const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  getCategoryItems,
  getCategoryTabs,
} = require('../.test-build/src/utils/publishedCatalog.js');
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

test('category tabs are ordered by count and filtered by category name', () => {
  const tabs = getCategoryTabs(categoryItems);
  assert.deepEqual(tabs.map(({ count }) => count), [3, 2, 1]);
  assert.deepEqual(new Set(tabs.map(({ category }) => category)), new Set(['Action', 'Drama', 'Horror']));

  const dramaItems = getCategoryItems(categoryItems, 'Drama');
  assert.deepEqual(dramaItems.map(({ title }) => title), ['Later Drama', 'Action Rush', 'Early Drama']);

  const horrorItems = getCategoryItems(categoryItems, 'Horror');
  assert.deepEqual(horrorItems.map(({ title }) => title), ['Horror Night']);
});

test('Animation titles are filtered by the Animation category', () => {
  const animationItems = getCategoryItems([
    ...categoryItems,
    {
      id: 'movie:animation',
      source: 'geniuz',
      title: 'Animated Adventure',
      type: 'movie',
      createdAt: '2026-10-05T00:00:00.000Z',
      genres: ['Adventure'],
      categories: ['Animation'],
      availability: { discoverable: true, stream: true, download: true, premium: false },
    },
  ], 'Animation');

  assert.deepEqual(animationItems.map(({ title }) => title), ['Animated Adventure']);
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
