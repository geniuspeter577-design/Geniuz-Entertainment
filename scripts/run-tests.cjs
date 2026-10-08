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
  'src/repositories/SupabaseMovieRepository.ts',
  'src/api/ApiClient.ts',
  'src/services/ContentService.ts',
  'src/constants/video.ts',
  'src/config/features.ts',
  'src/utils/videoFile.ts',
  'src/utils/conversionStatus.ts',
  'src/utils/watchlist.ts',
  'src/utils/adminCatalog.ts',
  'src/utils/adminAccess.ts',
  'src/utils/confirmAction.ts',
  'src/utils/homeHero.ts',
  'src/utils/playerControls.ts',
  'src/utils/keyboardScroll.ts',
  'src/utils/trailerAutoplay.ts',
  'src/utils/uploadSaveRecovery.ts',
  'src/utils/titleImageValidation.ts',
  'src/utils/downloadAvailability.ts',
  'src/utils/networkStatus.ts',
  'src/utils/supabaseError.ts',
  'src/utils/contentError.ts',
  'src/utils/publishedCatalog.ts',
  'src/constants/categories.ts',
  'src/utils/homeList.ts',
  'src/utils/homeNavigation.ts',
  'src/utils/homeRowShuffle.ts',
  'src/utils/titleDeletion.ts',
  'src/utils/downloadQueue.ts',
  'src/utils/episodeSelection.ts',
  'src/utils/episodePlayback.ts',
  'src/utils/subtitles.ts',
  'src/utils/deviceTransferProtocol.ts',
  'src/utils/playbackError.ts',
  'src/utils/secureStorage.ts',
  'src/utils/accountAuth.ts',
  'src/utils/accountProfile.ts',
  'src/models/profile.ts',
  'src/services/OfflineDownloadService.ts',
  'src/services/TitleCleanupStore.ts',
  'src/services/NotificationsStore.ts',
  'src/services/TrailerAutoplayPreference.ts',
  'src/utils/meScreen.ts',
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
    const testUtilsDirectory = path.join(outputDirectory, 'src', 'utils');
    fs.mkdirSync(testUtilsDirectory, { recursive: true });
    fs.copyFileSync(
      path.join(projectRoot, 'src', 'utils', 'formatFileSize.cjs'),
      path.join(testUtilsDirectory, 'formatFileSize.cjs'),
    );
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
      'tests/playback.test.cjs',
      'tests/account.test.cjs',
      'tests/admin-confirm.test.cjs',
      'tests/offline-download.test.cjs',
      'tests/backend-storage.test.cjs',
      'tests/detail-features.test.cjs',
      'tests/category-notifications.test.cjs',
      'tests/device-transfer.test.cjs',
    ]);
  }
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
