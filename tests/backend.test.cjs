const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const { once } = require('node:events');
const { test } = require('node:test');

const { loadConfig } = require('../.test-build/backend/backend/src/config/config.js');
const { createApiServer } = require('../.test-build/backend/backend/src/http/server.js');
const { TMDBContentRepository } = require('../.test-build/backend/backend/src/repositories/TMDBContentRepository.js');
const { MemoryCache } = require('../.test-build/backend/backend/src/repositories/MemoryCache.js');
const { HttpTMDBProvider } = require('../.test-build/backend/backend/src/providers/TMDBProvider.js');
const { FootballMatchesService } = require('../.test-build/backend/backend/src/services/FootballMatchesService.js');
const { MembershipService, getMembershipAccessStatus } = require('../.test-build/backend/backend/src/services/MembershipService.js');
const { PaystackService, isValidPaystackSignature } = require('../.test-build/backend/backend/src/services/PaystackService.js');
const { ContentService } = require('../.test-build/backend/backend/src/services/ContentService.js');
const { B2StorageService } = require('../.test-build/backend/backend/src/storage/B2StorageService.js');
const requestFetch = global.fetch;

const tmdbRecord = {
  id: 101,
  title: 'Catalog feature',
  release_date: '2025-04-03',
  genre_ids: [28],
  poster_path: '/catalog-poster.jpg',
  backdrop_path: '/catalog-backdrop.jpg',
  overview: 'A catalog description.',
  vote_average: 8.2,
  original_language: 'en',
};

const footballMatch = {
  id: 'match-1',
  competition: { id: 'competition-1', name: 'Test League' },
  startsAt: '2026-10-08T17:00:00.000Z',
  status: 'live',
  minute: 61,
  homeTeam: { name: 'Home FC' },
  awayTeam: { name: 'Away FC' },
  homeScore: 2,
  awayScore: 1,
};

function makeResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeFetch({
  failStatus,
  keyTracker,
} = {}) {
  const calls = new Map();

  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.set(url.pathname, (calls.get(url.pathname) ?? 0) + 1);
    keyTracker?.push(new Headers(init.headers).get('Authorization'));

    if (failStatus) {
      return makeResponse({ status_message: 'provider internals with secret data' }, failStatus);
    }

    if (url.pathname.endsWith('/genre/movie/list')) {
      return makeResponse({ genres: [{ id: 28, name: 'Action' }] });
    }
    if (url.pathname.endsWith('/genre/tv/list')) {
      return makeResponse({ genres: [{ id: 18, name: 'Drama' }] });
    }
    if (url.pathname.endsWith('/trending/all/week')) {
      return makeResponse({
        page: 1,
        total_pages: 3,
        results: [{ ...tmdbRecord, media_type: 'movie' }],
      });
    }
    if (url.pathname.endsWith('/movie/popular') || url.pathname.endsWith('/movie/upcoming')) {
      return makeResponse({ page: 1, total_pages: 2, results: [tmdbRecord] });
    }
    if (url.pathname.endsWith('/tv/popular') || url.pathname.endsWith('/discover/tv')) {
      return makeResponse({
        page: 1,
        total_pages: 2,
        results: [{ id: 102, name: 'Catalog series', genre_ids: [18], first_air_date: '2024-01-02' }],
      });
    }
    if (url.pathname.endsWith('/search/multi')) {
      return makeResponse({
        page: Number(url.searchParams.get('page') ?? 1),
        total_pages: 1,
        results: [{ ...tmdbRecord, media_type: 'movie' }],
      });
    }
    if (url.pathname.endsWith('/movie/101/similar')) {
      return makeResponse({ page: 1, total_pages: 1, results: [tmdbRecord] });
    }
    if (url.pathname.endsWith('/movie/101')) {
      return makeResponse({ ...tmdbRecord, genres: [{ id: 28, name: 'Action' }], runtime: 114 });
    }
    if (/\/movie\/\d+$/.test(url.pathname) || /\/tv\/\d+$/.test(url.pathname)) {
      return makeResponse({ status_message: 'Not found' }, 404);
    }
    if (url.pathname.endsWith('/now_playing')) {
      return makeResponse({ page: 1, total_pages: 1, results: [tmdbRecord] });
    }
    if (url.pathname.endsWith('/discover/movie')) {
      return makeResponse({ page: 1, total_pages: 1, results: [tmdbRecord] });
    }
    return makeResponse({ status_message: 'Not found' }, 404);
  };

  return { fetchImplementation, calls };
}

async function startApi(options = {}) {
  const config = {
    port: 0,
    tmdbApiKey: Object.hasOwn(options, 'tmdbApiKey')
      ? options.tmdbApiKey
      : 'server-only-test-token',
    tmdbBaseUrl: 'https://tmdb.example.test/3',
    anilistApiUrl: 'https://anilist.example.test/graphql',
    corsOrigins: options.corsOrigins ?? ['http://localhost:8081'],
    cacheTtlSeconds: 30,
    membershipPriceNgn: options.membershipPriceNgn ?? 900,
    membershipGraceDays: options.membershipGraceDays ?? 3,
    subscription1500Enabled: options.subscription1500Enabled ?? false,
    dedicatedAccountEnabled: options.dedicatedAccountEnabled ?? false,
    ...(options.paystackSecretKey ? { paystackSecretKey: options.paystackSecretKey } : {}),
    ...(options.supabaseServiceRoleKey ? { supabaseServiceRoleKey: options.supabaseServiceRoleKey } : {}),
    ...(options.membershipCronSecret ? { membershipCronSecret: options.membershipCronSecret } : {}),
    ...(Object.hasOwn(options, 'footballDataApiKey')
      ? { footballDataApiKey: options.footballDataApiKey }
      : {}),
    ...(options.supabaseUrl ? { supabaseUrl: options.supabaseUrl } : {}),
    ...(options.supabasePublishableKey
      ? { supabasePublishableKey: options.supabasePublishableKey }
      : {}),
    ...(options.storage ?? {}),
  };
  const fakeFetch = makeFetch(options);
  const provider = new HttpTMDBProvider(
    { tmdbApiKey: config.tmdbApiKey, tmdbBaseUrl: config.tmdbBaseUrl },
    fakeFetch.fetchImplementation,
  );
  const repository = new TMDBContentRepository(provider, 30_000);
  const server = createApiServer(
    config,
    new ContentService(repository, 30_000),
    {
      ...(options.footballMatchesService ? { footballMatchesService: options.footballMatchesService } : {}),
      ...(options.membershipService ? { membershipService: options.membershipService } : {}),
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls: fakeFetch.calls,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function startTransferApi(context, activeMember = false) {
  const originalFetch = global.fetch;
  const calls = { membership: 0, createSession: 0, authorizeSend: 0 };
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return makeResponse({
        id: '00000000-0000-4000-8000-000000000021',
        app_metadata: { role: 'user' },
      });
    }
    if (url.pathname === '/rest/v1/rpc/require_active_transfer_membership') {
      calls.membership += 1;
      return activeMember
        ? makeResponse(true)
        : makeResponse({ message: 'MEMBERSHIP_REQUIRED', code: 'P0001' }, 400);
    }
    if (url.pathname === '/rest/v1/rpc/authorize_device_transfer') {
      calls.authorizeSend += 1;
      return makeResponse({ sessionId: '00000000-0000-4000-8000-000000000022', receivedBytes: 0 });
    }
    if (url.pathname === '/rest/v1/rpc/verify_device_transfer') {
      return makeResponse({ verified: true });
    }
    if (url.pathname === '/rest/v1/transfer_sessions' && init.method === 'POST') {
      calls.createSession += 1;
      return makeResponse({
        id: '00000000-0000-4000-8000-000000000022',
        expires_at: '2026-10-08T20:00:00.000Z',
      }, 201);
    }
    return makeResponse({}, 404);
  };
  context.after(() => {
    global.fetch = originalFetch;
  });
  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
  });
  context.after(api.close);
  return { api, originalFetch: requestFetch, calls };
}

