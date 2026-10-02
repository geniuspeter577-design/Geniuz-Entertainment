export type MediaType = 'movie' | 'series' | 'live';

export type MediaItem = {
  id: string;
  slug: string;
  title: string;
  type: MediaType;
  tag: string;
  year: number;
  duration: string;
  rating: string;
  genres: string[];
  description: string;
  poster: string;
  backdrop: string;
  progress?: number;
  isPremium?: boolean;
  isNew?: boolean;
};

export const mockMedia: MediaItem[] = [
  {
    id: '1',
    slug: 'the-last-horizon',
    title: 'The Last Horizon',
    type: 'series',
    tag: 'Sci-Fi / Action',
    year: 2026,
    duration: '49 min',
    rating: 'TV-14',
    genres: ['Sci‑Fi', 'Action', 'Drama'],
    description:
      'After a failed orbital station rescue, a rogue pilot uncovers a hidden signal that could alter the fate of the entire galaxy.',
    poster:
      'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80',
    backdrop:
      'https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=1400&q=80',
    progress: 62,
    isPremium: true,
    isNew: true,
  },
  {
    id: '2',
    slug: 'shadow-state',
    title: 'Shadow State',
    type: 'series',
    tag: 'Thriller',
    year: 2025,
    duration: '42 min',
    rating: 'TV-MA',
    genres: ['Thriller', 'Mystery'],
    description:
      'A citywide surveillance network collapses just as a mayoral candidate disappears, forcing an investigative journalist to uncover the truth.',
    poster:
      'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80',
    backdrop:
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=80',
    progress: 38,
    isPremium: false,
    isNew: true,
  },
  {
    id: '3',
    slug: 'midnight-bloom',
    title: 'Midnight Bloom',
    type: 'movie',
    tag: 'Romance / Drama',
    year: 2024,
    duration: '1h 48m',
    rating: 'PG-13',
    genres: ['Romance', 'Drama'],
    description:
      'A celebrated florist and a reclusive architect fall into a slow-burn romance while a city festival transforms the entire skyline.',
    poster:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
    backdrop:
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1400&q=80',
    progress: 80,
    isPremium: true,
    isNew: false,
  },
  {
    id: '4',
    slug: 'signal-runner',
    title: 'Signal Runner',
    type: 'movie',
    tag: 'Action',
    year: 2026,
    duration: '2h 04m',
    rating: 'PG-13',
    genres: ['Action', 'Adventure'],
    description:
      'An elite courier races through a city that runs on stolen data to stop an AI system from taking over every network in the world.',
    poster:
      'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80',
    backdrop:
      'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1400&q=80',
    isPremium: false,
    isNew: true,
  },
  {
    id: '5',
    slug: 'the-echo-mine',
    title: 'The Echo Mine',
    type: 'series',
    tag: 'Adventure',
    year: 2025,
    duration: '53 min',
    rating: 'TV-PG',
    genres: ['Adventure', 'Mystery'],
    description:
      'Archaeologists discover a forgotten crystalline network beneath the desert that predicts the future through memory maps.',
    poster:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
    backdrop:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80',
    isPremium: false,
    isNew: false,
  },
  {
    id: '6',
    slug: 'night-of-ember',
    title: 'Night of Ember',
    type: 'live',
    tag: 'Live Drama',
    year: 2026,
    duration: 'Live',
    rating: 'HD',
    genres: ['Drama', 'Concert'],
    description:
      'A live-streamed festival unfolds in a neon-lit stadium as bands, dancers, and immersive visuals light the night sky.',
    poster:
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
    backdrop:
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1400&q=80',
    isPremium: true,
    isNew: true,
  },
];

export const continueWatching = mockMedia.filter((item) => item.progress !== undefined);
export const trendingTitles = mockMedia.filter((item) => item.isNew);
export const premiumPicks = mockMedia.filter((item) => item.isPremium);
