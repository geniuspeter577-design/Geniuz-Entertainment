import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { downloadObjectToFile, isAllowedOutputPath } from './download-media.mjs';

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

class ConversionError extends Error {}

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

export function buildFfmpegArgs(
  sourcePath,
  outputPath,
  streams,
  { crf = 30, maxrateKbps = 200, audioKbps = 64 } = {},
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
  const shouldScaleVideo = sourceHeight > 480;

  const canRemux =
    videoStreams.every((stream) => stream.codec_name === 'h264') &&
    audioStreams.every((stream) => stream.codec_name === 'aac');
  const args = ['-nostdin', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0?'];
  if (canRemux) {
    args.push('-c', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
      '-maxrate', `${maxrateKbps}k`, '-bufsize', `${maxrateKbps * 2}k`, '-pix_fmt', 'yuv420p',
    );
    if (shouldScaleVideo) {
      args.push('-vf', 'scale=-2:480');
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

export function parseArguments(args) {
  const options = new Map();
  let dryRun = false;
  const usage = 'Usage: npm --prefix backend run media:convert -- --key <movies/<uuid>.mkv> [--input <local_path>] [--upload-only </tmp/convert/<uuid>.converted.mp4>] [--crf <0-51>] [--maxrate-kbps <positive_integer>] [--audio-kbps <positive_integer>] [--dry-run]';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      if (dryRun) {
        throw new Error(usage);
      }
      dryRun = true;
      continue;
    }
    if (!['--key', '--input', '--upload-only', '--crf', '--maxrate-kbps', '--audio-kbps'].includes(argument) || options.has(argument) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(usage);
    }
    options.set(argument, args[index + 1]);
    index += 1;
  }

  const key = options.get('--key');
  if (!key) {
    throw new Error(usage);
  }
  const crf = options.has('--crf') ? Number(options.get('--crf')) : 30;
  const maxrateKbps = options.has('--maxrate-kbps') ? Number(options.get('--maxrate-kbps')) : 200;
  const audioKbps = options.has('--audio-kbps') ? Number(options.get('--audio-kbps')) : 64;
  if (!Number.isInteger(crf) || crf < 0 || crf > 51 || !Number.isSafeInteger(maxrateKbps) || maxrateKbps <= 0 || !Number.isSafeInteger(audioKbps) || audioKbps <= 0) {
    throw new Error(usage);
  }
  return { key, input: options.get('--input'), uploadOnly: options.get('--upload-only'), crf, maxrateKbps, audioKbps, dryRun };
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

async function assertObjectDoesNotExist(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isMissingObjectError(error)) {
      return;
    }
    throw new ConversionError('Could not confirm the new object key is unused.');
  }
  throw new ConversionError('The converted object key already exists; refusing to overwrite it.');
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

async function probe(input) {
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
    await assertObjectDoesNotExist(client, process.env.S3_BUCKET, newKey);
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
    } else if (options.input) {
      const localInput = await resolveLocalInput(options.input);
      inputPath = localInput.path;
      const head = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: options.key }));
      if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength < 0) {
        throw new ConversionError('The source object did not provide a valid size.');
      }
      if (localInput.size !== head.ContentLength) {
        throw new ConversionError(`Local input size mismatch: source object is ${head.ContentLength} bytes; local file is ${localInput.size} bytes.`);
      }
      sourceSize = localInput.size;
      sourceProbe = await probe(inputPath);
      console.log(`Local input size verified against source HEAD: ${sourceSize} bytes.`);
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
          process.stdout.write(`\rDownloading ${(done / 1024 / 1024).toFixed(2)} MB / ${(total / 1024 / 1024).toFixed(2)} MB`);
        },
      );
      process.stdout.write('\n');
      sourceSize = downloadResult.sizeBytes;
      console.log(`Source download size verified: ${sourceSize} bytes.`);
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
        console.error(`WARNING: Converted output is larger than the source; refusing upload. Source: ${sourceSize} bytes; output: ${outputSize} bytes.`);
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

    await assertObjectDoesNotExist(client, process.env.S3_BUCKET, newKey);
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
    console.log(`New size: ${uploadSize} bytes`);
    if (!options.uploadOnly) {
      const convertedProbe = await probe(stableConvertedPath);
      const convertedDuration = Number(convertedProbe.format.duration);
      console.log(`Duration: ${Number.isFinite(convertedDuration) ? convertedDuration.toFixed(3) : 'unknown'} seconds`);
    }
    console.log(`Old key: ${options.key}`);
    console.log('Database values:');
    console.log(`storage_key: ${newKey}`);
    console.log('file_extension: mp4');
    console.log('mime_type: video/mp4');
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
