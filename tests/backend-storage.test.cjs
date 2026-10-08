const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  accumulateSkipSeconds,
  clampPlayerValue,
  getPlayerTapZone,
  getSwipeValue,
} = require('../.test-build/src/utils/playerControls.js');

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

test('player gesture helpers keep tap zones, skip totals, and swipe values bounded', () => {
  assert.equal(getPlayerTapZone(10, 100), 'left');
  assert.equal(getPlayerTapZone(90, 100), 'right');
  assert.equal(getPlayerTapZone(50, 100), 'right');
  assert.equal(getPlayerTapZone(790, 900), 'right');
  assert.equal(getPlayerTapZone(790, 0), 'center');
  assert.equal(accumulateSkipSeconds(10, 10), 20);
  assert.equal(clampPlayerValue(-1), 0);
  assert.equal(clampPlayerValue(2), 1);
  assert.equal(getSwipeValue(0.5, -40, 200), 0.7);
  assert.equal(getSwipeValue(0.2, 400, 200), 0);
});

test('media conversion parser accepts upload-only and other quality flags', async () => {
  const { parseArguments } = await import('../backend/scripts/convert-media.mjs');
  const defaults = parseArguments([
    '--key', 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
  ], {});
  assert.equal(defaults.crf, 30);
  assert.equal(defaults.maxrateKbps, 350);
  assert.equal(defaults.audioKbps, 64);

  const environmentOverride = parseArguments([
    '--key', 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
  ], { VIDEO_MAXRATE_KBPS: '425' });
  assert.equal(environmentOverride.maxrateKbps, 425);

  const parsed = parseArguments([
    '--key', 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
    '--upload-only', '/tmp/convert/f157edce-7fcf-4ab2-a80c-365306fae850.converted.mp4',
    '--crf', '26',
    '--maxrate-kbps', '1500',
    '--audio-kbps', '96',
  ]);

  assert.deepEqual(parsed, {
    key: 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
    input: undefined,
    uploadOnly: '/tmp/convert/f157edce-7fcf-4ab2-a80c-365306fae850.converted.mp4',
    crf: 26,
    maxrateKbps: 1500,
    audioKbps: 96,
    replace: false,
    dryRun: false,
  });
  assert.throws(() => parseArguments(['--upload-only']), /Usage/);

  const replaceOptions = parseArguments([
    '--key', 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
    '--upload-only', '/tmp/convert/f157edce-7fcf-4ab2-a80c-365306fae850.converted.mp4',
    '--replace',
    '--dry-run',
  ]);
  assert.equal(replaceOptions.replace, true);
  assert.equal(replaceOptions.uploadOnly, '/tmp/convert/f157edce-7fcf-4ab2-a80c-365306fae850.converted.mp4');
  assert.equal(replaceOptions.dryRun, true);
  assert.throws(() => parseArguments([
    '--key', 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
    '--replace', '--replace',
  ]), /Usage/);
});

test('dry-run refuses an existing target by default and reports a no-upload replacement plan with --replace', async () => {
  const { buildTargetUploadPlan } = await import('../backend/scripts/convert-media.mjs');
  const key = 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mp4';

  assert.throws(
    () => buildTargetUploadPlan({ key, targetExists: true, replace: false, dryRun: true }),
    { message: 'The converted object key already exists; refusing to overwrite it.' },
  );
  assert.deepEqual(
    buildTargetUploadPlan({ key, targetExists: true, replace: true, dryRun: true }),
    {
      dryRun: true,
      willUpload: false,
      replacementMessage: `REPLACING a live file: ${key}`,
    },
  );
  assert.deepEqual(
    buildTargetUploadPlan({ key, targetExists: false, replace: false, dryRun: false }),
    { dryRun: false, willUpload: true, replacementMessage: undefined },
  );
});

