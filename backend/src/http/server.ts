import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Config } from '../config/config';
import type { ContentPage } from '../models/content';
import { B2StorageService } from '../storage/B2StorageService';
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
    'Cache-Control': 'no-store',
  });
  response.end(body);
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

  if (pathname === '/health') {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    writeJson(response, 200, { status: 'ok', service: 'geniuz-api' });
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    await authenticateAdmin(config, request.headers.authorization);
    const storage = getB2Storage(config);

    if (pathname === '/uploads/init') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const input = validateUploadInput(await readJson(request));
      writeJson(
        response,
        201,
        await storage.startMultipartUpload(input.fileName, input.contentType, input.objectType),
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
      writeJson(response, 200, await storage.completeMultipartUpload(key, uploadId, parts));
      return;
    }

    if (pathname === '/uploads/abort') {
      if (request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
      }
      const body = await readJson(request);
      await storage.abortMultipartUpload(
        requiredString(body, 'key'),
        requiredString(body, 'uploadId'),
      );
      writeJson(response, 200, { aborted: true });
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
    if (data.storage_provider !== 'b2' || typeof data.storage_key !== 'string') {
      throw new HttpError(409, 'NOT_B2_STORAGE', 'This movie is not stored in Backblaze.');
    }
    const playbackUrl = await getB2Storage(config).createPlayUrl(data.storage_key);
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
    if (data.storage_provider !== 'b2' || typeof data.storage_key !== 'string') {
      throw new HttpError(409, 'NOT_B2_STORAGE', 'This episode is not stored in Backblaze.');
    }
    const playbackUrl = await getB2Storage(config).createPlayUrl(data.storage_key);
    writeJson(response, 200, { url: playbackUrl, expiresIn: 7200 });
    return;
  }

  if (pathname === '/api/playback/session' || pathname === '/api/downloads/authorize') {
    if (request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not allowed.');
    }
    throw new HttpError(
      501,
      'NOT_IMPLEMENTED',
      'Playback and download authorization require a configured licensed content provider.',
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

export function createApiServer(config: Config, content: ContentService): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, config, content).catch((error: unknown) => {
      const httpError =
        error instanceof HttpError
          ? error
          : error instanceof ContentNotFoundError
            ? new HttpError(404, 'CONTENT_NOT_FOUND', 'The requested content was not found.')
            : mapProviderError(error);

      if (httpError.status >= 500) {
        const method = request.method ?? 'UNKNOWN';
        const route = request.url?.split('?')[0] ?? 'unknown';
        console.error(`[Geniuz API] ${method} ${route} failed: ${httpError.code}`);
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
