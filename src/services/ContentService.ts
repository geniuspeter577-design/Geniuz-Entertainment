import type {
  ContentItem,
  ContentQueryResult,
  ContinueWatchingEntry,
} from '../models/content';
import type { ContentRepository, ContentSearchOptions } from '../repositories/ContentRepository';
import { MockContentRepository } from '../repositories/MockContentRepository';
import { getFriendlyCatalogErrorMessage } from '../utils/contentError';
import { isDemoCatalogEnabled } from '../utils/publishedCatalog';

const LIVE_FAILURE_WARNING = 'The catalog is temporarily unavailable. Please retry.';
const MISSING_CONFIGURATION_WARNING = 'The catalog service is not configured. Please try again later.';

export class ContentService {
  private readonly knownItems = new Map<string, ContentItem>();
  private readonly loggedFailures = new Set<string>();

  constructor(
    private readonly repository: ContentRepository,
    private readonly mockRepository = new MockContentRepository(),
    private readonly remoteEnabled = false,
    private readonly configurationWarning?: string,
    private readonly allowDemoFallback = isDemoCatalogEnabled,
  ) {}

  getTrending = () => this.list('trending', () => this.repository.getTrending(), () => this.mockRepository.getTrending());

  getPopular = () => this.list('popular', () => this.repository.getPopular(), () => this.mockRepository.getPopular());

  getUpcoming = () => this.list('upcoming', () => this.repository.getUpcoming(), () => this.mockRepository.getUpcoming());

  getNowPlaying = () =>
    this.list(
      'now-playing',
      () => this.repository.getNowPlaying(),
      () => this.mockRepository.getNowPlaying(),
    );

  getMovies = () => this.list('movies', () => this.repository.getMovies(), () => this.mockRepository.getMovies());

  getSeries = () => this.list('series', () => this.repository.getSeries(), () => this.mockRepository.getSeries());

  getAnime = () => this.list('anime', () => this.repository.getAnime(), () => this.mockRepository.getAnime());

  search = (query: string, options?: ContentSearchOptions) =>
    this.list(
      'search',
      () => this.repository.search(query, options),
      () => this.mockRepository.search(query, options),
    );

  getByGenre = (genre: string, page?: number) =>
    this.list(
      `genre:${genre}:${page ?? 1}`,
      () => this.repository.getByGenre(genre, page),
      () => this.mockRepository.getByGenre(genre, page),
    );

  async getById(
    id: string,
    fallbackItem?: ContentItem,
  ): Promise<ContentQueryResult<ContentItem | null>> {
    if (!this.remoteEnabled || id.startsWith('mock:')) {
      if (!this.allowDemoFallback) {
        return {
          data: id.startsWith('mock:') ? null : fallbackItem ?? null,
          source: fallbackItem ? 'local' : 'tmdb',
          warning:
            this.configurationWarning ??
            (this.remoteEnabled ? LIVE_FAILURE_WARNING : MISSING_CONFIGURATION_WARNING),
        };
      }
      const localItem = await this.mockRepository.getById(id);
      return {
        data: localItem ?? fallbackItem ?? null,
        source: 'mock',
        ...(this.configurationWarning
          ? { warning: `${this.configurationWarning} Showing the Demo catalog.` }
          : {}),
      };
    }

    try {
      const item = await this.repository.getById(id);

      if (item) {
        this.knownItems.set(item.id, item);
      }

      const resolvedItem =
        item ??
        this.knownItems.get(id) ??
        fallbackItem ??
        (this.allowDemoFallback ? await this.mockRepository.getById(id) : null);
      return {
        data: resolvedItem,
        source: this.resolveResultSource(resolvedItem),
      };
    } catch (error) {
      this.logFailure(`detail:${id}`, error);
      const resolvedItem =
        this.knownItems.get(id) ??
        fallbackItem ??
        (this.allowDemoFallback ? await this.mockRepository.getById(id) : null);
      if (!this.allowDemoFallback && !this.knownItems.has(id) && !fallbackItem) {
        return {
          data: null,
          source: 'tmdb',
          warning: getFriendlyCatalogErrorMessage(error),
        };
      }
      return {
        data: resolvedItem,
        source: this.resolveResultSource(resolvedItem),
        warning:
          resolvedItem?.source === 'mock'
            ? `${getFriendlyCatalogErrorMessage(error)} Showing the Demo catalog.`
            : getFriendlyCatalogErrorMessage(error),
      };
    }
  }

  private async list(
    key: string,
    request: () => Promise<ContentItem[]>,
    fallback: () => Promise<ContentItem[]>,
  ): Promise<ContentQueryResult<ContentItem[]>> {
    if (!this.remoteEnabled) {
      if (!this.allowDemoFallback) {
        return {
          data: [],
          source: 'tmdb',
          warning: this.configurationWarning ?? MISSING_CONFIGURATION_WARNING,
        };
      }
      return {
        data: await fallback(),
        source: 'mock',
        ...(this.configurationWarning
          ? { warning: `${this.configurationWarning} Showing the Demo catalog.` }
          : {}),
      };
    }

    try {
      const data = await request();
      this.remember(data);
      return { data, source: 'tmdb' };
    } catch (error) {
      this.logFailure(key, error);
      if (!this.allowDemoFallback) {
        return {
          data: [],
          source: 'tmdb',
          warning: getFriendlyCatalogErrorMessage(error),
        };
      }
      const data = await fallback();
      this.remember(data);
      return {
        data,
        source: 'mock',
        warning: `${getFriendlyCatalogErrorMessage(error)} Showing the Demo catalog.`,
      };
    }
  }

  private resolveResultSource(item?: ContentItem | null): 'mock' | 'tmdb' {
    return item?.source === 'mock' ? 'mock' : 'tmdb';
  }

  private logFailure(key: string, error: unknown) {
    if (process.env.NODE_ENV !== 'development' || this.loggedFailures.has(key)) {
      return;
    }
    this.loggedFailures.add(key);
    console.warn(`[ContentService] Catalog request "${key}" failed.`, getFriendlyCatalogErrorMessage(error));
  }

  private remember(items: ContentItem[]) {
    for (const item of items) {
      this.knownItems.set(item.id, item);
    }
  }
}

export type { ContinueWatchingEntry };
