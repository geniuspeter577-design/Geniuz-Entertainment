export const TITLE_CATEGORIES = [
  'Nollywood',
  'Hollywood',
  'Bollywood',
  'Anime',
  'Animation',
  'Cartoon',
  'K-Drama',
  'Series',
  'Action',
  'Comedy',
  'Drama',
  'Horror',
  'Romance',
  'Kids',
  'Football',
  'Reels',
] as const;

export type TitleCategory = (typeof TITLE_CATEGORIES)[number];
