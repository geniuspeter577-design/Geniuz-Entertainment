import type { ContentItem } from '../models/content';
import type { OfflineDownloadRecord } from '../services/OfflineDownloadService';

const HERO_ITEM_LIMIT = 5;

export function getHomeHeroItems(
  publishedItems: readonly ContentItem[],
  downloads: readonly OfflineDownloadRecord[],
  isOnline: boolean,
) {
  if (isOnline) {
    return publishedItems
      .filter((item) => item.availability.discoverable)
      .slice()
      .sort((first, second) =>
        (second.createdAt ?? '').localeCompare(first.createdAt ?? ''),
      )
      .slice(0, HERO_ITEM_LIMIT);
  }

  return downloads
    .filter((record) => record.status === 'downloaded')
    .slice()
    .sort((first, second) => second.date.localeCompare(first.date))
    .slice(0, HERO_ITEM_LIMIT)
    .map((record) => record.item);
}
