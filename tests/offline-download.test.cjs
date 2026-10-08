const assert = require('node:assert/strict');
const { test } = require('node:test');

const { MAX_VIDEO_FILE_SIZE_BYTES } = require('../.test-build/src/constants/video.js');
const { OfflineDownloadService } = require('../.test-build/src/services/OfflineDownloadService.js');
const {
  detectVideoFileType,
  isVideoFormatLikelySupported,
  validateVideoFileSize,
} = require('../.test-build/src/utils/videoFile.js');

function createDownloadService(options = {}) {
  const values = new Map();
  const files = new Map();
  const signedUrls = [];
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value),
  };
  const fileSystem = {
    availableDiskSpace: () => options.availableDiskSpace ?? 4 * 1024 ** 3,
    getFilePath: (item) => `/documents/${item.sourceId}.${item.fileExtension ?? 'mp4'}`,
    createDownloadTask: (url, filePath, downloadOptions) => {
      let finishPausedDownload;
      return {
        downloadAsync: () =>
          new Promise((resolve, reject) => {
          downloadOptions.onProgress({ bytesWritten: 512, totalBytes: 1024 });
          if (options.pauseDownload) {
            finishPausedDownload = resolve;
            return;
          }
          const abort = () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (downloadOptions.signal.aborted) {
            abort();
            return;
          }
          if (options.waitForCancel) {
            downloadOptions.signal.addEventListener('abort', abort, { once: true });
            return;
          }
          if (options.failFirstDownload && options.downloadAttempts++ === 0) {
            reject(new Error('Temporary network error.'));
            return;
          }
          files.set(filePath, 1024);
          resolve({ uri: filePath });
          }),
        pauseAsync: async () => {
          if (!options.pauseDownload || !finishPausedDownload) {
            throw new Error('Download is not pausable.');
          }
          finishPausedDownload(null);
        },
        resumeAsync: async () => {
          files.set(filePath, 1024);
          return { uri: filePath };
        },
      };
    },
    fileExists: (filePath) => files.has(filePath),
    getFileSize: (filePath) => files.get(filePath) ?? null,
    deleteFile: (filePath) => files.delete(filePath),
    getPosterFilePath: (item) => `/documents/${item.sourceId}.poster.jpg`,
    downloadPoster: async (_url, filePath) => files.set(filePath, 128),
  };
  const service = new OfflineDownloadService(storage, fileSystem, async (item) => {
    signedUrls.push(item.id);
    return `https://storage.example.test/${item.sourceId}?signed=true`;
  });

  return { service, files, signedUrls, values };
}

function downloadableItem(overrides = {}) {
  return {
    id: 'geniuz:movie:movie-123',
    source: 'geniuz',
    sourceId: 'movie-123',
    title: 'Offline title',
    type: 'movie',
    genres: [],
    mediaPath: 'movies/movie-123.mkv',
    fileExtension: 'mkv',
    fileSizeBytes: 1024,
    availability: { discoverable: true, stream: true, download: true, premium: false },
    ...overrides,
  };
}

test('video type detection uses extensions when MIME is empty or generic and uses video MIME types', () => {
  for (const [extension, mimeType] of [
    ['mkv', 'video/x-matroska'],
    ['mp4', 'video/mp4'],
    ['mov', 'video/quicktime'],
    ['avi', 'video/x-msvideo'],
    ['webm', 'video/webm'],
    ['m4v', 'video/x-m4v'],
    ['3gp', 'video/3gpp'],
    ['ts', 'video/mp2t'],
    ['flv', 'video/x-flv'],
    ['wmv', 'video/x-ms-wmv'],
  ]) {
    assert.equal(detectVideoFileType(`movie.${extension}`, '').mimeType, mimeType);
  }
  assert.equal(detectVideoFileType('movie.mkv', '').mimeType, 'video/x-matroska');
  assert.equal(detectVideoFileType('movie.mkv', 'application/octet-stream').extension, 'mkv');
  assert.equal(detectVideoFileType('movie', 'video/mp4').extension, 'mp4');
  assert.equal(detectVideoFileType('movie.avi', 'image/jpeg').mimeType, 'video/x-msvideo');
  assert.equal(detectVideoFileType('movie.txt', 'text/plain'), null);
  assert.equal(detectVideoFileType('unknown', 'application/octet-stream'), null);
});

test('playback warns for formats that are not reliably supported on the target device', () => {
  assert.equal(isVideoFormatLikelySupported('mp4', 'android'), true);
  assert.equal(isVideoFormatLikelySupported('mkv', 'android'), false);
  assert.equal(isVideoFormatLikelySupported('mkv', 'ios'), false);
});

test('the 1 GB file limit accepts the boundary and reports the actual oversized file size', () => {
  assert.deepEqual(validateVideoFileSize(MAX_VIDEO_FILE_SIZE_BYTES, MAX_VIDEO_FILE_SIZE_BYTES), {
    valid: true,
  });
  const tooLarge = validateVideoFileSize(MAX_VIDEO_FILE_SIZE_BYTES + 1, MAX_VIDEO_FILE_SIZE_BYTES);
  assert.equal(tooLarge.valid, false);
  assert.match(tooLarge.message, /1\.00 GiB/);
  assert.match(tooLarge.message, /1,073,741,825 bytes/);
  assert.equal(validateVideoFileSize(0, MAX_VIDEO_FILE_SIZE_BYTES).valid, false);
});

