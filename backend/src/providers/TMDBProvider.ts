import type { Config } from '../config/config';

export type TMDBMediaType = 'movie' | 'tv';

export type TMDBGenre = {
  id: number;
  name: string;
};

export type TMDBRecord = {
  id?: number;
  media_type?: TMDBMediaType | 'person';
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: TMDBGenre[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  original_language?: string;
  origin_country?: string[];
  runtime?: number;
  episode_run_time?: number[];
  adult?: boolean;
};

export type TMDBListResponse = {
  results?: TMDBRecord[];
  page?: number;
  total_pages?: number;
};

export class ProviderError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE',
    readonly httpStatus: number,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

export interface TMDBProvider {
  getTrending(page: number): Promise<TMDBListResponse>;
  getPopular(kind: TMDBMediaType, page: number): Promise<TMDBListResponse>;
  getUpcoming(page: number): Promise<TMDBListResponse>;
  getNowPlaying(page: number): Promise<TMDBListResponse>;
  getMovies(page: number): Promise<TMDBListResponse>;
  getSeries(page: number): Promise<TMDBListResponse>;
  getAnime(page: number): Promise<TMDBListResponse>;
  getByGenre(kind: TMDBMediaType, genreIds: number[], page: number): Promise<TMDBListResponse>;
  search(query: string, page: number): Promise<TMDBListResponse>;
  getDetails(kind: TMDBMediaType, id: number): Promise<TMDBRecord | null>;
  getSimilar(kind: TMDBMediaType, id: number, page: number): Promise<TMDBListResponse>;
  getGenres(kind: TMDBMediaType): Promise<TMDBGenre[]>;
}

type FetchImplementation = typeof fetch;

export class HttpTMDBProvider implements TMDBProvider {
  constructor(
    private readonly config: Pick<Config, 'tmdbApiKey' | 'tmdbBaseUrl'>,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  getTrending(page: number) {
    return this.getList('/trending/all/week', { page });
  }

  getPopular(kind: TMDBMediaType, page: number) {
    return this.getList(`/${kind}/popular`, { page });
  }

  getUpcoming(page: number) {
    return this.getList('/movie/upcoming', { page });
  }

  getNowPlaying(page: number) {
    return this.getList('/movie/now_playing', { page });
  }

  getMovies(page: number) {
    return this.getList('/discover/movie', { page, include_adult: false, sort_by: 'popularity.desc' });
  }

  getSeries(page: number) {
    return this.getList('/discover/tv', { page, sort_by: 'popularity.desc' });
  }

  getAnime(page: number) {
    return this.getList('/discover/tv', {
      page,
      with_genres: 16,
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
    });
  }

  getByGenre(kind: TMDBMediaType, genreIds: number[], page: number) {
    return this.getList(`/discover/${kind}`, {
      page,
      with_genres: genreIds.join(','),
      ...(kind === 'movie' ? { include_adult: false } : {}),
      sort_by: 'popularity.desc',
    });
  }

  search(query: string, page: number) {
    return this.getList('/search/multi', { query, page, include_adult: false });
  }

  async getDetails(kind: TMDBMediaType, id: number) {
    try {
      return await this.get<TMDBRecord>(`/${kind}/${id}`);
    } catch (error) {
      if (error instanceof ProviderError && error.httpStatus === 404) {
        return null;
      }
      throw error;
    }
  }

  getSimilar(kind: TMDBMediaType, id: number, page: number) {
    return this.getList(`/${kind}/${id}/similar`, { page });
  }

  async getGenres(kind: TMDBMediaType) {
    const response = await this.get<{ genres?: TMDBGenre[] }>(`/genre/${kind}/list`);
    return response.genres ?? [];
  }

  private async getList(path: string, params: Record<string, string | number | boolean>) {
    return this.get<TMDBListResponse>(path, params);
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean> = {}) {
    if (!this.config.tmdbApiKey) {
      throw new ProviderError('NOT_CONFIGURED', 503);
    }

    const url = new URL(`${this.config.tmdbBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.tmdbApiKey}`,
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('NOT_CONFIGURED', 503);
      }
      if (response.status === 429) {
        throw new ProviderError('RATE_LIMITED', 503);
      }
      if (response.status === 404) {
        throw new ProviderError('UNAVAILABLE', 404);
      }
      if (!response.ok) {
        throw new ProviderError('UNAVAILABLE', 502);
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new ProviderError('INVALID_RESPONSE', 502);
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new ProviderError('TIMEOUT', 504);
      }
      throw new ProviderError('UNAVAILABLE', 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}
