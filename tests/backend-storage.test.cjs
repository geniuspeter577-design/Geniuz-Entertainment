const assert = require('node:assert/strict');
const { test } = require('node:test');
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

test('B2 CORS origin builder combines configured, Codespaces, and localhost origins once', () => {
  assert.deepEqual(
    buildAllowedOrigins({
      codespaceName: 'fictional-space-waffle-vprqq96jxjgq24vv',
      corsOrigin: ' https://admin.example.test/ , http://localhost:8081, https://admin.example.test ',
    }),
    [
      'https://admin.example.test',
      'http://localhost:8081',
      'https://fictional-space-waffle-vprqq96jxjgq24vv-8081.app.github.dev',
      'http://localhost:19006',
    ],
  );
});
