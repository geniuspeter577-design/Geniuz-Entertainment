import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { Config } from '../config/config';
import type { ContentPage } from '../models/content';
import { B2StorageService } from '../storage/B2StorageService';
import { deleteAdminTitle } from '../services/adminTitleDeletion';
import {
  deleteListedIncompleteMultipartUploads,
  deleteListedUnusedMediaFiles,
  scanIncompleteMultipartUploads,
  scanUnusedMediaFiles,
  multipartUploadIdentity,
  type IncompleteMultipartUpload,
  type MediaObject,
} from '../storage/unusedMediaCleanup';
import {
  validateCompletedParts,
  validateUploadInput,
} from '../storage/uploadValidation';
import { ContentNotFoundError, ContentService } from '../services/ContentService';
import { authenticateAdmin, authenticatePlayback, requirePublishedOrAdmin } from './auth';
import { HttpError, mapProviderError } from './errors';

const MAX_PAGE = 500;
const MAX_QUERY_LENGTH = 120;
const MAX_GENRE_LENGTH = 80;
const MAX_JSON_BODY_BYTES = 256 * 1024;
const CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const CORS_HEADERS = ['authorization', 'content-type', 'apikey', 'x-client-info'];
const publicRateLimit = new Map<string, { count: number; windowStart: number }>();
const PUBLIC_RATE_LIMIT_PER_MINUTE = 120;
const PLAY_URL_RATE_LIMIT_PER_MINUTE = 30;
const UNUSED_MEDIA_SCAN_TTL_MS = 30 * 60 * 1000;

type StorageFactory = (config: Config) => B2StorageService;
type UnusedMediaScan = {
  userId: string;
  files: MediaObject[];
  incompleteUploads: IncompleteMultipartUpload[];
  expiresAt: number;
};
type ApiServerOptions = {
  storageFactory?: StorageFactory;
  now?: () => number;
};

let b2Storage: B2StorageService | undefined;

function getB2Storage(config: Config) {
  b2Storage ??= new B2StorageService(config);
  return b2Storage;
}

function writeJson(response: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sanitizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    if (url.searchParams.has('token')) {
      url.searchParams.set('token', '[redacted]');
    }
    if (url.searchParams.has('signature')) {
      url.searchParams.set('signature', '[redacted]');
    }
    return `${url.pathname}${url.search ? '?[filtered]' : ''}`;
  } catch {
    return '/';
  }
}

function getClientIp(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0]?.trim() ?? 'unknown';
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function applyRateLimit(request: IncomingMessage, pathname: string) {
  const isMediaUrl =
    /^\/(movies|episodes)\/[^/]+\/play-url$/.test(pathname) ||
    pathname === '/api/subtitles' ||
    pathname === '/api/downloads/authorize';
  const limit = isMediaUrl ? PLAY_URL_RATE_LIMIT_PER_MINUTE : PUBLIC_RATE_LIMIT_PER_MINUTE;
  const key = `${getClientIp(request)}:${isMediaUrl ? 'media-url' : pathname}`;
  const now = Date.now();
  const bucket = publicRateLimit.get(key);

  if (!bucket || now - bucket.windowStart > 60_000) {
    publicRateLimit.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (bucket.count >= limit) {
    return true;
  }

  bucket.count += 1;
  return false;
}

function pageFrom(url: URL) {
  const rawPage = url.searchParams.get('page') ?? '1';
  if (!/^\d+$/.test(rawPage)) {
    throw new HttpError(400, 'INVALID_PAGE', 'The page parameter must be a positive integer.');
  }
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new HttpError(400, 'INVALID_PAGE', `The page parameter must be between 1 and ${MAX_PAGE}.`);
  }
  return page;
}

function requiredQuery(url: URL, name: string, maximumLength: number) {
  const value = url.searchParams.get(name)?.trim() ?? '';
  if (!value) {
    throw new HttpError(400, 'INVALID_QUERY', `The "${name}" query parameter is required.`);
  }
  if (value.length > maximumLength) {
    throw new HttpError(400, 'INVALID_QUERY', `The "${name}" query parameter is too long.`);
  }
  return value;
}

function optionalQuery(url: URL, name: string, maximumLength: number) {
  const value = url.searchParams.get(name)?.trim();
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (value.length > maximumLength) {
    throw new HttpError(400, 'INVALID_QUERY', `The "${name}" query parameter is too long.`);
  }
  return value;
}

