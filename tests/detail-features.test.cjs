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
const { getSupabaseErrorDetails } = require('../.test-build/src/utils/supabaseError.js');
const { getAdminRouteState, isAdminMetadata } = require('../.test-build/src/utils/adminAccess.js');
const { getHomeHeroItems } = require('../.test-build/src/utils/homeHero.js');
const { getKeyboardScrollTarget } = require('../.test-build/src/utils/keyboardScroll.js');
const {
  getDragTarget,
  getSeekBarTarget,
  isPlayerGestureArea,
  getSeekTarget,
  formatPlaybackTime,
  PLAYER_CONTROLS_AUTO_HIDE_MS,
  PLAYER_SPEED_OPTIONS,
  getPlayerSpeedLabel,
  getNextPlayerSpeed,
  getNextPlayerFit,
  getPlayerFitLabel,
  runPlayerActionIfActive,
  shouldAutoHidePlayerControls,
  setPlayerMuted,
  setPlayerVolume,
  togglePlayerLock,
  togglePlayerOrientation,
} = require('../.test-build/src/utils/playerControls.js');
const {
  getFriendlyPlaybackError,
  isExpiredPlaybackLinkError,
} = require('../.test-build/src/utils/playbackError.js');
const {
  shouldAutoplayTrailer,
  toggleTrailerMuted,
} = require('../.test-build/src/utils/trailerAutoplay.js');
const {
  deleteRecordThenCleanup,
  retryTitleCleanup,
} = require('../.test-build/src/utils/titleDeletion.js');
const { TitleCleanupStore } = require('../.test-build/src/services/TitleCleanupStore.js');
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
const {
  EPISODE_WATCHED_PROGRESS_PERCENT,
  NEXT_EPISODE_COUNTDOWN_SECONDS,
  isEpisodeWatchedAtPosition,
  markEpisodeWatched,
} = require('../.test-build/src/utils/episodePlayback.js');
const {
  findSubtitleCue,
  parseSubtitleFile,
  validateSubtitleFile,
} = require('../.test-build/src/utils/subtitles.js');

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

test('keyboard scroll target keeps a focused input above the visible keyboard edge', () => {
  const viewport = {
    viewportTop: 100,
    viewportHeight: 500,
    keyboardTop: 500,
    currentScrollOffset: 120,
  };
  assert.equal(getKeyboardScrollTarget({ ...viewport, inputTop: 400, inputHeight: 60 }), 120);
  assert.equal(getKeyboardScrollTarget({ ...viewport, inputTop: 450, inputHeight: 60 }), 146);
  assert.equal(getKeyboardScrollTarget({
    ...viewport,
    keyboardTop: 430,
    inputTop: 360,
    inputHeight: 60,
  }), 126);
  assert.equal(getKeyboardScrollTarget({
    ...viewport,
    keyboardTop: undefined,
    inputTop: 650,
    inputHeight: 40,
  }), 226);
});

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

test('Supabase diagnostics retain only code, message, details, and hint fields', () => {
  assert.deepEqual(
    getSupabaseErrorDetails({
      code: 'PGRST204',
      message: 'Column not found',
      details: 'The requested column is absent.',
      hint: 'Apply the current migration.',
      access_token: 'must-not-be-logged',
    }),
    {
      code: 'PGRST204',
      message: 'Column not found',
      details: 'The requested column is absent.',
      hint: 'Apply the current migration.',
    },
  );
});

test('admin screen access permits admins, hides direct mobile access, and allows intentional sign-in', () => {
  assert.equal(isAdminMetadata({ role: 'admin' }), true);
  assert.equal(isAdminMetadata({ role: 'user' }), false);
  assert.equal(getAdminRouteState({ isAdmin: false, isSignedIn: false, canSignIn: false }), 'not-found');
  assert.equal(getAdminRouteState({ isAdmin: false, isSignedIn: false, canSignIn: true }), 'sign-in');
  assert.equal(getAdminRouteState({ isAdmin: false, isSignedIn: true, canSignIn: true }), 'not-found');
  assert.equal(getAdminRouteState({ isAdmin: true, isSignedIn: true, canSignIn: false }), 'admin');
});

