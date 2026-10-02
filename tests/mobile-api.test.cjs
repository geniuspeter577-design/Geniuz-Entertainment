const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');

const { ApiClient } = require('../.test-build/src/api/ApiClient.js');
const { GeniuzContentRepository } = require('../.test-build/src/repositories/GeniuzContentRepository.js');
const { loadConfig } = require('../.test-build/backend/config/config.js');
const { createApiServer } = require('../.test-build/backend/http/server.js');
const { TMDBContentRepository } = require('../.test-build/backend/repositories/TMDBContentRepository.js');
const { HttpTMDBProvider } = require('../.test-build/backend/providers/TMDBProvider.js');
const { ContentService } = require('../.test-build/backend/services/ContentService.js');

function tmdbResponse(url) {
  if (url.pathname.endsWith('/genre/movie/list')) {
    return new Response(JSON.stringify({ genres: [{ id: 28, name: 'Action' }] }), { status: 200 });
  }
  if (url.pathname.endsWith('/genre/tv/list')) {
    return new Response(JSON.stringify({ genres: [] }), { status: 200 });
  }
  if (url.pathname.endsWith('/trending/all/week')) {
    return new Response(
      JSON.stringify({
        page: 1,
        total_pages: 1,
        results: [
          {
            id: 321,
            media_type: 'movie',
            title: 'Mobile integration title',
            release_date: '2026-01-01',
            genre_ids: [28],
            overview: 'Returned via Geniuz API.',
          },
        ],
      }),
      { status: 200 },
    );
  }
  if (url.pathname.endsWith('/search/multi')) {
    return new Response(
      JSON.stringify({
        page: 1,
        total_pages: 1,
        results: [
          {
            id: 654,
            media_type: 'movie',
            title: 'Search integration title',
            genre_ids: [28],
          },
        ],
      }),
      { status: 200 },
    );
  }
  return new Response(JSON.stringify({ results: [] }), { status: 200 });
}

async function createIntegratedServer() {
  const config = {
    port: 0,
    tmdbApiKey: 'integration-only-secret',
    tmdbBaseUrl: 'https://tmdb.example.test/3',
    anilistApiUrl: 'https://anilist.example.test/graphql',
    corsOrigins: ['http://localhost:8081'],
    cacheTtlSeconds: 30,
  };
  const provider = new HttpTMDBProvider(
    config,
    async (input) => tmdbResponse(new URL(String(input))),
  );
  const repository = new TMDBContentRepository(provider);
  const server = createApiServer(config, new ContentService(repository));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

test('mobile Geniuz repository consumes live trending and search API responses', async (context) => {
  const server = await createIntegratedServer();
  context.after(server.close);

  const repository = new GeniuzContentRepository(new ApiClient({ baseUrl: server.baseUrl }));
  const trending = await repository.getTrending();
  const search = await repository.search('search');

  assert.equal(trending[0].id, 'tmdb:movie:321');
  assert.equal(trending[0].title, 'Mobile integration title');
  assert.equal(trending[0].availability.stream, false);
  assert.equal(search[0].id, 'tmdb:movie:654');
  assert.equal(search[0].availability.download, false);
});

test('mobile Geniuz repository rejects malformed normalized responses', async () => {
  const apiClient = {
    get: async () => ({ items: [{ title: 'Missing required fields' }], page: 1, totalPages: 1 }),
  };
  const repository = new GeniuzContentRepository(apiClient);
  await assert.rejects(repository.getTrending(), /invalid content item/i);
});

test('server health stays available when TMDB credentials are missing', async (context) => {
  context.mock.method(console, 'error', () => {});
  const config = loadConfig({ PORT: '4000' });
  const repository = new TMDBContentRepository(new HttpTMDBProvider(config));
  const server = createApiServer(config, new ContentService(repository));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/content/trending`)).status, 503);
});
