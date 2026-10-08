import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { downloadObjectToFile, isAllowedOutputPath } from './download-media.mjs';
import { formatFileSize } from '../../src/utils/formatFileSize.cjs';

const require = createRequire(import.meta.url);
export const videoConversionProfile = require('../src/config/videoConversionProfile.json');
export { formatFileSize };
const execFileAsync = promisify(execFile);
const REQUIRED_S3_SETTINGS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONVERSION_DIRECTORY = '/tmp/convert';
const USAGE = `Usage: npm --prefix backend run media:convert -- --key <movies/<uuid>.mkv> [--input <local_path>] [--upload-only </tmp/convert/<uuid>.converted.mp4>] [--crf <0-51>] [--maxrate-kbps <positive_integer>] [--audio-kbps <positive_integer>] [--replace] [--dry-run] [--help]
Defaults: --crf ${videoConversionProfile.crf}, --maxrate-kbps ${videoConversionProfile.VIDEO_MAXRATE_KBPS} kb/s (overridden by VIDEO_MAXRATE_KBPS when set), --audio-kbps ${videoConversionProfile.audioKbps} kb/s AAC stereo, buffer ${videoConversionProfile.bufferMultiplier}x maxrate, scale down to ${videoConversionProfile.scaleHeight}p only.`;

class ConversionError extends Error {}

export function getVideoMaxrateKbps(environment = process.env) {
  const configuredMaxrate = environment.VIDEO_MAXRATE_KBPS?.trim();
  return configuredMaxrate ? Number(configuredMaxrate) : videoConversionProfile.VIDEO_MAXRATE_KBPS;
}

// This script only reads the old Backblaze object and creates a new object; it never changes the database or deletes remote data.
export function getConvertedObjectKey(oldKey) {
  const match = /^movies\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.mkv$/i.exec(
    typeof oldKey === 'string' ? oldKey : '',
  );
  if (!match) {
    throw new ConversionError('The key must be a movie MKV object named movies/<uuid>.mkv.');
  }
  return `movies/${match[1]}.mp4`;
}

export function buildDatabaseUpdateSql(oldKey, newKey, fileSizeBytes) {
  const expectedNewKey = getConvertedObjectKey(oldKey);
  const movieId = oldKey.slice('movies/'.length, -'.mkv'.length);
  if (newKey !== expectedNewKey) {
    throw new ConversionError('The new key does not match the source movie key.');
  }
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new ConversionError('The uploaded file size must be a positive safe integer.');
  }

  return [
    '-- Run the SELECT first and save its old_* values before applying the UPDATE.',
    'SELECT id,',
    '       storage_key AS old_storage_key,',
    '       file_extension AS old_file_extension,',
    '       mime_type AS old_mime_type,',
    '       file_size_bytes AS old_file_size_bytes',
    'FROM public.movies',
    `WHERE id = '${movieId}'::uuid;`,
    '',
    'UPDATE public.movies',
    `SET storage_key = '${newKey}',`,
    "    file_extension = 'mp4',",
    "    mime_type = 'video/mp4',",
    `    file_size_bytes = ${fileSizeBytes}`,
    `WHERE id = '${movieId}'::uuid`,
    'RETURNING id, storage_key, file_extension, mime_type, file_size_bytes;',
  ].join('\n');
}

