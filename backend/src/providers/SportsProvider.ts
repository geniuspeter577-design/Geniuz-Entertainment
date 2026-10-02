export type LiveMatch = {
  id: string;
  competition: string;
  startsAt: string;
  status: 'scheduled' | 'live' | 'finished';
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
};

export interface SportsProvider {
  getLiveMatches(): Promise<LiveMatch[]>;
  getUpcomingMatches(): Promise<LiveMatch[]>;
  getResults(): Promise<LiveMatch[]>;
  getCompetition(id: string): Promise<unknown | null>;
}

export class UnconfiguredSportsProvider implements SportsProvider {
  async getLiveMatches(): Promise<LiveMatch[]> {
    return [];
  }
  async getUpcomingMatches(): Promise<LiveMatch[]> {
    return [];
  }
  async getResults(): Promise<LiveMatch[]> {
    return [];
  }
  async getCompetition(_id: string): Promise<null> {
    return null;
  }
}