function makeMembershipOperations() {
  const seenEvents = new Set();
  const calls = { checkout: [], webhooks: 0 };
  return {
    calls,
    getPlan: () => ({ id: 'member', name: 'Member', currency: 'NGN', priceNgn: 900, amountKobo: 90_000, intervalMonths: 1 }),
    getStatus: async () => ({ status: 'visitor' }),
    createCheckout: async (userId, email) => {
      calls.checkout.push({ userId, email });
      return {
        authorizationUrl: 'https://checkout.paystack.com/test-session',
        accessCode: 'test-access-code',
        reference: 'geniuz-test-reference',
        amountKobo: 90_000,
        currency: 'NGN',
      };
    },
    processWebhook: async (event, payload) => {
      calls.webhooks += 1;
      if (seenEvents.has(event.id)) {
        return { status: 'duplicate' };
      }
      seenEvents.add(event.id);
      const data = payload.data;
      return { status: event.event === 'charge.success' && data.amount === 90_000 ? 'activated' : 'wrong_amount' };
    },
    refund: async (_adminUserId, reference) => ({ status: 'refunded', reference }),
    runDailyMaintenance: async () => ({ checked: 0, remindersCreated: 0 }),
  };
}

test('upload preflight allows the configured app origin and auth headers', async (context) => {
  const origin = 'http://localhost:8081';
  const api = await startApi({ corsOrigins: [origin] });
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/uploads/init`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(
    response.headers.get('access-control-allow-methods')?.split(', '),
    ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  );
  const allowedHeaders = response.headers.get('access-control-allow-headers')?.toLowerCase();
  assert.match(allowedHeaders, /authorization/);
  assert.match(allowedHeaders, /content-type/);

  const denied = await fetch(`${api.baseUrl}/uploads/init`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unlisted.example.test',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED');

  const explicitOrigin = 'https://admin.example.test';
  const explicitConfig = loadConfig({
    CODESPACE_NAME: 'geniuz-workspace',
    CORS_ORIGIN: explicitOrigin,
  });
  assert.deepEqual(explicitConfig.corsOrigins, [explicitOrigin]);
  const explicitApi = await startApi({ corsOrigins: explicitConfig.corsOrigins });
  context.after(explicitApi.close);
  const explicitAllowed = await fetch(`${explicitApi.baseUrl}/uploads/init`, {
    method: 'OPTIONS',
    headers: {
      Origin: explicitOrigin,
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(explicitAllowed.status, 204);
  assert.equal(explicitAllowed.headers.get('access-control-allow-origin'), explicitOrigin);
});

test('unauthenticated and non-admin callers are denied every upload, delete, cleanup, and edit API path', async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    if (new URL(String(input)).pathname === '/auth/v1/user') {
      return makeResponse({
        id: '00000000-0000-4000-8000-000000000009',
        app_metadata: { role: 'user' },
      });
    }
    return makeResponse({ error: 'unexpected request' }, 404);
  };
  context.after(() => {
    global.fetch = originalFetch;
  });
  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
  });
  context.after(api.close);
  const paths = [
    '/uploads/init',
    '/uploads/part-urls',
    '/uploads/complete',
    '/uploads/abort',
    '/uploads/delete',
    '/uploads/cleanup',
    '/uploads/trailer',
    '/uploads/edit',
    '/admin/titles/delete',
  ];
  for (const path of paths) {
    const unauthenticated = await originalFetch(`${api.baseUrl}${path}`, { method: 'POST' });
    assert.equal(unauthenticated.status, 401, `${path} should require authentication`);
    const nonAdmin = await originalFetch(`${api.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer normal-user-test-token' },
    });
    assert.equal(nonAdmin.status, 403, `${path} should require an admin`);
  }
});

