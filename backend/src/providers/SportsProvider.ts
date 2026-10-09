export type FootballMatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export type FootballMatch = {
  id: string;
  competition: {
    id: string;
    name: string;
    logoUrl?: string;
  };
  startsAt: string;
  status: FootballMatchStatus;
  minute: number | null;
  homeTeam: {
    name: string;
    logoUrl?: string;
  };
  awayTeam: {
    name: string;
    logoUrl?: string;
  };
  homeScore: number | null;
  awayScore: number | null;
};

export type FootballMatchesResponse = {
  date: string;
  fetchedAt: string;
  stale: boolean;
  matches: FootballMatch[];
};

export class SportsProviderError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'UNAVAILABLE',
  ) {
    super(code);
    this.name = 'SportsProviderError';
  }
}

export interface SportsProvider {
  getMatches(date: string): Promise<FootballMatch[]>;
  getMatchesRange?(dateFrom: string, dateTo: string): Promise<FootballMatch[]>;
}

export class UnconfiguredSportsProvider implements SportsProvider {
  async getMatches(_date: string): Promise<FootballMatch[]> {
    throw new SportsProviderError('NOT_CONFIGURED');
  }
}
