import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import {
  MAX_TRAILER_FILE_SIZE_BYTES,
  MAX_VIDEO_FILE_SIZE_BYTES,
} from '../../../src/constants/video';
import { HttpError } from '../http/errors';

export type UploadInput = {
  fileName: string;
  fileSize: number;
  contentType: string;
  objectType: 'movie' | 'episode';
  kind: 'video' | 'trailer';
};

export function validateUploadInput(value: unknown): UploadInput {
  if (typeof value !== 'object' || value === null) {
    throw new HttpError(400, 'INVALID_UPLOAD', 'Upload details are required.');
  }
  const input = value as Record<string, unknown>;
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  const contentType =
    typeof input.contentType === 'string' ? input.contentType.trim().toLowerCase() : '';
  const fileSize = input.fileSize;
  const objectType = input.objectType ?? 'movie';
  const kind = input.kind ?? 'video';

  if (
    !fileName ||
    fileName.length > 255 ||
    /[/\\\u0000-\u001f\u007f]/.test(fileName) ||
    fileName === '.' ||
    fileName === '..'
  ) {
    throw new HttpError(400, 'INVALID_FILE_NAME', 'Choose a valid video file name.');
  }
  if (
    typeof fileSize !== 'number' ||
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 0 ||
    fileSize > (kind === 'trailer' ? MAX_TRAILER_FILE_SIZE_BYTES : MAX_VIDEO_FILE_SIZE_BYTES)
  ) {
    throw new HttpError(400, 'INVALID_FILE_SIZE', 'The video size must be between 1 byte and 1 GiB.');
  }
  if (!(contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
    throw new HttpError(400, 'INVALID_CONTENT_TYPE', 'Choose a video with a valid video content type.');
  }
  if (objectType !== 'movie' && objectType !== 'episode') {
    throw new HttpError(400, 'INVALID_OBJECT_TYPE', 'Choose a valid video type.');
  }
  if (kind !== 'video' && kind !== 'trailer') {
    throw new HttpError(400, 'INVALID_UPLOAD_KIND', 'Choose a valid upload kind.');
  }

  return { fileName, fileSize, contentType, objectType, kind };
}

export function generateObjectKey(
  fileName: string,
  id = randomUUID(),
  objectType: 'movie' | 'episode' | 'trailer' = 'movie',
) {
  const extension = extname(fileName).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '';
  const prefix = objectType === 'episode' ? 'episodes' : objectType === 'trailer' ? 'trailers' : 'movies';
  return `${prefix}/${id}${safeExtension}`;
}

export function validatePartNumbers(value: unknown, maximumParts: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumParts) {
    throw new HttpError(400, 'INVALID_PART_NUMBERS', 'Provide a valid list of upload part numbers.');
  }
  const partNumbers = value as unknown[];
  if (
    partNumbers.some(
      (partNumber) =>
        typeof partNumber !== 'number' ||
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > maximumParts,
    ) ||
    new Set(partNumbers).size !== partNumbers.length
  ) {
    throw new HttpError(400, 'INVALID_PART_NUMBERS', 'Upload part numbers must be unique and in range.');
  }
  return partNumbers as number[];
}

export function validateCompletedParts(value: unknown, maximumParts: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumParts) {
    throw new HttpError(400, 'INVALID_PARTS', 'Provide a valid list of uploaded parts.');
  }

  const parts = value as unknown[];
  const normalized = parts.map((part) => {
    if (typeof part !== 'object' || part === null) {
      throw new HttpError(400, 'INVALID_PARTS', 'Each uploaded part must include its number and ETag.');
    }
    const candidate = part as Record<string, unknown>;
    if (
      typeof candidate.partNumber !== 'number' ||
      !Number.isInteger(candidate.partNumber) ||
      candidate.partNumber < 1 ||
      candidate.partNumber > maximumParts ||
      typeof candidate.etag !== 'string' ||
      !/^"?[a-fA-F0-9-]{8,128}"?$/.test(candidate.etag)
    ) {
      throw new HttpError(400, 'INVALID_PARTS', 'Each uploaded part must include a valid number and ETag.');
    }
    return { PartNumber: candidate.partNumber, ETag: candidate.etag };
  });
  normalized.sort((left, right) => left.PartNumber - right.PartNumber);
  if (
    new Set(normalized.map((part) => part.PartNumber)).size !== normalized.length ||
    normalized.some((part, index) => part.PartNumber !== index + 1)
  ) {
    throw new HttpError(400, 'INVALID_PARTS', 'Uploaded parts must be complete and in order.');
  }
  return normalized;
}