test('trailer play URLs are public for published titles and admin-only for drafts', async (context) => {
  const originalFetch = global.fetch;
  const originalCreateTrailerPlayUrl = B2StorageService.prototype.createTrailerPlayUrl;
  let published = true;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return makeResponse({
        id: '00000000-0000-4000-8000-000000000001',
        app_metadata: { role: 'admin' },
      });
    }
    if (url.pathname === '/rest/v1/movies') {
      return makeResponse({
        content_type: 'movie',
        trailer_storage_key: 'trailers/00000000-0000-4000-8000-000000000002.mp4',
        published,
      });
    }
    return makeResponse({ error: 'unexpected request' }, 404);
  };
  B2StorageService.prototype.createTrailerPlayUrl = async () => 'https://b2.example.test/trailers/signed';
  context.after(() => {
    global.fetch = originalFetch;
    B2StorageService.prototype.createTrailerPlayUrl = originalCreateTrailerPlayUrl;
  });

  const config = {
    port: 0,
    tmdbApiKey: undefined,
    tmdbBaseUrl: 'https://tmdb.example.test/3',
    anilistApiUrl: 'https://anilist.example.test/graphql',
    corsOrigins: [],
    cacheTtlSeconds: 30,
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'publishable-test-key',
    s3Endpoint: 'https://s3.example.test',
    s3Region: 'us-east-1',
    s3AccessKeyId: 'test-key-id',
    s3SecretAccessKey: 'test-secret',
    s3Bucket: 'test-bucket',
  };
  const provider = new HttpTMDBProvider({ tmdbApiKey: undefined, tmdbBaseUrl: config.tmdbBaseUrl });
  const server = createApiServer(config, new ContentService(new TMDBContentRepository(provider)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/movies/00000000-0000-4000-8000-000000000001/trailer-play-url`;

  const publicResponse = await originalFetch(url);
  assert.equal(publicResponse.status, 200);
  const publicResult = await publicResponse.json();
  assert.equal(publicResult.expiresIn, 900);
  assert.match(publicResult.url, /trailers/);

  published = false;
  const blocked = await originalFetch(url);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'ADMIN_REQUIRED');

  const adminResponse = await originalFetch(url, {
    headers: { Authorization: 'Bearer admin-test-token' },
  });
  assert.equal(adminResponse.status, 200);
});

test('published B2 movie play URLs are public, drafts require admin, and non-B2 rows use the app signed-URL path', async (context) => {
  const originalFetch = global.fetch;
  const originalCreatePlayUrl = B2StorageService.prototype.createPlayUrl;
  let record = {
    storage_provider: 'b2',
    storage_key: 'movies/00000000-0000-4000-8000-000000000001.mp4',
    published: true,
  };
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return makeResponse({ id: '00000000-0000-4000-8000-000000000009', app_metadata: { role: 'admin' } });
    }
    if (url.pathname === '/rest/v1/movies') {
      return makeResponse(record);
    }
    return makeResponse({}, 404);
  };
  B2StorageService.prototype.createPlayUrl = async () => 'https://b2.example.test/signed';
  context.after(() => {
    global.fetch = originalFetch;
    B2StorageService.prototype.createPlayUrl = originalCreatePlayUrl;
  });

  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
    storage: {
      s3Endpoint: 'https://s3.example.test',
      s3Region: 'us-east-1',
      s3AccessKeyId: 'test-key',
      s3SecretAccessKey: 'test-secret',
      s3Bucket: 'test-bucket',
    },
  });
  context.after(api.close);
  const url = `${api.baseUrl}/movies/00000000-0000-4000-8000-000000000001/play-url`;

  const publicResponse = await originalFetch(url);
  assert.equal(publicResponse.status, 200);
  assert.equal((await publicResponse.json()).expiresIn, 7200);

  record = { ...record, published: false };
  const draftResponse = await originalFetch(url);
  assert.equal(draftResponse.status, 403);
  assert.equal((await draftResponse.json()).error.code, 'ADMIN_REQUIRED');

  const adminResponse = await originalFetch(url, { headers: { Authorization: 'Bearer admin-test-token' } });
  assert.equal(adminResponse.status, 200);

  record = { ...record, storage_provider: 'supabase', published: true };
  const supabaseResponse = await originalFetch(url);
  assert.equal(supabaseResponse.status, 409);
  assert.equal((await supabaseResponse.json()).error.code, 'NOT_B2_STORAGE');

  record = { ...record, storage_provider: 'b2', storage_key: '', published: true };
  const missingKeyResponse = await originalFetch(url);
  assert.equal(missingKeyResponse.status, 404);
  assert.equal((await missingKeyResponse.json()).error.code, 'PLAYBACK_FILE_MISSING');
});

test('published B2 episode play URLs are public while unpublished episodes require admin', async (context) => {
  const originalFetch = global.fetch;
  const originalCreatePlayUrl = B2StorageService.prototype.createPlayUrl;
  let episode = {
    storage_provider: 'b2',
    storage_key: 'episodes/00000000-0000-4000-8000-000000000002.mp4',
    published: true,
  };
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return makeResponse({ id: '00000000-0000-4000-8000-000000000009', app_metadata: { role: 'admin' } });
    }
    if (url.pathname === '/rest/v1/episodes') {
      return makeResponse(episode);
    }
    return makeResponse({}, 404);
  };
  B2StorageService.prototype.createPlayUrl = async () => 'https://b2.example.test/episodes/signed';
  context.after(() => {
    global.fetch = originalFetch;
    B2StorageService.prototype.createPlayUrl = originalCreatePlayUrl;
  });

  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
    storage: {
      s3Endpoint: 'https://s3.example.test',
      s3Region: 'us-east-1',
      s3AccessKeyId: 'test-key',
      s3SecretAccessKey: 'test-secret',
      s3Bucket: 'test-bucket',
    },
  });
  context.after(api.close);
  const url = `${api.baseUrl}/episodes/00000000-0000-4000-8000-000000000002/play-url`;

  const publicResponse = await originalFetch(url);
  assert.equal(publicResponse.status, 200);
  assert.equal((await publicResponse.json()).expiresIn, 7200);

  episode = { ...episode, published: false };
  const blocked = await originalFetch(url);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'ADMIN_REQUIRED');

  const adminResponse = await originalFetch(url, { headers: { Authorization: 'Bearer admin-test-token' } });
  assert.equal(adminResponse.status, 200);
});

test('download URLs require the published title download flag for movies and episodes', async (context) => {
  const originalFetch = global.fetch;
  const originalCreatePlayUrl = B2StorageService.prototype.createPlayUrl;
  const movie = {
    storage_provider: 'b2',
    storage_key: 'movies/00000000-0000-4000-8000-000000000001.mp4',
    published: true,
    allow_download: true,
    file_size_bytes: 1024,
    content_type: 'movie',
    video_path: 'movies/00000000-0000-4000-8000-000000000001.mp4',
  };
  const episode = {
    storage_provider: 'b2',
    storage_key: 'episodes/00000000-0000-4000-8000-000000000002.mp4',
    published: true,
    allow_download: true,
    file_size_bytes: 2048,
  };
  let requestedKeys = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/movies') {
      assert.match(url.searchParams.get('select'), /allow_download/);
      return makeResponse(movie);
    }
    if (url.pathname === '/rest/v1/episodes') {
      assert.match(url.searchParams.get('select'), /allow_download/);
      return makeResponse(episode);
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/movie-assets/')) {
      return makeResponse({
        signedURL: `${url.pathname.replace('/storage/v1', '')}?token=signed`,
      });
    }
    return makeResponse({}, 404);
  };
  B2StorageService.prototype.createPlayUrl = async (key) => {
    requestedKeys.push(key);
    return `https://b2.example.test/${key}?signed=true`;
  };
  context.after(() => {
    global.fetch = originalFetch;
    B2StorageService.prototype.createPlayUrl = originalCreatePlayUrl;
  });

  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
    storage: {
      s3Endpoint: 'https://s3.example.test',
      s3Region: 'us-east-1',
      s3AccessKeyId: 'test-key',
      s3SecretAccessKey: 'test-secret',
      s3Bucket: 'test-bucket',
    },
  });
  context.after(api.close);

  const authorizeDownload = (contentKind, contentId) =>
    originalFetch(`${api.baseUrl}/api/downloads/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentKind, contentId }),
    });
  const movieResponse = await authorizeDownload(
    'movie',
    '00000000-0000-4000-8000-000000000001',
  );
  assert.equal(movieResponse.status, 200);
  assert.equal((await movieResponse.json()).fileSizeBytes, 1024);
  const episodeResponse = await authorizeDownload(
    'episode',
    '00000000-0000-4000-8000-000000000002',
  );
  assert.equal(episodeResponse.status, 200);
  assert.equal((await episodeResponse.json()).fileSizeBytes, 2048);
  assert.equal(requestedKeys.length, 2);

  movie.storage_provider = 'supabase';
  const supabaseResponse = await authorizeDownload(
    'movie',
    '00000000-0000-4000-8000-000000000001',
  );
  assert.equal(supabaseResponse.status, 200);
  assert.match((await supabaseResponse.json()).url, /^https:\/\/supabase\.example\.test\/storage\/v1\/object\/sign\//);

  movie.allow_download = false;
  const deniedResponse = await authorizeDownload(
    'movie',
    '00000000-0000-4000-8000-000000000001',
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).error.code, 'DOWNLOAD_NOT_ALLOWED');
  assert.equal(requestedKeys.length, 2);
});

test('subtitle endpoints return signed tracks only for published movies and published episode chains', async (context) => {
  const originalFetch = global.fetch;
  const movieId = '00000000-0000-4000-8000-000000000011';
  const seriesId = '00000000-0000-4000-8000-000000000012';
  const episodeId = '00000000-0000-4000-8000-000000000013';
  const seasonId = '00000000-0000-4000-8000-000000000014';
  let moviePublished = true;
  let episodePublished = true;
  let seasonPublished = true;
  let seriesPublished = true;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/movies') {
      const id = url.searchParams.get('id');
      return makeResponse(id === `eq.${seriesId}`
        ? { published: seriesPublished, content_type: 'series' }
        : { published: moviePublished, content_type: 'movie' });
    }
    if (url.pathname === '/rest/v1/episodes') {
      return makeResponse({ published: episodePublished, season_id: seasonId });
    }
    if (url.pathname === '/rest/v1/seasons') {
      return makeResponse({ published: seasonPublished, series_id: seriesId });
    }
    if (url.pathname === '/rest/v1/subtitle_tracks') {
      return makeResponse([{
        id: 'track-1',
        language_label: 'English',
        format: 'vtt',
        storage_path: 'movie/track.vtt',
      }]);
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/subtitle-files/')) {
      return makeResponse({
        signedURL: `${url.pathname.replace('/storage/v1', '')}?token=signed`,
      });
    }
    return makeResponse({}, 404);
  };
  context.after(() => {
    global.fetch = originalFetch;
  });

  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
  });
  context.after(api.close);
  const getTracks = (kind, id) =>
    originalFetch(`${api.baseUrl}/api/subtitles?kind=${kind}&id=${id}`);

  const movieResponse = await getTracks('movie', movieId);
  assert.equal(movieResponse.status, 200);
  assert.deepEqual((await movieResponse.json()).tracks, [{
    id: 'track-1',
    languageLabel: 'English',
    format: 'vtt',
    url: 'https://supabase.example.test/storage/v1/object/sign/subtitle-files/movie/track.vtt?token=signed',
  }]);

  const episodeResponse = await getTracks('episode', episodeId);
  assert.equal(episodeResponse.status, 200);

  moviePublished = false;
  const draftMovie = await getTracks('movie', movieId);
  assert.equal(draftMovie.status, 403);

  episodePublished = false;
  const draftEpisode = await getTracks('episode', episodeId);
  assert.equal(draftEpisode.status, 403);
  episodePublished = true;
  seasonPublished = false;
  const draftSeason = await getTracks('episode', episodeId);
  assert.equal(draftSeason.status, 403);
  seasonPublished = true;
  seriesPublished = false;
  const draftSeries = await getTracks('episode', episodeId);
  assert.equal(draftSeries.status, 403);
});

test('signed-out users cannot create or join a receive session', async (context) => {
  const { api, originalFetch, calls } = await startTransferApi(context);
  const create = await originalFetch(`${api.baseUrl}/api/transfers/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken: 'a'.repeat(64) }),
  });
  const join = await originalFetch(
    `${api.baseUrl}/api/transfers/sessions/00000000-0000-4000-8000-000000000022/verify`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permit: 'b'.repeat(64) }) },
  );
  const send = await originalFetch(
    `${api.baseUrl}/api/transfers/sessions/00000000-0000-4000-8000-000000000022/authorize`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );

  assert.equal(create.status, 401);
  assert.equal(join.status, 401);
  assert.equal(send.status, 401);
  assert.equal(calls.membership, 0);
});