test('Home hero selects five newest published titles and only downloaded cached items offline', () => {
  const published = Array.from({ length: 7 }, (_, index) => ({
    ...item(`title-${index}`),
    createdAt: `2026-10-0${index + 1}T00:00:00.000Z`,
  }));
  published.push({
    ...item('draft'),
    createdAt: '2026-10-20T00:00:00.000Z',
    availability: { discoverable: false, stream: false, download: false, premium: false },
  });
  const online = getHomeHeroItems(published, [], true);
  assert.equal(online.length, 5);
  assert.deepEqual(online.map(({ id }) => id), ['title-6', 'title-5', 'title-4', 'title-3', 'title-2']);

  const cached = [
    { item: item('queued'), status: 'queued', date: '2026-10-30' },
    { item: item('old'), status: 'downloaded', date: '2026-10-01' },
    { item: item('new'), status: 'downloaded', date: '2026-10-02' },
  ];
  assert.deepEqual(getHomeHeroItems([], cached, false).map(({ id }) => id), ['new', 'old']);
});

test('player controls clamp seeks, speed presets, fit cycling, and lock state', () => {
  assert.equal(getSeekTarget(5, 60, 10), 15);
  assert.equal(getSeekTarget(5, 60, -10), 0);
  assert.equal(getSeekTarget(58, 60, 10), 60);
  assert.equal(getDragTarget(0.5, -25, 100), 0.75);
  assert.equal(getDragTarget(0.5, 100, 100), 0);
  assert.equal(getDragTarget(0.5, -100, 100), 1);
  assert.equal(getDragTarget(0.5, 10, 0), 0.5);
  assert.deepEqual(PLAYER_SPEED_OPTIONS, [0.5, 0.75, 1, 1.25, 1.5, 2]);
  assert.equal(getPlayerSpeedLabel(1), '1x');
  assert.equal(getPlayerSpeedLabel(1.25), '1.25x');
  assert.equal(getNextPlayerSpeed(1), 1.25);
  assert.equal(getNextPlayerSpeed(2), 0.5);
  assert.equal(getNextPlayerFit('contain'), 'fill');
  assert.equal(getNextPlayerFit('fill'), 'cover');
  assert.equal(getNextPlayerFit('cover'), 'contain');
  assert.equal(getPlayerFitLabel('contain'), 'Fit');
  assert.equal(getPlayerFitLabel('fill'), 'Fill');
  assert.equal(getPlayerFitLabel('cover'), 'Stretch');
  assert.equal(togglePlayerLock(false), true);
  assert.equal(togglePlayerLock(true), false);
  assert.equal(togglePlayerOrientation(false), true);
  assert.equal(togglePlayerOrientation(true), false);
  assert.equal(isPlayerGestureArea(60, 100, 360, 200), true);
  assert.equal(isPlayerGestureArea(180, 100, 360, 200), false);
  assert.equal(isPlayerGestureArea(20, 100, 360, 200), false);
  assert.equal(isPlayerGestureArea(60, 180, 360, 200), false);
  const player = { volume: 0.5, muted: false };
  setPlayerVolume(player, 2);
  setPlayerMuted(player, true);
  assert.equal(player.volume, 1);
  assert.equal(player.muted, true);
});

test('playback time formatting supports minutes, hours, and invalid values', () => {
  assert.equal(formatPlaybackTime(0), '0:00');
  assert.equal(formatPlaybackTime(65.9), '1:05');
  assert.equal(formatPlaybackTime(3600), '1:00:00');
  assert.equal(formatPlaybackTime(3661), '1:01:01');
  assert.equal(formatPlaybackTime(-1), '0:00');
  assert.equal(formatPlaybackTime(Number.NaN), '0:00');
});

test('seek bar math clamps the thumb position and rejects invalid dimensions', () => {
  assert.equal(getSeekBarTarget(0, 100, 60), 0);
  assert.equal(getSeekBarTarget(25, 100, 60), 15);
  assert.equal(getSeekBarTarget(100, 100, 60), 60);
  assert.equal(getSeekBarTarget(120, 100, 60), 60);
  assert.equal(getSeekBarTarget(-20, 100, 60), 0);
  assert.equal(getSeekBarTarget(20, 0, 60), 0);
  assert.equal(getSeekTarget(Number.NaN, 60, 10), 10);
});

test('player controls auto-hide only while playing and not seeking', () => {
  assert.equal(PLAYER_CONTROLS_AUTO_HIDE_MS, 3000);
  assert.equal(shouldAutoHidePlayerControls(true, false), true);
  assert.equal(shouldAutoHidePlayerControls(false, false), false);
  assert.equal(shouldAutoHidePlayerControls(true, true), false);
  assert.equal(shouldAutoHidePlayerControls(false, true), false);
});

