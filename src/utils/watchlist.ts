import type { ContentItem } from '../models/content';

export function toggleWatchlistItem(watchlist: ContentItem[], item: ContentItem) {
  const alreadySaved = watchlist.some((savedItem) => savedItem.id === item.id);
  return alreadySaved
    ? watchlist.filter((savedItem) => savedItem.id !== item.id)
    : [item, ...watchlist];
}
