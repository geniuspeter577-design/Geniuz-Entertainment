export type FootballMatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export type FootballTeam = {
  name: string;
  logoUrl?: string;
};

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
  homeTeam: FootballTeam;
  awayTeam: FootballTeam;
  homeScore: number | null;
  awayScore: number | null;
};

export type FootballMatchesResponse = {
  date: string;
  fetchedAt: string;
  stale: boolean;
  matches: FootballMatch[];
};