import type {
  FootballMatch,
  FootballMatchesResponse,
  SportsProvider,
} from '../providers/SportsProvider';

export const LIVE_MATCH_CACHE_MS = 60_000;
export const NON_LIVE_MATCH_CACHE_MS = 10 * 60_000;
const PROVIDER_RETRY_DELAY_MS = 60_000;

type CachedMatches = {
  response: FootballMatchesResponse;
  expiresAt: number;
  retryAfter?: number;
};

export class FootballMatchesService {
  private readonly cache = new Map<string, CachedMatches>();
  private readonly inFlight = new Map<string, Promise<FootballMatchesResponse>>();

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

    const request = this.loadMatches(date, cached)
      .finally(() => this.inFlight.delete(date));
    this.inFlight.set(date, request);
    return request;
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