test('upload-only validation requires h264 video, aac audio, and no size increase when source size is known', async () => {
  const { verifyUploadOnlyMedia } = await import('../backend/scripts/convert-media.mjs');
  const validProbe = {
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  };

  assert.deepEqual(
    verifyUploadOnlyMedia({ outputProbe: validProbe, outputSize: 900, sourceSize: 1000 }),
    { valid: true },
  );
  assert.match(
    verifyUploadOnlyMedia({
      outputProbe: validProbe,
      outputSize: 1001,
      sourceSize: 1000,
    }).reason,
    /larger than the source MKV/,
  );
  assert.match(
    verifyUploadOnlyMedia({
      outputProbe: { streams: [{ codec_type: 'video', codec_name: 'hevc' }, ...validProbe.streams.slice(1)] },
      outputSize: 900,
    }).reason,
    /video stream is not h264/,
  );
  assert.match(
    verifyUploadOnlyMedia({
      outputProbe: { streams: [validProbe.streams[0]] },
      outputSize: 900,
    }).reason,
    /audio stream is not aac/,
  );
});

test('media conversion upload params omit conditional headers unsupported by Backblaze', async () => {
  const { buildUploadObjectParams } = await import('../backend/scripts/convert-media.mjs');
  const params = buildUploadObjectParams({
    bucket: 'demo-bucket',
    key: 'movies/123e4567-e89b-12d3-a456-426614174000.mp4',
    body: Buffer.from('abc'),
    contentLength: 3,
  });

  assert.equal(params.ContentType, 'video/mp4');
  assert.equal(params.ContentLength, 3);
  assert.equal('IfNoneMatch' in params, false);
  assert.equal(params.IfNoneMatch, undefined);
});

test('media conversion derives a new UUID key and selects copy or re-encode arguments', async () => {
  const { buildFfmpegArgs, getConvertedObjectKey } = await import('../backend/scripts/convert-media.mjs');
  const oldKey = 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv';
  const newKey = 'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mp4';

  assert.equal(getConvertedObjectKey(oldKey), newKey);
  assert.throws(() => getConvertedObjectKey('../movies/not-a-uuid.mkv'), /movie MKV/);

  const remuxArgs = buildFfmpegArgs('/tmp/convert/input.mkv', '/tmp/convert/output.mp4', [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ]);
  assert.deepEqual(remuxArgs.slice(remuxArgs.indexOf('-c'), remuxArgs.indexOf('-sn')), ['-c', 'copy']);
  assert.ok(remuxArgs.includes('-map_chapters'));

  const scaledReencodeArgs = buildFfmpegArgs('/tmp/convert/input.mkv', '/tmp/convert/output.mp4', [
    { codec_type: 'video', codec_name: 'hevc', height: 720 },
    { codec_type: 'audio', codec_name: 'aac' },
  ]);
  assert.ok(scaledReencodeArgs.includes('libx264'));
  assert.deepEqual(
    scaledReencodeArgs.slice(scaledReencodeArgs.indexOf('-crf'), scaledReencodeArgs.indexOf('-pix_fmt')),
    ['-crf', '30', '-maxrate', '350k', '-bufsize', '700k'],
  );
  assert.deepEqual(
    scaledReencodeArgs.slice(scaledReencodeArgs.indexOf('-vf'), scaledReencodeArgs.indexOf('-c:a')),
    ['-vf', 'scale=-2:480'],
  );
  assert.deepEqual(
    scaledReencodeArgs.slice(scaledReencodeArgs.indexOf('-c:a'), scaledReencodeArgs.indexOf('-sn')),
    ['-c:a', 'aac', '-b:a', '64k', '-ac', '2'],
  );

  const noScaleWhenSmallArgs = buildFfmpegArgs('/tmp/convert/input.mkv', '/tmp/convert/output.mp4', [
    { codec_type: 'video', codec_name: 'hevc', height: 480 },
    { codec_type: 'audio', codec_name: 'aac' },
  ]);
  assert.ok(!noScaleWhenSmallArgs.includes('-vf'));

  const audioReencodeArgs = buildFfmpegArgs('/tmp/convert/input.mkv', '/tmp/convert/output.mp4', [
    { codec_type: 'video', codec_name: 'hevc', height: 1080 },
    { codec_type: 'audio', codec_name: 'ac3' },
  ]);
  assert.deepEqual(
    audioReencodeArgs.slice(audioReencodeArgs.indexOf('-c:a'), audioReencodeArgs.indexOf('-sn')),
    ['-c:a', 'aac', '-b:a', '64k', '-ac', '2'],
  );
  const qualityOverrideArgs = buildFfmpegArgs(
    '/tmp/convert/input.mkv',
    '/tmp/convert/output.mp4',
    [{ codec_type: 'video', codec_name: 'hevc', height: 1080 }],
    { crf: 24, maxrateKbps: 1200, audioKbps: 96 },
  );
  assert.deepEqual(
    qualityOverrideArgs.slice(qualityOverrideArgs.indexOf('-crf'), qualityOverrideArgs.indexOf('-pix_fmt')),
    ['-crf', '24', '-maxrate', '1200k', '-bufsize', '2400k'],
  );
  assert.deepEqual(
    qualityOverrideArgs.slice(qualityOverrideArgs.indexOf('-c:a'), qualityOverrideArgs.indexOf('-sn')),
    ['-c:a', 'aac', '-b:a', '96k', '-ac', '2'],
  );
});

