export type ContentType =
  | 'movie'
  | 'series'
  | 'tv'
  | 'anime'
  | 'kids'
  | 'nollywood'
  | 'african'
  | 'short'
  | 'sports'
  | 'live'
  | 'music';

export type ContentSource = 'geniuz' | 'tmdb' | 'mock' | 'anilist' | 'other';

export type ContentAvailability = {
  discoverable: boolean;
  stream: boolean;
  download: boolean;
  premium: boolean;
};

export interface ContentItem {
  id: string;
  source: ContentSource;
  sourceId?: string;
  title: string;
  type: ContentType;
  year?: number;
  releaseDate?: string;
  genres: string[];
  posterUrl?: string;
  backdropUrl?: string;
  mediaPath?: string;
  description?: string;
  rating?: number;
  contentRating?: string;
  language?: string;
  runtimeMinutes?: number;
  isNewRelease?: boolean;
  availability: ContentAvailability;
}

export interface ContinueWatchingEntry {
  item: ContentItem;
  progress: number;
  positionSeconds?: number;
  updatedAt: string;
}

export type ContentQueryResult<T> = {
  data: T;
  source: 'mock' | 'tmdb' | 'supabase';
  warning?: string;
};
