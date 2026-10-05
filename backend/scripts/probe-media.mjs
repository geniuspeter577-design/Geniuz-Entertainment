import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const REQUIRED_S3_SETTINGS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];

// This script is read-only: it only signs a GET URL and probes remote media metadata.
export function getRemuxVerdict(streams) {
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const subtitleStreams = streams.filter((stream) => stream.codec_type === 'subtitle');

  if (videoStreams.length === 0) {
    return {
      verdict: 'REENCODE_NEEDED',
      reason: 'No video stream was found.',
      subtitles: subtitleStreams,
    };
  }

  const incompatibleVideo = videoStreams.find((stream) => stream.codec_name !== 'h264');
  if (incompatibleVideo) {
    return {
      verdict: 'REENCODE_NEEDED',
      reason: `Video codec ${incompatibleVideo.codec_name ?? 'unknown'} is not h264.`,
      subtitles: subtitleStreams,
    };
  }

  const incompatibleAudio = audioStreams.find((stream) => stream.codec_name !== 'aac');
  if (incompatibleAudio) {
    return {
      verdict: 'REENCODE_NEEDED',
      reason: `Audio codec ${incompatibleAudio.codec_name ?? 'unknown'} is not aac.`,
      subtitles: subtitleStreams,
    };
  }

  return {
    verdict: 'REMUX_OK',
    reason: audioStreams.length === 0 ? 'h264 video with no audio stream.' : 'h264 video and aac audio.',
    subtitles: subtitleStreams,
  };
}

function getStorageKey(args) {
  const keyIndex = args.indexOf('--key');
  const key = keyIndex >= 0 ? args[keyIndex + 1] : undefined;
  if (
    !key ||
    args.filter((argument) => argument === '--key').length !== 1 ||
    args.length !== 2 ||
    !/^movies\/[A-Za-z0-9._-]+$/.test(key) ||
    key.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Usage: npm --prefix backend run media:probe -- --key <movies/storage_key>');
  }
  return key;
}

function printProbeResult(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const verdict = getRemuxVerdict(streams);
  const format = probe.format ?? {};

  console.log(`Duration: ${format.duration ?? 'unknown'} seconds`);
  console.log(`Size: ${format.size ?? 'unknown'} bytes`);
  console.log('Streams:');
  for (const stream of streams) {
    console.log(
      `- codec_type=${stream.codec_type ?? 'unknown'} codec_name=${stream.codec_name ?? 'unknown'} profile=${stream.profile ?? 'unknown'} width=${stream.width ?? 'n/a'} height=${stream.height ?? 'n/a'}`,
    );
  }
  console.log('Subtitle tracks:');
  if (verdict.subtitles.length === 0) {
    console.log('- none');
  } else {
    for (const stream of verdict.subtitles) {
      console.log(`- ${stream.codec_name ?? 'unknown'}${stream.profile ? ` (${stream.profile})` : ''}`);
    }
  }
  console.log(`${verdict.verdict}: ${verdict.reason}`);
}

async function runProbe(args) {
  let key;
  try {
    key = getStorageKey(args);
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

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      { expiresIn: 10 * 60 },
    );
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,profile,width,height:format=duration,size',
        '-of',
        'json',
        url,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    printProbeResult(JSON.parse(stdout));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.error('Could not run ffprobe. Install ffprobe and try again.');
    } else {
      console.error('Could not probe this media object. Check the key, storage access, and ffprobe installation.');
    }
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runProbe(process.argv.slice(2));
}