test('free accounts cannot create or join a receive session', async (context) => {
  const { api, originalFetch, calls } = await startTransferApi(context);
  const headers = {
    Authorization: 'Bearer test-access-token',
    'Content-Type': 'application/json',
  };
  const create = await originalFetch(`${api.baseUrl}/api/transfers/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionToken: 'a'.repeat(64) }),
  });
  const join = await originalFetch(
    `${api.baseUrl}/api/transfers/sessions/00000000-0000-4000-8000-000000000022/verify`,
    { method: 'POST', headers, body: JSON.stringify({ permit: 'b'.repeat(64) }) },
  );

  for (const response of [create, join]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'MEMBERSHIP_REQUIRED');
  }
  assert.equal(calls.membership, 2);
  assert.equal(calls.createSession, 0);
});

test('active members can create a receive session', async (context) => {
  const { api, originalFetch, calls } = await startTransferApi(context, true);
  const response = await originalFetch(`${api.baseUrl}/api/transfers/sessions`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionToken: 'a'.repeat(64) }),
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).sessionId, '00000000-0000-4000-8000-000000000022');
  assert.equal(calls.membership, 1);
  assert.equal(calls.createSession, 1);

  const join = await originalFetch(
    `${api.baseUrl}/api/transfers/sessions/00000000-0000-4000-8000-000000000022/verify`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permit: 'b'.repeat(64) }),
    },
  );
  assert.equal(join.status, 200);
  assert.equal(calls.membership, 2);
});

test('free accounts cannot send', async (context) => {
  const payload = {
    sessionToken: 'a'.repeat(64),
    contentId: '00000000-0000-4000-8000-000000000023',
    itemType: 'movie',
    fileName: 'geniuz-00000000-0000-4000-8000-000000000023.mp4',
    title: 'Transfer test movie',
    fileSizeBytes: 1024,
    fileSha256: 'b'.repeat(64),
  };
  const free = await startTransferApi(context);
  const freeResponse = await free.originalFetch(
    `${free.api.baseUrl}/api/transfers/sessions/00000000-0000-4000-8000-000000000022/authorize`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  assert.equal(freeResponse.status, 403);
  assert.equal((await freeResponse.json()).error.code, 'MEMBERSHIP_REQUIRED');
  assert.equal(free.calls.authorizeSend, 0);
});

test('active members can send', async (context) => {
  const member = await startTransferApi(context, true);
  const payload = {
    sessionToken: 'a'.repeat(64),
    contentId: '00000000-0000-4000-8000-000000000023',
    itemType: 'movie',
    fileName: 'geniuz-00000000-0000-4000-8000-000000000023.mp4',
    title: 'Transfer test movie',
    fileSizeBytes: 1024,
    fileSha256: 'b'.repeat(64),
  };
  const memberResponse = await member.originalFetch(
    `${member.api.baseUrl}/api/transfers/sessions/00000000-0000-4000-8000-000000000022/authorize`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  assert.equal(memberResponse.status, 200);
  assert.equal(member.calls.membership, 1);
  assert.equal(member.calls.authorizeSend, 1);
});

test('new transfer migration gates session reads and inserts through the membership check', () => {
  const migration = fs.readFileSync('supabase/migrations/20261021000000_transfer_membership_required.sql', 'utf8');
  assert.match(migration, /public\.has_active_membership\(auth\.uid\(\)\)/);
  assert.match(migration, /create policy "Members can view their transfer sessions"[\s\S]*?public\.require_active_transfer_membership\(\)/);
  assert.match(migration, /create policy "Members can create their own receive sessions"[\s\S]*?public\.require_active_transfer_membership\(\)/);
  assert.match(migration, /TODO\(plans\):[\s\S]*real paid membership data/);
});

test('system status is admin-only and reports only check states', async (context) => {
  const originalFetch = global.fetch;
  const originalCheckBucket = B2StorageService.prototype.checkBucket;
  const originalCreateProbeUrl = B2StorageService.prototype.createPlaybackProbeUrl;
  let adminCaller = false;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return makeResponse({
        id: '00000000-0000-4000-8000-000000000009',
        app_metadata: { role: adminCaller ? 'admin' : 'user' },
      });
    }
    if (url.pathname === '/rest/v1/movies') {
      return url.searchParams.get('select') === 'storage_key'
        ? makeResponse({ storage_key: 'movies/00000000-0000-4000-8000-000000000001.mp4' })
        : makeResponse([{ id: '00000000-0000-4000-8000-000000000001' }]);
    }
    if (url.hostname === 'b2.example.test') {
      return new Response(new Uint8Array([0]), { status: 206 });
    }
    return makeResponse({}, 404);
  };
  B2StorageService.prototype.checkBucket = async () => {};
  B2StorageService.prototype.createPlaybackProbeUrl = async () => 'https://b2.example.test/probe';
  context.after(() => {
    global.fetch = originalFetch;
    B2StorageService.prototype.checkBucket = originalCheckBucket;
    B2StorageService.prototype.createPlaybackProbeUrl = originalCreateProbeUrl;
  });

  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
    storage: {
      s3Endpoint: 'https://s3.example.test',
      s3Region: 'us-east-1',
      s3AccessKeyId: 'test-key',
      s3SecretAccessKey: 'test-secret',
      s3Bucket: 'test-bucket',
    },
  });
  context.after(api.close);
  const url = `${api.baseUrl}/admin/system-status`;

  assert.equal((await originalFetch(url)).status, 401);
  const nonAdmin = await originalFetch(url, { headers: { Authorization: 'Bearer normal-user-token' } });
  assert.equal(nonAdmin.status, 403);

  adminCaller = true;
  const response = await originalFetch(url, { headers: { Authorization: 'Bearer admin-user-token' } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).checks, {
    backend: 'ok',
    supabase: 'ok',
    bucket: 'ok',
    presignedRead: 'ok',
  });
});

test('server configuration validates port, cache TTL and HTTPS TMDB URL', () => {
  const config = loadConfig({
    PORT: '4001',
    TMDB_API_KEY: 'server-key',
    TMDB_BASE_URL: 'https://api.example.test/3/',
    CATALOG_CACHE_TTL_SECONDS: '42',
  });
  assert.equal(config.port, 4001);
  assert.equal(config.tmdbApiKey, 'server-key');
  assert.equal(config.tmdbBaseUrl, 'https://api.example.test/3');
  assert.equal(config.cacheTtlSeconds, 42);
  assert.equal(config.videoMaxrateKbps, 350);
  assert.equal(loadConfig({ VIDEO_MAXRATE_KBPS: '425' }).videoMaxrateKbps, 425);
  assert.throws(
    () => loadConfig({ TMDB_BASE_URL: 'http://not-secure.example.test' }),
    /HTTPS/,
  );
  assert.throws(() => loadConfig({ PORT: 'abc' }), /positive integer/);
  assert.throws(() => loadConfig({ PORT: '65536' }), /65535/);
});

test('server CORS allows Codespaces only when explicitly enabled', async (context) => {
  const codespaceOrigin = 'https://geniuz-workspace-8081.app.github.dev';
  const otherOrigin = 'https://other-workspace-8081.app.github.dev';
  const defaultConfig = loadConfig({ CODESPACE_NAME: 'geniuz-workspace' });

  assert.ok(defaultConfig.corsOrigins.includes('http://localhost:8081'));
  assert.ok(defaultConfig.corsOrigins.includes('http://localhost:19006'));
  assert.ok(!defaultConfig.corsOrigins.includes(codespaceOrigin));
  assert.ok(!defaultConfig.corsOrigins.includes('*'));

  const enabledConfig = loadConfig({
    CODESPACE_NAME: 'geniuz-workspace',
    CORS_ALLOW_CODESPACES: 'true',
  });
  assert.ok(enabledConfig.corsOrigins.includes(codespaceOrigin));
  assert.ok(!enabledConfig.corsOrigins.includes(otherOrigin));
  assert.ok(!enabledConfig.corsOrigins.includes('*'));

  const api = await startApi({ corsOrigins: enabledConfig.corsOrigins });
  context.after(api.close);
  const allowed = await fetch(`${api.baseUrl}/uploads/init`, {
    method: 'OPTIONS',
    headers: {
      Origin: codespaceOrigin,
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), codespaceOrigin);

  const denied = await fetch(`${api.baseUrl}/uploads/init`, {
    method: 'OPTIONS',
    headers: {
      Origin: otherOrigin,
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED');
});

test('health endpoint does not require catalog credentials', async (context) => {
  const config = loadConfig({ PORT: '4000' });
  const provider = new HttpTMDBProvider(config);
  const repository = new TMDBContentRepository(provider);
  const server = createApiServer(config, new ContentService(repository));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'geniuz-api' });
});

test('membership plan price comes from backend configuration and exposes only Visitor and Member', async (context) => {
  const api = await startApi({ membershipPriceNgn: 1250 });
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/membership/plan`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.plans.map(({ id }) => id), ['visitor', 'member']);
  assert.equal(body.plans[1].priceNgn, 1250);
});