test('download service requests a fresh signed URL, reports progress, and persists a completed file', async () => {
  const { service, signedUrls, values } = createDownloadService();
  const progressUpdates = [];
  service.subscribe((records) => {
    const current = records.find((record) => record.item.id === 'geniuz:movie:movie-123');
    if (current) {
      progressUpdates.push(current.progress);
    }
  });

  test('download service saves title metadata and caches its poster for offline details', async () => {
    const { service, files, values } = createDownloadService();
    const item = downloadableItem({
      title: 'Saved title',
      description: 'Saved description',
      posterUrl: 'https://images.example.test/poster.jpg',
    });
    await service.download(item);

    const saved = service.getRecords()[0];
    assert.equal(saved.item.title, 'Saved title');
    assert.equal(saved.item.description, 'Saved description');
    assert.equal(saved.item.posterUrl, '/documents/movie-123.poster.jpg');
    assert.equal(files.get(saved.item.posterUrl), 128);
    assert.match([...values.values()][0], /"description":"Saved description"/);

    await service.load();
    assert.equal(service.getRecords()[0].item.posterUrl, '/documents/movie-123.poster.jpg');

    await service.delete(item.id);
    assert.equal(files.has('/documents/movie-123.poster.jpg'), false);
  });

  await service.download(downloadableItem());

  assert.deepEqual(signedUrls, ['geniuz:movie:movie-123']);
  assert.ok(progressUpdates.includes(50));
  assert.equal(service.getRecords()[0].status, 'downloaded');
  assert.equal(service.getRecords()[0].filePath, '/documents/movie-123.mkv');
  assert.equal(service.getRecords()[0].size, 1024);
  assert.match([...values.values()][0], /"status":"downloaded"/);
});

test('download service checks free space and prevents duplicate active downloads', async () => {
  const insufficient = createDownloadService({ availableDiskSpace: 100 });
  await assert.rejects(insufficient.service.download(downloadableItem()), /not enough free storage/i);

  const pending = createDownloadService({ waitForCancel: true });
  const item = downloadableItem();
  const operation = pending.service.download(item);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(pending.service.download(item), /already downloading/i);
  await pending.service.cancel(item.id);
  await operation;
  assert.equal(pending.service.getRecords()[0].status, 'canceled');
});

test('received files are size-verified, persisted as received, and reject duplicates', async () => {
  const { service, files } = createDownloadService();
  const item = downloadableItem();
  const filePath = '/documents/received-movie.mkv';
  files.set(filePath, 1024);

  await service.registerReceived(item, filePath, 1024);
  assert.deepEqual(
    (({ origin, size, status }) => ({ origin, size, status }))(service.getRecords()[0]),
    { origin: 'received', size: 1024, status: 'downloaded' },
  );
  await service.load();
  assert.equal(service.getRecords()[0].origin, 'received');
  await assert.rejects(
    service.registerReceived(item, filePath, 1024),
    /already saved on this device/i,
  );
  await assert.rejects(
    service.registerReceived(downloadableItem({ id: 'other-title' }), filePath, 2048),
    /could not be verified/i,
  );
});

test('download service pauses and resumes an active download', async () => {
  const { service } = createDownloadService({ pauseDownload: true });
  const item = downloadableItem();
  const operation = service.download(item);
  await new Promise((resolve) => setImmediate(resolve));

  await service.pause(item.id);
  assert.equal(service.getRecords()[0].status, 'paused');

  await service.resume(item.id);
  await operation;
  assert.equal(service.getRecords()[0].status, 'downloaded');
  assert.equal(service.getRecords()[0].size, 1024);
});

test('download service rejects titles that do not permit offline downloads', async () => {
  const { service } = createDownloadService();
  await assert.rejects(
    service.download(
      downloadableItem({
        availability: { discoverable: true, stream: true, download: false, premium: false },
      }),
    ),
    /not enabled/i,
  );
});

test('download service retries a failed network download using a fresh signed URL', async () => {
  const { service, signedUrls } = createDownloadService({
    failFirstDownload: true,
    downloadAttempts: 0,
  });
  const item = downloadableItem();

  await assert.rejects(service.download(item), /download failed/i);
  assert.equal(service.getRecords()[0].status, 'failed');
  await service.download(item);

  assert.equal(service.getRecords()[0].status, 'downloaded');
  assert.equal(signedUrls.length, 2);
});

test('download queues start in order and allow canceling an episode before it starts', async () => {
  const { service, signedUrls } = createDownloadService({ waitForCancel: true });
  const first = downloadableItem({ id: 'episode-1', sourceId: 'episode-1', title: 'Episode 1' });
  const second = downloadableItem({ id: 'episode-2', sourceId: 'episode-2', title: 'Episode 2' });
  const third = downloadableItem({ id: 'episode-3', sourceId: 'episode-3', title: 'Episode 3' });

  const queue = service.downloadSequentially([first, second, third]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signedUrls, ['episode-1']);
  assert.equal(service.getRecords().find((record) => record.item.id === second.id).status, 'queued');

  await service.cancel(second.id);
  await service.cancel(first.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signedUrls, ['episode-1', 'episode-3']);
  await service.cancel(third.id);
  await queue;
  assert.equal(service.getRecords().find((record) => record.item.id === second.id).status, 'canceled');
  assert.equal(service.getRecords().find((record) => record.item.id === third.id).status, 'canceled');
});
