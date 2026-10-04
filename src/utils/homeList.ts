import type { ContentItem } from '../models/content';
import { sortPublishedNewest } from './publishedCatalog';

export function getRankedHomeListItems<T extends ContentItem>(
  items: readonly T[],
  isTrending: boolean,
  rankOffset = 0,
) {
  return sortPublishedNewest(items).map((item, index) => ({
    item,
    ...(isTrending ? { rank: rankOffset + index + 1 } : {}),
  }));
}