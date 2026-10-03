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