export class PlaybackError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PlaybackError';
  }
}

export function getPlaybackErrorDetails(error: unknown) {
  if (error instanceof PlaybackError) {
    return { status: error.status, code: error.code };
  }

  if (typeof error !== 'object' || error === null) {
    return { status: undefined, code: undefined };
  }

  const candidate = error as Record<string, unknown>;
  const statusValue = candidate.status ?? candidate.statusCode;
  const status =
    typeof statusValue === 'number'
      ? statusValue
      : typeof statusValue === 'string' && /^\d{3}$/.test(statusValue)
        ? Number(statusValue)
        : undefined;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  return { status, code };
}

export function isExpiredPlaybackLinkError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
  const { status, code } = getPlaybackErrorDetails(error);
  return (
    status === 401 ||
    status === 403 ||
    /(?:expired|unauthori[sz]ed|forbidden|signaturedoesnotmatch|request has expired)/i.test(
      `${message} ${code ?? ''}`,
    )
  );
}

export function getFriendlyPlaybackError(isOnline: boolean, error?: unknown): string {
  if (!isOnline) {
    return "You're offline. Connect to the internet, or play a downloaded title.";
  }
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
  if (/(?:unsupported|codec|decoder|video format)/i.test(message)) {
    return 'This video format is not supported on this device. Try an MP4 version.';
  }
  return 'This video could not be played. Check your connection and try again.';
}