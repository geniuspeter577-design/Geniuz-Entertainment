export const TRANSFER_CHUNK_BYTES = 256 * 1024;
export const MAX_TRANSFER_FILE_BYTES = 1024 ** 3;
const MAX_TRANSFER_FRAME_CHARACTERS = 400_000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function isTransferFrame(value: unknown): value is TransferFrame {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'hello':
      return (
        'sessionId' in value &&
        typeof value.sessionId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(value.sessionId) &&
        'sessionToken' in value &&
        typeof value.sessionToken === 'string' &&
        /^[0-9a-f]{64}$/i.test(value.sessionToken) &&
        'permit' in value &&
        typeof value.permit === 'string' &&
        /^[0-9a-f]{64}$/i.test(value.permit)
      );
    case 'resume':
    case 'ack':
      return (
        'nextChunk' in value &&
        Number.isSafeInteger(value.nextChunk) &&
        Number(value.nextChunk) >= 0 &&
        'receivedBytes' in value &&
        Number.isSafeInteger(value.receivedBytes) &&
        Number(value.receivedBytes) >= 0
      );
    case 'chunk':
      return (
        'index' in value &&
        Number.isSafeInteger(value.index) &&
        Number(value.index) >= 0 &&
        'bytes' in value &&
        Number.isSafeInteger(value.bytes) &&
        Number(value.bytes) > 0 &&
        Number(value.bytes) <= TRANSFER_CHUNK_BYTES &&
        'payload' in value &&
        typeof value.payload === 'string' &&
        value.payload.length <= MAX_TRANSFER_FRAME_CHARACTERS
      );
    case 'finish':
      return true;
    case 'complete':
      return (
        'sha256' in value &&
        typeof value.sha256 === 'string' &&
        /^[a-f0-9]{64}$/i.test(value.sha256)
      );
    case 'error':
      return 'message' in value && typeof value.message === 'string' && value.message.length <= 200;
    default:
      return false;
  }
}

export type TransferFrame =
  | { type: 'hello'; sessionId: string; sessionToken: string; permit: string }
  | { type: 'resume'; nextChunk: number; receivedBytes: number }
  | { type: 'chunk'; index: number; bytes: number; payload: string }
  | { type: 'ack'; nextChunk: number; receivedBytes: number }
  | { type: 'finish' }
  | { type: 'complete'; sha256: string }
  | { type: 'error'; message: string };

export function encodeTransferFrame(frame: TransferFrame) {
  return `${JSON.stringify(frame)}\n`;
}

export class TransferFrameParser {
  private buffered = '';

  push(data: string) {
    this.buffered += data;
    if (this.buffered.length > MAX_TRANSFER_FRAME_CHARACTERS && !this.buffered.includes('\n')) {
      throw new Error('Transfer message is too large.');
    }

    const frames: TransferFrame[] = [];
    let newlineIndex = this.buffered.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffered.slice(0, newlineIndex);
      this.buffered = this.buffered.slice(newlineIndex + 1);
      if (line.length > MAX_TRANSFER_FRAME_CHARACTERS) {
        throw new Error('Transfer message is too large.');
      }
      if (line.trim()) {
        const value: unknown = JSON.parse(line);
        if (!isTransferFrame(value)) {
          throw new Error('Transfer message is invalid.');
        }
        frames.push(value);
      }
      newlineIndex = this.buffered.indexOf('\n');
    }
    if (this.buffered.length > MAX_TRANSFER_FRAME_CHARACTERS) {
      throw new Error('Transfer message is too large.');
    }
    return frames;
  }
}

export function bytesToBase64(bytes: Uint8Array) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined
      ? '=='
      : third === undefined
        ? `${BASE64_ALPHABET[(second & 0x0f) << 2]}=`
        : `${BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)]}${BASE64_ALPHABET[third & 0x3f]}`;
  }
  return output;
}

export function base64ToBytes(value: string) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Transfer chunk encoding is invalid.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index]);
    const second = BASE64_ALPHABET.indexOf(value[index + 1]);
    const third = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
    const fourth = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
    bytes[outputIndex++] = (first << 2) | (second >> 4);
    if (outputIndex < bytes.length) {
      bytes[outputIndex++] = ((second & 0x0f) << 4) | (third >> 2);
    }
    if (outputIndex < bytes.length) {
      bytes[outputIndex++] = ((third & 0x03) << 6) | fourth;
    }
  }
  return bytes;
}

export function getTransferChunkCount(fileSizeBytes: number) {
  if (
    !Number.isSafeInteger(fileSizeBytes) ||
    fileSizeBytes <= 0 ||
    fileSizeBytes > MAX_TRANSFER_FILE_BYTES
  ) {
    throw new Error('The transfer file size is invalid.');
  }
  return Math.ceil(fileSizeBytes / TRANSFER_CHUNK_BYTES);
}

export function getTransferChunkSize(fileSizeBytes: number, index: number) {
  const count = getTransferChunkCount(fileSizeBytes);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new Error('The transfer chunk index is invalid.');
  }
  return Math.min(TRANSFER_CHUNK_BYTES, fileSizeBytes - index * TRANSFER_CHUNK_BYTES);
}

export function getTransferResumeBytes(fileSizeBytes: number, nextChunk: number) {
  const count = getTransferChunkCount(fileSizeBytes);
  if (!Number.isSafeInteger(nextChunk) || nextChunk < 0 || nextChunk > count) {
    throw new Error('The transfer resume position is invalid.');
  }
  return Math.min(fileSizeBytes, nextChunk * TRANSFER_CHUNK_BYTES);
}
