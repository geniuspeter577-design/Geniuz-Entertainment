# Geniuz+

Geniuz+ is an Expo / React Native entertainment app backed by a small TypeScript catalog API. Catalog discovery is not a content license: items from TMDB are always marked non-streamable and non-downloadable.

## Run locally

Use Node.js 22.9 or newer and npm.

```sh
npm install
cp .env.example .env
npm run backend:start
```

The API listens on `http://localhost:4000` by default. `GET /health` works without a TMDB credential; catalog routes return a safe configuration error until `TMDB_API_KEY` is set in the backend-only `.env`.

In a second terminal, run the mobile app:

```sh
EXPO_PUBLIC_GENIUZ_API_URL=http://localhost:4000 npm run web
```

For Expo web in Codespaces, use a forwarded/reachable URL for port 4000 instead of `localhost` if the browser is not running in the same container. Native Android/iOS emulators likewise need an address reachable from the device (for Android emulator, commonly `10.0.2.2:4000`). The server binds to `0.0.0.0`; its CORS origin allowlist is controlled by `CORS_ORIGIN`.

Run the mobile app alone with `npm start`; without `EXPO_PUBLIC_GENIUZ_API_URL`, it uses the local sample catalog.

## Architecture

```text
Expo Router screens
  -> ContentService
     -> GeniuzContentRepository -> ApiClient -> Geniuz API
     -> MockContentRepository (development fallback)

Geniuz API routes
  -> ContentService / ContentRepository
     -> TMDBContentRepository -> fixed-path TMDBProvider
     -> in-memory cache
```

The backend uses Node's HTTP server and built-in `fetch`; there is no general web framework or Redis dependency. Provider credentials exist only in the backend environment. The backend returns normalized Geniuz content models, never raw TMDB records. The mobile app does not know which catalog source supplied a result.

## Environment

`.env.example` documents:

- `PORT` — API listen port (default 4000)
- `TMDB_API_KEY` — server-only TMDB Bearer credential
- `TMDB_BASE_URL` — HTTPS TMDB v3 base URL
- `ANILIST_API_URL` — reserved for a future AniList provider
- `CORS_ORIGIN` — comma-separated browser origins allowed to call the API
- `CATALOG_CACHE_TTL_SECONDS` — in-memory catalog cache lifetime (default 300)
- `EXPO_PUBLIC_GENIUZ_API_URL` — public API base URL for the Expo client; this is not a secret
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public Supabase project settings; these do not grant access without the database and storage policies

Keep `.env` out of source control. Never add the TMDB credential to an `EXPO_PUBLIC_` variable or a mobile build. The backend has no actual credential or provider access until an authorized TMDB API key is configured.

## Upload and stream licensed movies

The app includes a Supabase-backed admin page, private MP4 storage, a published movie catalog, and short-lived signed playback URLs. To enable it:

1. Create a Supabase project.
2. Run [`supabase/migrations/20261002000000_movies.sql`](./supabase/migrations/20261002000000_movies.sql) in the Supabase SQL Editor. It creates the movie table, private `movie-assets` bucket, and row/storage security policies.
3. Create an account in Supabase Authentication, then set that user's **app metadata** to `{"role":"admin"}` in the Supabase dashboard. Do not use user-editable metadata for the admin role. Sign out and back in after changing the role.
4. Copy `.env.example` to `.env`, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Supabase project settings, and restart Expo.
5. Start the app with `npm start -- --tunnel`, scan the Expo QR code with Expo Go on your phone, and open **Profile → Admin console**. Choose an MP4, enter its listing details, confirm distribution rights, and upload. Published movies appear under **On Geniuz+** and can be played from their details page. On a computer and phone sharing a local network, `npm start` can be used without the tunnel.

