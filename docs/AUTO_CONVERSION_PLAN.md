# Automatic Video Conversion Plan

Status: planning document only. No conversion worker or migration is included in this change.

## 1. Upload Flow Today

- The admin picker checks a selected file's name/MIME type and size. It currently recognizes MP4, MKV, MOV, WEBM, AVI, and additional formats (M4V, 3GP, TS, FLV, and WMV); the backend accepts any `video/*` MIME type or `application/octet-stream`.
- Movie and episode bytes are uploaded from the admin app to private Backblaze B2 multipart storage. The app requests an upload ID, asks the backend for signed part URLs, uploads parts directly to B2, then asks the backend to complete the multipart upload. The authenticated backend validates the upload and its parts.
- After the movie upload, the app writes the movie metadata and B2 `storage_key` to `public.movies`. The current flow can set `published` immediately. The current backend playback route checks `published`, HEAD-checks the B2 object, and returns a signed GET URL; it does not check a conversion status.
- `backend/scripts/convert-media.mjs` is a separate, manually run utility for an MKV movie key. It reads the source, probes it, converts or remuxes to MP4, verifies and uploads the new object, then prints SQL for a human to review. It does not update Supabase itself.

## 2. Accepted Inputs and Size Limit

The conversion-enabled movie flow should accept MP4, MKV, MOV, WEBM, and AVI. The current picker and backend accept more formats than this target set, so the admin picker and server-side upload validation must agree on the supported set. Do not rely on a filename extension alone; ffprobe must confirm the content is readable.

Use a configurable maximum with a default of 1 GB (currently 1 GiB / 1,073,741,824 bytes). Proposed environment variable name: `MAX_VIDEO_UPLOAD_SIZE_BYTES`. The backend is authoritative; the admin should obtain the effective limit from backend configuration instead of maintaining a second hard-coded limit. The current multipart cap is also 64 parts of 16 MiB each, so changing the limit requires coordinating the part-count and part-size constraints.

Trailers currently have a separate 300 MiB cap. Keep that policy separate unless Genius explicitly chooses to include trailers in the conversion rollout.

## 3. Shared Conversion Profile

Convert once when a source is accepted for upload. The normalized output profile is:

- MP4 container, H.264 video using `libx264` and `veryfast`.
- Video maximum rate 350 kb/s, with the existing 2x buffer rule.
- AAC stereo audio at 64 kb/s.
- Scale down to at most 480p; never upscale.
- `+faststart` for progressive MP4 playback.
- Drop subtitle and data streams and chapters; the normalized file carries no embedded subtitles or data tracks.

Use the existing `backend/src/config/videoConversionProfile.json` as the single profile source. The worker and `convert-media.mjs` must load that same file (or a shared package derived from it), not duplicate defaults in worker configuration. Keep an explicit operator override only where the existing converter supports one, and log the effective profile with each job.

## 4. Skip Already-Compatible Files

Use ffprobe before encoding. If the input is already an MP4 with H.264 video and AAC audio and it is within the configured output-size target, skip re-encoding. Still calculate its hash, capture metadata, and verify its final size. Files with a different container, codec, or excessive size go through the shared conversion profile. A source with no audio needs an explicit policy; do not silently label a video-only file as AAC stereo.

## 5. Probe and Persist Metadata

Run ffprobe on the source and normalized output. Persist the output's duration in seconds, width, height, container format, video codec, audio codec, SHA-256, and actual `file_size_bytes`. `file_size_bytes` already exists on `public.movies`; it must be set from the final file's real byte count, not the source size or a rounded ffprobe display value. Verify the uploaded object's content length against the local output size. Do not treat an S3 ETag as a SHA-256 hash.

The current table has `runtime_minutes`, `file_extension`, `mime_type`, and `file_size_bytes`, but no conversion status, exact duration, dimensions, format, or content hash columns. Add metadata columns in a later worker integration migration; retain `runtime_minutes` compatibility if the app still reads it.

## 6. Status, Retry, and Playback Gate

Use four states:

| State | Meaning |
| --- | --- |
| `uploaded` | Source is stored and awaiting a worker. |
| `converting` | A worker has claimed and is processing the movie. |
| `ready` | Normalized output and metadata are verified and playable. |
| `failed` | Processing stopped with a safe, admin-visible failure reason. |

The worker advances `uploaded` to `converting`, then to `ready` only after output and storage verification. Any unrecoverable job error becomes `failed`. The admin catalog displays the state and a Retry action for failed jobs; Retry requeues the existing source and does not upload another copy. Make claims/retries idempotent so two workers cannot convert the same movie concurrently.

Once the conversion worker is enabled, new movies must start as `uploaded`, and the backend playback URL route must reject every movie whose status is not `ready`. The public catalog must also avoid presenting non-ready movies as playable. The app UI alone is not an entitlement or playback gate. During conversion, keep `published` false and persist the admin's requested choice separately (for example, `publish_after_conversion`); apply it only after the worker marks the row ready. Add that intent field with the worker integration, not the status-only first migration.