function pageResponse(result: ContentPage) {
  return { items: result.items, page: result.page, totalPages: result.totalPages };
}

function withCors(request: IncomingMessage, response: ServerResponse, config: Config) {
  const origin = request.headers.origin;
  const allowedOrigin = Boolean(origin && config.corsOrigins.includes(origin));
  if (allowedOrigin && origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey, x-client-info');
    response.setHeader('Access-Control-Max-Age', '600');
  }
  return allowedOrigin;
}

function validatePreflight(request: IncomingMessage, originAllowed: boolean) {
  if (!request.headers.origin) {
    return;
  }
  if (!originAllowed) {
    throw new HttpError(403, 'CORS_ORIGIN_DENIED', 'This app origin is not allowed to access the API.');
  }

  const requestedMethod = request.headers['access-control-request-method']?.toUpperCase();
  if (requestedMethod && !CORS_METHODS.split(', ').includes(requestedMethod)) {
    throw new HttpError(405, 'CORS_METHOD_DENIED', 'This request method is not allowed.');
  }

  const requestedHeaders = request.headers['access-control-request-headers']
    ?.split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders?.some((header) => !CORS_HEADERS.includes(header))) {
    throw new HttpError(403, 'CORS_HEADERS_DENIED', 'This request includes headers that are not allowed.');
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, 'REQUEST_TOO_LARGE', 'The request is too large.');
    }
    chunks.push(buffer);
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The request body must be valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_JSON', 'The request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string, maximumLength = 2048) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw new HttpError(400, 'INVALID_REQUEST', `The "${field}" field is invalid.`);
  }
  return value.trim();
}

