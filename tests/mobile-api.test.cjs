const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const { test } = require('node:test');

const { ApiClient } = require('../.test-build/src/api/ApiClient.js');
const { GeniuzContentRepository } = require('../.test-build/src/repositories/GeniuzContentRepository.js');
const { loadConfig } = require('../.test-build/backend/backend/src/config/config.js');
const { createApiServer } = require('../.test-build/backend/backend/src/http/server.js');
const { TMDBContentRepository } = require('../.test-build/backend/backend/src/repositories/TMDBContentRepository.js');
const { HttpTMDBProvider } = require('../.test-build/backend/backend/src/providers/TMDBProvider.js');
const { FootballMatchesService } = require('../.test-build/backend/backend/src/services/FootballMatchesService.js');
const { getKickoffPresentation, getNextFootballDates, sortHomeFootballMatches } = require('../.test-build/src/utils/footballScores.js');
const { getGoalBallCounts, normalizeFootballPinCorner, snapFootballPinCorner } = require('../.test-build/src/utils/footballPin.js');
const { parseUserAppSettings } = require('../.test-build/src/services/TrailerAutoplayPreference.js');
const { ContentService } = require('../.test-build/backend/backend/src/services/ContentService.js');

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
    footballDataApiKey: 'football-integration-key',
    corsOrigins: ['http://localhost:8081'],
    cacheTtlSeconds: 30,
  };
  const provider = new HttpTMDBProvider(
    config,
    async (input) => tmdbResponse(new URL(String(input))),
  );
  const repository = new TMDBContentRepository(provider);
  const footballMatchesService = new FootballMatchesService({
    getMatches: async () => [{
      id: 'football-match-1',
      competition: { id: 'league-1', name: 'Integration League' },
      startsAt: '2026-10-08T17:00:00.000Z',
      status: 'scheduled',
      minute: null,
      homeTeam: { name: 'Home FC' },
      awayTeam: { name: 'Away FC' },
      homeScore: null,
      awayScore: null,
    }],
  });
  const server = createApiServer(config, new ContentService(repository), { footballMatchesService });
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

test('mobile Geniuz repository loads football matches through the backend route', async (context) => {
  const server = await createIntegratedServer();
  context.after(server.close);

  const repository = new GeniuzContentRepository(new ApiClient({ baseUrl: server.baseUrl }));
  const response = await repository.getFootballMatches('2026-10-08');
  assert.equal(response.date, '2026-10-08');
  assert.equal(response.matches[0].competition.name, 'Integration League');
  assert.equal(response.matches[0].homeTeam.name, 'Home FC');
});

test('Football Home category shows score states and notes without match stream actions', () => {
  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  const panel = fs.readFileSync('src/components/FootballMatchesPanel.tsx', 'utf8');
  const context = fs.readFileSync('src/state/FootballMatchesContext.tsx', 'utf8');
  const card = fs.readFileSync('src/components/FootballHomeCard.tsx', 'utf8');
  const scoreUtils = fs.readFileSync('src/utils/footballScores.ts', 'utf8');
  assert.match(home, /selectedCategory === 'Football'[\s\S]*?<FootballMatchesPanel/);
  assert.match(panel, /useFootballMatches\(\)/);
  assert.match(panel, /Loading football scores/);
  assert.match(panel, /Football scores could not be loaded/);
  assert.match(panel, /You’re offline/);
  assert.match(panel, /No matches/);
  assert.match(scoreUtils, /Array\.from\(\{ length: 7 \}/);
  assert.match(panel, /onPress=\{\(\) => football\.selectDate\(day\.date\)\}/);
  assert.match(panel, /title: 'Live'/);
  assert.match(panel, /title: 'Upcoming'/);
  assert.match(panel, /title: 'Results'/);
  assert.match(scoreUtils, /timeZone: 'Africa\/Lagos'[\s\S]*?hour: '2-digit'/);
  assert.match(card, /getKickoffPresentation\(match\.startsAt\)/);
  assert.match(card, /kickoff\?\.comingSoon/);
  assert.match(home, /<FootballHomeCard/);
  assert.match(card, /if \(liveUpcoming\.length === 0\)[\s\S]*?return null/);
  assert.match(context, /getFootballMatches\(date\)/);
  assert.match(context, /appState !== 'active'/);
  assert.match(context, /}, 60_000\)/);
  assert.match(context, /requestsRef\.current\.get\(date\)/);
  assert.doesNotMatch(context, /football-data\.org/);
  assert.doesNotMatch(panel, /router\.push|\/watch\//);
});

