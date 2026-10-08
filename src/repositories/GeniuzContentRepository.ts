import { ApiClient, ApiError } from '../api/ApiClient';
import type { ContentItem, ContentType } from '../models/content';
import type { FootballMatch, FootballMatchesResponse, FootballMatchStatus, FootballTeam } from '../models/football';
import type { ContentRepository, ContentSearchOptions } from './ContentRepository';

type ContentPageResponse = {
  items: unknown[];
  page: number;
  totalPages: number;
};

const contentTypes = new Set<ContentType>([
  'movie',
  'series',
  'tv',
  'anime',
  'kids',
  'nollywood',
  'african',
  'short',
  'sports',
  'live',
  'music',
]);
const contentSources = new Set(['tmdb', 'anilist', 'geniuz', 'mock', 'other']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseContentItem(value: unknown): ContentItem {
  if (!isRecord(value) || !isRecord(value.availability)) {
    throw new ApiError('Geniuz API returned an invalid content item.');
  }

  const availability = value.availability;
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.type !== 'string' ||
    !contentTypes.has(value.type as ContentType) ||
    typeof value.source !== 'string' ||
    !contentSources.has(value.source) ||
    !Array.isArray(value.genres) ||
    !value.genres.every((genre) => typeof genre === 'string') ||
    typeof availability.discoverable !== 'boolean' ||
    typeof availability.stream !== 'boolean' ||
    typeof availability.download !== 'boolean' ||
    typeof availability.premium !== 'boolean'
  ) {
    throw new ApiError('Geniuz API returned an invalid content item.');
  }

  const optionalStringFields = [
    'sourceId',
    'releaseDate',
    'posterUrl',
    'backdropUrl',
    'description',
    'contentRating',
    'language',
  ] as const;
  if (
    optionalStringFields.some(
      (field) => value[field] !== undefined && typeof value[field] !== 'string',
    ) ||
    (value.year !== undefined && typeof value.year !== 'number') ||
    (value.rating !== undefined && typeof value.rating !== 'number') ||
    (value.runtimeMinutes !== undefined && typeof value.runtimeMinutes !== 'number')
  ) {
    throw new ApiError('Geniuz API returned invalid optional content fields.');
  }

  return {
    id: value.id,
    source: value.source as ContentItem['source'],
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}),
    title: value.title,
    type: value.type as ContentType,
    ...(typeof value.year === 'number' ? { year: value.year } : {}),
    ...(typeof value.releaseDate === 'string' ? { releaseDate: value.releaseDate } : {}),
    genres: value.genres,
    ...(typeof value.posterUrl === 'string' ? { posterUrl: value.posterUrl } : {}),
    ...(typeof value.backdropUrl === 'string' ? { backdropUrl: value.backdropUrl } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.rating === 'number' ? { rating: value.rating } : {}),
    ...(typeof value.contentRating === 'string' ? { contentRating: value.contentRating } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    ...(typeof value.runtimeMinutes === 'number' ? { runtimeMinutes: value.runtimeMinutes } : {}),
    availability: {
      discoverable: availability.discoverable,
      stream: availability.stream,
      download: availability.download,
      premium: availability.premium,
    },
  };
}

function parsePage(value: unknown): ContentItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new ApiError('Geniuz API returned an invalid content page.');
  }
  return value.items.map(parseContentItem);
}

const footballStatuses = new Set<FootballMatchStatus>([
  'scheduled',
  'live',
  'finished',
  'postponed',
  'cancelled',
]);

function parseFootballTeam(value: unknown): FootballTeam {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    (value.logoUrl !== undefined && typeof value.logoUrl !== 'string')
  ) {
    throw new ApiError('Geniuz API returned invalid football match data.');
  }
  return {
    name: value.name,
    ...(typeof value.logoUrl === 'string' ? { logoUrl: value.logoUrl } : {}),
  };
}

function parseFootballMatches(value: unknown): FootballMatchesResponse {
  if (
    !isRecord(value) ||
    typeof value.date !== 'string' ||
    typeof value.fetchedAt !== 'string' ||
    typeof value.stale !== 'boolean' ||
    !Array.isArray(value.matches)
  ) {
    throw new ApiError('Geniuz API returned invalid football match data.');
  }
  const matches: FootballMatch[] = value.matches.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !isRecord(item.competition) ||
      typeof item.competition.id !== 'string' ||
      typeof item.competition.name !== 'string' ||
      (item.competition.logoUrl !== undefined && typeof item.competition.logoUrl !== 'string') ||
      typeof item.startsAt !== 'string' ||
      !Number.isFinite(Date.parse(item.startsAt)) ||
      typeof item.status !== 'string' ||
      !footballStatuses.has(item.status as FootballMatchStatus) ||
      (item.minute !== null && (!Number.isInteger(item.minute) || Number(item.minute) < 0)) ||
      (item.homeScore !== null && (!Number.isInteger(item.homeScore) || Number(item.homeScore) < 0)) ||
      (item.awayScore !== null && (!Number.isInteger(item.awayScore) || Number(item.awayScore) < 0))
    ) {
      throw new ApiError('Geniuz API returned invalid football match data.');
    }
    return {
      id: item.id,
      competition: {
        id: item.competition.id,
        name: item.competition.name,
        ...(typeof item.competition.logoUrl === 'string' ? { logoUrl: item.competition.logoUrl } : {}),
      },
      startsAt: item.startsAt,
      status: item.status as FootballMatchStatus,
      minute: item.minute as number | null,
      homeTeam: parseFootballTeam(item.homeTeam),
      awayTeam: parseFootballTeam(item.awayTeam),
      homeScore: item.homeScore as number | null,
      awayScore: item.awayScore as number | null,
    };
  });
  return { date: value.date, fetchedAt: value.fetchedAt, stale: value.stale, matches };
}

export class GeniuzContentRepository implements ContentRepository {
  constructor(private readonly apiClient: ApiClient) {}

  getTrending() {
    return this.getItems('/api/content/trending');
  }

  getPopular() {
    return this.getItems('/api/content/popular');
  }

  getUpcoming() {
    return this.getItems('/api/content/upcoming');
  }

  getNowPlaying() {
    return this.getItems('/api/content/now-playing');
  }

  getMovies() {
    return this.getItems('/api/content/movies');
  }

  getSeries() {
    return this.getItems('/api/content/series');
  }

  getAnime() {
    return this.getItems('/api/content/anime');
  }

  async search(query: string, options: ContentSearchOptions = {}) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return this.getPopular();
    }
    return this.getItems('/api/content/search', {
      q: normalizedQuery,
      ...(options.genre ? { genre: options.genre } : {}),
      ...(options.page ? { page: options.page } : {}),
    });
  }

  async getById(id: string) {
    try {
      const response = await this.apiClient.get<{ item: unknown }>(
        `/api/content/${encodeURIComponent(id)}`,
      );
      return parseContentItem(response.item);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  getByGenre(genre: string, page?: number) {
    return this.getItems('/api/content/genre', {
      name: genre,
      ...(page ? { page } : {}),
    });
  }

  async getFootballMatches(date: string) {
    return parseFootballMatches(
      await this.apiClient.get<unknown>('/football/matches', { date }),
    );
  }

  async getSimilar(id: string, page = 1) {
    const response = await this.apiClient.get<ContentPageResponse>(
      `/api/content/${encodeURIComponent(id)}/similar`,
      { page },
    );
    return parsePage(response);
  }

  private async getItems(path: string, params: Record<string, string | number> = {}) {
    const response = await this.apiClient.get<ContentPageResponse>(path, params);
    return parsePage(response);
  }
}