export function buildFfmpegArgs(
  sourcePath,
  outputPath,
  streams,
  {
    crf = videoConversionProfile.crf,
    maxrateKbps = getVideoMaxrateKbps(),
    audioKbps = videoConversionProfile.audioKbps,
    forceReencode = false,
  } = {},
) {
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  if (videoStreams.length === 0) {
    throw new ConversionError('The source has no video stream.');
  }

  const sourceHeight = videoStreams.reduce((maxHeight, stream) => {
    const height = Number.isFinite(stream.height) ? stream.height : 0;
    return Math.max(maxHeight, height);
  }, 0);
  const shouldScaleVideo = sourceHeight > videoConversionProfile.scaleHeight;

  const canRemux =
    !forceReencode &&
    videoStreams.every((stream) => stream.codec_name === 'h264') &&
    audioStreams.every((stream) => stream.codec_name === 'aac');
  const args = ['-nostdin', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0?'];
  if (canRemux) {
    args.push('-c', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
      '-maxrate', `${maxrateKbps}k`,
      '-bufsize', `${maxrateKbps * videoConversionProfile.bufferMultiplier}k`,
      '-pix_fmt', 'yuv420p',
    );
    if (shouldScaleVideo) {
      args.push('-vf', `scale=-2:${videoConversionProfile.scaleHeight}`);
    }
    args.push('-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '2');
  }
  args.push('-sn', '-dn', '-map_chapters', '-1', '-movflags', '+faststart', '-n', outputPath);
  return args;
}

export function shouldWarnOutputIsLarger(sourceSize, outputSize) {
  return outputSize > sourceSize;
}

export function verifyConvertedMedia({ sourceDuration, sourceStreams = [], outputProbe, outputSize }) {
  if (!Number.isFinite(outputSize) || outputSize <= 0) {
    return { valid: false, reason: 'The output file is empty.' };
  }

  const streams = Array.isArray(outputProbe?.streams) ? outputProbe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const sourceHasAudio = sourceStreams.some((stream) => stream.codec_type === 'audio');
  if (videoStreams.length === 0 || videoStreams.some((stream) => stream.codec_name !== 'h264')) {
    return { valid: false, reason: 'The output video stream is not h264.' };
  }
  if (
    (sourceHasAudio && audioStreams.length === 0) ||
    audioStreams.some((stream) => stream.codec_name !== 'aac')
  ) {
    return { valid: false, reason: 'The output audio stream is not aac.' };
  }

  const convertedDuration = Number(outputProbe?.format?.duration);
  if (
    !Number.isFinite(sourceDuration) ||
    !Number.isFinite(convertedDuration) ||
    Math.abs(convertedDuration - sourceDuration) > 2
  ) {
    return { valid: false, reason: 'The output duration differs from the source by more than 2 seconds.' };
  }
  return { valid: true };
}

export function verifyUploadOnlyMedia({ outputProbe, outputSize, sourceSize }) {
  if (!Number.isSafeInteger(outputSize) || outputSize <= 0) {
    return { valid: false, reason: 'The upload-only file is empty or unreadable.' };
  }
  const streams = Array.isArray(outputProbe?.streams) ? outputProbe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  if (videoStreams.length === 0 || videoStreams.some((stream) => stream.codec_name !== 'h264')) {
    return { valid: false, reason: 'The upload-only video stream is not h264.' };
  }
  if (audioStreams.length === 0 || audioStreams.some((stream) => stream.codec_name !== 'aac')) {
    return { valid: false, reason: 'The upload-only audio stream is not aac.' };
  }
  if (Number.isSafeInteger(sourceSize) && shouldWarnOutputIsLarger(sourceSize, outputSize)) {
    return { valid: false, reason: 'The upload-only file is larger than the source MKV.' };
  }
  return { valid: true };
}

export function buildTargetUploadPlan({ key, targetExists, replace, dryRun }) {
  if (targetExists && !replace) {
    throw new ConversionError('The converted object key already exists; refusing to overwrite it.');
  }
  return {
    dryRun,
    willUpload: !dryRun,
    replacementMessage: targetExists && replace ? `REPLACING a live file: ${key}` : undefined,
  };
}

export function parseArguments(args, environment = process.env) {
  const options = new Map();
  let dryRun = false;
  let replace = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      if (dryRun) {
        throw new Error(USAGE);
      }
      dryRun = true;
      continue;
    }
    if (argument === '--replace') {
      if (replace) {
        throw new Error(USAGE);
      }
      replace = true;
      continue;
    }
    if (!['--key', '--input', '--upload-only', '--crf', '--maxrate-kbps', '--audio-kbps'].includes(argument) || options.has(argument) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(USAGE);
    }
    options.set(argument, args[index + 1]);
    index += 1;
  }

  const key = options.get('--key');
  if (!key) {
    throw new Error(USAGE);
  }
  const crf = options.has('--crf') ? Number(options.get('--crf')) : videoConversionProfile.crf;
  const maxrateKbps = options.has('--maxrate-kbps')
    ? Number(options.get('--maxrate-kbps'))
    : getVideoMaxrateKbps(environment);
  const audioKbps = options.has('--audio-kbps')
    ? Number(options.get('--audio-kbps'))
    : videoConversionProfile.audioKbps;
  if (!Number.isInteger(crf) || crf < 0 || crf > 51 || !Number.isSafeInteger(maxrateKbps) || maxrateKbps <= 0 || !Number.isSafeInteger(audioKbps) || audioKbps <= 0) {
    throw new Error(USAGE);
  }
  return { key, input: options.get('--input'), uploadOnly: options.get('--upload-only'), crf, maxrateKbps, audioKbps, replace, dryRun };
}