test('expired playback links are recognized without exposing technical errors', () => {
  assert.equal(isExpiredPlaybackLinkError({ message: 'Request has expired' }), true);
  assert.equal(isExpiredPlaybackLinkError({ status: 403, message: 'Forbidden' }), true);
  assert.equal(isExpiredPlaybackLinkError({ message: 'Unsupported codec' }), false);
  assert.match(getFriendlyPlaybackError(true, { message: 'Unsupported codec' }), /MP4/);
  assert.match(getFriendlyPlaybackError(false, { message: 'network error' }), /offline/i);
});

test('released trailer players do not receive further commands', () => {
  let calls = 0;
  assert.equal(runPlayerActionIfActive(true, () => calls++), false);
  assert.equal(calls, 0);
  assert.equal(runPlayerActionIfActive(false, () => calls++), true);
  assert.equal(calls, 1);
});

test('trailer autoplay requires a published, online, focused title and respects mute state', () => {
  const eligible = {
    isPublished: true,
    isOnline: true,
    hasTrailer: true,
    autoplayEnabled: true,
    isFocused: true,
    isAppActive: true,
  };
  assert.equal(shouldAutoplayTrailer(eligible), true);
  for (const key of Object.keys(eligible)) {
    assert.equal(shouldAutoplayTrailer({ ...eligible, [key]: false }), false, `${key} disables autoplay`);
  }
  assert.equal(toggleTrailerMuted(true), false);
  assert.equal(toggleTrailerMuted(false), true);
});

test('published movie query columns are declared by project migrations', () => {
  const repository = fs.readFileSync(
    path.join(process.cwd(), 'src/repositories/SupabaseMovieRepository.ts'),
    'utf8',
  );
  const columns = repository.match(/const MOVIE_COLUMNS =\s*'([^']+)'/)?.[1]?.split(',') ?? [];
  const migrations = fs
    .readdirSync(path.join(process.cwd(), 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', name), 'utf8'))
    .join('\n');
  for (const column of columns) {
    assert.match(migrations, new RegExp(`\\b${column}\\b`), `Missing migration column: ${column}`);
  }
});

test('manual movie conversion workflow is dispatch-only, read-only permissioned, and references secrets by name', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github/workflows/convert-movie.yml'),
    'utf8',
  );
  const triggerBlock = workflow.split(/^permissions:/m, 1)[0];
  const permissionsBlock = workflow.match(/^permissions:\s*\n((?:^  .*\n)+)/m)?.[1]?.trim();

  assert.match(triggerBlock, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(triggerBlock, /^\s{2}(push|pull_request|schedule|workflow_run):/m);
  assert.equal(permissionsBlock, 'contents: read');
  for (const secretName of [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    assert.match(workflow, new RegExp(`\\$\\{\\{\\s*secrets\\.${secretName}\\s*\\}\\}`));
  }
  assert.doesNotMatch(workflow, /sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
});

test('published series are selectable by anon while series still require no video file', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261008000000_published_series_read_access.sql'),
    'utf8',
  );
  assert.match(migration, /on public\.movies for select\s+to anon, authenticated/);
  assert.match(migration, /published\s+and\s+\(\s*content_type = 'series'/);
  assert.match(migration, /storage_provider = 'supabase' and video_path is not null/);
  assert.match(migration, /storage_provider = 'b2' and storage_key is not null/);
});

test('database and storage write policies require the trusted admin role', () => {
  const migrationDirectory = path.join(process.cwd(), 'supabase/migrations');
  const migrations = fs
    .readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => fs.readFileSync(path.join(migrationDirectory, name), 'utf8'))
    .join('\n');
  assert.match(migrations, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' = 'admin'/);
  for (const relation of ['movies', 'seasons', 'episodes']) {
    assert.match(migrations, new RegExp(`on public\\.${relation} for all[\\s\\S]*to authenticated[\\s\\S]*public\\.is_geniuz_admin\\(\\)[\\s\\S]*with check \\(public\\.is_geniuz_admin\\(\\)\\)`));
  }
  for (const bucket of ['movie-assets', 'title-images']) {
    assert.match(migrations, new RegExp(`bucket_id = '${bucket}' and public\\.is_geniuz_admin\\(\\)`));
  }
});

test('title deletion removes the database record first and retains only assets that failed cleanup', async () => {
  const record = {
    titleId: 'movie-1',
    title: 'Test title',
    assets: [
      { kind: 'b2', key: 'movies/video.mp4' },
      { kind: 'image', url: 'https://storage.example.test/poster.jpg' },
      { kind: 'supabase-video', path: 'movie-assets/legacy.mp4' },
    ],
  };
  const order = [];
  const result = await deleteRecordThenCleanup(
    record,
    async () => order.push('record'),
    async (asset) => {
      order.push(asset.kind);
      if (asset.kind !== 'image') {
        throw Object.assign(new Error('permission denied'), { status: 502, code: 'B2_DELETE_FAILED' });
      }
    },
  );
  assert.deepEqual(order, ['record', 'b2', 'image', 'supabase-video']);
  assert.deepEqual(result.pending.assets, [record.assets[0], record.assets[2]]);
  assert.equal(result.failures.length, 2);
});

test('title cleanup never touches files when deleting the database record fails', async () => {
  let removed = false;
  await assert.rejects(
    deleteRecordThenCleanup(
      { titleId: 'movie-1', title: 'Test title', assets: [{ kind: 'image', url: 'image-url' }] },
      async () => {
        throw new Error('record permission denied');
      },
      async () => {
        removed = true;
      },
    ),
    /record permission denied/,
  );
  assert.equal(removed, false);
});

test('retry cleanup removes successful assets and persists any remaining work', async () => {
  const values = new Map();
  const store = new TitleCleanupStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value),
  });
  const job = {
    titleId: 'movie-1',
    title: 'Test title',
    assets: [
      { kind: 'b2', key: 'movies/video.mp4' },
      { kind: 'image', url: 'https://storage.example.test/poster.jpg' },
    ],
  };
  const retry = await retryTitleCleanup(job, async (asset) => {
    if (asset.kind === 'b2') {
      throw new Error('permission denied');
    }
  });
  await store.save([retry.pending]);
  assert.deepEqual((await store.load())[0].assets, [job.assets[0]]);
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

