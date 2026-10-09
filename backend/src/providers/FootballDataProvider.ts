import {
  SportsProviderError,
  type FootballMatch,
  type FootballMatchStatus,
  type SportsProvider,
} from './SportsProvider';

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SportsProviderError('INVALID_RESPONSE');
  }
  return value;
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SportsProviderError('INVALID_RESPONSE');
  }
  return value.trim();
}

function optionalLogo(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function scoreValue(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function mapStatus(value: unknown): FootballMatchStatus {
  switch (value) {
    case 'IN_PLAY':
    case 'PAUSED':
    case 'EXTRA_TIME':
    case 'PENALTY_SHOOTOUT':
    case 'SUSPENDED':
    case 'INTERRUPTED':
      return 'live';
    case 'FINISHED':
    case 'AWARDED':
      return 'finished';
    case 'POSTPONED':
      return 'postponed';
    case 'CANCELLED':
      return 'cancelled';
    case 'SCHEDULED':
    case 'TIMED':
      return 'scheduled';
    default:
      throw new SportsProviderError('INVALID_RESPONSE');
  }
}

function parseMatch(value: unknown): FootballMatch {
  const match = requiredRecord(value, 'match');
  const competition = requiredRecord(match.competition, 'competition');
  const homeTeam = requiredRecord(match.homeTeam, 'home team');
  const awayTeam = requiredRecord(match.awayTeam, 'away team');
  const score = requiredRecord(match.score, 'score');
  const fullTimeScore = isRecord(score.fullTime) ? score.fullTime : {};
  const startsAt = requiredText(match.utcDate);
  if (!Number.isFinite(Date.parse(startsAt)) || typeof match.id !== 'number') {
    throw new SportsProviderError('INVALID_RESPONSE');
  }
  const minute = Number.isInteger(match.minute) && Number(match.minute) >= 0 && Number(match.minute) <= 180
    ? Number(match.minute)
    : null;

  return {
    id: String(match.id),
    competition: {
      id: String(competition.id ?? ''),
      name: requiredText(competition.name),
      ...(optionalLogo(competition.emblem) ? { logoUrl: optionalLogo(competition.emblem) } : {}),
    },
    startsAt: new Date(startsAt).toISOString(),
    ...(Number.isInteger(match.matchday) && Number(match.matchday) > 0
      ? { round: `Matchday ${Number(match.matchday)}` }
      : {}),
    status: mapStatus(match.status),
    minute,
    homeTeam: {
      name: requiredText(homeTeam.shortName ?? homeTeam.name),
      ...(optionalLogo(homeTeam.crest) ? { logoUrl: optionalLogo(homeTeam.crest) } : {}),
    },
    awayTeam: {
      name: requiredText(awayTeam.shortName ?? awayTeam.name),
      ...(optionalLogo(awayTeam.crest) ? { logoUrl: optionalLogo(awayTeam.crest) } : {}),
    },
    homeScore: scoreValue(fullTimeScore.home),
    awayScore: scoreValue(fullTimeScore.away),
  };
}

export class FootballDataProvider implements SportsProvider {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  getMatches(date: string) {
    return this.getMatchesRange(date, date);
  }

  async getMatchesRange(dateFrom: string, dateTo: string) {
    if (!this.apiKey) {
      throw new SportsProviderError('NOT_CONFIGURED');
    }
    const url = new URL('https://api.football-data.org/v4/matches');
    url.searchParams.set('dateFrom', dateFrom);
    url.searchParams.set('dateTo', dateTo);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        headers: { 'X-Auth-Token': this.apiKey },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new SportsProviderError('RATE_LIMITED');
      }
      if (!response.ok) {
        throw new SportsProviderError('UNAVAILABLE');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SportsProviderError('INVALID_RESPONSE');
      }
      if (!isRecord(payload) || !Array.isArray(payload.matches)) {
        throw new SportsProviderError('INVALID_RESPONSE');
      }
      return payload.matches.flatMap((item) => {
        try {
          return [parseMatch(item)];
        } catch {
          return [];
        }
      });
    } catch (error) {
      if (error instanceof SportsProviderError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new SportsProviderError('TIMEOUT');
      }
      throw new SportsProviderError('UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}
