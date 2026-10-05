import type { ContentItem } from '../models/content';

export type PublishedCatalog<T extends ContentItem = ContentItem> = {
  movies: T[];
  series: T[];
  shorts: T[];
  hasFailures: boolean;
};

export async function loadPublishedCatalog<T extends ContentItem>(
  loadMovies: () => Promise<T[]>,
  loadSeries: () => Promise<T[]>,
  loadShorts: () => Promise<T[]> = async () => [],
): Promise<PublishedCatalog<T>> {
  const [moviesResult, seriesResult, shortsResult] = await Promise.allSettled([
    loadMovies(),
    loadSeries(),
    loadShorts(),
  ]);

  return {
    movies: moviesResult.status === 'fulfilled' ? moviesResult.value : [],
    series: seriesResult.status === 'fulfilled' ? seriesResult.value : [],
    shorts: shortsResult.status === 'fulfilled' ? shortsResult.value : [],
    hasFailures:
      moviesResult.status === 'rejected' ||
      seriesResult.status === 'rejected' ||
      shortsResult.status === 'rejected',
  };
}

export async function loadAllPages<T>(
  loadPage: (offset: number, pageSize: number) => Promise<T[]>,
  pageSize: number,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError('Page size must be a positive safe integer.');
  }
  const items: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await loadPage(offset, pageSize);
    items.push(...page);
    if (page.length < pageSize) {
      return items;
    }
  }
}

export function sortPublishedNewest<T extends ContentItem>(items: readonly T[]) {
  return [...items].sort((first, second) =>
    (second.createdAt ?? '').localeCompare(first.createdAt ?? ''),
  );
}

export function getCategoryTabs(items: readonly ContentItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const category of new Set(item.categories ?? [])) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((first, second) => second.count - first.count || first.category.localeCompare(second.category));
}

export function getCategoryItems(items: readonly ContentItem[], category: string) {
  const normalizedCategory = category.trim().toLocaleLowerCase();
  return sortPublishedNewest(items.filter((item) =>
    item.availability.discoverable &&
    (item.categories ?? []).some((itemCategory) =>
      itemCategory.toLocaleLowerCase() === normalizedCategory,
    ),
  ));
}

export function getHomeCategoryItems(items: readonly ContentItem[], category: string) {
  if (category.trim().toLocaleLowerCase() === 'tv') {
    return sortPublishedNewest(items.filter(
      (item) => item.availability.discoverable && (item.type === 'series' || item.type === 'tv'),
    ));
  }
  return getCategoryItems(items, category);
}

export function searchPublishedCatalog(
  items: readonly ContentItem[],
  query: string,
): ContentItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return [...items];
  }

  return items.filter(
    (item) =>
      item.title.toLocaleLowerCase().includes(normalized) ||
      item.genres.some((genre) => genre.toLocaleLowerCase().includes(normalized)) ||
      (item.year !== undefined && String(item.year).includes(normalized)),
  );
}

export const isDemoCatalogEnabled = process.env.EXPO_PUBLIC_USE_DEMO_CATALOG === 'true';