Large MP4 files use resumable 6 MiB TUS chunks. The migration sets the bucket's per-file limit to 5 GiB; the Supabase project plan's storage and upload limits still apply. Only MP4 is accepted for cross-platform playback. The playback URLs expire after one hour. Published video is available to anyone with a valid signed URL; this MVP does not implement DRM, transcoding to HLS, subscriptions, or offline downloads. Upload and stream only content you are legally authorized to distribute.

The Supabase publishable key is intentionally public and is protected by RLS. Never put a Supabase `service_role` key in `.env` variables prefixed with `EXPO_PUBLIC_`, the app, or a mobile build.

## API routes

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Liveness; does not require TMDB configuration |
| GET | `/api/content/trending?page=1` | Trending movies and TV |
| GET | `/api/content/popular?page=1` | Popular movies and TV |
| GET | `/api/content/upcoming?page=1` | Upcoming movies |
| GET | `/api/content/now-playing?page=1` | Now-playing movies |
| GET | `/api/content/movies?page=1` | Discover movies |
| GET | `/api/content/series?page=1` | Discover TV series |
| GET | `/api/content/anime?page=1` | Japanese animated TV discovery (TMDB metadata only) |
| GET | `/api/content/search?q=...&page=1&genre=...` | Search movies/TV |
| GET | `/api/content/genre?name=Action&page=1` | Browse a genre |
| GET | `/api/content/:id` | Details, e.g. `tmdb:movie:123` (URL-encoded colon accepted) |
| GET | `/api/content/:id/similar?page=1` | Similar metadata |
| GET | `/api/genres` | Movie and TV genres |
| POST | `/api/playback/session` | Explicitly unavailable (501) until licensed playback exists |
| POST | `/api/downloads/authorize` | Explicitly unavailable (501) until download entitlements exist |

List responses use `{ items, page, totalPages }`; detail responses use `{ item }`. Errors use `{ error: { code, message } }`. Query sizes/pages and content ID formats are validated. The API only maps predefined provider paths; it cannot fetch caller-supplied URLs.

## Providers, data safety, and caching

The server-side TMDB provider supports trending, popular, upcoming, now-playing, movie/TV discovery, search, detail, similar-title, and genre requests. It uses a server Bearer credential, an 8-second upstream timeout, and maps provider failures to safe client errors without stack traces or provider response bodies.

An in-memory TTL cache deduplicates concurrent requests and caches catalog lists and genres by endpoint/page. It can later be replaced behind the repository boundary with a shared cache. Cache is per process and is not persistent.

TMDB supplies discovery metadata, **not Geniuz+ streaming rights**. TMDB results always have `discoverable: true`, `stream: false`, `download: false`, and `premium: false`. No playback URL or download URL is generated. AniList and sports/news provider interfaces are reserved but not connected; no live scores or news are fabricated.

When the mobile API URL is absent, the app uses mock content. If a configured API call fails, the app logs the failure, falls back to sample content, and visibly identifies the fallback. The local watchlist/progress metadata remains device-only and is not synchronized.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run backend:build
npm audit
npm run backend:start
curl http://localhost:4000/health
CI=1 npx expo export --platform web --output-dir dist
```

`npm test` runs mobile repository/service tests plus backend and mobile-to-backend HTTP integration tests without requiring a TMDB key.

The dependency overrides in `package.json` pin patched versions of `decode-uri-component` and the `xcode` tool's `uuid` dependency while retaining Expo SDK 57. The current Expo CLI dependency graph still includes `node-forge@1.4.0`, which is covered by the upstream RSA verification advisory and has no patched npm release. Do not apply `npm audit fix --force` to this project: npm proposes downgrading Expo to 44.0.6. Recheck `npm audit` when Expo publishes an updated CLI/signing dependency.

## Current limitations

Live catalog requests need a valid server-side TMDB credential. End-user account sync, entitlements, DRM, offline media downloads, payment processing, production deployment/signing, and video transcoding are not implemented. Supabase admin sign-in and basic signed-URL playback only cover movies uploaded to your configured project. TMDB metadata alone does not authorize playback or downloads.
