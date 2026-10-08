import type { DownloadProgress } from 'expo-file-system';

import { MAX_VIDEO_FILE_SIZE_BYTES } from '../constants/video';
import type { ContentItem } from '../models/content';
import { downloadInOrder } from '../utils/downloadQueue';
import { formatFileSize } from '../utils/formatFileSize.cjs';

export type OfflineDownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'failed'
  | 'canceled';

export type OfflineDownloadRecord = {
  item: ContentItem;
  filePath: string;
  posterFilePath?: string;
  size: number;
  status: OfflineDownloadStatus;
  progress: number;
  date: string;
};

export type DownloadStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type DownloadTask = {
  downloadAsync(): Promise<{ uri: string } | null>;
  pauseAsync?(): Promise<void>;
  resumeAsync?(): Promise<{ uri: string } | null>;
  cancel?(): void;
};

export type DownloadFileSystem = {
  availableDiskSpace(): number;
  getFilePath(item: ContentItem): string;
  createDownloadTask(
    url: string,
    filePath: string,
    options: {
      onProgress: (progress: DownloadProgress) => void;
      signal: AbortSignal;
    },
  ): DownloadTask;
  fileExists(filePath: string): boolean;
  getFileSize(filePath: string): number | null;
  deleteFile(filePath: string): void;
  getPosterFilePath?(item: ContentItem): string;
  downloadPoster?(url: string, filePath: string, signal: AbortSignal): Promise<void>;
};

const STORAGE_KEY = '@geniuz/downloads/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDownloadRecord(value: unknown): value is OfflineDownloadRecord {
  if (!isRecord(value) || !isRecord(value.item) || !isRecord(value.item.availability)) {
    return false;
  }

  return (
    typeof value.item.id === 'string' &&
    typeof value.item.title === 'string' &&
    typeof value.filePath === 'string' &&
    (value.posterFilePath === undefined || typeof value.posterFilePath === 'string') &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size > 0 &&
    (value.status === 'queued' ||
      value.status === 'downloading' ||
      value.status === 'paused' ||
      value.status === 'downloaded' ||
      value.status === 'failed' ||
      value.status === 'canceled') &&
    typeof value.progress === 'number' &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 100 &&
    typeof value.date === 'string'
  );
}