function isMovieId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  content: ContentService,
  getStorage: StorageFactory,
  unusedMediaScans: Map<string, UnusedMediaScan>,
  activeMultipartUploads: Set<string>,
  now: () => number,
) {
  const originAllowed = withCors(request, response, config);

  if (request.method === 'OPTIONS') {
    validatePreflight(request, originAllowed);
    response.writeHead(204);
    response.end();
    return;
  }

  if (!request.url) {
    throw new HttpError(400, 'INVALID_REQUEST', 'A request URL is required.');
  }
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (pathname === '/' && request.method === 'GET') {
    writeJson(response, 200, { status: 'ok', service: 'geniuz-api' });
    return;
  }

  if (applyRateLimit(request, pathname)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
  }

  if (pathname === '/health') {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    writeJson(response, 200, { status: 'ok', service: 'geniuz-api' });
    return;
  }

  if (pathname === '/admin/system-status') {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client } = await authenticateAdmin(config, request.headers.authorization);
    const checks: Record<'backend' | 'supabase' | 'bucket' | 'presignedRead', 'ok' | 'not_ok'> = {
      backend: 'ok',
      supabase: 'not_ok',
      bucket: 'not_ok',
      presignedRead: 'not_ok',
    };
    const movieQuery = await client.from('movies').select('id').limit(1);
    if (!movieQuery.error) {
      checks.supabase = 'ok';
    }

    let storage: B2StorageService | undefined;
    try {
      storage = getStorage(config);
      await storage.checkBucket();
      checks.bucket = 'ok';
    } catch {
      storage = undefined;
    }

    if (storage) {
      try {
        const { data, error } = await client
          .from('movies')
          .select('storage_key')
          .eq('published', true)
          .eq('storage_provider', 'b2')
          .not('storage_key', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && typeof data?.storage_key === 'string' && data.storage_key.trim()) {
          const signedUrl = await storage.createPlaybackProbeUrl(data.storage_key);
          const probe = await fetch(signedUrl, {
            headers: { Range: 'bytes=0-0' },
            signal: AbortSignal.timeout(8_000),
          });
          checks.presignedRead = probe.ok ? 'ok' : 'not_ok';
          try {
            await probe.body?.cancel();
          } catch {
            // The status result is sufficient for this diagnostic read.
          }
        }
      } catch {
        checks.presignedRead = 'not_ok';
      }
    }

    writeJson(response, 200, { checks });
    return;
  }

  if (pathname === '/admin/titles/delete') {
    if (request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client, userId } = await authenticateAdmin(config, request.headers.authorization);
    const titleId = requiredString(await readJson(request), 'titleId', 64);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(titleId)) {
      throw new HttpError(400, 'INVALID_TITLE_ID', 'The title ID is invalid.');
    }
    const result = await deleteAdminTitle(client, getStorage(config), config, titleId, userId, new Date(now()));
    writeJson(response, 200, result);
    return;
  }

  if (pathname === '/admin/unused-files' || pathname === '/admin/unused-files/delete') {
    const { client, userId } = await authenticateAdmin(config, request.headers.authorization);
    for (const [scanId, scan] of unusedMediaScans) {
      if (scan.expiresAt <= now()) {
        unusedMediaScans.delete(scanId);
      }
    }

    if (pathname === '/admin/unused-files') {
      if (request.method !== 'GET') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const [files, incompleteUploads] = await Promise.all([
        scanUnusedMediaFiles(getStorage(config), client, config.unusedMediaMinAgeHours, now()),
        scanIncompleteMultipartUploads(
          getStorage(config),
          client,
          config.unusedMediaMinAgeHours,
          now(),
          activeMultipartUploads,
        ),
      ]);
      const scanId = randomUUID();
      unusedMediaScans.set(scanId, {
        userId,
        files,
        incompleteUploads,
        expiresAt: now() + UNUSED_MEDIA_SCAN_TTL_MS,
      });
      writeJson(response, 200, {
        scanId,
        files,
        incompleteUploads,
        totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
        incompleteUploadTotalSizeBytes: incompleteUploads.reduce(
          (total, upload) => total + (upload.uploadedSizeBytes ?? 0),
          0,
        ),
        minimumAgeHours: config.unusedMediaMinAgeHours,
      });
      return;
    }

    if (request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const scanId = requiredString(await readJson(request), 'scanId', 64);
    const scan = unusedMediaScans.get(scanId);
    if (!scan || scan.expiresAt <= now()) {
      unusedMediaScans.delete(scanId);
      throw new HttpError(410, 'UNUSED_FILE_SCAN_EXPIRED', 'Find unused files again before deleting them.');
    }
    if (scan.userId !== userId) {
      throw new HttpError(403, 'ADMIN_REQUIRED', 'This scan belongs to a different admin session.');
    }
    unusedMediaScans.delete(scanId);
    const [result, incompleteResult] = await Promise.all([
      deleteListedUnusedMediaFiles(
        getStorage(config),
        client,
        scan.files,
        config.unusedMediaMinAgeHours,
        now(),
      ),
      deleteListedIncompleteMultipartUploads(
        getStorage(config),
        client,
        scan.incompleteUploads,
        config.unusedMediaMinAgeHours,
        now(),
        activeMultipartUploads,
      ),
    ]);
    writeJson(response, 200, {
      deleted: [...result.deleted, ...incompleteResult.deleted],
      failures: [...result.failures, ...incompleteResult.failures],
      skipped: result.skipped + incompleteResult.skipped,
      bytesFreed: result.deleted.reduce((total, file) => total + file.sizeBytes, 0) + incompleteResult.bytesFreed,
      filesDeleted: result.deleted.length,
      incompleteUploadsDeleted: incompleteResult.deleted.length,
    });
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    await authenticateAdmin(config, request.headers.authorization);
    const storage = getStorage(config);

    if (pathname === '/uploads/init') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const input = validateUploadInput(await readJson(request));
      const upload = await storage.startMultipartUpload(input.fileName, input.contentType, input.objectType, input.kind);
      activeMultipartUploads.add(multipartUploadIdentity(upload));
      writeJson(
        response,
        201,
        upload,
      );
      return;
    }

    if (pathname === '/uploads/part-urls') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const body = await readJson(request);
      const result = await storage.createPartUrls(
        requiredString(body, 'key'),
        requiredString(body, 'uploadId'),
        body.partNumbers,
      );
      writeJson(response, 200, result);
      return;
    }

    if (pathname === '/uploads/complete') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const body = await readJson(request);
      const key = requiredString(body, 'key');
      const uploadId = requiredString(body, 'uploadId');
      const parts = validateCompletedParts(body.parts, 64);
      const result = await storage.completeMultipartUpload(key, uploadId, parts);
      activeMultipartUploads.delete(multipartUploadIdentity({ key, uploadId }));
      writeJson(response, 200, result);
      return;
    }

    if (pathname === '/uploads/abort') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const body = await readJson(request);
      const key = requiredString(body, 'key');
      const uploadId = requiredString(body, 'uploadId');
      await storage.abortMultipartUpload(
        key,
        uploadId,
      );
      activeMultipartUploads.delete(multipartUploadIdentity({ key, uploadId }));
      writeJson(response, 200, { aborted: true });
      return;
    }

    if (pathname === '/uploads/delete') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      await storage.deleteObject(requiredString(await readJson(request), 'key'));
      writeJson(response, 200, { deleted: true });
      return;
    }

    throw new HttpError(404, 'NOT_FOUND', 'The requested endpoint was not found.');
  }

  const playUrlMatch = /^\/movies\/([^/]+)\/play-url$/.exec(pathname);
  if (playUrlMatch) {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client, isAdmin } = await authenticatePlayback(config, request.headers.authorization);
    let movieId: string;
    try {
      movieId = decodeURIComponent(playUrlMatch[1]);
    } catch {
      throw new HttpError(400, 'INVALID_MOVIE_ID', 'The movie ID is invalid.');
    }
    if (!isMovieId(movieId)) {
      throw new HttpError(400, 'INVALID_MOVIE_ID', 'The movie ID is invalid.');
    }

    const { data, error } = await client
      .from('movies')
      .select('storage_provider,storage_key,published')
      .eq('id', movieId)
      .maybeSingle();
    if (error) {
      throw new HttpError(502, 'MOVIE_LOOKUP_FAILED', 'Could not load this movie.');
    }
    if (!data) {
      throw new HttpError(
        isAdmin ? 404 : 403,
        isAdmin ? 'MOVIE_NOT_FOUND' : 'ADMIN_REQUIRED',
        isAdmin ? 'The requested movie was not found.' : 'Admin access is required.',
      );
    }
    requirePublishedOrAdmin(data.published === true, isAdmin);
    if (data.storage_provider !== 'b2') {
      throw new HttpError(409, 'NOT_B2_STORAGE', 'This movie is not stored in Backblaze.');
    }
    if (typeof data.storage_key !== 'string' || !data.storage_key.trim()) {
      throw new HttpError(404, 'PLAYBACK_FILE_MISSING', 'This movie is missing its video file.');
    }
    const playbackUrl = await getStorage(config).createPlayUrl(data.storage_key, {
      routeKind: 'movie',
      contentId: movieId,
    });
    writeJson(response, 200, { url: playbackUrl, expiresIn: 7200 });
    return;
  }

  const episodePlayUrlMatch = /^\/episodes\/([^/]+)\/play-url$/.exec(pathname);
  if (episodePlayUrlMatch) {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client, isAdmin } = await authenticatePlayback(config, request.headers.authorization);
    let episodeId: string;
    try {
      episodeId = decodeURIComponent(episodePlayUrlMatch[1]);
    } catch {
      throw new HttpError(400, 'INVALID_EPISODE_ID', 'The episode ID is invalid.');
    }
    if (!isMovieId(episodeId)) {
      throw new HttpError(400, 'INVALID_EPISODE_ID', 'The episode ID is invalid.');
    }

    const { data, error } = await client
      .from('episodes')
      .select('storage_provider,storage_key,published')
      .eq('id', episodeId)
      .maybeSingle();
    if (error) {
      throw new HttpError(502, 'EPISODE_LOOKUP_FAILED', 'Could not load this episode.');
    }
    if (!data) {
      throw new HttpError(
        isAdmin ? 404 : 403,
        isAdmin ? 'EPISODE_NOT_FOUND' : 'ADMIN_REQUIRED',
        isAdmin ? 'The requested episode was not found.' : 'Admin access is required.',
      );
    }
    requirePublishedOrAdmin(data.published === true, isAdmin);
    if (data.storage_provider !== 'b2') {
      throw new HttpError(409, 'NOT_B2_STORAGE', 'This episode is not stored in Backblaze.');
    }
    if (typeof data.storage_key !== 'string' || !data.storage_key.trim()) {
      throw new HttpError(404, 'PLAYBACK_FILE_MISSING', 'This episode is missing its video file.');
    }
    const playbackUrl = await getStorage(config).createPlayUrl(data.storage_key, {
      routeKind: 'episode',
      contentId: episodeId,
    });
    writeJson(response, 200, { url: playbackUrl, expiresIn: 7200 });
    return;
  }

  if (pathname === '/api/downloads/authorize') {
    if (request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client, isAdmin } = await authenticatePlayback(config, request.headers.authorization);
    const body = await readJson(request);
    const contentKind = requiredString(body, 'contentKind');
    const contentId = requiredString(body, 'contentId');
    if (contentKind !== 'movie' && contentKind !== 'episode') {
      throw new HttpError(400, 'INVALID_CONTENT_KIND', 'The content kind is invalid.');
    }
    if (!isMovieId(contentId)) {
      throw new HttpError(400, 'INVALID_CONTENT_ID', 'The content ID is invalid.');
    }

    let data: {
      storage_provider: unknown;
      storage_key: unknown;
      video_path: unknown;
      published: unknown;
      allow_download: unknown;
      file_size_bytes: unknown;
      content_type: unknown;
    } | null;
    if (contentKind === 'episode') {
      const lookup = await client
        .from('episodes')
        .select('storage_provider,storage_key,published,allow_download,file_size_bytes')
        .eq('id', contentId)
        .maybeSingle();
      if (lookup.error) {
        throw new HttpError(502, 'DOWNLOAD_LOOKUP_FAILED', 'Could not load this title.');
      }
      data = lookup.data ? { ...lookup.data, video_path: null, content_type: null } : null;
    } else {
      const lookup = await client
        .from('movies')
        .select('storage_provider,storage_key,video_path,published,allow_download,file_size_bytes,content_type')
        .eq('id', contentId)
        .maybeSingle();
      if (lookup.error) {
        throw new HttpError(502, 'DOWNLOAD_LOOKUP_FAILED', 'Could not load this title.');
      }
      data = lookup.data;
    }
    if (!data) {
      throw new HttpError(404, 'TITLE_NOT_FOUND', 'This title is not available for download.');
    }
    if (data.published !== true && !isAdmin) {
      throw new HttpError(403, 'TITLE_NOT_PUBLISHED', 'This title is not available for download.');
    }
    if (
      data.allow_download !== true ||
      (contentKind === 'movie' && data.content_type === 'series')
    ) {
      throw new HttpError(403, 'DOWNLOAD_NOT_ALLOWED', 'Downloads are not enabled for this title.');
    }
    const storagePath =
      data.storage_provider === 'b2'
        ? data.storage_key
        : contentKind === 'episode'
          ? data.storage_key
          : data.video_path;
    if (typeof storagePath !== 'string' || !storagePath.trim()) {
      throw new HttpError(404, 'PLAYBACK_FILE_MISSING', 'This title is missing its video file.');
    }
    const fileSizeBytes = Number(data.file_size_bytes);
    if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) {
      throw new HttpError(409, 'FILE_SIZE_UNAVAILABLE', 'This title has no verified file size.');
    }

    let url: string;
    if (data.storage_provider === 'b2') {
      url = await getStorage(config).createPlayUrl(storagePath, {
        routeKind: contentKind,
        contentId,
      });
    } else if (data.storage_provider === 'supabase') {
      const { data: signedData, error: signedUrlError } = await client.storage
        .from('movie-assets')
        .createSignedUrl(storagePath, 7200);
      if (signedUrlError || !signedData?.signedUrl) {
        throw new HttpError(502, 'DOWNLOAD_URL_FAILED', 'Could not prepare this title for download.');
      }
      url = signedData.signedUrl;
    } else {
      throw new HttpError(409, 'STORAGE_PROVIDER_UNSUPPORTED', 'This title uses unsupported storage.');
    }
    writeJson(response, 200, { url, expiresIn: 7200, fileSizeBytes });
    return;
  }

  if (pathname === '/api/subtitles') {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client, isAdmin } = await authenticatePlayback(config, request.headers.authorization);
    const contentKind = requiredQuery(url, 'kind', 16);
    const contentId = requiredQuery(url, 'id', 64);
    if ((contentKind !== 'movie' && contentKind !== 'episode') || !isMovieId(contentId)) {
      throw new HttpError(400, 'INVALID_SUBTITLE_TARGET', 'The subtitle target is invalid.');
    }

    let trackColumn: 'movie_id' | 'episode_id';
    if (contentKind === 'movie') {
      const { data, error } = await client
        .from('movies')
        .select('published,content_type')
        .eq('id', contentId)
        .maybeSingle();
      if (error) {
        throw new HttpError(502, 'SUBTITLE_LOOKUP_FAILED', 'Could not load subtitles for this title.');
      }
      if (!data || (data.content_type !== 'movie' && data.content_type !== 'short')) {
        throw new HttpError(404, 'TITLE_NOT_FOUND', 'This video is not available.');
      }
      requirePublishedOrAdmin(data.published === true, isAdmin);
      trackColumn = 'movie_id';
    } else {
      const { data: episode, error: episodeError } = await client
        .from('episodes')
        .select('published,season_id')
        .eq('id', contentId)
        .maybeSingle();
      if (episodeError) {
        throw new HttpError(502, 'SUBTITLE_LOOKUP_FAILED', 'Could not load subtitles for this episode.');
      }
      if (!episode) {
        throw new HttpError(404, 'EPISODE_NOT_FOUND', 'This video is not available.');
      }
      const { data: season, error: seasonError } = await client
        .from('seasons')
        .select('published,series_id')
        .eq('id', episode.season_id)
        .maybeSingle();
      if (seasonError) {
        throw new HttpError(502, 'SUBTITLE_LOOKUP_FAILED', 'Could not load subtitles for this episode.');
      }
      if (!season) {
        throw new HttpError(404, 'EPISODE_NOT_FOUND', 'This video is not available.');
      }
      const { data: series, error: seriesError } = await client
        .from('movies')
        .select('published,content_type')
        .eq('id', season.series_id)
        .maybeSingle();
      if (seriesError) {
        throw new HttpError(502, 'SUBTITLE_LOOKUP_FAILED', 'Could not load subtitles for this episode.');
      }
      if (!series || series.content_type !== 'series') {
        throw new HttpError(404, 'EPISODE_NOT_FOUND', 'This video is not available.');
      }
      requirePublishedOrAdmin(
        episode.published === true && season.published === true && series.published === true,
        isAdmin,
      );
      trackColumn = 'episode_id';
    }

    const { data: tracks, error: tracksError } = await client
      .from('subtitle_tracks')
      .select('id,language_label,format,storage_path')
      .eq(trackColumn, contentId)
      .order('language_label', { ascending: true });
    if (tracksError) {
      throw new HttpError(502, 'SUBTITLE_LOOKUP_FAILED', 'Could not load subtitles for this video.');
    }
    const signedTracks = await Promise.all(
      (tracks ?? []).map(async (track) => {
        const { data, error } = await client.storage
          .from('subtitle-files')
          .createSignedUrl(track.storage_path, 7200);
        if (error || !data?.signedUrl) {
          throw new HttpError(502, 'SUBTITLE_URL_FAILED', 'Could not prepare a subtitle track.');
        }
        return {
          id: track.id,
          languageLabel: track.language_label,
          format: track.format,
          url: data.signedUrl,
        };
      }),
    );
    writeJson(response, 200, { tracks: signedTracks });
    return;
  }

  const trailerPlayUrlMatch = /^\/(movies|series)\/([^/]+)\/trailer-play-url$/.exec(pathname);
  if (trailerPlayUrlMatch) {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    const { client, isAdmin } = await authenticatePlayback(config, request.headers.authorization);
    let titleId: string;
    try {
      titleId = decodeURIComponent(trailerPlayUrlMatch[2]);
    } catch {
      throw new HttpError(400, 'INVALID_TITLE_ID', 'The title ID is invalid.');
    }
    if (!isMovieId(titleId)) {
      throw new HttpError(400, 'INVALID_TITLE_ID', 'The title ID is invalid.');
    }
    const { data, error } = await client
      .from('movies')
      .select('content_type,trailer_storage_key,published')
      .eq('id', titleId)
      .maybeSingle();
    if (error) {
      throw new HttpError(502, 'TRAILER_LOOKUP_FAILED', 'Could not load this trailer.');
    }
    if (!data || (trailerPlayUrlMatch[1] === 'series') !== (data.content_type === 'series')) {
      throw new HttpError(
        isAdmin ? 404 : 403,
        isAdmin ? 'TITLE_NOT_FOUND' : 'ADMIN_REQUIRED',
        isAdmin ? 'The requested title was not found.' : 'Admin access is required.',
      );
    }
    requirePublishedOrAdmin(data.published === true, isAdmin);
    if (typeof data.trailer_storage_key !== 'string' || !data.trailer_storage_key.trim()) {
      throw new HttpError(404, 'TRAILER_NOT_FOUND', 'This title does not have a trailer.');
    }
    const trailerUrl = await getStorage(config).createTrailerPlayUrl(data.trailer_storage_key, titleId);
    writeJson(response, 200, { url: trailerUrl, expiresIn: 900 });
    return;
  }

  if (pathname === '/api/playback/session') {
    if (request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    throw new HttpError(
      501,
      'NOT_IMPLEMENTED',
      'Playback authorization requires a configured licensed content provider.',
    );
  }

  if (!pathname.startsWith('/api/')) {
    throw new HttpError(404, 'NOT_FOUND', 'The requested endpoint was not found.');
  }
  if (request.method !== 'GET') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
  }

  if (pathname === '/api/genres') {
    writeJson(response, 200, { genres: await content.getGenres() });
    return;
  }

  const page = pageFrom(url);
  let result: ContentPage;

  switch (pathname) {
    case '/api/content/trending':
      result = await content.getTrending(page);
      break;
    case '/api/content/popular':
      result = await content.getPopular(page);
      break;
    case '/api/content/upcoming':
      result = await content.getUpcoming(page);
      break;
    case '/api/content/now-playing':
      result = await content.getNowPlaying(page);
      break;
    case '/api/content/movies':
      result = await content.getMovies(page);
      break;
    case '/api/content/series':
      result = await content.getSeries(page);
      break;
    case '/api/content/anime':
      result = await content.getAnime(page);
      break;
    case '/api/content/search': {
      const query = requiredQuery(url, 'q', MAX_QUERY_LENGTH);
      result = await content.search(query, page, optionalQuery(url, 'genre', MAX_GENRE_LENGTH));
      break;
    }
    case '/api/content/genre': {
      const genre = requiredQuery(url, 'name', MAX_GENRE_LENGTH);
      result = await content.getByGenre(genre, page);
      break;
    }
    default: {
      const detailMatch = /^\/api\/content\/([^/]+)(?:\/(similar))?$/.exec(pathname);
      if (!detailMatch) {
        throw new HttpError(404, 'NOT_FOUND', 'The requested endpoint was not found.');
      }

      let id: string;
      try {
        id = decodeURIComponent(detailMatch[1]);
      } catch {
        throw new HttpError(400, 'INVALID_CONTENT_ID', 'The content ID is invalid.');
      }
      if (!/^tmdb:(movie|tv):\d+$/.test(id)) {
        throw new HttpError(400, 'INVALID_CONTENT_ID', 'The content ID is invalid.');
      }

      if (detailMatch[2] === 'similar') {
        result = await content.getSimilar(id, page);
        writeJson(response, 200, pageResponse(result));
        return;
      }

      const item = await content.getById(id);
      writeJson(response, 200, { item });
      return;
    }
  }

  writeJson(response, 200, pageResponse(result));
}

export function createApiServer(config: Config, content: ContentService, options: ApiServerOptions = {}): Server {
  const getStorage = options.storageFactory ?? getB2Storage;
  const unusedMediaScans = new Map<string, UnusedMediaScan>();
  const activeMultipartUploads = new Set<string>();
  const now = options.now ?? Date.now;
  return createServer((request, response) => {
    void handleRequest(request, response, config, content, getStorage, unusedMediaScans, activeMultipartUploads, now).catch((error: unknown) => {
      const httpError =
        error instanceof HttpError
          ? error
          : error instanceof ContentNotFoundError
            ? new HttpError(404, 'CONTENT_NOT_FOUND', 'The requested content was not found.')
            : mapProviderError(error);

      if (httpError.status >= 500) {
        const method = request.method ?? 'UNKNOWN';
        const route = sanitizeUrl(request.url ?? '/');
        const clientIp = getClientIp(request);
        console.error(`[Geniuz API] ${method} ${route} ${httpError.code} ${clientIp}`);
      }

      if (!response.headersSent) {
        writeJson(response, httpError.status, {
          error: { code: httpError.code, message: httpError.message },
        });
      } else {
        response.destroy();
      }
    });
  });
}
