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
  storageProvider?: 'supabase' | 'b2';
  storageKey?: string;
  fileExtension?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  description?: string;
  rating?: number;
  contentRating?: string;
  language?: string;
  runtimeMinutes?: number;
  seasonCount?: number;
  parentSeriesId?: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  durationSeconds?: number;
  isNewRelease?: boolean;
  availability: ContentAvailability;
}

export interface SeasonItem {
  id: string;
  seriesId: string;
  seasonNumber: number;
  year?: number;
  published: boolean;
  episodes: EpisodeItem[];
}

export interface EpisodeItem extends ContentItem {
  seasonId: string;
  episodeNumber: number;
  durationSeconds: number;
  parentSeriesId: string;
  published: boolean;
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