export function buildUploadObjectParams({ bucket, key, body, contentLength }) {
  return {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: 'video/mp4',
  };
}

function isMissingObjectError(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.Code === 'NotFound' ||
    error?.Code === 'NoSuchKey'
  );
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isMissingObjectError(error)) {
      return false;
    }
    throw new ConversionError('Could not confirm the new object key is unused.');
  }
}

async function getObjectSizeIfPresent(client, bucket, key) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return Number.isSafeInteger(head.ContentLength) && head.ContentLength >= 0
      ? head.ContentLength
      : undefined;
  } catch (error) {
    if (isMissingObjectError(error)) {
      return undefined;
    }
    throw new ConversionError('Could not verify the source MKV size for upload-only validation.');
  }
}

async function prepareConversionDirectory(create) {
  const temporaryRoot = await realpath('/tmp');
  const expectedDirectory = path.join(temporaryRoot, 'convert');
  try {
    const existingDirectory = await lstat(CONVERSION_DIRECTORY);
    if (!existingDirectory.isDirectory() || existingDirectory.isSymbolicLink()) {
      throw new ConversionError('The conversion directory must be a real directory under /tmp.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' || !create) {
      if (error?.code === 'ENOENT' && !create) {
        return expectedDirectory;
      }
      throw error;
    }
    await mkdir(CONVERSION_DIRECTORY, { mode: 0o700 });
  }
  const actualDirectory = await realpath(CONVERSION_DIRECTORY);
  if (
    actualDirectory !== expectedDirectory ||
    !isAllowedOutputPath(path.join(actualDirectory, 'validation.tmp'), REPOSITORY_ROOT, temporaryRoot)
  ) {
    throw new ConversionError('The conversion directory must resolve to /tmp/convert.');
  }
  return actualDirectory;
}

function formatCommand(command, args) {
  return [command, ...args]
    .map((argument) => `'${String(argument).replaceAll("'", "'\\''")}'`)
    .join(' ');
}

export async function probe(input) {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,width,height:format=duration,size', '-of', 'json', input],
      { maxBuffer: 1024 * 1024 },
    );
    const result = JSON.parse(stdout);
    return {
      streams: Array.isArray(result.streams) ? result.streams : [],
      format: result.format ?? {},
    };
  } catch {
    throw new ConversionError('ffprobe could not read the media streams.');
  }
}

async function resolveLocalInput(inputPath) {
  if (!isAllowedOutputPath(inputPath, REPOSITORY_ROOT)) {
    throw new ConversionError('Input path must be an absolute path inside /tmp and outside the repository.');
  }
  let resolvedPath;
  let details;
  try {
    resolvedPath = await realpath(inputPath);
    if (!isAllowedOutputPath(resolvedPath, REPOSITORY_ROOT)) {
      throw new ConversionError('Input path must resolve inside /tmp and outside the repository.');
    }
    details = await stat(resolvedPath);
  } catch (error) {
    if (error instanceof ConversionError) {
      throw error;
    }
    throw new ConversionError('The local input file could not be read.');
  }
  if (!details.isFile()) {
    throw new ConversionError('The local input path must be a readable file.');
  }
  return { path: resolvedPath, size: details.size };
}

