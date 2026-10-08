import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useContentQuery } from '../hooks/useContentQuery';
import type { FootballMatch, FootballMatchesResponse, FootballTeam } from '../models/football';
import { getFootballMatches } from '../services/createContentService';
import { theme } from '../theme';
import { ContentNotice } from './ContentNotice';

function getWestAfricaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: 'year' | 'month' | 'day') => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function TeamMark({ team }: { team: FootballTeam }) {
  return team.logoUrl ? (
    <Image source={{ uri: team.logoUrl }} style={styles.teamLogo} resizeMode="contain" />
  ) : (
    <View style={styles.teamMarkFallback}>
      <Text style={styles.teamMarkInitial}>{team.name.slice(0, 1).toLocaleUpperCase()}</Text>
    </View>
  );
}

function getMatchStatus(match: FootballMatch) {
  if (match.status === 'live') {
    return match.minute === null ? 'LIVE' : `LIVE · ${match.minute}′`;
  }
  if (match.status === 'scheduled') {
    return formatKickoff(match.startsAt);
  }
  return match.status.charAt(0).toLocaleUpperCase() + match.status.slice(1);
}

function groupByCompetition(matches: FootballMatch[]) {
  const competitions = new Map<string, { name: string; logoUrl?: string; matches: FootballMatch[] }>();
  for (const match of matches) {
    const group = competitions.get(match.competition.id) ?? {
      name: match.competition.name,
      ...(match.competition.logoUrl ? { logoUrl: match.competition.logoUrl } : {}),
      matches: [],
    };
    group.matches.push(match);
    competitions.set(match.competition.id, group);
  }
  return [...competitions.values()];
}

export function FootballMatchesPanel({
  isOnline,
  onRetryConnection,
}: {
  isOnline: boolean;
  onRetryConnection: () => void;
}) {
  const [date] = useState(getWestAfricaDate);
  const loadMatches = useCallback(async () => ({
    data: await getFootballMatches(date),
    source: 'api' as const,
  }), [date]);
  const query = useContentQuery<FootballMatchesResponse>(`football-matches:${date}`, loadMatches, isOnline);
  const competitions = useMemo(
    () => groupByCompetition(query.data?.matches ?? []),
    [query.data?.matches],
  );

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.heading}>Matches</Text>
          <Text style={styles.note}>Scores may be delayed</Text>
          <Text style={styles.note}>All times in West Africa Time</Text>
        </View>
        {query.data?.stale ? (
          <Ionicons accessibilityLabel="Showing cached scores" name="time-outline" size={18} color={theme.warning} />
        ) : null}
      </View>

      {!isOnline ? (
        <ContentNotice
          message="You’re offline. Football scores need an internet connection."
          actionLabel="Retry connection"
          onAction={onRetryConnection}
        />
      ) : null}
      {isOnline && query.isLoading ? <ContentNotice message="Loading football scores…" /> : null}
      {isOnline && query.error ? (
        <ContentNotice
          message="Football scores could not be loaded. Please retry."
          tone="error"
          actionLabel="Retry"
          onAction={query.retry}
        />
      ) : null}
      {isOnline && query.data?.stale ? (
        <Text style={styles.staleMessage}>Showing the last available scores.</Text>
      ) : null}
      {isOnline && !query.isLoading && !query.error && query.data?.matches.length === 0 ? (
        <Text style={styles.emptyMessage}>No matches scheduled for this date.</Text>
      ) : null}

      {competitions.map((competition) => (
        <View key={competition.name} style={styles.competition}>
          <View style={styles.competitionHeading}>
            {competition.logoUrl ? (
              <Image source={{ uri: competition.logoUrl }} style={styles.competitionLogo} resizeMode="contain" />
            ) : null}
            <Text style={styles.competitionName}>{competition.name}</Text>
          </View>
          {competition.matches.map((match) => (
            <View key={match.id} style={styles.matchRow}>
              <View style={styles.team}>
                <TeamMark team={match.homeTeam} />
                <Text style={styles.teamName} numberOfLines={2}>{match.homeTeam.name}</Text>
              </View>
              <View style={styles.scoreBlock}>
                <Text style={styles.score}>
                  {match.homeScore ?? '–'} <Text style={styles.scoreSeparator}>:</Text> {match.awayScore ?? '–'}
                </Text>
                <Text style={[styles.matchStatus, match.status === 'live' && styles.liveStatus]}>
                  {getMatchStatus(match)}
                </Text>
              </View>
              <View style={[styles.team, styles.awayTeam]}>
                <Text style={styles.teamName} numberOfLines={2}>{match.awayTeam.name}</Text>
                <TeamMark team={match.awayTeam} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginBottom: 18 },
  headingRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  heading: { color: theme.text, fontSize: 19, fontWeight: '800' },
  note: { color: theme.secondaryText, fontSize: 12, lineHeight: 17 },
  staleMessage: { color: theme.warning, fontSize: 12 },
  emptyMessage: { color: theme.secondaryText, fontSize: 13, paddingVertical: 12 },
  competition: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  competitionHeading: {
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  competitionLogo: { height: 22, width: 22 },
  competitionName: { color: theme.text, flex: 1, fontSize: 13, fontWeight: '700' },
  matchRow: {
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 70,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  team: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 7, minWidth: 0 },
  awayTeam: { justifyContent: 'flex-end' },
  teamLogo: { height: 24, width: 24 },
  teamMarkFallback: {
    alignItems: 'center',
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  teamMarkInitial: { color: theme.secondaryText, fontSize: 11, fontWeight: '700' },
  teamName: { color: theme.text, flex: 1, fontSize: 12, fontWeight: '600', minWidth: 0 },
  scoreBlock: { alignItems: 'center', minWidth: 64, paddingHorizontal: 4 },
  score: { color: theme.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreSeparator: { color: theme.secondaryText },
  matchStatus: { color: theme.secondaryText, fontSize: 10, marginTop: 2 },
  liveStatus: { color: theme.accent, fontWeight: '800' },
});