test('football kickoff labels use Today only for Lagos calendar dates and Upcoming matches sort after Live', () => {
  const now = new Date('2026-10-08T00:00:00.000Z');
  assert.deepEqual(getKickoffPresentation('2026-10-08T17:30:00.000Z', now), { label: 'Today, 18:30', comingSoon: false });
  assert.deepEqual(getKickoffPresentation('2026-10-09T17:30:00.000Z', now), { label: '9 Oct, 18:30', comingSoon: true });
  assert.equal(getNextFootballDates(now).length, 7);
  const base = {
    competition: { id: 'league', name: 'League' },
    minute: null,
    homeTeam: { name: 'Home' },
    awayTeam: { name: 'Away' },
    homeScore: null,
    awayScore: null,
  };
  const sorted = sortHomeFootballMatches([
    { ...base, id: 'upcoming', startsAt: '2026-10-08T20:00:00Z', status: 'scheduled' },
    { ...base, id: 'live', startsAt: '2026-10-08T19:00:00Z', status: 'live' },
    { ...base, id: 'finished', startsAt: '2026-10-08T18:00:00Z', status: 'finished' },
  ]);
  assert.deepEqual(sorted.map(({ id }) => id), ['live', 'upcoming']);
});

test('football goal balls animate only score increases and never on first load or corrections', () => {
  const current = { id: 'match', homeScore: 2, awayScore: 1 };
  assert.deepEqual(getGoalBallCounts(undefined, current), { home: 0, away: 0 });
  assert.deepEqual(getGoalBallCounts({ ...current }, current), { home: 0, away: 0 });
  assert.deepEqual(getGoalBallCounts({ ...current, homeScore: 1, awayScore: 1 }, current), { home: 1, away: 0 });
  assert.deepEqual(getGoalBallCounts({ ...current, homeScore: 2, awayScore: 0 }, current), { home: 0, away: 1 });
  assert.deepEqual(getGoalBallCounts({ ...current, homeScore: 4, awayScore: 1 }, current), { home: 0, away: 0 });
});

test('football pin snaps to nearest corner and its corner persists in per-user app settings', () => {
  const snapped = snapFootballPinCorner(
    { x: 650, y: 470 },
    { width: 800, height: 600 },
    { width: 200, height: 100 },
    { top: 10, right: 10, bottom: 20, left: 10 },
  );
  assert.equal(snapped.corner, 'bottom-right');
  assert.deepEqual(normalizeFootballPinCorner(snapped.corner), 'bottom-right');
  const settings = parseUserAppSettings(JSON.stringify({ footballPinCorner: snapped.corner }));
  assert.equal(settings.footballPinCorner, 'bottom-right');
  const pin = fs.readFileSync('src/components/FootballScorePin.tsx', 'utf8');
  const root = fs.readFileSync('app/_layout.tsx', 'utf8');
  assert.match(pin, /getUserAppSettings/);
  assert.match(pin, /setUserAppSettings/);
  assert.match(pin, /snapFootballPinCorner/);
  assert.match(pin, /pointerEvents="box-none"/);
  assert.match(root, /<FootballMatchesProvider>[\s\S]*?<FootballScorePin\s*\/>[\s\S]*?<\/FootballMatchesProvider>/);
});

test('transfer panel explains Member access and routes visitors to sign-in or the existing Member card', () => {
  const panel = fs.readFileSync('src/components/downloads/DeviceTransferPanel.tsx', 'utf8');
  const memberPage = fs.readFileSync('app/membership.tsx', 'utf8');
  const profile = fs.readFileSync('app/(tabs)/profile.tsx', 'utf8');
  assert.match(panel, /Transfer is for Members/);
  assert.match(panel, /router\.push\('\/membership'\)/);
  assert.match(panel, /Both sending and receiving require active Member access/);
  assert.match(memberPage, /Become a Member/);
  assert.match(memberPage, /loadMemberPlan|useMembership/);
  assert.match(memberPage, /Sign in to continue/);
  assert.match(memberPage, /createMemberCheckout/);
  assert.match(memberPage, /Continue payment/);
  assert.match(memberPage, /You are a Member until/);
  assert.match(memberPage, /Post REELS and Earn in Dollars/);
  assert.doesNotMatch(memberPage, /NGN\s+900/);
  assert.match(profile, /useMembership\(\)/);
  assert.match(profile, /Member until \$\{formatMembershipDate/);
});

test('mobile Geniuz repository rejects malformed normalized responses', async () => {
  const apiClient = {
    get: async () => ({ items: [{ title: 'Missing required fields' }], page: 1, totalPages: 1 }),
  };
  const repository = new GeniuzContentRepository(apiClient);
  await assert.rejects(repository.getTrending(), /invalid content item/i);
});

test('API client retries transient launch wake-ups and preserves the public error semantics', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async (input) => {
    attempts += 1;
    if (attempts < 3) {
      throw new TypeError('temporary network issue');
    }
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/content/trending');
    return new Response(JSON.stringify({ items: [], page: 1, totalPages: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const client = new ApiClient({ baseUrl: 'https://api.example.test', timeoutMs: 1000 });
    const result = await client.get('/api/content/trending');
    assert.deepEqual(result, { items: [], page: 1, totalPages: 1 });
    assert.equal(attempts, 3);
  } finally {
    global.fetch = originalFetch;
  }
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
