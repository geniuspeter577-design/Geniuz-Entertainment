import type { ContentItem, ContentPage, Genre } from '../models/content';
import type { ContentRepository } from '../repositories/ContentRepository';
import { MemoryCache } from '../repositories/MemoryCache';

export class ContentNotFoundError extends Error {
  constructor() {
    super('Content was not found.');
    this.name = 'ContentNotFoundError';
  }
}

export class ContentService {
  private readonly detailsCache: MemoryCache;
  private readonly similarCache: MemoryCache;

  constructor(
    private readonly repository: ContentRepository,
    cacheTtlMs = 300_000,
  ) {
    this.detailsCache = new MemoryCache(cacheTtlMs);
    this.similarCache = new MemoryCache(cacheTtlMs);
  }

  getTrending(page: number) {
    return this.repository.getTrending(page);
  }
  getPopular(page: number) {
    return this.repository.getPopular(page);
  }
  getUpcoming(page: number) {
    return this.repository.getUpcoming(page);
  }
  getNowPlaying(page: number) {
    return this.repository.getNowPlaying(page);
  }
  getMovies(page: number) {
    return this.repository.getMovies(page);
  }
  getSeries(page: number) {
    return this.repository.getSeries(page);
  }
  getAnime(page: number) {
    return this.repository.getAnime(page);
  }
  getByGenre(genre: string, page: number) {
    return this.repository.getByGenre(genre, page);
  }
  search(query: string, page: number, genre?: string) {
    return this.repository.search(query, page, genre);
  }
  getGenres(): Promise<Genre[]> {
    return this.repository.getGenres();
  }

  async getById(id: string): Promise<ContentItem> {
    const item = await this.detailsCache.getOrLoad(id, async () => {
      const detail = await this.repository.getById(id);
      if (!detail) {
        throw new ContentNotFoundError();
      }
      return detail;
    });
    return item;
  }

  getSimilar(id: string, page: number): Promise<ContentPage> {
    return this.similarCache.getOrLoad(`${id}:${page}`, async () => {
      const result = await this.repository.getSimilar(id, page);
      if (!result) {
        throw new ContentNotFoundError();
      }
      return result;
    });
  }
}
