import type { ContentItem } from '../models/content';

const mockAvailability = () => ({
  discoverable: true,
  stream: false,
  download: false,
  premium: false,
});

export const mockContent: ContentItem[] = [
  {
    id: 'mock:the-last-horizon',
    source: 'mock',
    sourceId: 'the-last-horizon',
    title: 'The Last Horizon',
    type: 'series',
    year: 2026,
    genres: ['Science Fiction', 'Action', 'Drama'],
    posterUrl:
      'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80',
    backdropUrl:
      'https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=1400&q=80',
    description:
      'After a failed orbital station rescue, a rogue pilot uncovers a hidden signal that could alter the fate of the entire galaxy.',
    rating: 8.1,
    contentRating: 'TV-14',
    language: 'en',
    runtimeMinutes: 49,
    isNewRelease: true,
    availability: mockAvailability(),
  },
  {
    id: 'mock:shadow-state',
    source: 'mock',
    sourceId: 'shadow-state',
    title: 'Shadow State',
    type: 'series',
    year: 2025,
    genres: ['Thriller', 'Mystery'],
    posterUrl:
      'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80',
    backdropUrl:
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=80',
    description:
      'A citywide surveillance network collapses just as a mayoral candidate disappears, forcing an investigative journalist to uncover the truth.',
    rating: 7.6,
    contentRating: 'TV-MA',
    language: 'en',
    runtimeMinutes: 42,
    isNewRelease: true,
    availability: mockAvailability(),
  },
  {
    id: 'mock:midnight-bloom',
    source: 'mock',
    sourceId: 'midnight-bloom',
    title: 'Midnight Bloom',
    type: 'movie',
    year: 2024,
    genres: ['Romance', 'Drama'],
    posterUrl:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
    backdropUrl:
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1400&q=80',
    description:
      'A celebrated florist and a reclusive architect fall into a slow-burn romance while a city festival transforms the entire skyline.',
    rating: 7.3,
    contentRating: 'PG-13',
    language: 'en',
    runtimeMinutes: 108,
    availability: mockAvailability(),
  },
  {
    id: 'mock:signal-runner',
    source: 'mock',
    sourceId: 'signal-runner',
    title: 'Signal Runner',
    type: 'movie',
    year: 2026,
    genres: ['Action', 'Adventure'],
    posterUrl:
      'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80',
    backdropUrl:
      'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1400&q=80',
    description:
      'An elite courier races through a city that runs on stolen data to stop an AI system from taking over every network in the world.',
    rating: 7.8,
    contentRating: 'PG-13',
    language: 'en',
    runtimeMinutes: 124,
    isNewRelease: true,
    availability: mockAvailability(),
  },
  {
    id: 'mock:the-echo-mine',
    source: 'mock',
    sourceId: 'the-echo-mine',
    title: 'The Echo Mine',
    type: 'series',
    year: 2025,
    genres: ['Adventure', 'Mystery'],
    posterUrl:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
    backdropUrl:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80',
    description:
      'Archaeologists discover a forgotten crystalline network beneath the desert that predicts the future through memory maps.',
    rating: 7.2,
    contentRating: 'TV-PG',
    language: 'en',
    runtimeMinutes: 53,
    availability: mockAvailability(),
  },
  {
    id: 'mock:night-of-ember',
    source: 'mock',
    sourceId: 'night-of-ember',
    title: 'Night of Ember',
    type: 'live',
    year: 2026,
    genres: ['Drama', 'Concert', 'Live'],
    posterUrl:
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
    backdropUrl:
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1400&q=80',
    description:
      'A live-streamed festival unfolds in a neon-lit stadium as bands, dancers, and immersive visuals light the night sky.',
    language: 'en',
    isNewRelease: true,
    availability: mockAvailability(),
  },
];
