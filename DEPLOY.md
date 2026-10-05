# Deployment notes

## Backend

Deploy from the repository root using the included `render.yaml` Blueprint. It creates a Node web service rooted at `backend/`, builds only the standalone backend package, and runs it on Render's assigned `PORT`. Alternatively, create a Render Web Service with root directory `backend`, build command `npm ci --include=dev && npm run build`, and start command `npm run start`.

In the Render dashboard, add these backend environment variables. Use the exact names shown; never add their values to the Expo app environment:

- Required for signed playback and admin uploads: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, and `CORS_ORIGIN`.
- Required for live catalog discovery: `TMDB_API_KEY`.
- Optional: `TMDB_BASE_URL`, `ANILIST_API_URL`, and `CATALOG_CACHE_TTL_SECONDS`.
- Render supplies `PORT`; the service binds to `0.0.0.0`.

Set `CORS_ORIGIN` to the exact browser origins that need API access, comma-separated. Native iOS and Android requests do not use browser CORS. Test deployment with `curl https://YOUR_RENDER_URL/health`; it should return HTTP 200 without exposing configuration.

Render's free web services spin down after inactivity. The first request after a spin-down can take around a minute while the service starts, so the mobile API retries transient startup/network failures with a longer initial timeout. Free instances are not kept awake by `/health` traffic, and persistent uptime is not guaranteed; use a paid instance if that is a requirement. The service is stateless, and its catalog cache is in-memory and resets on restart.

## App

- Use `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the Expo app environment.
- Add any other public values needed by the app to `EXPO_PUBLIC_*` variables only.
- Use EAS build profiles from `eas.json` for development, preview APK, and production app bundle.

## Supabase and Backblaze

- Apply the migrations in timestamp order.
- Set the admin role in Supabase user `app_metadata` to `{"role":"admin"}`.
- Configure the Backblaze bucket and key with the permissions required for upload, signed URLs, and cleanup.
- Add the required CORS rule for the app origin.
- For Codespaces-only testing, set `CORS_ALLOW_CODESPACES=true` and `CODESPACE_NAME` to the active Codespace name. Leave `CORS_ALLOW_CODESPACES` at its default `false` in production; do not enable a wildcard origin or any `*.app.github.dev` host outside the current port-8081 pattern.
- Recommended Backblaze bucket lifecycle rule: `Delete unfinished large files after 1 day`.

## Codespace switching and one-time setup

1. One-time backend setup: set the environment variables `CODESPACE_NAME` and `CORS_ALLOW_CODESPACES=true` in the backend environment for the current Codespace. Keep `CORS_ORIGIN` limited to the exact app origins you need, and include the current Codespace origin only when the flag is enabled.
2. When you switch to a different Codespace, update `CODESPACE_NAME` and restart the backend. The allowed Codespace origin is always `https://$CODESPACE_NAME-8081.app.github.dev`, never a wildcard and never a different port.
3. For local web testing, keep `http://localhost:8081` and `http://localhost:19006` in `CORS_ORIGIN` as needed. Do not set `CORS_ALLOW_CODESPACES=true` in production.

## Go-live checklist

- Confirm each title has valid distribution rights.
- Remove or archive all test titles before launch.
- Confirm the admin account role is set.
- Review Supabase and Backblaze service limits and alerts.
- Test `/health`, uploads, playback, and cleanup before enabling public access.
