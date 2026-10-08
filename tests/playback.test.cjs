const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: {} };
  }
  if (request === 'tus-js-client') {
    return { Upload: class Upload {} };
  }
  if (request === '../services/supabase' && parent?.filename.endsWith('/SupabaseMovieRepository.js')) {
    return { supabase: null };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { SupabaseMovieRepository } = require('../.test-build/src/repositories/SupabaseMovieRepository.js');
const { getConversionStatusBadge } = require('../.test-build/src/utils/conversionStatus.js');
Module._load = originalLoad;

function createRepository(options = {}) {
  const signedCalls = [];
  const client = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (path, expiresIn) => {
          signedCalls.push({ bucket, path, expiresIn });
          return {
            data: options.signedUrl === undefined ? { signedUrl: 'https://storage.example.test/signed' } : { signedUrl: options.signedUrl },
            error: options.signedError ?? null,
          };
        },
      }),
    },
    auth: {
      getSession: async () => ({ data: { session: options.session ?? null }, error: null }),
    },
  };
  return {
    repository: new SupabaseMovieRepository(client, 'https://supabase.example.test', 'publishable-test-key'),
    signedCalls,
  };
}

function createMovieQueryClient(responses) {
  const selectedColumns = [];
  return {
    selectedColumns,
    client: {
      from(table) {
        assert.equal(table, 'movies');
        return {
          select(columns) {
            selectedColumns.push(columns);
            return { order: async () => responses.shift() };
          },
        };
      },
    },
  };
}

test('movie repository retries without conversion_status and defaults legacy rows to ready', async () => {
  const row = {
    id: 'movie-1',
    created_at: '2026-10-08T00:00:00.000Z',
    title: 'Test movie',
    description: null,
    release_year: null,
    genres: [],
    categories: [],
    poster_url: null,
    cover_url: null,
    runtime_minutes: null,
    content_rating: null,
    video_path: null,
    published: false,
    file_extension: 'mp4',
    mime_type: 'video/mp4',
    file_size_bytes: 1200,
    allow_download: false,
    storage_provider: 'b2',
    storage_key: 'movies/movie-1.mp4',
    content_type: 'movie',
  };
  const queryClient = createMovieQueryClient([
    { data: null, error: { code: '42703', message: 'column movies.conversion_status does not exist' } },
    { data: [row], error: null },
  ]);
  const repository = new SupabaseMovieRepository(
    queryClient.client,
    'https://supabase.example.test',
    'publishable-test-key',
  );

  const movies = await repository.getAdminMovies();

  assert.equal(queryClient.selectedColumns.length, 2);
  assert.match(queryClient.selectedColumns[0], /conversion_status/);
  assert.doesNotMatch(queryClient.selectedColumns[1], /conversion_status/);
  assert.equal(movies[0].conversionStatus, 'ready');
});

test('conversion status badge maps every status to its requested label and color', () => {
  for (const [status, label, color] of [
    ['ready', 'Ready', 'green'],
    ['uploaded', 'Uploaded', 'grey'],
    ['converting', 'Converting', 'yellow'],
    ['failed', 'Failed', 'red'],
  ]) {
    assert.deepEqual(getConversionStatusBadge(status), { status, label, color });
  }
  assert.deepEqual(getConversionStatusBadge(undefined), {
    status: 'ready',
    label: 'Ready',
    color: 'green',
  });
});

