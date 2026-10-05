const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TITLE_CATEGORIES } = require('../.test-build/src/constants/categories.js');

const {
  loadAllPages,
  getHomeCategoryItems,
  sortPublishedNewest,
  getCategoryTabs,
} = require('../.test-build/src/utils/publishedCatalog.js');
const { getRankedHomeListItems } = require('../.test-build/src/utils/homeList.js');
const { resetHomeToTrending } = require('../.test-build/src/utils/homeNavigation.js');
const {
  createHomeShuffleSeed,
  shuffleHomeCategoryRows,
} = require('../.test-build/src/utils/homeRowShuffle.js');
const {
  getUnreadNotificationCount,
} = require('../.test-build/src/services/NotificationsStore.js');

const categoryItems = [
  {
    id: 'movie:1',
    source: 'geniuz',
    title: 'Action Rush',
    type: 'movie',
    createdAt: '2026-10-01T00:00:00.000Z',
    genres: ['Action'],
    categories: ['Action', 'Drama'],
    availability: { discoverable: true, stream: true, download: true, premium: false },
  },
  {
    id: 'movie:2',
    source: 'geniuz',
    title: 'Later Drama',
    type: 'movie',
    createdAt: '2026-10-03T00:00:00.000Z',
    genres: ['Drama'],
    categories: ['Drama'],
    availability: { discoverable: true, stream: true, download: true, premium: false },
  },
  {
    id: 'movie:3',
    source: 'geniuz',
    title: 'Action Night',
    type: 'movie',
    createdAt: '2026-10-02T00:00:00.000Z',
    genres: ['Action'],
    categories: ['Action'],
    availability: { discoverable: true, stream: true, download: true, premium: false },
  },
  {
    id: 'movie:4',
    source: 'geniuz',
    title: 'Early Drama',
    type: 'movie',
    createdAt: '2026-09-28T00:00:00.000Z',
    genres: ['Drama'],
    categories: ['Drama'],
    availability: { discoverable: true, stream: true, download: true, premium: false },
  },
  {
    id: 'movie:5',
    source: 'geniuz',
    title: 'Horror Night',
    type: 'movie',
    createdAt: '2026-10-04T00:00:00.000Z',
    genres: ['Horror'],
    categories: ['Horror'],
    availability: { discoverable: true, stream: true, download: true, premium: false },
  },
];

test('Home category tabs include every matching published category case-insensitively', () => {
  const tabs = getCategoryTabs(categoryItems);
  assert.deepEqual(tabs.map(({ count }) => count), [3, 2, 1]);
  assert.deepEqual(new Set(tabs.map(({ category }) => category)), new Set(['Action', 'Drama', 'Horror']));

  const dramaItems = getHomeCategoryItems(categoryItems, 'Drama');
  assert.deepEqual(dramaItems.map(({ title }) => title), ['Later Drama', 'Action Rush', 'Early Drama']);

  const horrorItems = getHomeCategoryItems(categoryItems, 'Horror');
  assert.deepEqual(horrorItems.map(({ title }) => title), ['Horror Night']);
});

test('Nollywood multi-category movies, Animation movies, and series appear in their matching Home tabs', () => {
  const sharedMetadata = {
    source: 'geniuz',
    createdAt: '2026-10-05T00:00:00.000Z',
    genres: [],
    availability: { discoverable: true, stream: true, download: false, premium: false },
  };
  const titles = [
    {
      ...sharedMetadata,
      id: 'movie:nollywood',
      title: 'Nollywood Comedy',
      type: 'movie',
      categories: ['Nollywood', 'Comedy', 'Romance'],
    },
    {
      ...sharedMetadata,
      id: 'movie:animation',
      title: 'Animated Adventure',
      type: 'movie',
      categories: ['Animation'],
    },
    {
      ...sharedMetadata,
      id: 'series:tv',
      title: 'Seasonal Series',
      type: 'series',
      categories: ['Drama'],
    },
  ];

  assert.deepEqual(getHomeCategoryItems(titles, 'Nollywood').map(({ id }) => id), ['movie:nollywood']);
  assert.deepEqual(getHomeCategoryItems(titles, 'Animation').map(({ id }) => id), ['movie:animation']);
  assert.deepEqual(getHomeCategoryItems(titles, 'TV').map(({ id }) => id), ['series:tv']);
  assert.deepEqual(getHomeCategoryItems(titles, 'nOlLyWoOd').map(({ id }) => id), ['movie:nollywood']);
  assert.deepEqual(
    getHomeCategoryItems([{ ...titles[0], categories: ['nOlLyWoOd'] }], 'Nollywood').map(({ id }) => id),
    ['movie:nollywood'],
  );
  assert.deepEqual(getHomeCategoryItems(titles, 'Drama').map(({ id }) => id), ['series:tv']);
  assert.deepEqual(getHomeCategoryItems(titles, 'Comedy').map(({ id }) => id), ['movie:nollywood']);
  assert.deepEqual(getHomeCategoryItems(titles, 'Romance').map(({ id }) => id), ['movie:nollywood']);
});

