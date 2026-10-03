# Deployment notes

## Backend

- Use a Render web service running Node 22.
- Set the service start command to `npm run backend:start`.
- Confirm `PORT` is provided by Render and the app binds to `0.0.0.0`.
- Keep a `/health` route enabled and test it with `curl https://YOUR_RENDER_URL/health`.
- Keep `CORS_ORIGIN` as a comma-separated list of allowed app origins.
- Put all secrets in the backend environment only. Do not commit `.env` files.

## App

- Use `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the Expo app environment.
- Add any other public values needed by the app to `EXPO_PUBLIC_*` variables only.
- Use EAS build profiles from `eas.json` for development, preview APK, and production app bundle.

## Supabase and Backblaze

- Apply the migrations in timestamp order.
- Set the admin role in Supabase user `app_metadata` to `{"role":"admin"}`.
- Configure the Backblaze bucket and key with the permissions required for upload, signed URLs, and cleanup.
- Add the required CORS rule for the app origin.

## Go-live checklist

- Confirm each title has valid distribution rights.
- Remove or archive all test titles before launch.
- Confirm the admin account role is set.
- Review Supabase and Backblaze service limits and alerts.
- Test `/health`, uploads, playback, and cleanup before enabling public access.
