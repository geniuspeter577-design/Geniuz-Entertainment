import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';
import { File, FileMode, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import type ReactNativeTcpSocket from 'react-native-tcp-socket';

import type { ContentItem } from '../models/content';
import { logger } from '../utils/logger';
import type { OfflineDownloadRecord } from './OfflineDownloadService';
import {
  base64ToBytes,
  bytesToBase64,
  encodeTransferFrame,
  getTransferChunkCount,
  getTransferChunkSize,
  getTransferResumeBytes,
  TransferFrameParser,
  TRANSFER_CHUNK_BYTES,
  type TransferFrame,
} from '../utils/deviceTransferProtocol';

type TransferAddress = {
  ip: string;
  port: number;
  sessionId: string;
  sessionToken: string;
};

type TransferManifest = {
  sessionId: string;
  contentId: string;
  itemType: 'movie' | 'series';
  parentSeriesId: string | null;
  fileName: string;
  title: string;
  fileSizeBytes: number;
  fileSha256: string;
};

type ReceiverCallbacks = {
  canReceive: (contentId: string) => boolean;
  onProgress: (receivedBytes: number, totalBytes: number) => void;
  onReceived: (item: ContentItem, filePath: string, size: number) => Promise<void>;
  onComplete: (title: string) => void;
  onError: (message: string) => void;
};

type SenderOptions = {
  address: TransferAddress;
  record: OfflineDownloadRecord;
  accessToken: string;
  signal: AbortSignal;
  onProgress: (sentBytes: number, totalBytes: number) => void;
};

type TcpSocket = InstanceType<typeof ReactNativeTcpSocket.Socket>;
type TcpServer = InstanceType<typeof ReactNativeTcpSocket.Server>;
type HashState = ReturnType<typeof sha256.create>;

type ActiveReceiver = {
  accessToken: string;
  callbacks: ReceiverCallbacks;
  hash?: HashState;
  nextChunk: number;
  fileHandle?: ReturnType<File['open']>;
  partFile?: File;
  manifest?: TransferManifest;
  receivedBytes: number;
  sessionId: string;
  sessionToken: string;
  server: TcpServer;
  activeSocket?: TcpSocket;
  busy: boolean;
  stopped: boolean;
};

function toHex(bytes: Uint8Array) {
  return bytesToHex(bytes);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifest(value: unknown): value is TransferManifest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isUuid(value.sessionId) &&
    isUuid(value.contentId) &&
    (value.itemType === 'movie' || value.itemType === 'series') &&
    (value.parentSeriesId === null || isUuid(value.parentSeriesId)) &&
    typeof value.fileName === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value.fileName) &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    value.title.length <= 200 &&
    Number.isSafeInteger(value.fileSizeBytes) &&
    Number(value.fileSizeBytes) > 0 &&
    typeof value.fileSha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.fileSha256)
  );
}

function getApiUrl() {
  const value = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim();
  if (!value) {
    throw new Error('The Geniuz+ API is not configured for device transfer.');
  }
  return value.replace(/\/+$/, '');
}

async function transferApi(accessToken: string, path: string, body: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error('Could not reach the Geniuz+ transfer service. Check your connection and retry.', {
      cause: error,
    });
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error('The transfer service returned an invalid response.', { cause: error });
  }
  if (!response.ok) {
    const message =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'object' &&
      result.error !== null &&
      'message' in result.error &&
      typeof result.error.message === 'string'
        ? result.error.message
        : 'The transfer service rejected this request.';
    throw new Error(message);
  }
  return result;
}

function isNativeTransferAvailable() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

async function loadTcpSocket() {
  if (!isNativeTransferAvailable()) {
    throw new Error('Device transfer is available only in the iOS or Android app.');
  }
  try {
    return (await import('react-native-tcp-socket')).default;
  } catch (error) {
    throw new Error(
      'The native TCP service is unavailable. Install a Geniuz+ development build; Expo Go does not include device transfer.',
      { cause: error },
    );
  }
}

