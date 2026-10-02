import { mockContent } from '../data/mockContent';
import type { ContentItem } from '../models/content';
import type { ContentRepository, ContentSearchOptions } from './ContentRepository';

function matchesGenre(item: ContentItem, genre?: string) {
  return !genre || item.genres.some((itemGenre) => itemGenre.toLowerCase() === genre.toLowerCase());
}

export class MockContentRepository implements ContentRepository {
  async getTrending() {
    return mockContent.filter((item) => item.isNewRelease);
  }

  async getPopular() {
    return [...mockContent];
  }

  async getUpcoming() {
    return mockContent.filter((item) => item.isNewRelease);
  }

  async getNowPlaying() {
    return mockContent.filter((item) => item.type === 'movie');
  }

  async getMovies() {
    return mockContent.filter((item) => item.type === 'movie');
  }

  async getSeries() {
    return mockContent.filter((item) => item.type === 'series' || item.type === 'tv');
  }

  async getAnime() {
    return mockContent.filter((item) => item.type === 'anime');
  }

  async search(query: string, options: ContentSearchOptions = {}) {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return mockContent.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        item.title.toLocaleLowerCase().includes(normalizedQuery) ||
        item.description?.toLocaleLowerCase().includes(normalizedQuery) ||
        item.genres.some((genre) => genre.toLocaleLowerCase().includes(normalizedQuery));

      return matchesQuery && matchesGenre(item, options.genre);
    });
  }

  async getById(id: string) {
    return mockContent.find((item) => item.id === id || item.sourceId === id) ?? null;
  }

  async getByGenre(genre: string, _page?: number) {
    return mockContent.filter((item) => matchesGenre(item, genre));
  }
}
