import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

import {
  buildFfmpegArgs,
  formatFileSize,
  getVideoMaxrateKbps,
  probe,
  videoConversionProfile,
} from './convert-media.mjs';
import { downloadObjectToFile } from './download-media.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_VIDEO_SIZE_BYTES = 1024 ** 3;
const REQUIRED_SUPABASE_SETTINGS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const REQUIRED_STORAGE_SETTINGS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const USAGE = 'Usage: npm --prefix backend run media:process -- --movie-id <uuid> [--apply] [--replace]';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class MovieProcessError extends Error {
  constructor(safeMessage) {
    super(safeMessage);
    this.name = 'MovieProcessError';
    this.safeMessage = safeMessage;
  }
}

export function parseArguments(args) {
  let movieId;
  let apply = false;
  let replace = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--movie-id') {
      if (movieId || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error(USAGE);
      }
      movieId = args[index + 1];
      index += 1;
    } else if (argument === '--apply') {
      if (apply) {
        throw new Error(USAGE);
      }
      apply = true;
    } else if (argument === '--replace') {
      if (replace) {
        throw new Error(USAGE);
      }
      replace = true;
    } else {
      throw new Error(USAGE);
    }
  }
  if (!movieId || !UUID_PATTERN.test(movieId)) {
    throw new Error(USAGE);
  }
  return { movieId, apply, replace };
}

export function getMaxVideoSizeBytes(environment = process.env) {
  const configured = environment.MAX_VIDEO_UPLOAD_SIZE_BYTES?.trim();
  if (!configured) {
    return DEFAULT_MAX_VIDEO_SIZE_BYTES;
  }
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MovieProcessError('MAX_VIDEO_UPLOAD_SIZE_BYTES must be a positive integer.');
  }
  return value;
}

export function getTargetStorageKey(movieId, sourceKey) {
  const standardTarget = `movies/${movieId}-converted.mp4`;
  if (standardTarget !== sourceKey) {
    return standardTarget;
  }
  return `movies/${movieId}-converted-${randomUUID()}.mp4`;
}

export function formatDryRunOutput(movie, targetKey, maxrateKbps = videoConversionProfile.VIDEO_MAXRATE_KBPS) {
  const sourceKey = movie.storage_key;
  const currentStatus = typeof movie.conversion_status === 'string'
    ? movie.conversion_status
    : 'ready';
  return [
    `Movie: ${movie.id}`,
    `Source key: ${sourceKey}`,
    `Target key: ${targetKey}`,
    `Planned conversion_status: ${currentStatus} -> converting -> ready (or failed on error)`,
    `Shared profile: libx264/veryfast, max ${maxrateKbps} kb/s video, AAC stereo ${videoConversionProfile.audioKbps} kb/s, scale down to ${videoConversionProfile.scaleHeight}p; 2x buffer.`,
    'Dry run: no files were downloaded, no objects were uploaded, and no database rows were changed.',
  ].join('\n');
}

function getProbeStreams(mediaProbe) {
  return Array.isArray(mediaProbe?.streams) ? mediaProbe.streams : [];
}

function hasH264VideoAndAacAudio(mediaProbe) {
  const streams = getProbeStreams(mediaProbe);
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  return (
    videoStreams.length > 0 &&
    videoStreams.every((stream) => stream.codec_name === 'h264') &&
    audioStreams.length > 0 &&
    audioStreams.every((stream) => stream.codec_name === 'aac')
  );
}

export function shouldSkipEncoding({ fileExtension, mediaProbe, fileSizeBytes, maxSizeBytes }) {
  const formats = String(mediaProbe?.format?.format_name ?? '').toLowerCase().split(',');
  return (
    fileExtension?.replace(/^\./, '').toLowerCase() === 'mp4' &&
    formats.includes('mp4') &&
    Number.isSafeInteger(fileSizeBytes) &&
    fileSizeBytes > 0 &&
    fileSizeBytes <= maxSizeBytes &&
    hasH264VideoAndAacAudio(mediaProbe)
  );
}

export function verifyProcessedOutput({ mediaProbe, fileSizeBytes, sourceSizeBytes, maxSizeBytes }) {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) {
    return { valid: false, reason: 'The processed video is empty or unreadable.' };
  }
  if (!Number.isSafeInteger(sourceSizeBytes) || fileSizeBytes > sourceSizeBytes) {
    return { valid: false, reason: 'The processed video is larger than the source.' };
  }
  if (fileSizeBytes > maxSizeBytes) {
    return { valid: false, reason: 'The processed video exceeds the configured size limit.' };
  }
  if (!hasH264VideoAndAacAudio(mediaProbe)) {
    return { valid: false, reason: 'The processed video must contain H.264 video and AAC audio.' };
  }
  if (!String(mediaProbe?.format?.format_name ?? '').toLowerCase().split(',').includes('mp4')) {
    return { valid: false, reason: 'The processed container is not MP4.' };
  }
  const duration = Number(mediaProbe?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { valid: false, reason: 'The processed video duration could not be verified.' };
  }
  const runtimeMinutes = Math.ceil(duration / 60);
  if (runtimeMinutes > 1000) {
    return { valid: false, reason: 'The processed video duration exceeds the supported movie runtime.' };
  }
  return { valid: true, durationSeconds: duration, runtimeMinutes };
}

