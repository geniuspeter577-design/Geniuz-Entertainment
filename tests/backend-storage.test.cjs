const assert = require('node:assert/strict');
const { test } = require('node:test');

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
    }),
    {
      fileName: 'movie.mkv',
      fileSize: 1073741824,
      contentType: 'video/x-matroska',
      objectType: 'movie',
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
    generateObjectKey('episode.mkv', '00000000-0000-4000-8000-000000000004', 'episode'),
    'episodes/00000000-0000-4000-8000-000000000004.mkv',
  );
  assert.throws(
    () => validateUploadInput({ fileName: 'episode.mkv', fileSize: 1024, contentType: 'video/x-matroska', objectType: 'other' }),
    { status: 400 },
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
