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

export type ContentItem = {
  id: string;
  source: 'tmdb' | 'anilist' | 'geniuz' | 'other';
  sourceId: string;
  title: string;
  type: ContentType;
  year?: number;
  releaseDate?: string;
  genres: string[];
  posterUrl?: string;
  backdropUrl?: string;
  description?: string;
  rating?: number;
  contentRating?: string;
  language?: string;
  runtimeMinutes?: number;
  availability: {
    discoverable: boolean;
    stream: boolean;
    download: boolean;
    premium: boolean;
  };
};

export type ContentPage = {
  items: ContentItem[];
  page: number;
  totalPages: number;
};

export type Genre = {
  id: number;
  name: string;
  mediaType: 'movie' | 'tv';
};
