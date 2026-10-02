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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ApiError(`Geniuz API returned HTTP ${response.status}.`, response.status);
      }

      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new ApiError('Geniuz API returned invalid JSON.', response.status, { cause: error });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new ApiError(`Geniuz API request timed out after ${this.timeoutMs} ms.`, undefined, {
          cause: error,
        });
      }

      throw new ApiError('Unable to reach the Geniuz API.', undefined, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
