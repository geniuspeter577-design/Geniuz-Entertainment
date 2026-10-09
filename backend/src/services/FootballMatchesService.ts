import type {
  FootballMatch,
  FootballMatchesResponse,
  SportsProvider,
} from '../providers/SportsProvider';
import { SportsProviderError } from '../providers/SportsProvider';

export const LIVE_MATCH_CACHE_MS = 60_000;
export const NON_LIVE_MATCH_CACHE_MS = 10 * 60_000;
const PROVIDER_RETRY_DELAY_MS = 60_000;
const PROVIDER_REQUEST_WINDOW_MS = 60_000;
const PROVIDER_REQUEST_LIMIT = 10;

type CachedMatches = {
  response: FootballMatchesResponse;
  expiresAt: number;
  retryAfter?: number;
};

export class FootballMatchesService {
  private readonly cache = new Map<string, CachedMatches>();
  private readonly inFlight = new Map<string, Promise<FootballMatchesResponse>>();
  private readonly providerRequestTimes: number[] = [];

  constructor(
    private readonly provider: SportsProvider,
    private readonly now: () => number = Date.now,
  ) {}

  getMatches(date: string): Promise<FootballMatchesResponse> {
    const cached = this.cache.get(date);
    const now = this.now();
    if (cached?.expiresAt && cached.expiresAt > now) {
      return Promise.resolve(cached.response);
    }
    if (cached?.retryAfter && cached.retryAfter > now) {
      return Promise.resolve({ ...cached.response, stale: true });
    }

    const existing = this.inFlight.get(date);
    if (existing) {
      return existing;
    }

    while (
      this.providerRequestTimes.length > 0 &&
      this.providerRequestTimes[0] <= now - PROVIDER_REQUEST_WINDOW_MS
    ) {
      this.providerRequestTimes.shift();
    }
    if (this.providerRequestTimes.length >= PROVIDER_REQUEST_LIMIT) {
      if (!cached) {
        throw new SportsProviderError('RATE_LIMITED');
      }
      const retryAfter = this.providerRequestTimes[0] + PROVIDER_REQUEST_WINDOW_MS;
      this.cache.set(date, { ...cached, retryAfter });
      return Promise.resolve({ ...cached.response, stale: true });
    }
    this.providerRequestTimes.push(now);

    const request = this.loadMatches(date, cached)
      .finally(() => this.inFlight.delete(date));
    this.inFlight.set(date, request);
    return request;
  }

  private upcomingCache: CachedMatches | undefined;
  private upcomingInFlight: Promise<FootballMatchesResponse> | undefined;

  getUpcoming(): Promise<FootballMatchesResponse> {
    const now = this.now();
    const cached = this.upcomingCache;
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.response);
    }
    if (cached?.retryAfter && cached.retryAfter > now) {
      return Promise.resolve({ ...cached.response, stale: true });
    }
    if (this.upcomingInFlight) {
      return this.upcomingInFlight;
    }
    const request = this.loadUpcoming(cached).finally(() => {
      this.upcomingInFlight = undefined;
    });
    this.upcomingInFlight = request;
    return request;
  }

  private takeProviderSlot() {
    const now = this.now();
    while (
      this.providerRequestTimes.length > 0 &&
      this.providerRequestTimes[0] <= now - PROVIDER_REQUEST_WINDOW_MS
    ) {
      this.providerRequestTimes.shift();
    }
    if (this.providerRequestTimes.length >= PROVIDER_REQUEST_LIMIT) {
      return false;
    }
    this.providerRequestTimes.push(now);
    return true;
  }

  private async loadUpcoming(cached: CachedMatches | undefined) {
    try {
      const provider = this.provider;
      if (!provider.getMatchesRange) {
        throw new SportsProviderError('UNAVAILABLE');
      }
      const dayMs = 24 * 60 * 60 * 1000;
      const startMs = this.now();
      const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      let found: FootballMatch[] = [];
      for (let window = 0; window < 2; window += 1) {
        if (!this.takeProviderSlot()) {
          if (found.length > 0) {
            break;
          }
          throw new SportsProviderError('RATE_LIMITED');
        }
        const from = isoDay(startMs + window * 10 * dayMs);
        const to = isoDay(startMs + (window * 10 + 9) * dayMs);
        const matches = await provider.getMatchesRange(from, to);
        found = matches.filter((match) => match.status === 'live' || match.status === 'scheduled');
        if (found.length > 0) {
          break;
        }
      }
      const ordered = found
        .slice()
        .sort((left, right) => {
          const leftLive = left.status === 'live' ? 0 : 1;
          const rightLive = right.status === 'live' ? 0 : 1;
          return leftLive - rightLive || left.startsAt.localeCompare(right.startsAt);
        })
        .slice(0, 30);
      const fetchedAtMs = this.now();
      const response: FootballMatchesResponse = {
        date: isoDay(startMs),
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        stale: false,
        matches: ordered,
      };
      this.upcomingCache = {
        response,
        expiresAt: fetchedAtMs + (ordered.some((match) => match.status === 'live')
          ? LIVE_MATCH_CACHE_MS
          : NON_LIVE_MATCH_CACHE_MS),
      };
      return response;
    } catch (error) {
      if (!cached) {
        throw error;
      }
      this.upcomingCache = { ...cached, retryAfter: this.now() + PROVIDER_RETRY_DELAY_MS };
      return { ...cached.response, stale: true };
    }
  }

  private async loadMatches(date: string, cached: CachedMatches | undefined) {
    try {
      const matches = await this.provider.getMatches(date);
      const fetchedAtMs = this.now();
      const response: FootballMatchesResponse = {
        date,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        stale: false,
        matches: sortMatches(matches),
      };
      this.cache.set(date, {
        response,
        expiresAt: fetchedAtMs + (matches.some((match) => match.status === 'live')
          ? LIVE_MATCH_CACHE_MS
          : NON_LIVE_MATCH_CACHE_MS),
      });
      return response;
    } catch (error) {
      if (!cached) {
        throw error;
      }
      this.cache.set(date, { ...cached, retryAfter: this.now() + PROVIDER_RETRY_DELAY_MS });
      return { ...cached.response, stale: true };
    }
  }
}

function sortMatches(matches: FootballMatch[]) {
  return [...matches].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}
