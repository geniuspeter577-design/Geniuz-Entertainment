const assert = require('node:assert/strict');
const { test } = require('node:test');

const { FEATURE_FLAGS, isFeatureEnabled } = require('../.test-build/src/config/features.js');
const { toggleWatchlistItem } = require('../.test-build/src/utils/watchlist.js');
const {
  nextEpisodeInSeason,
  nextEpisodeInSeries,
  orderEpisodes,
  selectEpisodes,
  totalEpisodeSize,
} = require('../.test-build/src/utils/episodeSelection.js');

function item(id, title = id) {
  return {
    id,
    title,
    source: 'geniuz',
    type: 'movie',
    genres: [],
    availability: { discoverable: true, stream: true, download: false, premium: false },
  };
}

test('watchlist toggling adds a title once and removes it by ID', () => {
  const first = item('first');
  const second = item('second');

  assert.deepEqual(toggleWatchlistItem([], first), [first]);
  assert.deepEqual(toggleWatchlistItem([first], second), [second, first]);
  assert.deepEqual(toggleWatchlistItem([first, second], first), [second]);
});

test('premium UI feature flags default off and remain explicitly queryable', () => {
  assert.deepEqual(FEATURE_FLAGS, {
    premiumBanner: false,
    qualityOptions: false,
    vipUpsell: false,
  });

  test('episode selection preserves season and episode order and calculates selected file size', () => {
    const episode = (seasonNumber, episodeNumber, fileSizeBytes) => ({
      ...item(`s${seasonNumber}e${episodeNumber}`),
      seasonId: `season-${seasonNumber}`,
      seasonNumber,
      episodeNumber,
      durationSeconds: 1200,
      fileSizeBytes,
      parentSeriesId: 'series-1',
      published: true,
    });
    const seasonOne = episode(1, 1, 100);
    const seasonTwo = episode(2, 1, 300);
    const seasonOneNext = episode(1, 2, 200);
    const unordered = [seasonTwo, seasonOneNext, seasonOne];

    assert.deepEqual(orderEpisodes(unordered).map(({ id }) => id), [
      seasonOne.id,
      seasonOneNext.id,
      seasonTwo.id,
    ]);
    assert.deepEqual(selectEpisodes(unordered, [seasonTwo.id, seasonOne.id]).map(({ id }) => id), [
      seasonOne.id,
      seasonTwo.id,
    ]);
    assert.equal(totalEpisodeSize([seasonOne, seasonOneNext]), 300);
    assert.equal(
      nextEpisodeInSeason({ id: 'season-1', seriesId: 'series-1', seasonNumber: 1, published: true, episodes: [seasonOne, seasonOneNext] }, seasonOne.id).id,
      seasonOneNext.id,
    );
    assert.equal(nextEpisodeInSeries(unordered, seasonOneNext.id).id, seasonTwo.id);
  });
  assert.equal(isFeatureEnabled('premiumBanner'), false);
  assert.equal(isFeatureEnabled('qualityOptions'), false);
  assert.equal(isFeatureEnabled('vipUpsell'), false);
});
