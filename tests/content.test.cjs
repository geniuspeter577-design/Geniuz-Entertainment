const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ApiClient, ApiError } = require('../.test-build/src/api/ApiClient.js');
const { MockContentRepository } = require('../.test-build/src/repositories/MockContentRepository.js');
const { ContentService } = require('../.test-build/src/services/ContentService.js');

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
  const service = new ContentService(unavailableRepository, repository, true);
  const result = await service.getTrending();

  assert.equal(result.source, 'mock');
  assert.match(result.warning, /live catalog is unavailable/i);
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
  const service = new ContentService(remoteRepository, mockRepository, true);
  const result = await service.getById('mock:the-last-horizon');

  assert.equal(remoteRequestMade, false);
  assert.equal(result.data?.title, 'The Last Horizon');
  assert.equal(result.source, 'mock');
});

test('content service keeps known normalized results available after the API goes down', async (context) => {
  context.mock.method(console, 'error', () => {});
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
  assert.match(result.warning, /live catalog is unavailable/i);
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
