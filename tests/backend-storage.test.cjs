const assert = require('node:assert/strict');
const { test } = require('node:test');

let getRemuxVerdict;
let isAllowedOutputPath;
test('media probe classifies remux-compatible codecs and reports subtitles', async () => {
  ({ getRemuxVerdict } = await import('../backend/scripts/probe-media.mjs'));

  const compatible = getRemuxVerdict([
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
    { codec_type: 'subtitle', codec_name: 'subrip' },
  ]);
  assert.equal(compatible.verdict, 'REMUX_OK');
  assert.equal(compatible.subtitles[0].codec_name, 'subrip');

  assert.equal(
    getRemuxVerdict([{ codec_type: 'video', codec_name: 'h264' }]).verdict,
    'REMUX_OK',
  );

  const videoNeedsReencode = getRemuxVerdict([{ codec_type: 'video', codec_name: 'hevc' }]);
  assert.equal(videoNeedsReencode.verdict, 'REENCODE_NEEDED');
  assert.match(videoNeedsReencode.reason, /hevc/);

  const audioNeedsReencode = getRemuxVerdict([
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'ac3' },
  ]);
  assert.equal(audioNeedsReencode.verdict, 'REENCODE_NEEDED');
  assert.match(audioNeedsReencode.reason, /ac3/);
});

test('media download output paths stay under /tmp and reject traversal into the repository', async () => {
  ({ isAllowedOutputPath } = await import('../backend/scripts/download-media.mjs'));
  const repositoryRoot = process.cwd();

  assert.equal(isAllowedOutputPath('/tmp/conversion-tests/movie.mkv', repositoryRoot), true);
  assert.equal(isAllowedOutputPath(`${repositoryRoot}/movie.mkv`, repositoryRoot), false);
  assert.equal(isAllowedOutputPath('/tmp/../workspaces/Geniuz-Entertainment/movie.mkv', repositoryRoot), false);
  assert.equal(isAllowedOutputPath('/tmp/conversion-tests/../../repo/movie.mkv', repositoryRoot), false);
  assert.equal(isAllowedOutputPath('relative/movie.mkv', repositoryRoot), false);
});
const { buildAllowedOrigins } = require('../scripts/b2-cors.cjs');

const {
  requirePublishedOrAdmin,
  requireAdminRole,
} = require('../.test-build/backend/backend/src/http/auth.js');
const {
  generateObjectKey,
  validateCompletedParts,
  validatePartNumbers,
  validateUploadInput,
} = require('../.test-build/backend/backend/src/storage/uploadValidation.js');
const { B2StorageService } = require('../.test-build/backend/backend/src/storage/B2StorageService.js');
const { deleteAdminTitle } = require('../.test-build/backend/backend/src/services/adminTitleDeletion.js');
const {
  collectReferencedMediaKeys,
  deleteListedUnusedMediaFiles,
  findIncompleteMultipartUploads,
  findUnusedMediaFiles,
  scanUnusedMediaFiles,
} = require('../.test-build/backend/backend/src/storage/unusedMediaCleanup.js');

function makeReferenceClient(recordsByTable = {}) {
  return {
    from(table) {
      let start = 0;
      let end = -1;
      const query = {
        select() { return query; },
        order() { return query; },
        range(first, last) {
          start = first;
          end = last;
          return Promise.resolve({
            data: (recordsByTable[table] ?? []).slice(start, end + 1),
            error: null,
          });
        },
      };
      return query;
    },
  };
}

test('unused-media scan keeps movie, draft, image, trailer, episode, and subtitle references', () => {
  const references = collectReferencedMediaKeys([
    { published: true, storage_key: 'movies/published-video.mp4' },
    { published: false, video_path: 'movies/draft-video.mp4', trailer_storage_key: 'trailers/draft-trailer.mp4' },
    { poster_url: 'https://cdn.example.test/file/bucket/movies/draft-poster.webp' },
    { cover_url: 'movies/draft-cover.webp' },
    { storage_key: 'episodes/episode-video.mp4', subtitle_tracks: [{ key: 'subtitles/episode-en.vtt' }] },
  ]);

  assert.deepEqual(
    [...references].sort(),
    [
      'episodes/episode-video.mp4',
      'movies/draft-cover.webp',
      'movies/draft-poster.webp',
      'movies/draft-video.mp4',
      'movies/published-video.mp4',
      'subtitles/episode-en.vtt',
      'trailers/draft-trailer.mp4',
    ],
  );
});