async function runConversion(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(USAGE);
    return;
  }

  let options;
  let newKey;
  try {
    options = parseArguments(args);
    newKey = getConvertedObjectKey(options.key);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const missing = REQUIRED_S3_SETTINGS.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error(`Missing required settings: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  let conversionDirectory;
  try {
    conversionDirectory = await prepareConversionDirectory(!options.dryRun);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const downloadedInputPath = path.join(conversionDirectory, `${randomUUID()}.mkv`);
  let inputPath = downloadedInputPath;
  const outputPath = path.join(conversionDirectory, `${randomUUID()}.mp4`);
  if (
    !isAllowedOutputPath(downloadedInputPath, REPOSITORY_ROOT) ||
    !isAllowedOutputPath(outputPath, REPOSITORY_ROOT) ||
    !downloadedInputPath.startsWith(`${conversionDirectory}${path.sep}`) ||
    !outputPath.startsWith(`${conversionDirectory}${path.sep}`)
  ) {
    console.error('Temporary conversion paths must remain inside /tmp/convert.');
    process.exitCode = 1;
    return;
  }

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  let stableConvertedPath = null;

  try {
    const targetExistsInitially = await objectExists(client, process.env.S3_BUCKET, newKey);
    const initialPlan = buildTargetUploadPlan({
      key: newKey,
      targetExists: targetExistsInitially,
      replace: options.replace,
      dryRun: options.dryRun,
    });
    if (options.dryRun && initialPlan.replacementMessage) {
      console.log(initialPlan.replacementMessage);
    }
    let sourceProbe;
    let sourceSize;
    if (options.uploadOnly) {
      const uploadOnlyPath = await resolveLocalInput(options.uploadOnly);
      stableConvertedPath = uploadOnlyPath.path;
      if (!stableConvertedPath.startsWith(`${conversionDirectory}${path.sep}`)) {
        throw new ConversionError('Upload-only files must remain inside /tmp/convert.');
      }
      if (uploadOnlyPath.size <= 0) {
        throw new ConversionError('The upload-only file is empty.');
      }
      sourceSize = await getObjectSizeIfPresent(client, process.env.S3_BUCKET, options.key);
      sourceProbe = await probe(stableConvertedPath);
      const verification = verifyUploadOnlyMedia({
        outputProbe: sourceProbe,
        outputSize: uploadOnlyPath.size,
        sourceSize,
      });
      if (!verification.valid) {
        throw new ConversionError(`Upload-only file verification failed: ${verification.reason}`);
      }
      console.log(`Upload-only file verified: ${formatFileSize(uploadOnlyPath.size)}; video h264, audio aac.`);
    } else if (options.input) {
      const localInput = await resolveLocalInput(options.input);
      inputPath = localInput.path;
      const head = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: options.key }));
      if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength < 0) {
        throw new ConversionError('The source object did not provide a valid size.');
      }
      if (localInput.size !== head.ContentLength) {
        throw new ConversionError(`Local input size mismatch: source object is ${formatFileSize(head.ContentLength)}; local file is ${formatFileSize(localInput.size)}.`);
      }
      sourceSize = localInput.size;
      sourceProbe = await probe(inputPath);
      console.log(`Local input size verified against source HEAD: ${formatFileSize(sourceSize)}.`);
    } else if (options.dryRun) {
      const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: options.key });
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const signedUrl = await getSignedUrl(client, command, { expiresIn: 10 * 60 });
      sourceProbe = await probe(signedUrl);
    } else {
      const downloadResult = await downloadObjectToFile(
        client,
        process.env.S3_BUCKET,
        options.key,
        downloadedInputPath,
        (done, total) => {
          process.stdout.write(`\rDownloading ${formatFileSize(done)} / ${formatFileSize(total)}`);
        },
      );
      process.stdout.write('\n');
      sourceSize = downloadResult.sizeBytes;
      console.log(`Source download size verified: ${formatFileSize(sourceSize)}.`);
      sourceProbe = await probe(inputPath);
    }

    if (!options.uploadOnly) {
      const sourceDuration = Number(sourceProbe.format.duration);
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
        throw new ConversionError('The source duration could not be determined.');
      }
      const ffmpegArgs = buildFfmpegArgs(inputPath, outputPath, sourceProbe.streams, options);

      if (options.dryRun) {
        console.log(`New key: ${newKey}`);
        console.log(`FFmpeg command: ${formatCommand('ffmpeg', ffmpegArgs)}`);
        return;
      }

      try {
        await execFileAsync('ffmpeg', ffmpegArgs, { maxBuffer: 1024 * 1024 });
      } catch {
        throw new ConversionError('ffmpeg conversion failed.');
      }
      const { size: outputSize } = await stat(outputPath);
      if (Number.isFinite(sourceSize) && shouldWarnOutputIsLarger(sourceSize, outputSize)) {
        console.error(`WARNING: Converted output is larger than the source; refusing upload. Source: ${formatFileSize(sourceSize)}; output: ${formatFileSize(outputSize)}.`);
        process.exitCode = 1;
        return;
      }
      const outputProbe = await probe(outputPath);
      const verification = verifyConvertedMedia({
        sourceDuration,
        sourceStreams: sourceProbe.streams,
        outputProbe,
        outputSize,
      });
      if (!verification.valid) {
        await unlink(outputPath);
        throw new ConversionError(`Converted output verification failed: ${verification.reason}`);
      }

      stableConvertedPath = path.join(conversionDirectory, `${randomUUID()}.converted.mp4`);
      await rename(outputPath, stableConvertedPath);
      console.log(`Converted file preserved at: ${stableConvertedPath}`);
    }

    const uploadSource = stableConvertedPath ?? outputPath;
    const { size: uploadSize } = await stat(uploadSource);
    if (!Number.isSafeInteger(uploadSize) || uploadSize <= 0) {
      throw new ConversionError('The converted media is empty or unreadable.');
    }

    if (options.dryRun) {
      console.log(`New key: ${newKey}`);
      console.log('Dry run: no files were written and no upload was performed.');
      return;
    }

    const targetExistsBeforeUpload = await objectExists(client, process.env.S3_BUCKET, newKey);
    const uploadPlan = buildTargetUploadPlan({
      key: newKey,
      targetExists: targetExistsBeforeUpload,
      replace: options.replace,
      dryRun: false,
    });
    if (uploadPlan.replacementMessage) {
      console.log(uploadPlan.replacementMessage);
    }
    try {
      await client.send(
        new PutObjectCommand(buildUploadObjectParams({
          bucket: process.env.S3_BUCKET,
          key: newKey,
          body: createReadStream(uploadSource, { highWaterMark: 1024 * 1024 }),
          contentLength: uploadSize,
        })),
      );
    } catch (error) {
      if (
        error?.$metadata?.httpStatusCode === 412 ||
        error?.$metadata?.httpStatusCode === 409 ||
        error?.name === 'PreconditionFailed' ||
        error?.name === 'ConditionalRequestConflict'
      ) {
        throw new ConversionError('The converted object key already exists; refusing to overwrite it.');
      }
      console.error(
        `Upload failed: name=${error?.name ?? 'unknown'} httpStatus=${error?.$metadata?.httpStatusCode ?? 'unknown'} message=${error?.message ?? 'unknown'}`,
      );
      if (uploadSource) {
        console.error(`Converted file preserved at: ${uploadSource}`);
      }
      throw new ConversionError('Upload to the new object key failed.');
    }
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: newKey }));
    } catch {
      throw new ConversionError('The new object was uploaded, but its size could not be verified.');
    }
    if (head.ContentLength !== uploadSize) {
      throw new ConversionError('Uploaded object size mismatch during HEAD verification.');
    }

    console.log(`New key: ${newKey}`);
    console.log(`New size: ${formatFileSize(uploadSize)}`);
    if (!options.uploadOnly) {
      const convertedProbe = await probe(stableConvertedPath);
      const convertedDuration = Number(convertedProbe.format.duration);
      console.log(`Duration: ${Number.isFinite(convertedDuration) ? convertedDuration.toFixed(3) : 'unknown'} seconds`);
    }
    console.log('Manual SQL for review (not executed):');
    console.log(buildDatabaseUpdateSql(options.key, newKey, uploadSize));
  } catch (error) {
    console.error(
      error instanceof ConversionError
        ? error.message
        : 'Conversion failed. Check storage access, ffmpeg, ffprobe, and available disk space.',
    );
    process.exitCode = 1;
  } finally {
    client.destroy();
    const cleanupPaths = [];
    if (!options.input && downloadedInputPath) {
      cleanupPaths.push(downloadedInputPath);
    }
    if (!options.uploadOnly && outputPath && outputPath !== stableConvertedPath) {
      cleanupPaths.push(outputPath);
    }
    for (const temporaryPath of cleanupPaths) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== 'ENOENT') {
          console.error('Could not clean up a temporary conversion file.');
          process.exitCode = 1;
        }
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runConversion(process.argv.slice(2));
}