test('membership defaults to NGN 900 monthly, three grace days, and a disabled legacy plan', () => {
  const config = loadConfig({});
  assert.equal(config.membershipPriceNgn, 900);
  assert.equal(config.membershipGraceDays, 3);
  assert.equal(config.subscription1500Enabled, false);
  assert.equal(config.dedicatedAccountEnabled, false);
  assert.equal(loadConfig({ MEMBERSHIP_PRICE_NGN: '1250', MEMBERSHIP_GRACE_DAYS: '5' }).membershipPriceNgn, 1250);
});

test('Paystack checkout uses server-provided NGN kobo amount and card/bank transfer in TEST mode', async () => {
  let request;
  const paystack = new PaystackService('sk_test_payments', async (url, init) => {
    request = { url: String(url), init };
    return makeResponse({
      status: true,
      data: { authorization_url: 'https://checkout.paystack.com/session', access_code: 'access', reference: 'server-ref' },
    });
  });
  const result = await paystack.initializeTransaction({ email: 'member@example.test', amountKobo: 90_000, reference: 'server-ref' });
  const body = JSON.parse(request.init.body);
  assert.equal(result.authorizationUrl, 'https://checkout.paystack.com/session');
  assert.equal(body.amount, 90_000);
  assert.equal(body.currency, 'NGN');
  assert.deepEqual(body.channels, ['card', 'bank_transfer']);
  assert.equal(Object.hasOwn(body, 'plan'), false);
  assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer sk_test_payments');

  const liveKeyService = new PaystackService('sk_live_not_allowed', async () => {
    throw new Error('Live mode must never be called.');
  });
  await assert.rejects(
    liveKeyService.initializeTransaction({ email: 'member@example.test', amountKobo: 90_000, reference: 'server-ref' }),
    (error) => error.code === 'NOT_CONFIGURED',
  );
});