test('unused-media scan excludes referenced, recent, and out-of-scope files', () => {
  const now = Date.parse('2026-10-04T12:00:00.000Z');
  const objects = [
    { key: 'movies/used.mp4', sizeBytes: 200, lastModified: '2026-10-01T00:00:00.000Z' },
    { key: 'movies/orphan.mp4', sizeBytes: 100, lastModified: '2026-10-01T00:00:00.000Z' },
    { key: 'episodes/recent.mp4', sizeBytes: 300, lastModified: '2026-10-04T11:30:00.000Z' },
    { key: 'avatars/user.jpg', sizeBytes: 400, lastModified: '2026-09-01T00:00:00.000Z' },
  ];

  assert.deepEqual(
    findUnusedMediaFiles(objects, new Set(['movies/used.mp4']), now, 24).map(({ key }) => key),
    ['movies/orphan.mp4'],
  );
});

test('B2 playback verifies the object and signs a two-hour GET URL with Range-compatible headers', async () => {
  const storage = new B2StorageService({
    s3Endpoint: 'https://s3.example.test',
    s3Region: 'us-east-1',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    s3Bucket: 'test-bucket',
  });
  const commands = [];
  storage.client.send = async (command) => {
    commands.push(command);
    return {};
  };

  const signedUrl = new URL(await storage.createPlayUrl('movies/00000000-0000-4000-8000-000000000001.mp4'));
  assert.equal(commands[0].constructor.name, 'HeadObjectCommand');
  assert.equal(commands[0].input.Key, 'movies/00000000-0000-4000-8000-000000000001.mp4');
  assert.equal(signedUrl.searchParams.get('X-Amz-Expires'), '7200');
  assert.equal(signedUrl.searchParams.get('X-Amz-SignedHeaders'), 'host');
});

test('B2 playback reports missing storage objects without exposing provider details', async () => {
  const storage = new B2StorageService({
    s3Endpoint: 'https://s3.example.test',
    s3Region: 'us-east-1',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    s3Bucket: 'test-bucket',
  });
  storage.client.send = async () => {
    const error = new Error('provider response must not reach the client');
    error.name = 'NotFound';
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  };

  await assert.rejects(
    storage.createPlayUrl('movies/00000000-0000-4000-8000-000000000001.mp4'),
    (error) => error.status === 404 && error.code === 'PLAYBACK_FILE_NOT_FOUND' && !/provider response/.test(error.message),
  );
});

test('B2 playback gives an actionable error when the backend key cannot read objects', async () => {
  const storage = new B2StorageService({
    s3Endpoint: 'https://s3.example.test',
    s3Region: 'us-east-1',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    s3Bucket: 'test-bucket',
  });
  storage.client.send = async () => {
    const error = new Error('provider response must not reach the client');
    error.name = 'AccessDenied';
    error.$metadata = { httpStatusCode: 403 };
    throw error;
  };

  await assert.rejects(
    storage.createPlayUrl('movies/00000000-0000-4000-8000-000000000001.mp4'),
    (error) =>
      error.status === 502 &&
      error.code === 'B2_READ_ACCESS_DENIED' &&
      /daily download cap/.test(error.message) &&
      /readFiles/.test(error.message) &&
      !/provider response/.test(error.message),
  );
});

test('upload validation enforces names, video content types, and the shared 1 GiB limit', () => {
  assert.deepEqual(
    validateUploadInput({
      fileName: 'movie.mkv',
      fileSize: 1073741824,
      contentType: 'video/x-matroska',
      objectType: 'movie',
      kind: 'video',
    }),
    {
      fileName: 'movie.mkv',
      fileSize: 1073741824,
      contentType: 'video/x-matroska',
      objectType: 'movie',
      kind: 'video',
    },
  );
  for (const input of [
    { fileName: '../movie.mp4', fileSize: 100, contentType: 'video/mp4' },
    { fileName: 'movie.mp4', fileSize: 1073741825, contentType: 'video/mp4' },
    { fileName: 'image.png', fileSize: 100, contentType: 'image/png' },
  ]) {
    assert.throws(() => validateUploadInput(input), { status: 400 });
  }
});

