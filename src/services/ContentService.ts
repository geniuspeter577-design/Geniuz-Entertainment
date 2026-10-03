import type {
  ContentItem,
  ContentQueryResult,
  ContinueWatchingEntry,
} from '../models/content';
import type { ContentRepository, ContentSearchOptions } from '../repositories/ContentRepository';
import { MockContentRepository } from '../repositories/MockContentRepository';

const FALLBACK_WARNING = 'The live catalog is unavailable. Showing the local development catalog.';

export class ContentService {
  private readonly knownItems = new Map<string, ContentItem>();

  constructor(
    private readonly repository: ContentRepository,
    private readonly mockRepository = new MockContentRepository(),
    private readonly remoteEnabled = false,
    private readonly configurationWarning?: string,
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
      const localItem = await this.mockRepository.getById(id);
      return {
        data: localItem ?? fallbackItem ?? null,
        source: 'mock',
        ...(this.configurationWarning ? { warning: this.configurationWarning } : {}),
      };
    }

    try {
      const item = await this.repository.getById(id);

      if (item) {
        this.knownItems.set(item.id, item);
      }

      const resolvedItem =
        item ?? this.knownItems.get(id) ?? fallbackItem ?? (await this.mockRepository.getById(id));
      return {
        data: resolvedItem,
        source: this.resolveResultSource(resolvedItem),
      };
    } catch (error) {
      console.error(`[ContentService] Catalog detail request failed for "${id}".`, error);
      const resolvedItem =
        this.knownItems.get(id) ?? fallbackItem ?? (await this.mockRepository.getById(id));
      return {
        data: resolvedItem,
        source: this.resolveResultSource(resolvedItem),
        warning: FALLBACK_WARNING,
      };
    }
  }

  private async list(
    key: string,
    request: () => Promise<ContentItem[]>,
    fallback: () => Promise<ContentItem[]>,
  ): Promise<ContentQueryResult<ContentItem[]>> {
    if (!this.remoteEnabled) {
      return {
        data: await fallback(),
        source: 'mock',
        ...(this.configurationWarning ? { warning: this.configurationWarning } : {}),
      };
    }

    try {
      const data = await request();
      this.remember(data);
      return { data, source: 'tmdb' };
    } catch (error) {
      console.error(`[ContentService] Catalog request "${key}" failed; using mock content.`, error);
      const data = await fallback();
      this.remember(data);
      return {
        data,
        source: 'mock',
        warning: FALLBACK_WARNING,
      };
    }
  }

  private resolveResultSource(item?: ContentItem | null): 'mock' | 'tmdb' {
    return item?.source === 'mock' ? 'mock' : 'tmdb';
  }

  private remember(items: ContentItem[]) {
    for (const item of items) {
      this.knownItems.set(item.id, item);
    }
  }
}

export type { ContinueWatchingEntry };
