export const TITLE_IMAGE_MAX_INPUT_BYTES = 5 * 1024 * 1024;

const imageTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function validateTitleImage(fileName: string, mimeType: string | null | undefined, size: number) {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const normalizedMime = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (!imageTypes[extension] || (normalizedMime && normalizedMime !== imageTypes[extension])) {
    return { valid: false as const, message: 'Choose a JPG, PNG, or WebP image.' };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false as const, message: 'The selected image is empty or its size could not be read.' };
  }
  if (size > TITLE_IMAGE_MAX_INPUT_BYTES) {
    return { valid: false as const, message: 'Images must be 5 MB or smaller. Choose a smaller file and retry.' };
  }
  return { valid: true as const };
}