test('admin role check accepts only trusted app_metadata.role values', () => {
  assert.doesNotThrow(() => requireAdminRole({ role: 'admin' }));
  for (const metadata of [undefined, null, {}, { role: 'user' }, { role: ['admin'] }]) {
    assert.throws(() => requireAdminRole(metadata), { status: 403 });
  }
});

test('published movie playback is public while unpublished playback stays admin-only', () => {
  assert.doesNotThrow(() => requirePublishedOrAdmin(true, false));
  assert.doesNotThrow(() => requirePublishedOrAdmin(true, true));
  assert.throws(() => requirePublishedOrAdmin(false, false), { status: 403 });
  assert.doesNotThrow(() => requirePublishedOrAdmin(false, true));
});

test('published episode playback is public while unpublished episodes stay admin-only', () => {
  assert.doesNotThrow(() => requirePublishedOrAdmin(true, false));
  assert.throws(() => requirePublishedOrAdmin(false, false), { status: 403 });
  assert.doesNotThrow(() => requirePublishedOrAdmin(false, true));
});

test('object keys are unique, scoped to movies, and preserve safe extensions', () => {
  const first = generateObjectKey('film.MKV', '00000000-0000-4000-8000-000000000001');
  const second = generateObjectKey('film.MKV', '00000000-0000-4000-8000-000000000002');
  assert.equal(first, 'movies/00000000-0000-4000-8000-000000000001.mkv');
  assert.notEqual(first, second);
  assert.equal(
    generateObjectKey('film.invalid-extensiontoolong', '00000000-0000-4000-8000-000000000003'),
    'movies/00000000-0000-4000-8000-000000000003',
  );
  assert.equal(
    generateObjectKey('trailer.mp4', '00000000-0000-4000-8000-000000000005', 'trailer'),
    'trailers/00000000-0000-4000-8000-000000000005.mp4',
  );
  assert.equal(
    generateObjectKey('episode.mkv', '00000000-0000-4000-8000-000000000004', 'episode'),
    'episodes/00000000-0000-4000-8000-000000000004.mkv',
  );
  assert.throws(
    () => validateUploadInput({ fileName: 'episode.mkv', fileSize: 1024, contentType: 'video/x-matroska', objectType: 'other' }),
    { status: 400 },
  );
});

test('trailer uploads accept kind trailer up to 300 MB while preserving the 1 GiB video limit', () => {
  const input = {
    fileName: 'preview.mp4',
    fileSize: 300 * 1024 * 1024,
    contentType: 'video/mp4',
    kind: 'trailer',
    objectType: 'movie',
  };
  assert.deepEqual(validateUploadInput(input), input);
  assert.throws(
    () => validateUploadInput({ ...input, fileSize: 300 * 1024 * 1024 + 1 }),
    { status: 400 },
  );
  assert.throws(() => validateUploadInput({ ...input, kind: 'unknown' }), { status: 400 });
  assert.equal(
    validateUploadInput({ ...input, kind: 'video', fileSize: 1024 * 1024 * 1024 }).kind,
    'video',
  );
});

test('multipart parts must be unique, in range, contiguous, and carry ETags', () => {
  assert.deepEqual(validatePartNumbers([1, 2], 64), [1, 2]);
  assert.throws(() => validatePartNumbers([1, 1], 64), { status: 400 });
  assert.deepEqual(
    validateCompletedParts(
      [
        { partNumber: 2, etag: '"0123456789abcdef0123456789abcdef"' },
        { partNumber: 1, etag: '"fedcba9876543210fedcba9876543210"' },
      ],
      64,
    ).map((part) => part.PartNumber),
    [1, 2],
  );
  assert.throws(
    () =>
      validateCompletedParts([{ partNumber: 2, etag: '"0123456789abcdef0123456789abcdef"' }], 64),
    { status: 400 },
  );
});