test('media conversion prints a reviewable SQL update using the real movie size column', async () => {
  const { buildDatabaseUpdateSql } = await import('../backend/scripts/convert-media.mjs');
  const sql = buildDatabaseUpdateSql(
    'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mkv',
    'movies/f157edce-7fcf-4ab2-a80c-365306fae850.mp4',
    1234567,
  );

  assert.match(sql, /SELECT id,/);
  assert.match(sql, /storage_key AS old_storage_key/);
  assert.match(sql, /file_extension AS old_file_extension/);
  assert.match(sql, /mime_type AS old_mime_type/);
  assert.match(sql, /file_size_bytes AS old_file_size_bytes/);
  assert.match(sql, /UPDATE public\.movies/);
  assert.match(sql, /file_size_bytes = 1234567/);
  assert.match(sql, /RETURNING id, storage_key, file_extension, mime_type, file_size_bytes/);
  assert.throws(
    () => buildDatabaseUpdateSql('movies/invalid.mkv', 'movies/invalid.mp4', 123),
    /movie MKV/,
  );
});

test('file-size formatting uses one binary-unit helper across application and scripts', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1024), '1 KiB');
  assert.equal(formatFileSize(1024 ** 2), '1.0 MiB');
  assert.equal(formatFileSize(1024 ** 3), '1.00 GiB');
});

test('media conversion warns only when output exceeds source size', async () => {
  const { shouldWarnOutputIsLarger } = await import('../backend/scripts/convert-media.mjs');
  assert.equal(shouldWarnOutputIsLarger(1000, 1001), true);
  assert.equal(shouldWarnOutputIsLarger(1000, 1000), false);
  assert.equal(shouldWarnOutputIsLarger(1000, 999), false);
});

test('media conversion verification enforces codecs, duration tolerance, and non-empty output', async () => {
  const { verifyConvertedMedia } = await import('../backend/scripts/convert-media.mjs');
  const validProbe = {
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
    format: { duration: '100.5' },
  };
  assert.equal(
    verifyConvertedMedia({
      sourceDuration: 100,
      sourceStreams: validProbe.streams,
      outputProbe: validProbe,
      outputSize: 1024,
    }).valid,
    true,
  );
  assert.equal(verifyConvertedMedia({ sourceDuration: 100, outputProbe: validProbe, outputSize: 0 }).valid, false);
  assert.equal(
    verifyConvertedMedia({
      sourceDuration: 100,
      sourceStreams: validProbe.streams,
      outputProbe: { ...validProbe, streams: [{ codec_type: 'video', codec_name: 'hevc' }] },
      outputSize: 1024,
    }).valid,
    false,
  );
  assert.equal(
    verifyConvertedMedia({
      sourceDuration: 100,
      sourceStreams: validProbe.streams,
      outputProbe: { ...validProbe, format: { duration: '102.01' } },
      outputSize: 1024,
    }).valid,
    false,
  );
  assert.equal(
    verifyConvertedMedia({
      sourceDuration: 100,
      sourceStreams: validProbe.streams,
      outputProbe: { ...validProbe, streams: [{ codec_type: 'video', codec_name: 'h264' }] },
      outputSize: 1024,
    }).valid,
    false,
  );
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
const {
  B2StorageService,
  redactB2LogValue,
} = require('../.test-build/backend/backend/src/storage/B2StorageService.js');
const { formatFileSize } = require('../.test-build/src/utils/formatFileSize.cjs');
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

  const signedUrl = new URL(await storage.createPlayUrl(
    'movies/00000000-0000-4000-8000-000000000001.mp4',
    { routeKind: 'movie', contentId: '00000000-0000-4000-8000-000000000001' },
  ));
  assert.equal(commands[0].constructor.name, 'HeadObjectCommand');
  assert.equal(commands[0].input.Key, 'movies/00000000-0000-4000-8000-000000000001.mp4');
  assert.equal(signedUrl.searchParams.get('X-Amz-Expires'), '7200');
  assert.equal(signedUrl.searchParams.get('X-Amz-SignedHeaders'), 'host');
});

