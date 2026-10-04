export const TITLE_CATEGORIES = [
  'Nollywood',
  'Hollywood',
  'Bollywood',
  'Anime',
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
] as const;

export type TitleCategory = (typeof TITLE_CATEGORIES)[number];
