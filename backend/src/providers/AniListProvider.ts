import type { ContentItem } from '../models/content';

export interface AniListProvider {
  searchAnime(query: string, page: number): Promise<ContentItem[]>;
}

export class UnconfiguredAniListProvider implements AniListProvider {
  async searchAnime(_query: string, _page: number): Promise<ContentItem[]> {
    return [];
  }
}
