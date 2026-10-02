import type { ContentItem, ContentPage, Genre } from '../models/content';

export interface ContentRepository {
  getTrending(page: number): Promise<ContentPage>;
  getPopular(page: number): Promise<ContentPage>;
  getUpcoming(page: number): Promise<ContentPage>;
  getNowPlaying(page: number): Promise<ContentPage>;
  getMovies(page: number): Promise<ContentPage>;
  getSeries(page: number): Promise<ContentPage>;
  getAnime(page: number): Promise<ContentPage>;
  getByGenre(genre: string, page: number): Promise<ContentPage>;
  search(query: string, page: number, genre?: string): Promise<ContentPage>;
  getById(id: string): Promise<ContentItem | null>;
  getSimilar(id: string, page: number): Promise<ContentPage | null>;
  getGenres(): Promise<Genre[]>;
}