test('episode watch completion records watched state at 95 percent without duplicating IDs', () => {
  const episodeId = 'geniuz:episode:episode-1';
  assert.equal(EPISODE_WATCHED_PROGRESS_PERCENT, 95);
  assert.equal(NEXT_EPISODE_COUNTDOWN_SECONDS, 10);
  assert.equal(isEpisodeWatchedAtPosition(episodeId, 94, 100), false);
  assert.equal(isEpisodeWatchedAtPosition(episodeId, 95, 100), true);
  assert.equal(isEpisodeWatchedAtPosition('geniuz:movie:movie-1', 100, 100), false);
  assert.deepEqual(markEpisodeWatched([], episodeId, 95, 100), [episodeId]);
  assert.deepEqual(markEpisodeWatched([episodeId], episodeId, 99, 100), [episodeId]);
});

test('subtitle validation and SRT/VTT parsing select cues by playback time', () => {
  assert.deepEqual(validateSubtitleFile('captions.srt', 10), { valid: true, format: 'srt' });
  assert.deepEqual(validateSubtitleFile('captions.vtt', 10), { valid: true, format: 'vtt' });
  assert.equal(validateSubtitleFile('captions.txt', 10).valid, false);
  assert.equal(validateSubtitleFile('captions.srt', 0).valid, false);

  const srt = parseSubtitleFile(
    '1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; welcome\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nNext line',
    'srt',
  );
  assert.deepEqual(srt, [
    { startSeconds: 1, endSeconds: 2.5, text: 'Hello & welcome' },
    { startSeconds: 3, endSeconds: 4, text: 'Next line' },
  ]);
  assert.equal(findSubtitleCue(srt, 0.99), undefined);
  assert.equal(findSubtitleCue(srt, 1.5).text, 'Hello & welcome');
  assert.equal(findSubtitleCue(srt, 2.5), undefined);
  assert.deepEqual(
    parseSubtitleFile('WEBVTT\n\n00:00:00.500 --> 00:00:01.250\nHello', 'vtt'),
    [{ startSeconds: 0.5, endSeconds: 1.25, text: 'Hello' }],
  );
  assert.throws(() => parseSubtitleFile('00:00:01.000 --> 00:00:02.000\nCaption', 'vtt'), /WEBVTT/);
});
