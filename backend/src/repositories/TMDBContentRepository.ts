import type { ContentItem, ContentPage, ContentType, Genre } from '../models/content';
import type { TMDBGenre, TMDBMediaType, TMDBProvider, TMDBRecord } from '../providers/TMDBProvider';
import type { ContentRepository } from './ContentRepository';
import { MemoryCache } from './MemoryCache';

const AFRICAN_COUNTRIES = new Set(['NG', 'GH', 'ZA', 'KE', 'UG', 'TZ', 'RW', 'SN', 'CI', 'CM', 'EG']);
const GENRE_CACHE_KEY = 'tmdb:genres';

function contentType(record: TMDBRecord, mediaType: TMDBMediaType): ContentType {
  const genres = record.genre_ids ?? record.genres?.map(({ id }) => id) ?? [];
  const countries = record.origin_country ?? [];

  if (countries.includes('NG') || record.original_language === 'yo') {
    return 'nollywood';
  }
  if (countries.some((country) => AFRICAN_COUNTRIES.has(country))) {
    return 'african';
  }
  if (genres.includes(10762)) {
    return 'kids';
  }
  if (mediaType === 'tv' && record.original_language === 'ja' && genres.includes(16)) {
    return 'anime';
  }
  return mediaType === 'movie' ? 'movie' : 'series';
}

function toContentItem(
  record: TMDBRecord,
  mediaType?: TMDBMediaType,
  genreNames: Map<number, string> = new Map(),
): ContentItem | null {
  if (typeof record.id !== 'number') {
    return null;
  }
  const kind = mediaType ?? record.media_type;
  if (!kind || kind === 'person') {
    return null;
  }

  const title = kind === 'movie' ? record.title : record.name;
  if (!title?.trim()) {
    return null;
  }
  const releaseDate = kind === 'movie' ? record.release_date : record.first_air_date;
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) : undefined;
  const genres =
    record.genres?.map(({ name }) => name) ??
    (record.genre_ids ?? []).map((id) => genreNames.get(id)).filter((name): name is string => Boolean(name));

  return {
    id: `tmdb:${kind}:${record.id}`,
    source: 'tmdb',
    sourceId: String(record.id),
    title,
    type: contentType(record, kind),
    ...(Number.isInteger(year) && year ? { year } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    genres,
    ...(record.poster_path
      ? { posterUrl: `https://image.tmdb.org/t/p/w500${record.poster_path}` }
      : {}),
    ...(record.backdrop_path
      ? { backdropUrl: `https://image.tmdb.org/t/p/w1280${record.backdrop_path}` }
      : {}),
    ...(record.overview ? { description: record.overview } : {}),
    ...(typeof record.vote_average === 'number' ? { rating: record.vote_average } : {}),
    ...(record.original_language ? { language: record.original_language } : {}),
    ...(record.runtime
      ? { runtimeMinutes: record.runtime }
      : record.episode_run_time?.[0]
        ? { runtimeMinutes: record.episode_run_time[0] }
        : {}),
    availability: {
      discoverable: true,
      stream: false,
      download: false,
      premium: false,
    },
  };
}

function toPage(
  response: { results?: TMDBRecord[]; page?: number; total_pages?: number },
  mapper: (record: TMDBRecord) => ContentItem | null,
  requestedPage: number,
): ContentPage {
  return {
    items: (response.results ?? []).map(mapper).filter((item): item is ContentItem => item !== null),
    page: response.page ?? requestedPage,
    totalPages: Math.max(1, response.total_pages ?? 1),
  };
}

export function mapTMDBToContentItem(
  record: TMDBRecord,
  mediaType?: TMDBMediaType,
  genreNames?: Map<number, string>,
) {
  return toContentItem(record, mediaType, genreNames);
}

export class TMDBContentRepository implements ContentRepository {
  private readonly cache: MemoryCache;

  constructor(
    private readonly provider: TMDBProvider,
    cacheTtlMs = 300_000,
  ) {
    this.cache = new MemoryCache(cacheTtlMs);
  }

  getTrending(page: number) {
    return this.cachedList(`trending:${page}`, () => this.provider.getTrending(page), (record, genres) =>
      toContentItem(record, undefined, genres));
  }

  async getPopular(page: number): Promise<ContentPage> {
    return this.cache.getOrLoad(`popular:${page}`, async () => {
      const [movies, shows] = await Promise.all([
        this.provider.getPopular('movie', page),
        this.provider.getPopular('tv', page),
      ]);
      const genreNames = await this.genreMap();
      return {
        items: [
          ...toPage(movies, (record) => toContentItem(record, 'movie', genreNames), page).items,
          ...toPage(shows, (record) => toContentItem(record, 'tv', genreNames), page).items,
        ],
        page,
        totalPages: Math.max(movies.total_pages ?? 1, shows.total_pages ?? 1),
      };
    });
  }

