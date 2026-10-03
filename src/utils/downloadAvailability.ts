export function getDownloadUnavailableReason({
  allowed,
  platform,
  supported,
  availableBytes,
  fileSize,
}: {
  allowed: boolean;
  platform: 'ios' | 'android' | 'web' | 'other';
  supported: boolean;
  availableBytes: number;
  fileSize?: number;
}) {
  if (!allowed) {
    return 'Downloads are turned off for this title.';
  }
  if (platform === 'web') {
    return 'Offline downloads need the Geniuz+ phone app; they are not available in a browser.';
  }
  if (!supported) {
    return 'This video format is not supported for offline playback on this device.';
  }
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    return 'The video size is unavailable. Reopen this title while online and retry.';
  }
  if (!Number.isFinite(availableBytes) || availableBytes < fileSize) {
    return 'There is not enough free storage for this download. Free up space and try again.';
  }
  return undefined;
}