test('incomplete multipart uploads keep only stale, unreferenced managed uploads', () => {
  const now = Date.parse('2026-10-04T12:00:00.000Z');
  const candidates = [
    { key: 'movies/unfinished.mp4', uploadId: 'u-1', initiatedAt: '2026-10-03T10:00:00.000Z', uploadedSizeBytes: 1048576 },
    { key: 'episodes/current.mp4', uploadId: 'u-2', initiatedAt: '2026-10-04T11:30:00.000Z', uploadedSizeBytes: 524288 },
    { key: 'movies/referenced.mp4', uploadId: 'u-3', initiatedAt: '2026-10-01T00:00:00.000Z', uploadedSizeBytes: 2097152 },
    { key: 'avatars/other.jpg', uploadId: 'u-4', initiatedAt: '2026-10-01T00:00:00.000Z', uploadedSizeBytes: 1048576 },
  ];

  assert.deepEqual(
    findIncompleteMultipartUploads(candidates, new Set(['movies/referenced.mp4']), now, 24).map(({ key }) => key),
    ['movies/unfinished.mp4'],
  );
});

test('an admin can delete a draft title after its exact stored file key is removed', async () => {
  const titleId = '00000000-0000-4000-8000-000000000001';
  const events = [];
  const draft = {
    id: titleId,
    title: 'Admin-owned draft',
    published: false,
    content_type: 'movie',
    storage_provider: 'b2',
    storage_key: 'movies/drafts/admin-owned.mp4',
  };
  const client = {
    from(table) {
      let operation = 'select';
      const query = {
        insert() {
          operation = 'insert';
          events.push('audit-start');
          return query;
        },
        select() {
          return query;
        },
        update(values) {
          operation = 'update';
          query.values = values;
          return query;
        },
        delete() {
          operation = 'delete';
          return query;
        },
        eq() {
          return query;
        },
        async single() {
          return { data: { id: 'audit-1' }, error: null };
        },
        async maybeSingle() {
          if (table === 'movies' && operation === 'select') {
            return { data: draft, error: null };
          }
          if (table === 'movies' && operation === 'delete') {
            events.push('database-delete');
            return { data: { id: titleId }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) {
          events.push(`audit-${query.values.result}`);
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  client.storage = {
    from(bucket) {
      return {
        async remove(keys) {
          events.push(`file-delete:${bucket}/${keys[0]}`);
          return { error: null };
        },
      };
    },
  };

  const result = await deleteAdminTitle(
    client,
    {
      async deleteObject(key) {
        events.push(`file-delete:${key}`);
      },
    },
    { supabaseUrl: 'https://supabase.example.test' },
    titleId,
    'admin-user',
  );

  assert.deepEqual(result, {
    deleted: true,
    titleId,
    filesRemoved: ['movies/drafts/admin-owned.mp4'],
  });
  assert.ok(events.indexOf('file-delete:movies/drafts/admin-owned.mp4') < events.indexOf('database-delete'));
  assert.ok(events.includes('audit-success'));
});

test('B2 CORS origin builder combines configured, Codespaces, and localhost origins once', () => {
  const configured = buildAllowedOrigins({
    codespaceName: 'abc123',
    corsOrigin: 'https://app.example.test, http://localhost:8081',
    allowCodespaces: true,
  });
  assert.deepEqual(configured, [
    'https://app.example.test',
    'http://localhost:8081',
    'https://abc123-8081.app.github.dev',
    'http://localhost:19006',
  ]);

  assert.deepEqual(
    buildAllowedOrigins({
      codespaceName: 'abc123',
      corsOrigin: 'https://app.example.test',
      allowCodespaces: false,
    }),
    ['https://app.example.test', 'http://localhost:8081', 'http://localhost:19006'],
  );

  assert.deepEqual(
    buildAllowedOrigins({
      codespaceName: 'abc123',
      corsOrigin: 'https://not-allowed.example.test',
      allowCodespaces: false,
    }),
    ['https://not-allowed.example.test', 'http://localhost:8081', 'http://localhost:19006'],
  );
});