test('unpublished titles never appear in category tabs', () => {
  const draft = {
    id: 'movie:draft',
    source: 'geniuz',
    title: 'Unpublished Nollywood',
    type: 'movie',
    genres: [],
    categories: ['Nollywood'],
    availability: { discoverable: false, stream: false, download: false, premium: false },
  };

  assert.deepEqual(getHomeCategoryItems([draft], 'Nollywood'), []);
});

test('published catalog fetch follows all pages beyond the default Supabase row limit', async () => {
  const allTitles = Array.from({ length: 1103 }, (_, index) => `title-${index}`);
  const pageOffsets = [];
  const result = await loadAllPages(async (offset, pageSize) => {
    pageOffsets.push(offset);
    return allTitles.slice(offset, offset + pageSize);
  }, 500);

  assert.deepEqual(pageOffsets, [0, 500, 1000]);
  assert.deepEqual(result, allTitles);
});

test('Home lists sort newest first and keep Trending ranks continuous across pages', () => {
  const ranked = getRankedHomeListItems(categoryItems, true);
  assert.deepEqual(ranked.map(({ item }) => item.title), [
    'Horror Night',
    'Later Drama',
    'Action Night',
    'Action Rush',
    'Early Drama',
  ]);
  assert.deepEqual(ranked.map(({ rank }) => rank), [1, 2, 3, 4, 5]);

  const nextPage = getRankedHomeListItems([categoryItems[0], categoryItems[3]], true, 5);
  assert.deepEqual(nextPage.map(({ rank }) => rank), [6, 7]);
  assert.deepEqual(
    getRankedHomeListItems(categoryItems, false).map(({ rank }) => rank),
    [undefined, undefined, undefined, undefined, undefined],
  );
});

test('tapping Home resets the selected category to Trending and scrolls to the top', () => {
  let selectedCategory = 'Football';
  let scrollPosition = 640;
  resetHomeToTrending(
    (category) => { selectedCategory = category; },
    () => { scrollPosition = 0; },
  );
  assert.equal(selectedCategory, 'Trending');
  assert.equal(scrollPosition, 0);
});

test('refresh changes the seeded shuffle while Latest stays newest-first', () => {
  const originalRandom = Math.random;
  const shuffledRows = [
    {
      key: 'latest',
      title: 'Latest',
      emptyMessage: 'No titles',
      isLoading: false,
      items: sortPublishedNewest([
        { id: 'older', createdAt: '2026-10-01', title: 'Older' },
        { id: 'newest', createdAt: '2026-10-05', title: 'Newest' },
        { id: 'middle', createdAt: '2026-10-03', title: 'Middle' },
      ]),
    },
    {
      key: 'movies',
      title: 'Movies',
      emptyMessage: 'No titles',
      isLoading: false,
      items: ['a', 'b', 'c', 'd'],
    },
    {
      key: 'series',
      title: 'Series',
      emptyMessage: 'No titles',
      isLoading: false,
      items: ['e', 'f', 'g', 'h'],
    },
  ];

  try {
    Math.random = () => 1201 / 0x100000000;
    const firstSeed = createHomeShuffleSeed();
    Math.random = () => 9842 / 0x100000000;
    const refreshedSeed = createHomeShuffleSeed(firstSeed);
    assert.notEqual(refreshedSeed, firstSeed);

    const initialRows = shuffleHomeCategoryRows(shuffledRows, firstSeed);
    const refreshedRows = shuffleHomeCategoryRows(shuffledRows, refreshedSeed);
    assert.notDeepEqual(
      refreshedRows.filter(({ key }) => key !== 'latest').map(({ key, items }) => [key, items]),
      initialRows.filter(({ key }) => key !== 'latest').map(({ key, items }) => [key, items]),
    );
    assert.equal(refreshedRows[0].key, 'latest');
    assert.deepEqual(refreshedRows[0].items.map(({ id }) => id), ['newest', 'middle', 'older']);
  } finally {
    Math.random = originalRandom;
  }
});

test('admin category picker includes Reels', () => {
  assert.ok(TITLE_CATEGORIES.includes('Reels'));
});

test('notification unread counts reflect new reads without mutating the original array', () => {
  const notifications = [
    { id: 'a', read: false },
    { id: 'b', read: false },
    { id: 'c', read: true },
  ];

  assert.equal(getUnreadNotificationCount(notifications), 2);

  const updated = notifications.map((notification) =>
    notification.id === 'b' ? { ...notification, read: true } : notification,
  );

  assert.equal(getUnreadNotificationCount(updated), 1);
  assert.equal(getUnreadNotificationCount(notifications), 2);
});