test('membership checkout requires sign-in and ignores client-supplied amounts', async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return makeResponse({
        id: '00000000-0000-4000-8000-000000000031',
        email: 'member@example.test',
        app_metadata: { role: 'user' },
      });
    }
    return makeResponse({}, 404);
  };
  context.after(() => { global.fetch = originalFetch; });
  const membershipService = makeMembershipOperations();
  const api = await startApi({
    supabaseUrl: 'https://supabase.example.test',
    supabasePublishableKey: 'test-publishable-key',
    membershipService,
  });
  context.after(api.close);

  const signedOut = await originalFetch(`${api.baseUrl}/api/membership/create-checkout`, { method: 'POST' });
  assert.equal(signedOut.status, 401);
  const response = await originalFetch(`${api.baseUrl}/api/membership/create-checkout`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 1, amountKobo: 1, priceNgn: 1 }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).amountKobo, 90_000);
  assert.deepEqual(membershipService.calls.checkout, [{
    userId: '00000000-0000-4000-8000-000000000031',
    email: 'member@example.test',
  }]);
});

test('Paystack webhook rejects a bad signature before processing', async (context) => {
  const membershipService = makeMembershipOperations();
  const api = await startApi({ paystackSecretKey: 'sk_test_example', membershipService });
  context.after(api.close);
  const response = await fetch(`${api.baseUrl}/webhooks/paystack`, {
    method: 'POST',
    headers: { 'x-paystack-signature': '0'.repeat(128), 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'charge.success', data: { id: 12, reference: 'ref-1' } }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'INVALID_PAYSTACK_SIGNATURE');
  assert.equal(membershipService.calls.webhooks, 0);
});

test('Paystack HMAC signatures are valid only for exact payloads and TEST keys', () => {
  const secret = 'sk_test_hmac_secret';
  const body = Buffer.from('{"event":"charge.success"}');
  const signature = createHmac('sha512', secret).update(body).digest('hex');
  assert.equal(isValidPaystackSignature(body, signature, secret), true);
  assert.equal(isValidPaystackSignature(Buffer.from('{"event":"charge.failed"}'), signature, secret), false);
  assert.equal(isValidPaystackSignature(body, signature, 'sk_live_not_allowed'), false);
});

test('Paystack webhook is idempotent and distinguishes success from a wrong amount', async (context) => {
  const secret = 'sk_test_webhook_secret';
  const membershipService = makeMembershipOperations();
  const api = await startApi({ paystackSecretKey: secret, membershipService });
  context.after(api.close);
  const postEvent = async (id, amount) => {
    const body = JSON.stringify({ event: 'charge.success', data: { id, reference: `ref-${id}`, amount } });
    const signature = createHmac('sha512', secret).update(body).digest('hex');
    return fetch(`${api.baseUrl}/webhooks/paystack`, {
      method: 'POST',
      headers: { 'x-paystack-signature': signature, 'Content-Type': 'application/json' },
      body,
    });
  };
  const success = await postEvent(401, 90_000);
  assert.equal((await success.json()).status, 'activated');
  const duplicate = await postEvent(401, 90_000);
  assert.equal((await duplicate.json()).status, 'duplicate');
  const wrongAmount = await postEvent(402, 1);
  assert.equal((await wrongAmount.json()).status, 'wrong_amount');
  assert.equal(membershipService.calls.webhooks, 3);
});

test('membership service verifies success with Paystack before applying the event to the ledger RPC', async () => {
  const secret = 'sk_test_verify_secret';
  const requests = [];
  const rpcCalls = [];
  const adminClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: 'activated', error: null };
    },
  };
  const paystack = new PaystackService(secret, async (input, init) => {
    requests.push({ url: String(input), init });
    return makeResponse({
      status: true,
      data: { status: 'success', reference: 'verify-reference', amount: 90_000, currency: 'NGN', channel: 'card' },
    });
  });
  const membership = new MembershipService(loadConfig({ MEMBERSHIP_GRACE_DAYS: '3' }), { adminClient, paystack });
  const result = await membership.processWebhook(
    { id: 'event-900', event: 'charge.success', data: { reference: 'verify-reference' } },
    { event: 'charge.success', data: { reference: 'verify-reference', amount: 1 } },
  );

  assert.equal(result.status, 'activated');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /transaction\/verify\/verify-reference$/);
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), `Bearer ${secret}`);
  assert.equal(rpcCalls[0].name, 'apply_paystack_event');
  assert.equal(rpcCalls[0].args.p_verified_amount_kobo, 90_000);
  assert.equal(rpcCalls[0].args.p_grace_days, 3);
});

