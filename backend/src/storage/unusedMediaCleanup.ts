import type { SupabaseClient } from '@supabase/supabase-js';

import { HttpError } from '../http/errors';

const MEDIA_PREFIXES = new Set(['movies', 'episodes', 'trailers', 'subtitles']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\\]/;
const REFERENCE_TABLES = ['movies', 'episodes'] as const;
const REFERENCE_PAGE_SIZE = 1000;

export type MediaObject = {
  key: string;
  sizeBytes: number;
  lastModified: string;
};

export type IncompleteMultipartUpload = {
  key: string;
  uploadId: string;
  initiatedAt: string;
  ageHours: number;
  uploadedSizeBytes?: number;
};

export function multipartUploadIdentity(upload: Pick<IncompleteMultipartUpload, 'key' | 'uploadId'>) {
  return `${upload.key}\u0000${upload.uploadId}`;
}

export function isManagedMediaKey(key: string) {
  const [prefix, ...segments] = key.split('/');
  return (
    MEDIA_PREFIXES.has(prefix) &&
    segments.length > 0 &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !CONTROL_CHARACTERS.test(segment))
  );
}

function mediaKeyFromString(value: string): string | undefined {
  const trimmed = value.trim();
  if (isManagedMediaKey(trimmed)) {
    return trimmed;
  }

  let pathname: string;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    return undefined;
  }

  const segments = pathname.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  const prefixIndex = segments.findIndex((segment) => MEDIA_PREFIXES.has(segment));
  if (prefixIndex < 0) {
    return undefined;
  }
  const key = segments.slice(prefixIndex).join('/');
  return isManagedMediaKey(key) ? key : undefined;
}

export function collectReferencedMediaKeys(value: unknown, keys = new Set<string>()) {
  if (typeof value === 'string') {
    const key = mediaKeyFromString(value);
    if (key) {
      keys.add(key);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencedMediaKeys(item, keys);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectReferencedMediaKeys(item, keys);
    }
  }
  return keys;
}

export function findUnusedMediaFiles(
  objects: readonly MediaObject[],
  referencedKeys: ReadonlySet<string>,
  now: number,
  minimumAgeHours: number,
) {
  const cutoff = now - minimumAgeHours * 60 * 60 * 1000;
  return objects
    .filter((object) => {
      const modifiedAt = Date.parse(object.lastModified);
      return (
        isManagedMediaKey(object.key) &&
        Number.isFinite(modifiedAt) &&
        modifiedAt <= cutoff &&
        !referencedKeys.has(object.key)
      );
    })
    .sort((first, second) => first.lastModified.localeCompare(second.lastModified) || first.key.localeCompare(second.key));
}

export async function loadReferencedMediaKeys(client: SupabaseClient) {
  const referencedKeys = new Set<string>();
  for (const table of REFERENCE_TABLES) {
    let offset = 0;
    while (true) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .order('id', { ascending: true })
        .range(offset, offset + REFERENCE_PAGE_SIZE - 1);
      if (error) {
        throw new HttpError(502, 'MEDIA_REFERENCE_SCAN_FAILED', 'Could not safely scan title file references.');
      }
      const records = Array.isArray(data) ? data : [];
      for (const record of records) {
        collectReferencedMediaKeys(record, referencedKeys);
      }
      if (records.length < REFERENCE_PAGE_SIZE) {
        break;
      }
      offset += records.length;
    }
  }
  return referencedKeys;
}

export async function scanUnusedMediaFiles(
  storage: { listMediaObjects: () => Promise<MediaObject[]> },
  client: SupabaseClient,
  minimumAgeHours: number,
  now = Date.now(),
) {
  const [objects, referencedKeys] = await Promise.all([
    storage.listMediaObjects(),
    loadReferencedMediaKeys(client),
  ]);
  return findUnusedMediaFiles(objects, referencedKeys, now, minimumAgeHours);
}

export function findIncompleteMultipartUploads(
  uploads: readonly Omit<IncompleteMultipartUpload, 'ageHours'>[],
  referencedKeys: ReadonlySet<string>,
  now: number,
  minimumAgeHours: number,
  activeUploads: ReadonlySet<string> = new Set(),
): IncompleteMultipartUpload[] {
  const minimumAgeMs = minimumAgeHours * 60 * 60 * 1000;
  return uploads
    .flatMap((upload) => {
      const initiatedAt = Date.parse(upload.initiatedAt);
      const ageMs = now - initiatedAt;
      if (
        !isManagedMediaKey(upload.key) ||
        !upload.uploadId ||
        !Number.isFinite(initiatedAt) ||
        ageMs < minimumAgeMs ||
        referencedKeys.has(upload.key) ||
        activeUploads.has(multipartUploadIdentity(upload))
      ) {
        return [];
      }
      return [{ ...upload, ageHours: Math.floor(ageMs / (60 * 60 * 1000)) }];
    })
    .sort((first, second) => first.initiatedAt.localeCompare(second.initiatedAt) || first.key.localeCompare(second.key));
}

