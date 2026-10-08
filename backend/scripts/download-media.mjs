import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, lstat, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatFileSize } from '../../src/utils/formatFileSize.cjs';

const REQUIRED_S3_SETTINGS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
// This script is read-only on Backblaze: it only reads an object and writes a local copy.
export function isAllowedOutputPath(outputPath, repositoryRoot, temporaryRoot = '/tmp') {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    return false;
  }

  const segments = outputPath.split(path.sep);
  if (segments.includes('..')) {
    return false;
  }

  const resolvedOutput = path.resolve(outputPath);
  const fileName = path.basename(resolvedOutput);
  if (!fileName || fileName === '.' || fileName === path.sep) {
    return false;
  }
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const temporaryRelative = path.relative(resolvedTemporaryRoot, resolvedOutput);
  if (
    temporaryRelative === '' ||
    temporaryRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(temporaryRelative)
  ) {
    return false;
  }

  const resolvedRepository = path.resolve(repositoryRoot);
  const repositoryRelative = path.relative(resolvedRepository, resolvedOutput);
  return !(
    repositoryRelative === '' ||
    (!repositoryRelative.startsWith(`..${path.sep}`) &&
      repositoryRelative !== '..' &&
      !path.isAbsolute(repositoryRelative))
  );
}

export async function downloadObjectToFile(client, bucket, key, outputPath, onProgress = () => {}) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const totalBytes = result.ContentLength;
  if (!result.Body || !Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Object did not provide a readable body and content length.');
  }

  let downloadedBytes = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      onProgress(downloadedBytes, totalBytes);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(result.Body, progress, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
    const { size: localBytes } = await stat(outputPath);
    if (localBytes !== totalBytes) {
      const mismatch = new Error(`Expected ${formatFileSize(totalBytes)}, received ${formatFileSize(localBytes)}.`);
      mismatch.code = 'SIZE_MISMATCH';
      throw mismatch;
    }
    return { sizeBytes: localBytes };
  } catch (error) {
    await unlink(outputPath).catch((cleanupError) => {
      if (cleanupError?.code !== 'ENOENT') {
        console.error('Could not remove the incomplete temporary output file.');
      }
    });
    throw error;
  }
}

function parseArguments(args) {
  const options = new Map();
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--force') {
      if (force) {
        throw new Error('Usage: npm --prefix backend run media:download -- --key <storage_key> --out <local_path> [--force]');
      }
      force = true;
      continue;
    }
    if ((argument !== '--key' && argument !== '--out') || options.has(argument) || !args[index + 1]) {
      throw new Error('Usage: npm --prefix backend run media:download -- --key <storage_key> --out <local_path> [--force]');
    }
    options.set(argument, args[index + 1]);
    index += 1;
  }

  const key = options.get('--key');
  const outputPath = options.get('--out');
  if (!key || key.startsWith('/') || /[\u0000-\u001f\u007f]/.test(key) || !outputPath) {
    throw new Error('Usage: npm --prefix backend run media:download -- --key <storage_key> --out <local_path> [--force]');
  }
  return { key, outputPath, force };
}

async function prepareOutputPath(outputPath, repositoryRoot) {
  if (!isAllowedOutputPath(outputPath, repositoryRoot)) {
    throw new Error('Output path must be an absolute path inside /tmp and outside the repository.');
  }

  const requestedDirectory = path.dirname(path.resolve(outputPath));
  const actualDirectory = await realpath(requestedDirectory);
  if (!isAllowedOutputPath(path.join(actualDirectory, path.basename(outputPath)), repositoryRoot)) {
    throw new Error('Output path must resolve inside /tmp and outside the repository.');
  }

  return path.join(actualDirectory, path.basename(outputPath));
}

async function outputExists(outputPath) {
  try {
    await lstat(outputPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function runDownload(args) {
  let options;
  try {
    options = parseArguments(args);
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

  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  let outputPath;
  try {
    outputPath = await prepareOutputPath(options.outputPath, repositoryRoot);
    if (!options.force && await outputExists(outputPath)) {
      throw new Error('Output file already exists. Pass --force to replace it.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.partial`,
  );
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  let keepTemporaryFile = false;
  try {
    const { sizeBytes: totalBytes } = await downloadObjectToFile(
      client,
      process.env.S3_BUCKET,
      options.key,
      temporaryPath,
      (downloadedBytes, expectedBytes) => {
        process.stdout.write(`\r${formatFileSize(downloadedBytes)} / ${formatFileSize(expectedBytes)}`);
      },
    );
    process.stdout.write('\n');

    if (options.force) {
      await rename(temporaryPath, outputPath);
    } else {
      await link(temporaryPath, outputPath);
      await unlink(temporaryPath);
    }
    keepTemporaryFile = true;
    console.log(`OK: ${formatFileSize(totalBytes)} saved to ${outputPath}`);
  } catch (error) {
    process.stdout.write('\n');
    if (error?.code === 'SIZE_MISMATCH') {
      console.error(`MISMATCH: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.error('Download failed. Check the storage key, S3 settings, output directory, and local disk space.');
    process.exitCode = 1;
  } finally {
    client.destroy();
    if (!keepTemporaryFile) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== 'ENOENT') {
          console.error('Could not remove the incomplete temporary output file.');
        }
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDownload(process.argv.slice(2));
}