## 7. Temporary Files and Playback URLs

Process files in a private temporary directory on the worker, with restricted permissions. Remove source downloads, partial outputs, and successful temporary outputs in a `finally` cleanup path. On worker restart, clean only stale files inside the worker's own temporary directory. Never automatically delete the original B2 source or database records.

Keep the existing private-B2 playback model: after the backend confirms the ready output exists, issue a short-lived signed GET URL. The current URL lifetime is two hours; review whether that remains appropriate for production, but do not make the bucket public.

## 8. Where FFmpeg Runs

| Option | Pros | Cons and charge risk | What Genius would click/do |
| --- | --- | --- | --- |
| Separate worker service, such as a Render Background Worker | Keeps CPU and memory-heavy FFmpeg work away from the API process; can poll or claim queued jobs and retry them. | The Render free tier is too weak for this workload. A suitable worker may cost money; verify on the provider's page. Requires worker health checks, logs, and cleanup. | In the Render dashboard choose **New** then **Background Worker**, connect this repository, configure its worker command and environment variable names, choose an adequate plan, and deploy. |
| Free CI runner, such as GitHub Actions | Easy to trigger manually, no always-on worker, and useful for a small controlled pilot. | Job duration, concurrency, disk, and runner availability are constrained. Passing media through artifacts is undesirable. Usage or storage beyond included allowances may cost money; verify on the provider's page. | In the repository's **Actions** tab select the conversion workflow and **Run workflow**. First configure the required repository/environment secrets by name and approve the workflow permissions. |
| Small paid VM or managed container worker | Full control over FFmpeg version, disk, resource limits, and job lifetime. | Genius must operate security updates, service supervision, networking, monitoring, and retries. It can cost money; verify on the provider's page. | In the chosen provider's console create a VM/container, select region and compute/disk, deploy the worker image, restrict network access, and configure the required environment variable names. |

All options need restricted access to B2 and Supabase, durable job claiming, safe logs, and an explicit concurrency limit. Do not put secret values in this document or in workflow logs.

## 9. Recommendation

Use a separate, appropriately sized paid worker service for production, preferably alongside the existing Render deployment if its available worker plans meet the measured FFmpeg needs. This isolates conversion load from playback/API latency, supports long jobs and controlled retries, and avoids relying on CI artifacts for large private videos. The Render free tier is not recommended. Before selecting a plan, benchmark representative files and verify on the provider's page whether the chosen service can charge money and what limits apply.

## 10. Smallest First Build Step

Build only the status column and an admin status display first; do not add FFmpeg or a worker in that step. The latest migration currently in the repository is `20261016000000_admin_media_deletion_audit.sql`, so the proposed migration filename is `20261017000000_movie_conversion_status.sql`.

Proposed migration contents (for the later implementation task; not applied here):

```sql
alter table public.movies
  add column conversion_status text not null default 'ready'
  constraint movies_conversion_status_check
  check (conversion_status in ('uploaded', 'converting', 'ready', 'failed'));
```

The `ready` default preserves current rows and current playback during this schema/display-only first step. When the worker is introduced, the same rollout must explicitly create new conversion jobs as `uploaded`, preserve publish intent, and enforce the `ready` gate in the backend before enabling conversion. Do not ship non-ready upload states without a worker capable of advancing them.

## 11. Risks and Open Questions for Genius

- Confirm the 1 GB default and whether a higher configurable limit is actually needed. Raising it also requires reviewing B2 multipart part count, worker disk space, and provider request limits.
- Confirm whether conversion initially covers movies only, or also episodes and trailers. The current converter accepts a movie MKV key; admin uploads also cover episodes and trailers.
- Confirm whether the original source should be retained indefinitely. The safe default is to retain it and never delete it automatically; retention costs must be checked with the provider.
- Confirm how silent videos should be handled, whether variable frame rate/interlaced inputs are supported, and the acceptable duration tolerance after conversion.
- Confirm who may Retry, how long a failed/converting job can remain stuck, and what admin-visible diagnostic detail is safe to expose.
- Confirm worker provider, resource sizing, concurrency, monitoring, and budget approval. CI and worker usage can incur charges; verify on the provider's page before enabling them.
- Confirm whether `runtime_minutes` should be derived from exact `duration_seconds`, and whether the admin needs to display resolution, format, codecs, and the hash.
- B2 overwrite behavior and checksum support must be verified before relying on remote checksums. Keep local SHA-256 plus HEAD content-length verification unless provider support is confirmed.
- The current direct-upload flow can mark a movie published immediately. The conversion rollout must prevent public discovery and signed playback until the normalized output is `ready`, including at the backend route.