export function mapFailureStatus(error) {
  const conversionError = error instanceof MovieProcessError
    ? error.safeMessage
    : 'Movie processing failed. Check the worker configuration and retry.';
  return { conversion_status: 'failed', conversion_error: conversionError };
}

export function formatSupabaseMovieLookupFailure(error) {
  if (error) {
    const code = typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(error.code)
      ? error.code
      : 'UNKNOWN';
    return `Supabase movie lookup failed (error code ${code}). Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`;
  }
  return 'Supabase lookup succeeded but returned no visible movie row. The UUID may not exist, or row-level security may hide an unpublished row; check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.';
}

export async function runMovieProcess(options, dependencies, writeLine = () => {}) {
  const { movieId, apply, replace } = options;
  let movie;
  let temporaryDirectory;
  try {
    movie = await dependencies.database.getMovie(movieId);
    if (!movie) {
      throw new MovieProcessError(formatSupabaseMovieLookupFailure(null));
    }
    if (typeof movie.storage_key !== 'string' || !movie.storage_key.startsWith('movies/')) {
      throw new MovieProcessError('The movie does not have a valid B2 source key.');
    }
    const targetKey = getTargetStorageKey(movieId, movie.storage_key);
    if (!apply) {
      const maxrateKbps = dependencies.getVideoMaxrateKbps
        ? dependencies.getVideoMaxrateKbps()
        : videoConversionProfile.VIDEO_MAXRATE_KBPS;
      writeLine(formatDryRunOutput(movie, targetKey, maxrateKbps));
      return { dryRun: true, targetKey };
    }

    await dependencies.database.updateMovie(movieId, {
      conversion_status: 'converting',
      conversion_error: null,
    });
    const maxSizeBytes = dependencies.getMaxSizeBytes
      ? dependencies.getMaxSizeBytes()
      : dependencies.maxSizeBytes;
    temporaryDirectory = await dependencies.runtime.createTempDirectory();
    const sourcePath = path.join(temporaryDirectory, 'source');
    const sourceDownload = await dependencies.storage.downloadSource(movie.storage_key, sourcePath);
    const sourceSizeBytes = sourceDownload.sizeBytes;
    const sourceProbe = await dependencies.runtime.probe(sourcePath);
    const extension = movie.file_extension || path.extname(movie.storage_key).slice(1);
    const skipEncoding = shouldSkipEncoding({
      fileExtension: extension,
      mediaProbe: sourceProbe,
      fileSizeBytes: sourceSizeBytes,
      maxSizeBytes,
    });

    let outputPath = sourcePath;
    let outputProbe = sourceProbe;
    let outputSizeBytes = sourceSizeBytes;
    let finalStorageKey = movie.storage_key;
    if (!skipEncoding) {
      outputPath = path.join(temporaryDirectory, 'processed.mp4');
      await dependencies.runtime.encode(sourcePath, outputPath, sourceProbe.streams, {
        forceReencode: true,
      });
      outputProbe = await dependencies.runtime.probe(outputPath);
      outputSizeBytes = await dependencies.runtime.getFileSize(outputPath);
    }

    const verification = verifyProcessedOutput({
      mediaProbe: outputProbe,
      fileSizeBytes: outputSizeBytes,
      sourceSizeBytes,
      maxSizeBytes,
    });
    if (!verification.valid) {
      throw new MovieProcessError(verification.reason);
    }

    const sha256 = await dependencies.runtime.sha256(outputPath);
    if (!skipEncoding) {
      const targetExists = await dependencies.storage.targetExists(targetKey);
      if (targetExists && !replace) {
        throw new MovieProcessError('The converted target already exists; rerun with --replace to overwrite it.');
      }
      if (targetExists) {
        writeLine(`REPLACING a live file: ${targetKey}`);
      }
      await dependencies.storage.uploadOutput(targetKey, outputPath, outputSizeBytes);
      finalStorageKey = targetKey;
    }

    await dependencies.runtime.removeTempDirectory(temporaryDirectory);
    temporaryDirectory = undefined;
    await dependencies.database.updateMovie(movieId, {
      storage_key: finalStorageKey,
      file_extension: 'mp4',
      mime_type: 'video/mp4',
      file_size_bytes: outputSizeBytes,
      runtime_minutes: verification.runtimeMinutes,
      conversion_status: 'ready',
      conversion_error: null,
    });
    writeLine(`Conversion ready: ${formatFileSize(outputSizeBytes)}; SHA-256 ${sha256}; ${skipEncoding ? 'encoding skipped' : 'encoded and uploaded'}.`);
    return { dryRun: false, targetKey: finalStorageKey, skipEncoding, sha256 };
  } catch (error) {
    if (apply) {
      const failure = mapFailureStatus(error);
      try {
        await dependencies.database.updateMovie(movieId, failure);
      } catch {
        // Keep the original safe error; the row update may fail if storage is unavailable.
      }
      throw new MovieProcessError(failure.conversion_error);
    }
    throw error instanceof MovieProcessError ? error : new MovieProcessError('Could not read the movie row.');
  } finally {
    if (temporaryDirectory) {
      await dependencies.runtime.removeTempDirectory(temporaryDirectory).catch(() => undefined);
    }
  }
}

