# Progress

Updated: 2026-10-05

## Phase 0: Inspection

- App: Expo SDK 57, React Native 0.86, TypeScript, Expo Router. The main screens live in `app/`; shared UI and state live in `src/`.
- Backend: Node.js 22 TypeScript HTTP server in `backend/`, deployed through `render.yaml`. It provides TMDB discovery, B2 multipart admin uploads, signed playback URLs, and health/status checks. It does not connect a payment provider or expose subscription, payout, creator, or transfer APIs.
- Data/auth: Supabase Auth with email/password and PKCE; public Supabase client uses a publishable key and RLS. Admin role uses `app_metadata.role`. There is no Google OAuth or date-of-birth capture.
- Database: timestamped SQL migrations define movies, storage, series/episodes, title metadata, notifications, profiles, usernames, deletion requests, Shorts, and categories. There are no plans, subscriptions, payment ledger, creator earnings, payouts, or transfer-session tables.
- Video: admin videos upload in multipart chunks to private Backblaze B2. Playback uses expiring signed URLs and HTTP Range support. No FFmpeg/ffprobe conversion pipeline exists; uploads retain their source format.
- Downloads/offline: native file-system downloads persist metadata in AsyncStorage, report progress, validate file size after download, handle queue/cancel/delete, and remain playable offline. Network state blocks new online-only operations. Hash verification and resumable partial downloads are not implemented.
- Load balancing: one configured backend URL; no endpoint pool or round-robin implementation.
- Existing checks: `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run backend:build`. The app and backend use separate env examples. Local env files were not read.
- Documentation mismatch: README's current limitations say offline downloads are not implemented although native downloads exist; this should be corrected in a documentation phase.

## Phase Status

- Phase 0: done.
- Phase 1: in progress. Added a spring-animated Home tab indicator and corrected keyboard-aware scrolling to measure after the keyboard opens, using a tested visible-viewport calculation. Email/password validation and admin security remain in place; the broader auth/security/env audit and Google OAuth/date-of-birth work remain.
- Phases 2-8: not started. No payment, member earnings/payout, FFmpeg conversion, multi-endpoint balancing, or device-transfer system exists today. External provider approvals/credentials are not present in the repository; code will use environment variables and no secrets will be added.

## Execution Boundaries

- Work is on local branch `main`.
- Do not push, run `supabase db push`, force-update refs, or merge branches.
- Apply migrations only as new files when needed; never execute them against a database.

## Latest Validation