function getConnectionCode(address: TransferAddress) {
  return `${address.ip}|${address.port}|${address.sessionId}|${address.sessionToken}`;
}

function getSafeExtension(fileName: string) {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  return extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'mp4';
}

export function parseTransferConnectionCode(value: string): TransferAddress {
  const [ip, portText, sessionId, sessionToken, extra] = value.trim().split('|');
  const port = Number(portText);
  if (
    extra !== undefined ||
    !ip ||
    !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) ||
    ip.split('.').some((part) => Number(part) > 255) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !isUuid(sessionId) ||
    !/^[a-f0-9]{64}$/i.test(sessionToken ?? '')
  ) {
    throw new Error('Enter the complete receive code exactly as shown on the other device.');
  }
  return { ip, port, sessionId, sessionToken };
}

class FrameChannel {
  private readonly parser = new TransferFrameParser();
  private readonly frames: TransferFrame[] = [];
  private waiter?: {
    resolve: (frame: TransferFrame) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  };
  private closedError?: Error;

  constructor(private readonly socket: TcpSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (data) => {
      try {
        for (const frame of this.parser.push(typeof data === 'string' ? data : data.toString('utf8'))) {
          if (this.waiter) {
            clearTimeout(this.waiter.timeout);
            const currentWaiter = this.waiter;
            this.waiter = undefined;
            currentWaiter.resolve(frame);
          } else {
            this.frames.push(frame);
          }
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('Transfer message parsing failed.'));
      }
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('The device connection closed.')));
  }

  async send(frame: TransferFrame) {
    const encoded = encodeTransferFrame(frame);
    await new Promise<void>((resolve, reject) => {
      this.socket.write(encoded, 'utf8', (error) => (error ? reject(error) : resolve()));
    });
  }

  next(timeoutMs = 20_000): Promise<TransferFrame> {
    const frame = this.frames.shift();
    if (frame) {
      return Promise.resolve(frame);
    }
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiter = undefined;
        reject(new Error('The other device did not respond in time.'));
      }, timeoutMs);
      this.waiter = { resolve, reject, timeout };
    });
  }

  close() {
    this.socket.destroy();
  }

  private fail(error: Error) {
    if (this.closedError) {
      return;
    }
    this.closedError = error;
    if (this.waiter) {
      clearTimeout(this.waiter.timeout);
      this.waiter.reject(error);
      this.waiter = undefined;
    }
  }
}

async function readFileHash(file: File, fileSizeBytes: number) {
  const handle = file.open(FileMode.ReadOnly);
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < fileSizeBytes; offset += TRANSFER_CHUNK_BYTES) {
      handle.offset = offset;
      const bytes = handle.readBytes(Math.min(TRANSFER_CHUNK_BYTES, fileSizeBytes - offset));
      if (bytes.byteLength === 0) {
        throw new Error('The saved download could not be read completely.');
      }
      hash.update(bytes);
    }
    return toHex(hash.digest());
  } finally {
    handle.close();
  }
}

function buildReceivedItem(manifest: TransferManifest, filePath: string): ContentItem {
  return {
    id: manifest.contentId,
    source: 'geniuz',
    title: manifest.title,
    type: manifest.itemType,
    genres: [],
    ...(manifest.parentSeriesId ? { parentSeriesId: manifest.parentSeriesId } : {}),
    mediaPath: filePath,
    fileExtension: getSafeExtension(manifest.fileName),
    fileSizeBytes: manifest.fileSizeBytes,
    availability: {
      discoverable: true,
      stream: false,
      download: false,
      premium: false,
    },
  };
}

export class DeviceTransferService {
  private receiver?: ActiveReceiver;