test('membership service forwards Paystack verified wrong amount for database rejection', async () => {
  const rpcCalls = [];
  const adminClient = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: 'wrong_amount', error: null };
    },
  };
  const paystack = new PaystackService('sk_test_verify_secret', async () => makeResponse({
    status: true,
    data: { status: 'success', reference: 'wrong-reference', amount: 1, currency: 'NGN' },
  }));
  const membership = new MembershipService(loadConfig({}), { adminClient, paystack });
  const result = await membership.processWebhook(
    { id: 'event-901', event: 'charge.success', data: { reference: 'wrong-reference' } },
    { event: 'charge.success', data: { reference: 'wrong-reference', amount: 90_000 } },
  );
  assert.equal(result.status, 'wrong_amount');
  assert.equal(rpcCalls[0].args.p_verified_amount_kobo, 1);
});

test('membership period status covers active, grace, and expired states', () => {
  const now = new Date('2026-10-08T00:00:00.000Z');
  assert.equal(getMembershipAccessStatus(null, now), 'visitor');
  assert.equal(getMembershipAccessStatus({
    status: 'active', current_period_end: '2026-10-09T00:00:00.000Z', grace_until: '2026-10-12T00:00:00.000Z',
  }, now), 'active');
  assert.equal(getMembershipAccessStatus({
    status: 'active', current_period_end: '2026-10-07T00:00:00.000Z', grace_until: '2026-10-11T00:00:00.000Z',
  }, now), 'grace');
  assert.equal(getMembershipAccessStatus({
    status: 'active', current_period_end: '2026-10-07T00:00:00.000Z', grace_until: '2026-10-07T12:00:00.000Z',
  }, now), 'expired');
});

test('membership migration verifies event idempotency, amount, activation, ledger, RLS, and grace', () => {
  const migration = fs.readFileSync('supabase/migrations/20261022000000_memberships_payments.sql', 'utf8');
  assert.match(migration, /create table if not exists public\.memberships/);
  assert.match(migration, /create table if not exists public\.payments[\s\S]*reference text not null unique/);
  assert.match(migration, /create table if not exists public\.revenue_ledger[\s\S]*amount_kobo bigint/);
  assert.match(migration, /create table if not exists public\.refunds/);
  assert.match(migration, /create table if not exists public\.membership_audit_log/);
  assert.match(migration, /create table if not exists public\.webhook_events[\s\S]*event_id text primary key/);
  assert.match(migration, /revoke all on public\.memberships, public\.payments[\s\S]*from anon, authenticated/);
  assert.match(migration, /grant all on public\.memberships, public\.payments[\s\S]*to service_role/);
  assert.match(migration, /using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(migration, /on conflict \(event_id\) do nothing/);
  assert.match(migration, /p_verified_currency <> 'NGN' or p_verified_amount_kobo <> payment_row\.amount_kobo/);
  assert.match(migration, /insert into public\.revenue_ledger/);
  assert.match(migration, /'Welcome, Member'/);
  assert.match(migration, /public\.has_active_membership\(p_user_id uuid\)[\s\S]*m\.grace_until > now\(\)/);
});

test('football matches endpoint validates and returns a real calendar date', async (context) => {
  let requestedDate;
  const footballMatchesService = new FootballMatchesService({
    getMatches: async (date) => {
      requestedDate = date;
      return [footballMatch];
    },
  });
  const api = await startApi({ footballDataApiKey: 'football-test-key', footballMatchesService });
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/football/matches?date=2026-10-08`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(requestedDate, '2026-10-08');
  assert.equal(body.date, '2026-10-08');
  assert.equal(body.matches[0].homeTeam.name, 'Home FC');
  assert.doesNotMatch(JSON.stringify(body), /football-test-key/);
});

test('football matches endpoint rejects missing or impossible dates with a clear 400', async (context) => {
  const api = await startApi({ footballDataApiKey: 'football-test-key' });
  context.after(api.close);

  for (const path of ['/football/matches', '/football/matches?date=2026-02-30', '/football/matches?date=2026-2-3']) {
    const response = await fetch(`${api.baseUrl}${path}`);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_MATCH_DATE');
    assert.match(body.error.message, /real date in YYYY-MM-DD/);
  }
});

test('football matches endpoint reports missing provider configuration without exposing a key', async (context) => {
  context.mock.method(console, 'error', () => {});
  const api = await startApi();
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/football/matches?date=2026-10-08`);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.match(body, /Football scores are not configured/);
  assert.doesNotMatch(body, /football-test-key|stack/i);
});

