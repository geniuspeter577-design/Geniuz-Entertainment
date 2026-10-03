const assert = require('node:assert/strict');
const { test } = require('node:test');

const { FEATURE_FLAGS, isFeatureEnabled } = require('../.test-build/src/config/features.js');
const { loadAdminCatalog } = require('../.test-build/src/utils/adminCatalog.js');
const {
  deleteOrphanedUpload,
  retryUploadedMovieSave,
} = require('../.test-build/src/utils/uploadSaveRecovery.js');
const { validateTitleImage, TITLE_IMAGE_MAX_INPUT_BYTES } = require('../.test-build/src/utils/titleImageValidation.js');
const { getDownloadUnavailableReason } = require('../.test-build/src/utils/downloadAvailability.js');
const { isNetworkOnline } = require('../.test-build/src/utils/networkStatus.js');
const fs = require('node:fs');
const path = require('node:path');
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

  assert.equal(isFeatureEnabled('premiumBanner'), false);
  assert.equal(isFeatureEnabled('qualityOptions'), false);
  assert.equal(isFeatureEnabled('vipUpsell'), false);
});

test('admin catalog loads movies even when series tables fail, and vice versa', async () => {
  const movie = { id: 'movie-1' };
  const success = await loadAdminCatalog(async () => [movie], async () => {
    throw new Error('series table missing');
  });
  assert.deepEqual(success.movies, [movie]);
  assert.match(success.seriesError.message, /series table missing/);

  const series = { id: 'season-1' };
  const partial = await loadAdminCatalog(async () => {
    throw new Error('movies query failed');
  }, async () => [series]);
  assert.match(partial.movieError.message, /movies query failed/);
  assert.deepEqual(partial.seasons, [series]);
});

test('retry-save reuses the uploaded key without uploading again and orphan cleanup deletes only that object', async () => {
  const draft = { movie: { title: 'Already uploaded' }, storageKey: 'movies/object.mp4' };
  const calls = [];
  const result = await retryUploadedMovieSave(draft, async (movie, key) => {
    calls.push({ movie, key });
    return 'saved';
  });
  assert.equal(result, 'saved');
  assert.deepEqual(calls, [{ movie: draft.movie, key: draft.storageKey }]);

  let removedKey;
  await deleteOrphanedUpload(draft, async (key) => {
    removedKey = key;
  });
  assert.equal(removedKey, draft.storageKey);
});

test('title image validation accepts JPG, PNG, and WebP up to 5 MB', () => {
  for (const [fileName, mimeType] of [
    ['poster.jpg', 'image/jpeg'],
    ['cover.png', 'image/png'],
    ['cover.webp', 'image/webp'],
  ]) {
    assert.deepEqual(validateTitleImage(fileName, mimeType, TITLE_IMAGE_MAX_INPUT_BYTES), {
      valid: true,
    });
  }
  assert.equal(validateTitleImage('poster.gif', 'image/gif', 100).valid, false);
  assert.equal(validateTitleImage('poster.jpg', 'image/png', 100).valid, false);
  assert.equal(validateTitleImage('poster.png', 'image/png', TITLE_IMAGE_MAX_INPUT_BYTES + 1).valid, false);
});

test('download availability explains disabled, browser, unsupported, and low-storage cases', () => {
  const defaults = {
    allowed: true,
    platform: 'android',
    supported: true,
    availableBytes: 10_000,
    fileSize: 1000,
  };
  assert.match(getDownloadUnavailableReason({ ...defaults, allowed: false }), /turned off/);
  assert.match(getDownloadUnavailableReason({ ...defaults, platform: 'web' }), /phone app/);
  assert.match(getDownloadUnavailableReason({ ...defaults, supported: false }), /format/);
  assert.match(getDownloadUnavailableReason({ ...defaults, availableBytes: 100 }), /free storage/);
  assert.equal(getDownloadUnavailableReason(defaults), undefined);
});

test('network status requires a connection and treats confirmed unreachable internet as offline', () => {
  assert.equal(isNetworkOnline({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(isNetworkOnline({ isConnected: true, isInternetReachable: null }), true);
  assert.equal(isNetworkOnline({ isConnected: true, isInternetReachable: false }), false);
  assert.equal(isNetworkOnline({ isConnected: false, isInternetReachable: true }), false);
});

test('title image migration creates a public-read bucket with admin-only mutations', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261006000000_title_images.sql'),
    'utf8',
  );
  assert.match(migration, /title-images[\s\S]*true[\s\S]*5242880/);
  assert.match(migration, /to anon, authenticated[\s\S]*using \(bucket_id = 'title-images'\)/);
  assert.match(migration, /to authenticated[\s\S]*public\.is_geniuz_admin\(\)/);
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