  async startReceiver(accessToken: string, callbacks: ReceiverCallbacks) {
    if (!isNativeTransferAvailable()) {
      throw new Error('Device transfer is available only in the iOS or Android app.');
    }
    if (this.receiver) {
      throw new Error('A receive session is already running on this device.');
    }
    const ip = await Network.getIpAddressAsync();
    if (ip === '0.0.0.0') {
      throw new Error('Connect to the same Wi-Fi or hotspot as the sending device, then retry.');
    }
    const sessionToken = toHex(await Crypto.getRandomBytesAsync(32));
    const created = await transferApi(
      accessToken,
      '/api/transfers/sessions',
      { sessionToken },
    );
    if (
      !isRecord(created) ||
      !isUuid(created.sessionId) ||
      typeof created.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(created.expiresAt))
    ) {
      throw new Error('The transfer service returned an invalid session ID.');
    }
    const sessionId = created.sessionId;
    const expiresAt = created.expiresAt;

    let activeReceiver: ActiveReceiver | undefined;
    let server: TcpServer;
    try {
      const tcpSocket = await loadTcpSocket();
      server = tcpSocket.createServer((socket) => {
        if (!activeReceiver) {
          socket.destroy();
          return;
        }
        void this.handleReceiverConnection(activeReceiver, socket).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'The transfer could not be received.';
          activeReceiver?.callbacks.onError(message);
          socket.destroy();
        });
      });
    } catch (error) {
      throw new Error(
        'The native TCP service is unavailable. Install a Geniuz+ development build; Expo Go does not include device transfer.',
        { cause: error },
      );
    }

    const listening = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The local transfer server did not start.')), 15_000);
      server.once('listening', () => {
        clearTimeout(timeout);
        resolve();
      });
      server.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    activeReceiver = {
      accessToken,
      callbacks,
      nextChunk: 0,
      receivedBytes: 0,
      sessionId,
      sessionToken,
      server,
      busy: false,
      stopped: false,
    };
    server.on('error', (error) => {
      logger.error('[DeviceTransfer] The local receive server failed.', error);
      activeReceiver?.callbacks.onError('The local receive server failed. Stop the session and try again.');
    });
    server.listen({ port: 0, host: '0.0.0.0', reuseAddress: true });
    try {
      await listening;
    } catch (error) {
      server.close();
      throw new Error(
        'Could not start the local transfer server. Use a Geniuz+ development build and check local network permissions.',
        { cause: error },
      );
    }
    const address = server.address();
    if (!address || typeof address.port !== 'number') {
      server.close();
      throw new Error('The local transfer server did not provide a network port.');
    }
    this.receiver = activeReceiver;
    const connection = { ip, port: address.port, sessionId, sessionToken };
    return {
      ...connection,
      code: getConnectionCode(connection),
      expiresAt,
      stop: () => this.stopReceiver(),
    };
  }

  async stopReceiver() {
    const receiver = this.receiver;
    if (!receiver) {
      return;
    }
    this.receiver = undefined;
    receiver.stopped = true;
    receiver.activeSocket?.destroy();
    let fileCleanupError: unknown;
    try {
      receiver.fileHandle?.close();
    } catch (error) {
      logger.error('[DeviceTransfer] Could not close the incomplete transfer file.', error);
      fileCleanupError = error;
    }
    receiver.fileHandle = undefined;
    if (receiver.partFile?.exists) {
      try {
        receiver.partFile.delete();
      } catch (error) {
        fileCleanupError ??= error;
      }
    }
    receiver.partFile = undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        receiver.server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      if (fileCleanupError) {
        logger.error('[DeviceTransfer] Could not close the local receive server.', error);
      } else {
        throw error;
      }
    }
    if (fileCleanupError) {
      throw new Error('The receive session stopped, but its incomplete file could not be removed.', {
        cause: fileCleanupError,
      });
    }
  }

  async sendFile({ address, record, accessToken, signal, onProgress }: SenderOptions) {
    if (!isNativeTransferAvailable()) {
      throw new Error('Device transfer is available only in the iOS or Android app.');
    }
    if (record.status !== 'downloaded') {
      throw new Error('Only a verified downloaded file can be sent.');
    }
    const file = new File(record.filePath);
    const fileSizeBytes = file.size;
    if (fileSizeBytes !== record.size || fileSizeBytes > 1024 ** 3 || fileSizeBytes <= 0) {
      throw new Error('The saved file size could not be verified before sending.');
    }
    const fileSha256 = await readFileHash(file, fileSizeBytes);
    const fileExtension = record.item.fileExtension?.replace(/^\./, '').toLowerCase();
    const safeExtension =
      fileExtension && /^[a-z0-9]{1,8}$/.test(fileExtension) ? fileExtension : 'mp4';
    const fileName = `geniuz-${record.item.id}.${safeExtension}`;
    const parentSeriesId = record.item.parentSeriesId ?? null;
    const itemType = parentSeriesId || record.item.type === 'series' ? 'series' : 'movie';
    const authorized = await transferApi(accessToken, `/api/transfers/sessions/${address.sessionId}/authorize`, {
      sessionToken: address.sessionToken,
      contentId: record.item.id,
      itemType,
      parentSeriesId,
      fileName,
      title: record.item.title,
      fileSizeBytes,
      fileSha256,
    });
    if (
      !isRecord(authorized) ||
      typeof authorized.permit !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(authorized.permit)
    ) {
      throw new Error('The transfer service returned an invalid authorization permit.');
    }
    const permit = authorized.permit;

    const totalChunks = getTransferChunkCount(fileSizeBytes);
    let nextChunk = 0;
    let reconnects = 0;
    let completedTransfer = false;
    while (!completedTransfer) {
      if (signal.aborted) {
        throw new Error('Transfer canceled.');
      }
      let channel: FrameChannel | undefined;
      let abortChannel: (() => void) | undefined;
      try {
        channel = await connectChannel(address.ip, address.port, signal);
        abortChannel = () => channel?.close();
        signal.addEventListener('abort', abortChannel, { once: true });
        await channel.send({
          type: 'hello',
          sessionId: address.sessionId,
          sessionToken: address.sessionToken,
          permit,
        });
        const resume = await channel.next();
        if (resume.type === 'error') {
          throw new Error(resume.message);
        }
        if (
          resume.type !== 'resume' ||
          resume.nextChunk > totalChunks ||
          resume.receivedBytes !== getTransferResumeBytes(fileSizeBytes, resume.nextChunk)
        ) {
          throw new Error('The receiver returned an invalid resume position.');
        }
        nextChunk = resume.nextChunk;

        while (nextChunk < totalChunks) {
          if (signal.aborted) {
            throw new Error('Transfer canceled.');
          }
          const size = getTransferChunkSize(fileSizeBytes, nextChunk);
          const handle = file.open(FileMode.ReadOnly);
          let bytes: Uint8Array;
          try {
            handle.offset = nextChunk * TRANSFER_CHUNK_BYTES;
            bytes = handle.readBytes(size);
          } finally {
            handle.close();
          }
          if (bytes.byteLength !== size) {
            throw new Error('The saved download could not be read completely.');
          }

          let acknowledged = false;
          for (let attempt = 0; attempt < 4 && !acknowledged; attempt += 1) {
            await channel.send({
              type: 'chunk',
              index: nextChunk,
              bytes: size,
              payload: bytesToBase64(bytes),
            });
            const ack = await channel.next(15_000);
            if (ack.type === 'error') {
              throw new Error(ack.message);
            }
            const expectedNextChunk = nextChunk + 1;
            const expectedReceivedBytes = getTransferResumeBytes(fileSizeBytes, expectedNextChunk);
            if (
              ack.type === 'ack' &&
              ack.nextChunk === expectedNextChunk &&
              ack.receivedBytes === expectedReceivedBytes
            ) {
              nextChunk = expectedNextChunk;
              onProgress(expectedReceivedBytes, fileSizeBytes);
              acknowledged = true;
            }
          }
          if (!acknowledged) {
            throw new Error('The receiver did not acknowledge a file chunk after four attempts.');
          }
        }
        await channel.send({ type: 'finish' });
        const completed = await channel.next(30_000);
        if (completed.type !== 'complete' || completed.sha256 !== fileSha256) {
          throw new Error('The receiver could not verify the final SHA-256 hash.');
        }
        onProgress(fileSizeBytes, fileSizeBytes);
        completedTransfer = true;
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.message === 'Transfer canceled.')) {
          throw new Error('Transfer canceled.');
        }
        if (++reconnects >= 5) {
          throw error instanceof Error
            ? error
            : new Error('The transfer could not reconnect after repeated interruptions.');
        }
      } finally {
        if (abortChannel) {
          signal.removeEventListener('abort', abortChannel);
        }
        channel?.close();
      }
    }
  }

  private async handleReceiverConnection(receiver: ActiveReceiver, socket: TcpSocket) {
    if (receiver.busy || receiver.stopped) {
      socket.destroy();
      return;
    }
    receiver.busy = true;
    receiver.activeSocket = socket;
    const channel = new FrameChannel(socket);
    try {
      const hello = await channel.next();
      if (
        hello.type !== 'hello' ||
        hello.sessionId !== receiver.sessionId ||
        !constantTimeEqual(hello.sessionToken, receiver.sessionToken)
      ) {
        throw new Error('The sender used an invalid receive code.');
      }
      const verified = await transferApi(
        receiver.accessToken,
        `/api/transfers/sessions/${receiver.sessionId}/verify`,
        { permit: hello.permit },
      );
      if (
        !isRecord(verified) ||
        !isManifest(verified.transfer) ||
        verified.transfer.sessionId !== receiver.sessionId
      ) {
        throw new Error('The backend returned invalid transfer details.');
      }
      const manifest = verified.transfer;
      if (receiver.manifest && !this.sameManifest(receiver.manifest, manifest)) {
        throw new Error('The reconnected sender selected a different file.');
      }
      if (!receiver.manifest) {
        if (!receiver.callbacks.canReceive(manifest.contentId)) {
          throw new Error('This title is already saved on the receiving device. Delete the existing copy first.');
        }
        receiver.manifest = manifest;
        receiver.nextChunk = 0;
        receiver.receivedBytes = 0;
        receiver.hash = sha256.create();
        receiver.partFile = new File(Paths.document, `geniuz-received-${manifest.sessionId}.part`);
        receiver.partFile.create({ overwrite: true });
        receiver.fileHandle = receiver.partFile.open(FileMode.ReadWrite);
      }
      await channel.send({
        type: 'resume',
        nextChunk: receiver.nextChunk,
        receivedBytes: receiver.receivedBytes,
      });

      const totalChunks = getTransferChunkCount(manifest.fileSizeBytes);
      while (!receiver.stopped) {
        const frame = await channel.next(60_000);
        if (frame.type === 'chunk') {
          if (frame.index < receiver.nextChunk) {
            await channel.send({
              type: 'ack',
              nextChunk: receiver.nextChunk,
              receivedBytes: receiver.receivedBytes,
            });
            continue;
          }
          if (frame.index !== receiver.nextChunk || frame.index >= totalChunks) {
            throw new Error('The sender sent a chunk out of order.');
          }
          const expectedBytes = getTransferChunkSize(manifest.fileSizeBytes, frame.index);
          const bytes = base64ToBytes(frame.payload);
          if (frame.bytes !== expectedBytes || bytes.byteLength !== expectedBytes) {
            throw new Error('The sender sent an incomplete file chunk.');
          }
          if (!receiver.fileHandle || !receiver.hash) {
            throw new Error('The receiver file is not ready.');
          }
          receiver.fileHandle.offset = receiver.receivedBytes;
          receiver.fileHandle.writeBytes(bytes);
          receiver.hash.update(bytes);
          receiver.nextChunk += 1;
          receiver.receivedBytes += bytes.byteLength;
          receiver.callbacks.onProgress(receiver.receivedBytes, manifest.fileSizeBytes);
          await channel.send({
            type: 'ack',
            nextChunk: receiver.nextChunk,
            receivedBytes: receiver.receivedBytes,
          });
          continue;
        }
        if (frame.type === 'finish') {
          if (
            receiver.nextChunk !== totalChunks ||
            receiver.receivedBytes !== manifest.fileSizeBytes ||
            !receiver.hash ||
            !receiver.partFile
          ) {
            throw new Error('The sender finished before all file chunks arrived.');
          }
          const actualSha256 = toHex(receiver.hash.digest());
          if (!constantTimeEqual(actualSha256, manifest.fileSha256)) {
            this.resetIncompleteReceiver(receiver);
            throw new Error('The received file SHA-256 did not match the sender.');
          }
          receiver.fileHandle?.close();
          receiver.fileHandle = undefined;
          const finalFile = new File(
            Paths.document,
            `geniuz-received-${manifest.sessionId}.${getSafeExtension(manifest.fileName)}`,
          );
          receiver.partFile.move(finalFile);
          const item = buildReceivedItem(manifest, finalFile.uri);
          try {
            await receiver.callbacks.onReceived(item, finalFile.uri, manifest.fileSizeBytes);
          } catch (error) {
            if (finalFile.exists) {
              try {
                finalFile.delete();
              } catch (cleanupError) {
                logger.error('[DeviceTransfer] Could not remove an unregistered received file.', cleanupError);
              }
            }
            this.resetIncompleteReceiver(receiver);
            throw error;
          }
          await transferApi(receiver.accessToken, `/api/transfers/sessions/${receiver.sessionId}/progress`, {
            nextChunk: totalChunks,
            receivedBytes: manifest.fileSizeBytes,
          });
          await transferApi(receiver.accessToken, `/api/transfers/sessions/${receiver.sessionId}/complete`, {});
          await channel.send({ type: 'complete', sha256: actualSha256 });
          receiver.callbacks.onComplete(manifest.title);
          receiver.partFile = undefined;
          receiver.manifest = undefined;
          receiver.hash = undefined;
          receiver.nextChunk = 0;
          receiver.receivedBytes = 0;
          receiver.stopped = true;
          this.receiver = undefined;
          receiver.server.close();
          return;
        }
        if (frame.type === 'error') {
          throw new Error(frame.message);
        }
        throw new Error('The sender sent an unexpected transfer message.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The transfer could not be received.';
      try {
        await channel.send({ type: 'error', message: message.slice(0, 200) });
      } catch (sendError) {
        logger.warn('[DeviceTransfer] Could not send a transfer error to the sender.', sendError);
      }
      throw error;
    } finally {
      receiver.busy = false;
      receiver.activeSocket = undefined;
      channel.close();
    }
  }

  private sameManifest(left: TransferManifest, right: TransferManifest) {
    return (
      left.contentId === right.contentId &&
      left.itemType === right.itemType &&
      left.parentSeriesId === right.parentSeriesId &&
      left.fileName === right.fileName &&
      left.title === right.title &&
      left.fileSizeBytes === right.fileSizeBytes &&
      left.fileSha256 === right.fileSha256
    );
  }

  private resetIncompleteReceiver(receiver: ActiveReceiver) {
    receiver.fileHandle?.close();
    receiver.fileHandle = undefined;
    if (receiver.partFile?.exists) {
      try {
        receiver.partFile.delete();
      } catch (error) {
        logger.error('[DeviceTransfer] Could not remove an incomplete transfer file.', error);
      }
    }
    receiver.partFile = undefined;
    receiver.manifest = undefined;
    receiver.hash = undefined;
    receiver.nextChunk = 0;
    receiver.receivedBytes = 0;
  }
}

async function connectChannel(host: string, port: number, signal: AbortSignal) {
  const tcpSocket = await loadTcpSocket();
  return new Promise<FrameChannel>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        cleanup();
        reject(new Error('Transfer canceled.'));
      }
    };
    const socket = tcpSocket.createConnection(
      { host, port, connectTimeout: 15_000, reuseAddress: true },
      () => {
        settled = true;
        cleanup();
        resolve(new FrameChannel(socket));
      },
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    socket.once('error', (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
    socket.once('close', () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Could not connect to the receiving device.'));
      }
    });
  });
}

export const deviceTransferService = new DeviceTransferService();
