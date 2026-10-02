import type { ContentItem } from '../models/content';

export type ContentSearchOptions = {
  genre?: string;
  page?: number;
};

export interface ContentRepository {
  getTrending(): Promise<ContentItem[]>;
  getPopular(): Promise<ContentItem[]>;
  getUpcoming(): Promise<ContentItem[]>;
  getNowPlaying(): Promise<ContentItem[]>;
  getMovies(): Promise<ContentItem[]>;
  getSeries(): Promise<ContentItem[]>;
  getAnime(): Promise<ContentItem[]>;
  search(query: string, options?: ContentSearchOptions): Promise<ContentItem[]>;
  getById(id: string): Promise<ContentItem | null>;
  getByGenre(genre: string, page?: number): Promise<ContentItem[]>;
}
