import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Config } from '../config/config';
import type { ContentPage } from '../models/content';
import { ContentNotFoundError, ContentService } from '../services/ContentService';
import { HttpError, mapProviderError } from './errors';

const MAX_PAGE = 500;
const MAX_QUERY_LENGTH = 120;
const MAX_GENRE_LENGTH = 80;

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
  if (origin && config.corsOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  content: ContentService,
) {
  withCors(request, response, config);

  if (request.method === 'OPTIONS') {
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