function createProductionDependencies(environment = process.env) {
  const missingSupabase = REQUIRED_SUPABASE_SETTINGS.filter((name) => !environment[name]?.trim());
  if (missingSupabase.length > 0) {
    throw new MovieProcessError(`Missing required settings: ${missingSupabase.join(', ')}`);
  }
  const supabase = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const database = {
    async getMovie(movieId) {
      const { data, error } = await supabase
        .from('movies')
        .select('id,storage_key,file_extension,file_size_bytes,conversion_status')
        .eq('id', movieId)
        .maybeSingle();
      if (error) {
        throw new MovieProcessError(formatSupabaseMovieLookupFailure(error));
      }
      return data;
    },
    async updateMovie(movieId, updates) {
      const { error } = await supabase.from('movies').update(updates).eq('id', movieId);
      if (error) {
        throw new MovieProcessError('Could not update the movie conversion status.');
      }
    },
  };

  return {
    database,
    getMaxSizeBytes: () => getMaxVideoSizeBytes(environment),
    getVideoMaxrateKbps: () => getVideoMaxrateKbps(environment),
  };
}

function createProductionStorageClient(environment) {
  const missingStorage = REQUIRED_STORAGE_SETTINGS.filter((name) => !environment[name]?.trim());
  if (missingStorage.length > 0) {
    throw new MovieProcessError(`Missing required settings: ${missingStorage.join(', ')}`);
  }
  const bucket = environment.S3_BUCKET;
  const client = new S3Client({
    endpoint: environment.S3_ENDPOINT,
    region: environment.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
    },
  });
  const storage = {
    async downloadSource(key, outputPath) {
      return downloadObjectToFile(client, bucket, key, outputPath);
    },
    async targetExists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
          return false;
        }
        throw new MovieProcessError('Could not verify the converted target in storage.');
      }
    },
    async uploadOutput(key, filePath, fileSizeBytes) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(filePath, { highWaterMark: 1024 * 1024 }),
        ContentLength: fileSizeBytes,
        ContentType: 'video/mp4',
      }));
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (head.ContentLength !== fileSizeBytes) {
        throw new MovieProcessError('The uploaded file size could not be verified.');
      }
    },
    destroy() {
      client.destroy();
    },
  };
  return storage;
}

function createProductionStorage(environment = process.env) {
  let clientStorage;
  const getStorage = () => {
    clientStorage ??= createProductionStorageClient(environment);
    return clientStorage;
  };
  return {
    downloadSource: (...args) => getStorage().downloadSource(...args),
    targetExists: (...args) => getStorage().targetExists(...args),
    uploadOutput: (...args) => getStorage().uploadOutput(...args),
    destroy: () => clientStorage?.destroy(),
  };
}

function createProductionRuntime() {
  return {
    createTempDirectory: () => mkdtemp(path.join(os.tmpdir(), 'geniuz-movie-process-')),
    removeTempDirectory: (directory) => rm(directory, { recursive: true, force: true }),
    probe,
    async encode(sourcePath, outputPath, streams, options) {
      try {
        await execFileAsync('ffmpeg', buildFfmpegArgs(sourcePath, outputPath, streams, options));
      } catch {
        throw new MovieProcessError('FFmpeg could not encode this source video.');
      }
    },
    async getFileSize(filePath) {
      const details = await stat(filePath);
      return details.size;
    },
    sha256(filePath) {
      return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
      });
    },
  };
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  let options;
  try {
    options = parseArguments(args);
  } catch {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  let dependencies;
  let storage;
  try {
    dependencies = createProductionDependencies(environment);
    if (options.apply) {
      storage = createProductionStorage(environment);
      dependencies.storage = storage;
      dependencies.runtime = createProductionRuntime();
    }
    await runMovieProcess(options, dependencies, (line) => console.log(line));
  } catch (error) {
    console.error(error instanceof MovieProcessError ? error.safeMessage : 'Movie processing failed.');
    process.exitCode = 1;
  } finally {
    storage?.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}