# Manual Movie Conversion Workflow

This workflow lets you ask GitHub Actions to inspect or process one movie. Start with a dry run. A dry run reads the movie row from Supabase and prints the planned source/target keys and status; it does not download or upload video or update the row. Turning **Apply** on downloads and processes the source, uploads the converted file, and updates the movie row.

## Add Repository Secrets

In GitHub, open the repository and go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add one secret for each exact name below. Get each value from the matching Supabase or Backblaze project. Do not paste secret values into workflow logs, issues, or chat.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

The workflow grants itself only `contents: read`, exposes secrets only to the processing step, and does not upload logs or artifacts.

## Run It

1. Open the repository's **Actions** tab.
2. Select **Convert movie** and choose **Run workflow**.
3. Enter the movie row UUID in `movie_id`.
4. Leave `apply` unchecked for the first run. Start it and inspect the printed plan.
5. If the plan is correct, run it again with `apply` checked. Apply mode can use runner minutes and changes the movie row and B2 storage.

The workflow processes only one conversion at a time. Its two-hour timeout is a safety bound, not a promise that every conversion will finish within that time.

## Cost

Private repositories have limited free GitHub Actions minutes. Verify the current included number and any billing implications on GitHub's billing page before running Apply. Do not rely on a number in this document; GitHub's allowance can change.

## If It Fails

- Read the final safe error in the Actions job log. Do not enable shell tracing, print secrets, or attach logs that might contain credentials.
- For a missing-settings error, check that all seven secret names above are present and that their values belong to the same Supabase/Backblaze projects expected by the app.
- For `42501` from Supabase, stop before retrying Apply. The current installed Supabase SDK's REST client may send a new `sb_secret_` key as an Authorization bearer as well as `apikey`; have the maintainer correct that client behavior and verify the live `service_role` table grants first.
- For a missing-column error, confirm the required conversion status and conversion error migrations were applied through the approved database process.
- For an FFmpeg or storage error, check the source row, available runner space, storage permissions, and the provider status. Retry only after correcting the cause. The original source object is not deleted.