export class OfflineDownloadService {
  private records: OfflineDownloadRecord[] = [];
  private readonly listeners = new Set<(records: OfflineDownloadRecord[]) => void>();
  private readonly activeDownloads = new Map<
    string,
    {
      controller: AbortController;
      operation?: Promise<void>;
      size: number;
      task?: DownloadTask;
      resolveResume?: () => void;
      rejectResume?: (error: Error) => void;
    }
  >();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: DownloadStorage,
    private readonly fileSystem: DownloadFileSystem,
    private readonly getSignedUrl: (item: ContentItem) => Promise<string>,
    private readonly maxFileSize = MAX_VIDEO_FILE_SIZE_BYTES,
  ) {}

  getRecords() {
    return this.records;
  }

  subscribe(listener: (records: OfflineDownloadRecord[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load() {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (raw === null) {
      this.records = [];
      this.emit();
      return;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.downloads)) {
      throw new Error('Saved downloads have an unsupported format.');
    }
    const rawDownloads = parsed.downloads as unknown[];
    const savedDownloads = rawDownloads.map((record) => {
      if (!isDownloadRecord(record)) {
        throw new Error('Saved download records are invalid.');
      }
      return record;
    });

    const restored: OfflineDownloadRecord[] = [];
    for (const record of savedDownloads) {
      if (
        (record.status === 'downloading' || record.status === 'paused') &&
        this.activeDownloads.has(record.item.id)
      ) {
        restored.push(record);
      } else if (record.status === 'downloading' || record.status === 'paused') {
        if (this.fileSystem.fileExists(record.filePath)) {
          this.fileSystem.deleteFile(record.filePath);
        }
        if (record.posterFilePath && this.fileSystem.fileExists(record.posterFilePath)) {
          this.fileSystem.deleteFile(record.posterFilePath);
        }
        restored.push({ ...record, status: 'failed', progress: 0 });
      } else if (record.status === 'queued') {
        restored.push({ ...record, status: 'failed', progress: 0 });
      } else if (record.status === 'downloaded' && !this.fileSystem.fileExists(record.filePath)) {
        restored.push({ ...record, status: 'failed', progress: 0 });
      } else {
        restored.push(record);
      }
    }

    this.records = restored;
    this.emit();
    if (restored.some((record, index) => record !== savedDownloads[index])) {
      await this.persist();
    }
  }

  async download(item: ContentItem) {
    const size = this.validateDownload(item);
    await this.startDownload(item, size, false);
  }

  async downloadSequentially(items: readonly ContentItem[]) {
    const uniqueItems = items.filter(
      (item, index) => items.findIndex((candidate) => candidate.id === item.id) === index,
    );
    const queue: { item: ContentItem; size: number }[] = [];
    for (const item of uniqueItems) {
      const existing = this.records.find((record) => record.item.id === item.id);
      if (existing?.status === 'downloaded' && this.fileSystem.fileExists(existing.filePath)) {
        continue;
      }
      if (existing?.status === 'downloading' || existing?.status === 'queued' || this.activeDownloads.has(item.id)) {
        throw new Error(`${item.title} is already in the download queue.`);
      }
      queue.push({ item, size: this.validateDownload(item) });
    }

    if (queue.length === 0) {
      return;
    }
    const date = new Date().toISOString();
    const queuedRecords = queue.map(({ item, size }): OfflineDownloadRecord => ({
      item,
      filePath: this.fileSystem.getFilePath(item),
      size,
      status: 'queued',
      progress: 0,
      date,
    }));
    this.records = [
      ...queuedRecords,
      ...this.records.filter((record) => !queuedRecords.some((queued) => queued.item.id === record.item.id)),
    ];
    this.emit();
    await this.persist();

    let firstError: unknown;
    await downloadInOrder(queue, async ({ item, size }) => {
      const queued = this.records.find((record) => record.item.id === item.id);
      if (queued?.status !== 'queued') {
        return;
      }
      try {
        await this.startDownload(item, size, true);
      } catch (error) {
        firstError ??= error;
      }
    });
    if (firstError) {
      throw firstError;
    }
  }

  private validateDownload(item: ContentItem) {
    if (!item.availability.download) {
      throw new Error('Downloads are not enabled for this title.');
    }
    if (!item.mediaPath) {
      throw new Error('This title does not have a downloadable video file.');
    }
    const size = item.fileSizeBytes;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new Error('This title’s file size is unavailable. Please try again later.');
    }
    if (size > this.maxFileSize) {
      throw new Error('This video exceeds the 1 GB download limit.');
    }
    return size;
  }

  private async startDownload(item: ContentItem, size: number, fromQueue: boolean) {
    const existing = this.records.find((record) => record.item.id === item.id);
    if (existing?.status === 'downloaded' && this.fileSystem.fileExists(existing.filePath)) {
      return;
    }
    if (this.activeDownloads.has(item.id)) {
      throw new Error('This title is already downloading.');
    }
    if (existing?.status === 'queued' && !fromQueue) {
      throw new Error('This title is already queued for download.');
    }

    const reservedSpace = [...this.activeDownloads.values()].reduce(
      (total, download) => total + download.size,
      0,
    );
    const availableSpace = this.fileSystem.availableDiskSpace();
    if (!Number.isFinite(availableSpace) || availableSpace < size + reservedSpace) {
      throw new Error(
        `There is not enough free storage for this ${formatFileSize(size)} video. Free up space and try again.`,
      );
    }

    const active: {
      controller: AbortController;
      operation?: Promise<void>;
      size: number;
      task?: DownloadTask;
      resolveResume?: () => void;
      rejectResume?: (error: Error) => void;
    } = {
      controller: new AbortController(),
      size,
    };
    this.activeDownloads.set(item.id, active);
    const operation = this.performDownload(item, size, active.controller.signal);
    active.operation = operation;
    try {
      await operation;
    } finally {
      this.activeDownloads.delete(item.id);
    }
  }

  async cancel(itemId: string) {
    const active = this.activeDownloads.get(itemId);
    if (!active) {
      const queued = this.records.find((record) => record.item.id === itemId && record.status === 'queued');
      if (queued) {
        await this.setRecord({ ...queued, status: 'canceled', progress: 0 });
      }
      return;
    }
    active.controller.abort();
    active.task?.cancel?.();
    active.rejectResume?.(new Error('Download canceled.'));
    await active.operation;
  }

  async pause(itemId: string) {
    const active = this.activeDownloads.get(itemId);
    if (!active?.task?.pauseAsync || !active.task.resumeAsync) {
      throw new Error('Pausing is not supported for this download on this device.');
    }
    await active.task.pauseAsync();
    const record = this.records.find((candidate) => candidate.item.id === itemId);
    if (record?.status === 'downloading') {
      await this.setRecord({ ...record, status: 'paused' });
    }
  }

  async resume(itemId: string) {
    const active = this.activeDownloads.get(itemId);
    const record = this.records.find((candidate) => candidate.item.id === itemId);
    if (!active || !record || record.status !== 'paused' || !active.resolveResume) {
      throw new Error('This download cannot be resumed. Retry it to start again.');
    }
    await this.setRecord({ ...record, status: 'downloading' });
    active.resolveResume();
    active.resolveResume = undefined;
    active.rejectResume = undefined;
  }

  async delete(itemId: string) {
    await this.cancel(itemId);
    const record = this.records.find((candidate) => candidate.item.id === itemId);
    if (record && this.fileSystem.fileExists(record.filePath)) {
      this.fileSystem.deleteFile(record.filePath);
    }
    if (record?.posterFilePath && this.fileSystem.fileExists(record.posterFilePath)) {
      this.fileSystem.deleteFile(record.posterFilePath);
    }
    this.records = this.records.filter((candidate) => candidate.item.id !== itemId);
    this.emit();
    await this.persist();
  }

  private async performDownload(item: ContentItem, size: number, signal: AbortSignal) {
    const filePath = this.fileSystem.getFilePath(item);
    const posterFilePath =
      item.posterUrl && this.fileSystem.getPosterFilePath && this.fileSystem.downloadPoster
        ? this.fileSystem.getPosterFilePath(item)
        : undefined;
    const record: OfflineDownloadRecord = {
      item,
      filePath,
      ...(posterFilePath ? { posterFilePath } : {}),
      size,
      status: 'downloading',
      progress: 0,
      date: new Date().toISOString(),
    };

    try {
      await this.setRecord(record);
      const signedUrl = await this.getSignedUrl(item);
      if (signal.aborted) {
        throw new Error('Download canceled.');
      }
      if (this.fileSystem.fileExists(filePath)) {
        this.fileSystem.deleteFile(filePath);
      }

      const task = this.fileSystem.createDownloadTask(signedUrl, filePath, {
        signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const progress =
            totalBytes > 0 ? Math.min(99, Math.floor((bytesWritten / totalBytes) * 100)) : 0;
          this.updateProgress(item.id, progress);
        },
      });
      const active = this.activeDownloads.get(item.id);
      if (active) {
        active.task = task;
      }
      let result: { uri: string } | null = null;
      try {
        result = await task.downloadAsync();
        while (!result && !signal.aborted) {
          await new Promise<void>((resolve, reject) => {
            const current = this.activeDownloads.get(item.id);
            if (!current) {
              reject(new Error('The download task is no longer active.'));
              return;
            }
            current.resolveResume = resolve;
            current.rejectResume = reject;
          });
          const current = this.activeDownloads.get(item.id);
          if (!current?.task?.resumeAsync) {
            throw new Error('This download cannot be resumed. Retry it to start again.');
          }
          result = await current.task.resumeAsync();
        }
      } catch {
        if (!signal.aborted) {
          throw new Error('The download failed. Check your connection and retry.');
        }
      }
      if (!result || signal.aborted) {
        throw new Error('Download canceled.');
      }

      const actualSize = this.fileSystem.getFileSize(filePath);
      if (actualSize === null || !Number.isFinite(actualSize) || actualSize <= 0) {
        throw new Error('The downloaded file could not be verified. Delete it and try again.');
      }
      if (actualSize !== size) {
        throw new Error('The downloaded file size did not match. Delete it and try again.');
      }
      let savedItem = item;
      let posterCached = false;
      if (posterFilePath && item.posterUrl && this.fileSystem.downloadPoster) {
        try {
          await this.fileSystem.downloadPoster(item.posterUrl, posterFilePath, signal);
          savedItem = { ...item, posterUrl: posterFilePath };
          posterCached = true;
        } catch (posterError) {
          if (this.fileSystem.fileExists(posterFilePath)) {
            this.fileSystem.deleteFile(posterFilePath);
          }
          if (signal.aborted) {
            throw posterError;
          }
          console.warn('[Downloads] Poster could not be cached for offline use.', posterError);
          savedItem = { ...item, posterUrl: undefined };
        }
      }
      await this.setRecord({
        ...record,
        item: savedItem,
        ...(posterCached ? {} : { posterFilePath: undefined }),
        status: 'downloaded',
        progress: 100,
        size: actualSize,
      });
    } catch (error) {
      if (this.fileSystem.fileExists(filePath)) {
        this.fileSystem.deleteFile(filePath);
      }
      if (posterFilePath && this.fileSystem.fileExists(posterFilePath)) {
        this.fileSystem.deleteFile(posterFilePath);
      }
      const canceled = signal.aborted;
      await this.setRecord({
        ...record,
        posterFilePath: undefined,
        status: canceled ? 'canceled' : 'failed',
        progress: 0,
      });
      if (!canceled) {
        throw error;
      }
    }
  }

  private updateProgress(itemId: string, progress: number) {
    this.records = this.records.map((record) =>
      record.item.id === itemId && record.status === 'downloading'
        ? { ...record, progress }
        : record,
    );
    this.emit();
  }

  private async setRecord(record: OfflineDownloadRecord) {
    this.records = [record, ...this.records.filter((candidate) => candidate.item.id !== record.item.id)];
    this.emit();
    await this.persist();
  }

  private async persist() {
    const value = JSON.stringify({ version: 1, downloads: this.records });
    const write = this.writeQueue.then(() => this.storage.setItem(STORAGE_KEY, value));
    this.writeQueue = write.catch(() => undefined);
    await write;
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.records);
    }
  }
}
export function formatBytes(bytes: number) {
  return formatFileSize(bytes);
}
