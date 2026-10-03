const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');

const { loadConfig } = require('../.test-build/backend/backend/src/config/config.js');
const { createApiServer } = require('../.test-build/backend/backend/src/http/server.js');
const { TMDBContentRepository } = require('../.test-build/backend/backend/src/repositories/TMDBContentRepository.js');
const { MemoryCache } = require('../.test-build/backend/backend/src/repositories/MemoryCache.js');
const { HttpTMDBProvider } = require('../.test-build/backend/backend/src/providers/TMDBProvider.js');
const { ContentService } = require('../.test-build/backend/backend/src/services/ContentService.js');

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
    ...(options.supabaseUrl ? { supabaseUrl: options.supabaseUrl } : {}),
    ...(options.supabasePublishableKey
      ? { supabasePublishableKey: options.supabasePublishableKey }
      : {}),
  };
  const fakeFetch = makeFetch(options);
  const provider = new HttpTMDBProvider(
    { tmdbApiKey: config.tmdbApiKey, tmdbBaseUrl: config.tmdbBaseUrl },
    fakeFetch.fetchImplementation,
  );
  const repository = new TMDBContentRepository(provider, 30_000);
  const server = createApiServer(config, new ContentService(repository, 30_000));
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
  context.after(() => {
    global.fetch = originalFetch;
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
  assert.throws(
    () => loadConfig({ TMDB_BASE_URL: 'http://not-secure.example.test' }),
    /HTTPS/,
  );
  assert.throws(() => loadConfig({ PORT: 'abc' }), /positive integer/);
  assert.throws(() => loadConfig({ PORT: '65536' }), /65535/);
});

test('server CORS defaults include the current Codespaces web origin', () => {
  const config = loadConfig({ CODESPACE_NAME: 'geniuz-workspace' });

  assert.ok(config.corsOrigins.includes('http://localhost:8081'));
  assert.ok(config.corsOrigins.includes('http://localhost:19006'));
  assert.ok(config.corsOrigins.includes('https://geniuz-workspace-8081.app.github.dev'));
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

test('playback and downloads are explicitly unavailable without a licensed provider', async (context) => {
  context.mock.method(console, 'error', () => {});
  const api = await startApi();
  context.after(api.close);

  const playback = await fetch(`${api.baseUrl}/api/playback/session`, { method: 'POST' });
  const downloads = await fetch(`${api.baseUrl}/api/downloads/authorize`, { method: 'POST' });
  assert.equal(playback.status, 501);
  assert.equal(downloads.status, 501);
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
