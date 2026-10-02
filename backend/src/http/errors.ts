export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function mapProviderError(error: unknown): HttpError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'NOT_CONFIGURED':
      return new HttpError(503, 'CATALOG_NOT_CONFIGURED', 'The catalog provider is not configured.');
    case 'RATE_LIMITED':
      return new HttpError(503, 'CATALOG_RATE_LIMITED', 'The catalog provider is temporarily rate limited.');
    case 'TIMEOUT':
      return new HttpError(504, 'CATALOG_TIMEOUT', 'The catalog provider did not respond in time.');
    case 'INVALID_RESPONSE':
    case 'UNAVAILABLE':
      return new HttpError(502, 'CATALOG_UNAVAILABLE', 'The catalog provider is temporarily unavailable.');
    default:
      return new HttpError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
  }
}
