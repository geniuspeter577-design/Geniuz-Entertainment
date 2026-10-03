# Geniuz+

Geniuz+ is an Expo / React Native entertainment app backed by a small TypeScript catalog API. Catalog discovery is not a content license: items from TMDB are always marked non-streamable and non-downloadable.

## Run locally

Use Node.js 22.9 or newer and npm.

```sh
npm install
cp backend/.env.example backend/.env
npm run backend:start
```

Set the required Supabase, B2, and CORS variables in `backend/.env` before starting the API. The API listens on `http://localhost:4000` by default. `GET /health` works without a TMDB credential; catalog routes return a safe configuration error until `TMDB_API_KEY` is set in `backend/.env`. Restart the API after changing backend settings.

In a second terminal, run the mobile app:

```sh
EXPO_PUBLIC_GENIUZ_API_URL=http://localhost:4000 npm run web
```

For Expo web and phones in Codespaces, set `EXPO_PUBLIC_GENIUZ_API_URL` to the forwarded HTTPS URL for backend port 4000. Make port 4000 public with `gh codespace ports visibility 4000:public -c "$CODESPACE_NAME"`. The server binds to `0.0.0.0`; its CORS origin allowlist is controlled by `CORS_ORIGIN`.

Run the mobile app alone with `npm start`; development builds show the clearly labeled Demo catalog when the API URL is missing or the live catalog is unavailable. Production builds never substitute demo titles and instead show a retryable catalog error.

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

The root `.env.example` is for public Expo app settings only. `backend/.env.example` documents backend settings:

- `PORT` — API listen port (default 4000)
- `TMDB_API_KEY` — server-only TMDB Bearer credential
- `TMDB_BASE_URL` — HTTPS TMDB v3 base URL
- `ANILIST_API_URL` — reserved for a future AniList provider
- `CORS_ORIGIN` — comma-separated browser origins allowed to call the API
- `CATALOG_CACHE_TTL_SECONDS` — in-memory catalog cache lifetime (default 300)
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` — backend Supabase project settings for Auth and RLS
- `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_BUCKET` — private Backblaze B2 access settings

Keep `.env` and `backend/.env` out of source control. `EXPO_PUBLIC_GENIUZ_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` belong only in the app environment. The Supabase publishable key does not grant admin privileges. Keep B2 credentials and `TMDB_API_KEY` only in `backend/.env` or the backend host's environment; never use `EXPO_PUBLIC_` names for them.

## Upload and stream licensed movies

The app uses Supabase for authentication and movie records, Backblaze B2 for newly uploaded private video files, and optional local offline downloads. To enable it:

1. Create a Supabase project.
2. Apply all migrations in timestamp order. With the Supabase CLI, run `npx supabase init` once if this project has no `supabase/config.toml`, then `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`, and `npx supabase db push`. Alternatively, apply the SQL files in `supabase/migrations/` in timestamp order in the Supabase SQL Editor. This provisions the public-read `title-images` bucket and its admin-only write policies, plus the title cover and trailer metadata columns. Existing Supabase Storage movies remain on the `supabase` provider and continue to play.
3. Create an account in Supabase Authentication, then set that user's **app metadata** to `{"role":"admin"}` in the Supabase dashboard. Do not use user-editable metadata for the admin role. Sign out and back in after changing the role.
4. Create a private Backblaze B2 bucket and a bucket-scoped application key with `readFiles` and `writeFiles` capabilities; `deleteFiles` is also needed for the one-off storage diagnostic cleanup. Copy `.env.example` to `.env` for the app and `backend/.env.example` to `backend/.env` for the server. Configure `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` only in the backend environment. In the app `.env`, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Start the API with `npm run backend:start`. In Codespaces, run `gh codespace ports visibility 4000:public -c "$CODESPACE_NAME"`, and set the app URL to `https://$CODESPACE_NAME-4000.$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` (no trailing slash). Include both `http://localhost:8081` and `https://$CODESPACE_NAME-8081.$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` in backend `CORS_ORIGIN`.
6. Restart Expo with `npm start -- --tunnel`, scan its QR code with Expo Go, and open **Profile → Admin console**. Choose a supported video up to 1 GiB, enter its listing details, confirm distribution rights, and upload. New files upload directly to B2 in 16 MiB parts, with at most three concurrent part uploads. A movie row is created only after storage confirms completion. Check **Allow users to download this title** to enable local downloads. Poster and cover images accept JPG, PNG, or WebP up to 5 MB and are resized/compressed before upload; trailers use the same multipart flow and are limited to 300 MB. The rights confirmation is required for image and trailer additions/replacements too.

**Profile → Settings → Autoplay trailers** is on by default; title-page trailer previews stream from B2 and use mobile data. In the player, **Rotate screen** enters landscape fullscreen; double-tap either side to seek 10 seconds and vertically swipe the left/right sides for brightness/volume. The volume gesture changes in-app player volume, not the Android system volume.

Configure this CORS rule for the B2 bucket (replace the forwarded origin with your Codespace's actual port-8081 origin):

```json
[
  {
    "CORSRules": [
      {
        "AllowedOrigins": [
          "http://localhost:8081",
          "https://YOUR-CODESPACE-8081.app.github.dev"
        ],
        "AllowedMethods": ["GET", "HEAD", "PUT"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
      }
    ]
  }
]
```

Backblaze's S3-compatible API supports `PutBucketCors` and `GetBucketCors`; configure the rule in the bucket CORS settings or through the S3-compatible API. The B2 application key and secret stay server-side; the app receives only short-lived presigned URLs. B2 playback URLs expire after two hours and support HTTP Range requests for seeking. Playback support depends on the device; MP4 is the most compatible format, and MKV and other formats may not play on iPhones. Offline files are stored in the app's document directory and appear in **Downloads** only for titles whose admin setting permits downloads. The app does not implement DRM, transcoding to HLS, or payments. Upload and stream only content you are legally authorized to distribute.

Use `npm run b2:cors` to print the bucket's current CORS rules without changing them. Use `npm run b2:cors -- --apply` to replace them with the rule above, using the current Codespaces port-8081 origin and all origins in backend `CORS_ORIGIN`. Both commands use the backend `S3_*` settings.

The Supabase publishable key is intentionally public and is protected by RLS. Never put a Supabase `service_role` key in `.env` variables prefixed with `EXPO_PUBLIC_`, the app, or a mobile build.

Downloaded title metadata and a local poster copy are saved with the video so its details, Downloads listing, and playback remain available offline. The app checks connectivity and limits offline mode to saved downloads; reconnecting refreshes online catalogs automatically. Supabase's free plan allows up to 50 MB per storage file and about 1 GB total, while B2's free allowance is 10 GB. Image storage, video storage, and transfer beyond provider allowances may incur charges; monitor both project usage dashboards. Each offline video also consumes space on the phone.

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
| POST | `/api/downloads/authorize` | Explicitly unavailable (501); offline downloads use the same movie playback URL as streaming |
| POST | `/uploads/init` | Admin-only multipart upload initialization |
| POST | `/uploads/part-urls` | Admin-only presigned B2 part URLs |
| POST | `/uploads/complete` | Admin-only multipart completion |
| POST | `/uploads/abort` | Admin-only multipart cancellation |
| GET | `/movies/:id/play-url` | Two-hour B2 playback URL for published movies; unpublished movies are admin-only |
| GET | `/episodes/:id/play-url` | Two-hour B2 playback URL for published episodes; unpublished episodes are admin-only |

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