test('football matches endpoint serves stale data after provider failure and caches successful results', async (context) => {
  let now = Date.UTC(2026, 9, 8);
  let calls = 0;
  let shouldFail = false;
  const footballMatchesService = new FootballMatchesService({
    getMatches: async () => {
      calls += 1;
      if (shouldFail) {
        throw new Error('provider unavailable');
      }
      return [];
    },
  }, () => now);
  const api = await startApi({ footballDataApiKey: 'football-test-key', footballMatchesService });
  context.after(api.close);

  const first = await fetch(`${api.baseUrl}/football/matches?date=2026-10-08`);
  assert.equal(first.status, 200);
  const cacheHit = await fetch(`${api.baseUrl}/football/matches?date=2026-10-08`);
  assert.equal(cacheHit.status, 200);
  assert.equal(calls, 1);

  now += 10 * 60_000 + 1;
  shouldFail = true;
  const stale = await fetch(`${api.baseUrl}/football/matches?date=2026-10-08`);
  const staleBody = await stale.json();
  assert.equal(stale.status, 200);
  assert.equal(staleBody.stale, true);
  assert.deepEqual(staleBody.matches, []);
  assert.equal(calls, 2);
});

test('football provider requests stay within the ten-per-minute free tier limit', async (context) => {
  context.mock.method(console, 'error', () => {});
  let calls = 0;
  const now = Date.UTC(2026, 9, 8);
  const footballMatchesService = new FootballMatchesService({
    getMatches: async () => {
      calls += 1;
      return [];
    },
  }, () => now);
  const api = await startApi({ footballDataApiKey: 'football-test-key', footballMatchesService });
  context.after(api.close);

  for (let day = 1; day <= 10; day += 1) {
    const response = await fetch(`${api.baseUrl}/football/matches?date=2026-10-${String(day).padStart(2, '0')}`);
    assert.equal(response.status, 200);
  }
  const limited = await fetch(`${api.baseUrl}/football/matches?date=2026-10-11`);
  assert.equal(limited.status, 503);
  assert.equal((await limited.json()).error.code, 'FOOTBALL_RATE_LIMITED');
  assert.equal(calls, 10);
});

test('trending endpoint returns normalized discovery items without streaming rights', async (context) => {
  const api = await startApi();
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/content/trending?page=1`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.page, 1);
  assert.equal(payload.totalPages, 3);
  assert.equal(payload.items[0].id, 'tmdb:movie:101');
  assert.deepEqual(payload.items[0].genres, ['Action']);
  assert.deepEqual(payload.items[0].availability, {
    discoverable: true,
    stream: false,
    download: false,
    premium: false,
  });
});

test('search validates input and normalizes results', async (context) => {
  const api = await startApi();
  context.after(api.close);

  const missing = await fetch(`${api.baseUrl}/api/content/search?q=`);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, 'INVALID_QUERY');

  const tooLong = await fetch(`${api.baseUrl}/api/content/search?q=${'x'.repeat(121)}`);
  assert.equal(tooLong.status, 400);

  const response = await fetch(`${api.baseUrl}/api/content/search?q=sample`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.items[0].title, 'Catalog feature');
  assert.equal(payload.items[0].availability.stream, false);
});

test('invalid content IDs, missing details, and page parameters have stable errors', async (context) => {
  const api = await startApi();
  context.after(api.close);

  const invalidId = await fetch(`${api.baseUrl}/api/content/not-a-tmdb-id`);
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).error.code, 'INVALID_CONTENT_ID');

  const missing = await fetch(`${api.baseUrl}/api/content/tmdb%3Amovie%3A999`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'CONTENT_NOT_FOUND');

  const invalidPage = await fetch(`${api.baseUrl}/api/content/trending?page=-1`);
  assert.equal(invalidPage.status, 400);
  assert.equal((await invalidPage.json()).error.code, 'INVALID_PAGE');
});

test('missing provider configuration returns a useful 503 without exposing credentials', async (context) => {
  context.mock.method(console, 'error', () => {});
  const api = await startApi({ tmdbApiKey: undefined });
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/content/trending`);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.match(body, /CATALOG_NOT_CONFIGURED/);
  assert.doesNotMatch(body, /server-only-test-token|stack|provider internals/i);
});

test('upstream rate limiting is mapped safely and provider tokens are never returned', async (context) => {
  context.mock.method(console, 'error', () => {});
  const tokens = [];
  const api = await startApi({ failStatus: 429, keyTracker: tokens });
  context.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/content/trending`);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.match(body, /CATALOG_RATE_LIMITED/);
  assert.doesNotMatch(body, /provider internals|server-only-test-token/);
  assert.ok(tokens.length >= 1);
  assert.ok(tokens.every((token) => token === 'Bearer server-only-test-token'));
});

test('trending and genre endpoints use server-side cache', async (context) => {
  const api = await startApi();
  context.after(api.close);

  await fetch(`${api.baseUrl}/api/content/trending`);
  await fetch(`${api.baseUrl}/api/content/trending`);
  await fetch(`${api.baseUrl}/api/genres`);
  await fetch(`${api.baseUrl}/api/genres`);
  assert.equal([...api.calls].find(([path]) => path.endsWith('/trending/all/week'))?.[1], 1);
  assert.equal([...api.calls].find(([path]) => path.endsWith('/genre/movie/list'))?.[1], 1);
  assert.equal([...api.calls].find(([path]) => path.endsWith('/genre/tv/list'))?.[1], 1);
});

test('playback and download authorization report missing provider configuration', async (context) => {
  context.mock.method(console, 'error', () => {});
  const api = await startApi();
  context.after(api.close);

  const playback = await fetch(`${api.baseUrl}/api/playback/session`, { method: 'POST' });
  const downloads = await fetch(`${api.baseUrl}/api/downloads/authorize`, { method: 'POST' });
  assert.equal(playback.status, 501);
  assert.equal(downloads.status, 503);
});

test('memory cache deduplicates in-flight work and expires values', async () => {
  const cache = new MemoryCache(15);
  let loads = 0;
  const load = async () => {
    loads += 1;
    return { count: loads };
  };

  const first = await Promise.all([cache.getOrLoad('key', load), cache.getOrLoad('key', load)]);
  assert.deepEqual(first, [{ count: 1 }, { count: 1 }]);
  assert.deepEqual(await cache.getOrLoad('key', load), { count: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await cache.getOrLoad('key', load), { count: 2 });
});