export async function scanIncompleteMultipartUploads(
  storage: { listIncompleteMultipartUploads: () => Promise<Omit<IncompleteMultipartUpload, 'ageHours'>[]> },
  client: SupabaseClient,
  minimumAgeHours: number,
  now = Date.now(),
  activeUploads: ReadonlySet<string> = new Set(),
) {
  const [uploads, referencedKeys] = await Promise.all([
    storage.listIncompleteMultipartUploads(),
    loadReferencedMediaKeys(client),
  ]);
  return findIncompleteMultipartUploads(uploads, referencedKeys, now, minimumAgeHours, activeUploads);
}

export async function deleteListedIncompleteMultipartUploads(
  storage: {
    listIncompleteMultipartUploads: () => Promise<Omit<IncompleteMultipartUpload, 'ageHours'>[]>;
    abortMultipartUpload: (key: string, uploadId: string) => Promise<void>;
  },
  client: SupabaseClient,
  listedUploads: readonly IncompleteMultipartUpload[],
  minimumAgeHours: number,
  now = Date.now(),
  activeUploads: ReadonlySet<string> = new Set(),
) {
  const currentUploads = await scanIncompleteMultipartUploads(
    storage,
    client,
    minimumAgeHours,
    now,
    activeUploads,
  );
  const currentByIdentity = new Map(currentUploads.map((upload) => [multipartUploadIdentity(upload), upload]));
  const candidates = listedUploads.flatMap((upload) => {
    const current = currentByIdentity.get(multipartUploadIdentity(upload));
    return current ? [current] : [];
  });
  const deleted: IncompleteMultipartUpload[] = [];
  const failures: { key: string; uploadId: string; message: string }[] = [];
  let bytesFreed = 0;

  for (const upload of candidates) {
    try {
      await storage.abortMultipartUpload(upload.key, upload.uploadId);
      deleted.push(upload);
      bytesFreed += upload.uploadedSizeBytes ?? 0;
      console.info('[UnusedMediaCleanup] Aborted stale multipart upload.', {
        key: upload.key,
        uploadId: upload.uploadId,
        uploadedSizeBytes: upload.uploadedSizeBytes,
      });
    } catch (error) {
      console.error('[UnusedMediaCleanup] Failed to abort stale multipart upload.', {
        key: upload.key,
        uploadId: upload.uploadId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      failures.push({
        key: upload.key,
        uploadId: upload.uploadId,
        message: 'Backblaze could not abort this multipart upload.',
      });
    }
  }

  return {
    deleted,
    failures,
    skipped: listedUploads.length - candidates.length,
    bytesFreed,
  };
}

export async function deleteListedUnusedMediaFiles(
  storage: {
    listMediaObjects: () => Promise<MediaObject[]>;
    deleteObject: (key: string) => Promise<void>;
  },
  client: SupabaseClient,
  listedFiles: readonly MediaObject[],
  minimumAgeHours: number,
  now = Date.now(),
) {
  const currentFiles = await scanUnusedMediaFiles(storage, client, minimumAgeHours, now);
  const currentlyUnused = new Map(currentFiles.map((file) => [file.key, file]));
  const candidates = listedFiles.flatMap((file) => {
    const current = currentlyUnused.get(file.key);
    return current ? [current] : [];
  });
  const deleted: MediaObject[] = [];
  const failures: { key: string; sizeBytes: number; message: string }[] = [];

  for (let start = 0; start < candidates.length; start += 10) {
    const batch = candidates.slice(start, start + 10);
    await Promise.all(batch.map(async (file) => {
      try {
        await storage.deleteObject(file.key);
        console.info('[UnusedMediaCleanup] Deleted unused media file.', {
          key: file.key,
          sizeBytes: file.sizeBytes,
        });
        deleted.push(file);
      } catch (error) {
        console.error('[UnusedMediaCleanup] Failed to delete unused media file.', {
          key: file.key,
          sizeBytes: file.sizeBytes,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        failures.push({
          key: file.key,
          sizeBytes: file.sizeBytes,
          message: 'Backblaze could not delete this file.',
        });
      }
    }));
  }

  return {
    deleted,
    failures,
    skipped: listedFiles.length - candidates.length,
  };
}