  getUpcoming(page: number) {
    return this.cachedList(`upcoming:${page}`, () => this.provider.getUpcoming(page), (record, genres) =>
      toContentItem(record, 'movie', genres));
  }

  getNowPlaying(page: number) {
    return this.cachedList(
      `now-playing:${page}`,
      () => this.provider.getNowPlaying(page),
      (record, genres) => toContentItem(record, 'movie', genres),
    );
  }

  getMovies(page: number) {
    return this.cachedList(`movies:${page}`, () => this.provider.getMovies(page), (record, genres) =>
      toContentItem(record, 'movie', genres));
  }

  getSeries(page: number) {
    return this.cachedList(`series:${page}`, () => this.provider.getSeries(page), (record, genres) =>
      toContentItem(record, 'tv', genres));
  }

  getAnime(page: number) {
    return this.cachedList(`anime:${page}`, () => this.provider.getAnime(page), (record, genres) =>
      toContentItem(record, 'tv', genres));
  }

  async search(query: string, page: number, genre?: string) {
    const genreNames = await this.genreMap();
    const response = await this.provider.search(query, page);
    let result = toPage(
      response,
      (record) => toContentItem(record, undefined, genreNames),
      page,
    );

    if (genre) {
      const normalizedGenre = genre.toLocaleLowerCase();
      result = {
        ...result,
        items: result.items.filter((item) =>
          item.genres.some((itemGenre) => itemGenre.toLocaleLowerCase() === normalizedGenre),
        ),
      };
    }
    return result;
  }

  async getByGenre(genre: string, page: number) {
    const genres = await this.getGenres();
    const normalizedGenre = genre.toLocaleLowerCase();
    const movieIds = genres
      .filter((item) => item.mediaType === 'movie' && item.name.toLocaleLowerCase() === normalizedGenre)
      .map(({ id }) => id);
    const tvIds = genres
      .filter((item) => item.mediaType === 'tv' && item.name.toLocaleLowerCase() === normalizedGenre)
      .map(({ id }) => id);
    const results: ContentPage[] = [];

    if (movieIds.length) {
      results.push(await this.discoverGenre('movie', movieIds, page));
    }
    if (tvIds.length) {
      results.push(await this.discoverGenre('tv', tvIds, page));
    }

    return {
      items: results.flatMap((result) => result.items),
      page,
      totalPages: Math.max(1, ...results.map((result) => result.totalPages)),
    };
  }

  async getById(id: string) {
    const match = /^tmdb:(movie|tv):(\d+)$/.exec(id);
    if (!match) {
      return null;
    }

    const [, kind, rawId] = match;
    const record = await this.provider.getDetails(kind as TMDBMediaType, Number(rawId));
    if (!record) {
      return null;
    }
    const genres = await this.genreMap();
    return toContentItem(record, kind as TMDBMediaType, genres);
  }

  async getSimilar(id: string, page: number) {
    const match = /^tmdb:(movie|tv):(\d+)$/.exec(id);
    if (!match) {
      return null;
    }

    const [, kind, rawId] = match;
    const response = await this.provider.getSimilar(kind as TMDBMediaType, Number(rawId), page);
    const genres = await this.genreMap();
    return toPage(
      response,
      (record) => toContentItem(record, kind as TMDBMediaType, genres),
      page,
    );
  }

  async getGenres(): Promise<Genre[]> {
    return this.cache.getOrLoad(GENRE_CACHE_KEY, async () => {
      const [movies, series] = await Promise.all([
        this.provider.getGenres('movie'),
        this.provider.getGenres('tv'),
      ]);
      return [
        ...movies.map((genre) => ({ ...genre, mediaType: 'movie' as const })),
        ...series.map((genre) => ({ ...genre, mediaType: 'tv' as const })),
      ].filter(
        (genre, index, genres) =>
          genres.findIndex(
            (candidate) => candidate.id === genre.id && candidate.mediaType === genre.mediaType,
          ) === index,
      );
    });
  }

  private cachedList(
    key: string,
    load: () => ReturnType<TMDBProvider['getTrending']>,
    mapper: (record: TMDBRecord, genres: Map<number, string>) => ContentItem | null,
  ) {
    return this.cache.getOrLoad(key, async () => {
      const [response, genres] = await Promise.all([load(), this.genreMap()]);
      return toPage(response, (record) => mapper(record, genres), response.page ?? 1);
    });
  }

  private genreMap() {
    return this.getGenres().then(
      (genres) => new Map<number, string>(genres.map((genre) => [genre.id, genre.name])),
    );
  }

  private async discoverGenre(kind: TMDBMediaType, genreIds: number[], page: number) {
    const [records, genres] = await Promise.all([
      this.provider.getByGenre(kind, genreIds, page),
      this.genreMap(),
    ]);

    return toPage(
      records,
      (record) => toContentItem(record, kind, genres),
      page,
    );
  }
}