test('Supabase movies and episodes keep using Supabase signed URLs while B2 uses the public backend route', async (context) => {
  const previousApiUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL;
  const originalFetch = global.fetch;
  context.after(() => {
    if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_GENIUZ_API_URL;
    else process.env.EXPO_PUBLIC_GENIUZ_API_URL = previousApiUrl;
    global.fetch = originalFetch;
  });

  const supabase = createRepository();
  assert.equal(
    await supabase.repository.getPlaybackUrl({ id: 'geniuz:movie:movie-1', mediaPath: 'movies/movie-1.mp4', storageProvider: 'supabase' }),
    'https://storage.example.test/signed',
  );
  assert.equal(
    await supabase.repository.getEpisodePlaybackUrl({ id: 'geniuz:episode:episode-1', mediaPath: 'episodes/episode-1.mp4', storageProvider: 'supabase' }),
    'https://storage.example.test/signed',
  );
  assert.deepEqual(supabase.signedCalls, [
    { bucket: 'movie-assets', path: 'movies/movie-1.mp4', expiresIn: 3600 },
    { bucket: 'movie-assets', path: 'episodes/episode-1.mp4', expiresIn: 3600 },
  ]);

  process.env.EXPO_PUBLIC_GENIUZ_API_URL = 'https://api.example.test/';
  let requestUrl;
  let requestHeaders;
  global.fetch = async (input, init = {}) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ url: 'https://b2.example.test/signed', expiresIn: 7200 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const b2 = createRepository();
  assert.equal(
    await b2.repository.getPlaybackUrl({
      id: 'geniuz:movie:00000000-0000-4000-8000-000000000001',
      mediaPath: 'movies/00000000-0000-4000-8000-000000000001.mp4',
      storageProvider: 'b2',
    }),
    'https://b2.example.test/signed',
  );
  assert.equal(requestUrl, 'https://api.example.test/movies/00000000-0000-4000-8000-000000000001/play-url');
  assert.equal(requestHeaders.has('authorization'), false);
});

test('playback reports missing files, storage failures, invalid URLs, and unreachable backend clearly', async (context) => {
  const previousApiUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL;
  const originalFetch = global.fetch;
  context.after(() => {
    if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_GENIUZ_API_URL;
    else process.env.EXPO_PUBLIC_GENIUZ_API_URL = previousApiUrl;
    global.fetch = originalFetch;
  });

  const noFile = createRepository();
  await assert.rejects(
    noFile.repository.getPlaybackUrl({ id: 'geniuz:movie:movie-1', mediaPath: ' ', storageProvider: 'b2' }),
    (error) => error.code === 'PLAYBACK_FILE_MISSING' && error.status === 404,
  );

  const missingSupabaseFile = createRepository({
    signedError: { statusCode: '404', error: 'not_found', code: 'not_found' },
  });
  await assert.rejects(
    missingSupabaseFile.repository.getPlaybackUrl({ id: 'geniuz:movie:movie-1', mediaPath: 'movies/missing.mp4', storageProvider: 'supabase' }),
    (error) => error.code === 'PLAYBACK_FILE_NOT_FOUND' && error.status === 404 && /missing/i.test(error.message),
  );

  process.env.EXPO_PUBLIC_GENIUZ_API_URL = 'https://api.example.test';
  global.fetch = async () => {
    throw new TypeError('network unavailable');
  };
  const b2 = createRepository();
  await assert.rejects(
    b2.repository.getPlaybackUrl({ id: 'geniuz:movie:movie-1', mediaPath: 'movies/movie-1.mp4', storageProvider: 'b2' }),
    (error) => error.code === 'BACKEND_UNREACHABLE' && /check your connection/i.test(error.message),
  );

  global.fetch = async () => new Response(JSON.stringify({ error: { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage is unavailable.' } }), { status: 503 });
  await assert.rejects(
    b2.repository.getPlaybackUrl({ id: 'geniuz:movie:movie-1', mediaPath: 'movies/movie-1.mp4', storageProvider: 'b2' }),
    (error) => error.status === 503 && error.code === 'STORAGE_NOT_CONFIGURED',
  );

  global.fetch = async () => new Response(JSON.stringify({ url: '' }), { status: 200 });
  await assert.rejects(
    b2.repository.getPlaybackUrl({ id: 'geniuz:movie:movie-1', mediaPath: 'movies/movie-1.mp4', storageProvider: 'b2' }),
    (error) => error.status === 200 && error.code === 'INVALID_PLAYBACK_URL',
  );
});
