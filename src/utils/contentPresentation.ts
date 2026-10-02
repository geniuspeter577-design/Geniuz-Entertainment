import type { ContentItem } from '../models/content';

export function formatRuntime(item: ContentItem) {
  if (!item.runtimeMinutes) {
    return item.type === 'live' ? 'Live' : 'Feature';
  }

  if (item.runtimeMinutes < 60) {
    return `${item.runtimeMinutes} min`;
  }

  const hours = Math.floor(item.runtimeMinutes / 60);
  const minutes = item.runtimeMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatRating(item: ContentItem) {
  if (item.contentRating) {
    return item.contentRating;
  }

  return typeof item.rating === 'number' ? item.rating.toFixed(1) : 'NR';
}

export function formatGenres(item: ContentItem) {
  return item.genres.length ? item.genres.join(' / ') : item.type.toUpperCase();
}
