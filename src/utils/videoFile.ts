export const VIDEO_MIME_TYPES: Record<string, string> = {
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  ts: 'video/mp2t',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
};

const MIME_EXTENSIONS = new Map(
  Object.entries(VIDEO_MIME_TYPES).map(([extension, mimeType]) => [mimeType, extension]),
);

export type DetectedVideoType = {
  extension: string;
  originalExtension: string | null;
  mimeType: string;
};

export function getFileExtension(fileName: string) {
  const match = /\.([^.]+)$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

export function detectVideoFileType(
  fileName: string,
  mimeType?: string | null,
): DetectedVideoType | null {
  const originalExtension = getFileExtension(fileName) || null;
  const normalizedMimeType = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const extensionMimeType = originalExtension ? VIDEO_MIME_TYPES[originalExtension] : undefined;

  if (extensionMimeType) {
    return {
      extension: originalExtension!,
      originalExtension,
      mimeType: extensionMimeType,
    };
  }

  const mimeExtension = MIME_EXTENSIONS.get(normalizedMimeType);
  if (mimeExtension) {
    return {
      extension: mimeExtension,
      originalExtension,
      mimeType: normalizedMimeType,
    };
  }

  if (normalizedMimeType === 'application/octet-stream' || normalizedMimeType === '') {
    return null;
  }

  if (normalizedMimeType.startsWith('video/')) {
    return {
      extension: originalExtension ?? '',
      originalExtension,
      mimeType: 'application/octet-stream',
    };
  }

  return null;
}

export function validateVideoFileSize(size: number, maxSize: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false as const, message: 'The selected video is empty or its size could not be read.' };
  }

  if (size > maxSize) {
    const actualSize = `${(size / 1024 ** 3).toFixed(2)} GB (${size.toLocaleString()} bytes)`;
    const maximumSize = `${(maxSize / 1024 ** 3).toFixed(2)} GB`;
    return {
      valid: false as const,
      message: `This video is ${actualSize}. The maximum file size is ${maximumSize}.`,
    };
  }

  return { valid: true as const };
}

export function isVideoFormatLikelySupported(
  extension: string | null | undefined,
  platform: 'ios' | 'android' | 'web' | 'other',
) {
  const normalizedExtension = extension?.replace(/^\./, '').toLowerCase();
  if (!normalizedExtension) {
    return false;
  }

  if (platform === 'ios') {
    return ['3gp', 'm4v', 'mov', 'mp4'].includes(normalizedExtension);
  }
  if (platform === 'android') {
    return ['3gp', 'm4v', 'mkv', 'mov', 'mp4', 'ts', 'webm'].includes(normalizedExtension);
  }
  if (platform === 'web') {
    return ['m4v', 'mov', 'mp4', 'webm'].includes(normalizedExtension);
  }

  return false;
}