test('B2 playback logs missing storage objects and preserves the client error', async () => {
  const storage = new B2StorageService({
    s3Endpoint: 'https://s3.example.test',
    s3Region: 'us-east-1',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    s3Bucket: 'test-bucket',
  });
  storage.client.send = async () => {
    const error = new Error('provider response for movies/private-key.mp4 must not reach the client');
    error.name = 'NotFound';
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  };

  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await assert.rejects(
      storage.createPlayUrl('movies/private-key.mp4', { routeKind: 'episode', contentId: 'episode-id' }),
      (error) => error.status === 404 && error.code === 'PLAYBACK_FILE_NOT_FOUND' && !/provider response/.test(error.message),
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"routeKind":"episode"/);
  assert.match(logs[0], /"contentId":"episode-id"/);
  assert.doesNotMatch(logs[0], /private-key/);
  assert.match(logs[0], /"httpStatusCode":404/);
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
    const error = new Error('provider response for movies/private-key.mp4 must not reach the client');
    error.name = 'AccessDenied';
    error.Code = 'AccessDenied';
    error.$metadata = { httpStatusCode: 403 };
    throw error;
  };

  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await assert.rejects(
      storage.createPlayUrl('movies/private-key.mp4', { routeKind: 'movie', contentId: 'movie-id' }),
      (error) =>
        error.status === 502 &&
        error.code === 'B2_READ_ACCESS_DENIED' &&
        /daily download cap/.test(error.message) &&
        /readFiles/.test(error.message) &&
        !/provider response/.test(error.message),
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"routeKind":"movie"/);
  assert.match(logs[0], /"contentId":"movie-id"/);
  assert.match(logs[0], /"s3ErrorName":"AccessDenied"/);
  assert.match(logs[0], /"s3Code":"AccessDenied"/);
  assert.match(logs[0], /"httpStatusCode":403/);
  assert.doesNotMatch(logs[0], /private-key/);
});

test('B2 playback logs sanitized provider details and preserves timeout mapping', async () => {
  const storage = new B2StorageService({
    s3Endpoint: 'https://s3.example.test',
    s3Region: 'us-east-1',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    s3Bucket: 'test-bucket',
  });
  storage.client.send = async () => {
    const error = new Error('timeout for movies/private-key.mp4 https://s3.example.test/path?X-Amz-Signature=secret test-key test-secret');
    error.name = 'TimeoutError';
    error.Code = 'RequestTimeout';
    error.$metadata = {
      httpStatusCode: 408,
      requestId: 'request-id',
      extendedRequestId: 'extended-request-id',
    };
    throw error;
  };

  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await assert.rejects(
      storage.createTrailerPlayUrl('trailers/00000000-0000-4000-8000-000000000003.mp4', 'title-id'),
      (error) => error.status === 502 && error.code === 'B2_PLAYBACK_CHECK_FAILED',
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"routeKind":"trailer"/);
  assert.match(logs[0], /"s3Code":"RequestTimeout"/);
  assert.match(logs[0], /"requestId":"request-id"/);
  assert.match(logs[0], /"extendedRequestId":"extended-request-id"/);
  assert.doesNotMatch(logs[0], /private-key|test-key|test-secret|X-Amz-Signature|s3\.example\.test/);
});

test('B2 log redaction removes credential-shaped values, URLs, and query strings', () => {
  const redacted = redactB2LogValue(
    'id=AKIA1234567890ABCDEF b2=0012345678901234567890123 secret=test-secret url=https://host.test/file?token=private',
    ['test-secret'],
  );
  assert.doesNotMatch(redacted, /AKIA1234567890ABCDEF|0012345678901234567890123|test-secret|host\.test|token=private/);
  assert.match(redacted, /REDACTED_ACCESS_KEY_ID/);
  assert.match(redacted, /REDACTED_URL/);
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