- Home navigation (2026-10-05): removed the focus-based reset. Only the Home tab's `tabPress` listener resets the category to Trending and scrolls to the top; tapping Home while already on Trending avoids a category state update. Returning from title/player routes, modals, or app focus preserves the selected category and Home scroll position. Regression coverage verifies the icon reset, no redundant Trending update, and no focus-based reset; refresh shuffle and Latest newest-first tests remain passing.
- Home navigation validation: `npm run typecheck`, `npm run lint`, and `npm test` passed; full suite passed (110/110). Lint reports two existing duplicate-import warnings in `src/services/ProfileRepository.ts`.
- Home now resets to Trending and scrolls to the top on Home tab presses and whenever the Home screen regains focus; tapping Home while already there does not reload the catalog. Pull-to-refresh generates a new shuffle seed. Existing Home row/item shuffling is restored while Latest remains first and newest-first.
- Validation for Home reset/refresh: `npm run typecheck` passed; `EXPO_NO_DOTENV=1 npm run lint` passed with two pre-existing duplicate-import warnings in `src/services/ProfileRepository.ts`; `npm test` passed (109/109). No migration, environment variable, or native build requirement.
- Home category tabs now fetch all published movies, series, and shorts in stable 500-row pages instead of relying on one unpaginated Supabase response, which could stop at the project row cap and omit older titles before category matching. Category membership is case-insensitive, multi-category aware, and excludes undiscoverable titles; TV includes series/TV items, and Home shuffle preserves the newest-first Latest row.
- The Me avatar now opens Edit profile with an accessible pencil badge. Home labels Shorts as Reels while retaining `/shorts`; Reels is available in the admin category picker. Categories remain free-form, so no migration is required.
- Validation for the Home/profile/Reels changes: `npm run typecheck` passed, `EXPO_NO_DOTENV=1 npm run lint` passed with two pre-existing duplicate-import warnings in `src/services/ProfileRepository.ts`, and `npm test` passed (108/108). No environment variables or database migration are needed; all changes are JavaScript/TypeScript and work in Expo Go as well as EAS builds.
- Auth storage: Supabase's base `sb-<project-ref>-auth-token` and PKCE `-code-verifier` keys are valid; the old `:secure-chunk:<n>` suffix generated invalid SecureStore keys for large auth sessions. SecureStore calls now sanitize every key while leaving already-valid keys unchanged; existing inline SecureStore sessions and the legacy AsyncStorage migration path remain readable.
- PKCE: added SDK 57-compatible `expo-crypto` and a WebCrypto `subtle.digest` shim backed by native SHA-256, retaining secure random generation and never downgrading challenge method to `plain`.
- Auth validation: `npm test` passed (101/101); sanitizer tests confirm valid keys are unchanged, invalid characters are replaced, no key is empty, and every chunk operation uses allowed characters.
- Auth validation: `npm run typecheck` passed; `EXPO_NO_DOTENV=1 npm run lint` passed with two existing duplicate-import warnings in untouched `src/services/ProfileRepository.ts`. Android phone verification of sign-up, sign-in, sign-out, and restored session is still needed.
- Keyboard handling: Android uses native resize without a second Android `KeyboardAvoidingView` height adjustment; the shared wrapper scrolls the focused field into view, follows multiline growth, and restores the pre-keyboard offset. Reviewed Discover search, admin sign-in/upload/edit modal, sign-in/sign-up sheet, password recovery, profile editing, and email-confirmation date-of-birth. No comments input exists in the current screens.
- Home `See all`: all Home rails now open the shared paginated `/home-list` screen; catalog pages contain 24 titles and use the existing poster/detail components. Trending is the Home `Latest` row, so it uses newest `created_at` first and assigns ranks from that order, not a popularity score.
- Validation: `npm test` passed (100/100), `npm run typecheck` passed, and `EXPO_NO_DOTENV=1 npm run lint` passed with two existing duplicate-import warnings in `src/services/ProfileRepository.ts`. Resolved Expo config confirms Android `resize` and non-translucent status bar.
- Manual check remaining: verify keyboard interactions on an Android device. The Android native window settings require a development or standalone build; Expo Go uses its own native manifest, while the shared wrapper changes run in Expo Go.
- Added Animation to the Home category tabs and shared admin category picker list; categories remain free-form text in the database. Added `20261015000000_animation_category.sql` to seed the readable category list; migration has not been applied.
- Animation validation: `npm test` passed (99/99), `npm run typecheck` passed, and `npm run lint` passed with two existing duplicate-import warnings in `src/services/ProfileRepository.ts`.
- `npm install`: passed; npm reported existing Expo peer-dependency and install-script warnings.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 94/94.
- `npm run backend:build`: passed.
- Keyboard geometry has unit coverage; device-level keyboard and animation behavior still needs a real-device check.
- Backblaze cleanup task D: the backend now exposes admin-only `/admin/unused-files` and `/admin/unused-files/delete` routes with a TTL-bound `scanId`, safe filtering for recent files, referenced title assets, drafts, and non-media prefixes, and per-file continue-on-error deletion. The admin console now includes “Find unused files” and “Delete unused files” buttons that require admin auth, scan the current Backblaze bucket, and ask for confirmation before deleting only the returned orphan set.
- Final validation: `npm run typecheck && npm run lint && npm test -- --runInBand` passed; lint emitted only the existing duplicate-import warnings in `src/services/ProfileRepository.ts`, and the full Node test suite passed at 103/103 with 0 failures.
- Part B: completed the admin title-delete safety fix, stale multipart upload cleanup, and Codespaces-safe CORS controls. The backend title-delete route deletes exact stored files before database rows, refuses automated deletion of protected draft titles `Run` and `NIGERIA`, and logs every action in the audit table; stale multipart uploads are scanned and aborted only after age and reference filtering, with the admin scan result exposing the file and upload totals and bytes freed. `CORS_ALLOW_CODESPACES=true` enables only the current Codespace `https://<name>-8081.app.github.dev` origin and defaults to `false` for production.
