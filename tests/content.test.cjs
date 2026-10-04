const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ApiClient, ApiError } = require('../.test-build/src/api/ApiClient.js');
const { MockContentRepository } = require('../.test-build/src/repositories/MockContentRepository.js');
const { ContentService } = require('../.test-build/src/services/ContentService.js');
const { getFriendlyCatalogErrorMessage } = require('../.test-build/src/utils/contentError.js');
const {
  loadPublishedCatalog,
  searchPublishedCatalog,
  sortPublishedNewest,
} = require('../.test-build/src/utils/publishedCatalog.js');

test('mock repository supports search, genre filtering, and explicit missing details', async () => {
  const repository = new MockContentRepository();
  const search = await repository.search('horizon');
  const action = await repository.getByGenre('Action');

  assert.deepEqual(search.map(({ sourceId }) => sourceId), ['the-last-horizon']);
  assert.ok(action.some(({ title }) => title === 'Signal Runner'));
  assert.equal(await repository.getById('missing-title'), null);
});

test('API client deduplicates concurrent GETs and caches successful responses', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ results: [1] }), { status: 200 });
  };

  try {
    const client = new ApiClient({ baseUrl: 'https://api.example.test/', cacheTtlMs: 5000 });
    const [first, second] = await Promise.all([
      client.get('/catalog', { query: 'A B' }),
      client.get('catalog', { query: 'A B' }),
    ]);
    const cached = await client.get('catalog', { query: 'A B' });

    assert.deepEqual(first, { results: [1] });
    assert.deepEqual(second, first);
    assert.deepEqual(cached, first);
    assert.equal(requestCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('API client reports HTTP failures and request timeouts', async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => new Response('unavailable', { status: 503 });
    const unavailableClient = new ApiClient({ baseUrl: 'https://api.example.test' });
    await assert.rejects(unavailableClient.get('catalog'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      return true;
    });

    global.fetch = async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const timeoutClient = new ApiClient({
      baseUrl: 'https://api.example.test',
      timeoutMs: 5,
      cacheTtlMs: 0,
    });
    await assert.rejects(timeoutClient.get('catalog'), /timed out/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('content service falls back to mocks and reports the fallback', async (context) => {
  context.mock.method(console, 'error', () => {});
  context.mock.method(console, 'warn', () => {});
  const repository = new MockContentRepository();
  const unavailableRepository = new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'getTrending') {
        return async () => {
          throw new ApiError('Unavailable', 503);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const service = new ContentService(unavailableRepository, repository, true, undefined, true);
  const result = await service.getTrending();

  assert.equal(result.source, 'mock');
  assert.match(result.warning, /Demo catalog/i);
  assert.equal(result.data[0].source, 'mock');
});

test('content service does not substitute unrelated content for an unknown id', async () => {
  const mockRepository = new MockContentRepository();
  const service = new ContentService(mockRepository);
  const result = await service.getById('not-a-real-title');

  assert.equal(result.data, null);
});

test('content service resolves mock IDs locally even when the live catalog is configured', async () => {
  const mockRepository = new MockContentRepository();
  let remoteRequestMade = false;
  const remoteRepository = {
    getById: async () => {
      remoteRequestMade = true;
      return null;
    },
  };
  const service = new ContentService(remoteRepository, mockRepository, true, undefined, true);
  const result = await service.getById('mock:the-last-horizon');

  assert.equal(remoteRequestMade, false);
  assert.equal(result.data?.title, 'The Last Horizon');
  assert.equal(result.source, 'mock');
});

test('content service keeps known normalized results available after the API goes down', async (context) => {
  context.mock.method(console, 'error', () => {});
  context.mock.method(console, 'warn', () => {});
  const item = {
    id: 'tmdb:movie:55',
    source: 'tmdb',
    sourceId: '55',
    title: 'Cached title',
    type: 'movie',
    genres: ['Drama'],
    availability: { discoverable: true, stream: false, download: false, premium: false },
  };
  const remoteRepository = {
    getTrending: async () => [item],
    getById: async () => {
      throw new ApiError('Unavailable');
    },
  };
  const service = new ContentService(remoteRepository, new MockContentRepository(), true);

  await service.getTrending();
  const result = await service.getById(item.id);

  assert.equal(result.data?.title, 'Cached title');
  assert.equal(result.source, 'tmdb');
  assert.match(result.warning, /Some titles could not be loaded/i);
});

test('content service treats non-mock live catalog items as live results', async () => {
  const item = {
    id: 'geniuz:movie:42',
    source: 'geniuz',
    sourceId: '42',
    title: 'Remote title',
    type: 'movie',
    genres: ['Drama'],
    availability: { discoverable: true, stream: true, download: false, premium: false },
  };
  const remoteRepository = { getById: async () => item };
  const service = new ContentService(remoteRepository, new MockContentRepository(), true);

  const result = await service.getById(item.id);

  assert.equal(result.data?.title, 'Remote title');
  assert.equal(result.source, 'tmdb');
});

test('development fallback is demo-only while production failures return no sample data', async () => {
  const mockRepository = new MockContentRepository();
  const unavailableRepository = {
    getTrending: async () => {
      throw new ApiError('Provider credentials are missing', 503);
    },
  };
  const developmentService = new ContentService(
    unavailableRepository,
    mockRepository,
    true,
    undefined,
    true,
  );
  const productionService = new ContentService(
    unavailableRepository,
    mockRepository,
    true,
    undefined,
    false,
  );

  const developmentResult = await developmentService.getTrending();
  const productionResult = await productionService.getTrending();

  assert.equal(developmentResult.source, 'mock');
  assert.ok(developmentResult.data.length > 0);
  assert.match(developmentResult.warning, /Demo catalog/);
  assert.equal(productionResult.source, 'tmdb');
  assert.deepEqual(productionResult.data, []);
  assert.match(productionResult.warning, /waking up/i);

  const productionDetailsService = new ContentService(
    { getById: async () => { throw new ApiError('Provider credentials are missing', 503); } },
    mockRepository,
    true,
    undefined,
    false,
  );
  const productionDetails = await productionDetailsService.getById('geniuz:movie:unknown');
  assert.equal(productionDetails.data, null);
});

test('a failed catalog request does not hide results from another request', async () => {
  const liveItem = {
    id: 'geniuz:movie:71',
    source: 'geniuz',
    title: 'Live result',
    type: 'movie',
    genres: [],
    availability: { discoverable: true, stream: true, download: false, premium: false },
  };
  const repository = {
    getTrending: async () => {
      throw new ApiError('Trending unavailable', 503);
    },
    getPopular: async () => [liveItem],
  };
  const service = new ContentService(repository, new MockContentRepository(), true, undefined, false);

  const [trending, popular] = await Promise.all([service.getTrending(), service.getPopular()]);

  assert.deepEqual(trending.data, []);
  assert.match(trending.warning, /waking up/i);
  assert.deepEqual(popular.data, [liveItem]);
});

test('published movies and series load independently when either query fails', async () => {
  const movie = {
    id: 'geniuz:movie:1',
    source: 'geniuz',
    title: 'Movie',
    type: 'movie',
    genres: [],
    availability: { discoverable: true, stream: true, download: false, premium: false },
  };
  const catalog = await loadPublishedCatalog(
    async () => [movie],
    async () => {
      throw new Error('series read failed');
    },
  );
  assert.deepEqual(catalog.movies, [movie]);
  assert.deepEqual(catalog.series, []);
  assert.deepEqual(catalog.shorts, []);
  assert.equal(catalog.hasFailures, true);
});

test('published Shorts load independently and remain empty when no short videos exist', async () => {
  const short = {
    id: 'geniuz:short:1',
    source: 'geniuz',
    title: 'Short',
    type: 'short',
    genres: [],
    availability: { discoverable: true, stream: true, download: false, premium: false },
  };
  const catalog = await loadPublishedCatalog(async () => [], async () => [], async () => [short]);
  assert.deepEqual(catalog.shorts, [short]);
  assert.equal(catalog.hasFailures, false);
});

test('published catalog search matches title, genre, and year, newest first', () => {
  const items = [
    {
      id: 'older',
      source: 'geniuz',
      title: 'Old Comedy',
      type: 'movie',
      year: 1999,
      createdAt: '2025-01-01',
      genres: ['Comedy'],
      availability: { discoverable: true, stream: true, download: false, premium: false },
    },
    {
      id: 'newer',
      source: 'geniuz',
      title: 'Recent Drama',
      type: 'series',
      year: 2026,
      createdAt: '2026-01-01',
      genres: ['Drama'],
      availability: { discoverable: true, stream: false, download: false, premium: false },
    },
  ];
  assert.deepEqual(searchPublishedCatalog(items, 'comedy').map(({ id }) => id), ['older']);
  assert.deepEqual(searchPublishedCatalog(items, '1999').map(({ id }) => id), ['older']);
  assert.deepEqual(sortPublishedNewest(items).map(({ id }) => id), ['newer', 'older']);
});

test('catalog errors map to short friendly messages without exposing provider details', () => {
  assert.equal(
    getFriendlyCatalogErrorMessage(new Error('fetch failed: private provider detail')),
    'Could not reach the catalog. Check your connection and retry.',
  );
  assert.equal(
    getFriendlyCatalogErrorMessage({ code: 'PGRST204', message: 'private column diagnostics' }),
    'Some titles could not be loaded. Please retry.',
  );
  assert.match(getFriendlyCatalogErrorMessage(new ApiError('Gateway unavailable', 503)), /waking up/i);
});
