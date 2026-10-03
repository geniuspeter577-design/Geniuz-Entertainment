export type ApiClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
};

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly requests = new Map<string, Promise<unknown>>();
  private startupRequest = true;

  constructor({ baseUrl, timeoutMs = 12_000, cacheTtlMs = 30_000 }: ApiClientOptions) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    let parsedBaseUrl: URL;

    try {
      parsedBaseUrl = new URL(normalizedBaseUrl);
    } catch {
      throw new Error('The Geniuz API base URL must be a valid HTTP or HTTPS URL.');
    }

    if (
      (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') ||
      parsedBaseUrl.username ||
      parsedBaseUrl.password
    ) {
      throw new Error('The Geniuz API base URL must use HTTP or HTTPS and must not contain credentials.');
    }

    this.baseUrl = normalizedBaseUrl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
  }

  async get<T>(path: string, params: QueryParams = {}): Promise<T> {
    const url = this.buildUrl(path, params);
    const key = url.toString();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    this.cache.delete(key);
    const existingRequest = this.requests.get(key);

    if (existingRequest) {
      return existingRequest as Promise<T>;
    }

    const request = this.request<T>(url)
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
        return value;
      })
      .finally(() => {
        this.requests.delete(key);
      });

    this.requests.set(key, request);
    return request;
  }

  private buildUrl(path: string, params: QueryParams) {
    const normalizedPath = path.replace(/^\/+/, '');
    const url = new URL(`${this.baseUrl}/${normalizedPath}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async request<T>(url: URL): Promise<T> {
    const maxAttempts = this.startupRequest ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = this.startupRequest ? 75_000 : this.timeoutMs;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryable = [502, 503, 504].includes(response.status);
          const isTransient = retryable && attempt < maxAttempts - 1;
          if (isTransient) {
            await this.delay(1200 * (attempt + 1));
            continue;
          }

          if (response.status === 401 || response.status === 403 || response.status === 404) {
            throw new ApiError(`Geniuz API returned HTTP ${response.status}.`, response.status);
          }

          throw new ApiError(`Geniuz API returned HTTP ${response.status}.`, response.status);
        }

        try {
          const value = (await response.json()) as T;
          this.startupRequest = false;
          return value;
        } catch (error) {
          throw new ApiError('Geniuz API returned invalid JSON.', undefined, undefined, { cause: error });
        }
      } catch (error) {
        lastError = error;

        if (error instanceof ApiError) {
          if (error.status === 401 || error.status === 403 || error.status === 404) {
            throw error;
          }
          if ([502, 503, 504].includes(error.status ?? 0) && attempt < maxAttempts - 1) {
            await this.delay(1200 * (attempt + 1));
            continue;
          }
          if (attempt < maxAttempts - 1 && this.shouldRetry(error)) {
            await this.delay(1200 * (attempt + 1));
            continue;
          }
          throw error;
        }

        if (controller.signal.aborted) {
          throw new ApiError(`Geniuz API request timed out after ${timeoutMs} ms.`, undefined, undefined, {
            cause: error,
          });
        }

        if (attempt < maxAttempts - 1 && this.shouldRetry(error)) {
          await this.delay(1200 * (attempt + 1));
          continue;
        }

        throw new ApiError('Unable to reach the Geniuz API.', undefined, undefined, { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new ApiError('Unable to reach the Geniuz API.');
  }

  private shouldRetry(error: unknown) {
    return (
      error instanceof TypeError ||
      error instanceof DOMException ||
      (typeof error === 'object' && error !== null && 'cause' in error && error.cause instanceof TypeError)
    );
  }

  private delay(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
