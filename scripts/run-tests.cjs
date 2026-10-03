const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, '.test-build');
const compiler = require.resolve('typescript/bin/tsc');
const sources = [
  'src/models/content.ts',
  'src/data/mockContent.ts',
  'src/repositories/ContentRepository.ts',
  'src/repositories/MockContentRepository.ts',
  'src/repositories/GeniuzContentRepository.ts',
  'src/api/ApiClient.ts',
  'src/services/ContentService.ts',
  'src/constants/video.ts',
  'src/config/features.ts',
  'src/utils/videoFile.ts',
  'src/utils/watchlist.ts',
  'src/utils/adminCatalog.ts',
  'src/utils/adminAccess.ts',
  'src/utils/homeHero.ts',
  'src/utils/playerControls.ts',
  'src/utils/trailerAutoplay.ts',
  'src/utils/uploadSaveRecovery.ts',
  'src/utils/titleImageValidation.ts',
  'src/utils/downloadAvailability.ts',
  'src/utils/networkStatus.ts',
  'src/utils/supabaseError.ts',
  'src/utils/contentError.ts',
  'src/utils/publishedCatalog.ts',
  'src/utils/titleDeletion.ts',
  'src/utils/downloadQueue.ts',
  'src/utils/episodeSelection.ts',
  'src/services/OfflineDownloadService.ts',
  'src/services/TitleCleanupStore.ts',
  'src/services/NotificationsStore.ts',
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

let exitCode = 1;

try {
  exitCode = run(process.execPath, [
    compiler,
    '--ignoreConfig',
    '--outDir',
    outputDirectory,
    '--rootDir',
    projectRoot,
    '--module',
    'Node16',
    '--target',
    'ES2022',
    '--moduleResolution',
    'Node16',
    '--strict',
    '--skipLibCheck',
    ...sources,
  ]);

  if (exitCode === 0) {
    exitCode = run(process.execPath, [
      compiler,
      '-p',
      'backend/tsconfig.json',
      '--outDir',
      path.join(outputDirectory, 'backend'),
      '--rootDir',
      projectRoot,
    ]);
  }

  if (exitCode === 0) {
    exitCode = run(process.execPath, [
      '--test',
      'tests/content.test.cjs',
      'tests/backend.test.cjs',
      'tests/mobile-api.test.cjs',
      'tests/offline-download.test.cjs',
      'tests/backend-storage.test.cjs',
      'tests/detail-features.test.cjs',
      'tests/category-notifications.test.cjs',
    ]);
  }
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
