import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { FootballMatch } from '../models/football';
import { formatWestAfricaKickoff, sortHomeFootballMatches } from '../utils/footballScores';
import type { GoalBallCounts } from '../utils/footballPin';
import { FootballGoalBalls } from './FootballGoalBalls';
import { theme } from '../theme';

type GoalSignal = GoalBallCounts & { createdAt?: number };

type Props = {
  matches: FootballMatch[];
  date: string;
  goalSignals: Record<string, GoalSignal>;
  isOffline: boolean;
  onOpenFootball: (date: string) => void;
  onPin: (match: FootballMatch, date: string) => void;
};

function formatLagosDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

export function FootballHomeCard({ matches, date, goalSignals, isOffline, onOpenFootball, onPin }: Props) {
  const liveUpcoming = sortHomeFootballMatches(matches);
  if (liveUpcoming.length === 0) {
    return null;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
      {liveUpcoming.map((match) => {
        const live = match.status === 'live';
        const goals = goalSignals[match.id];
        return (
          <View key={match.id} style={styles.card}>
            <View style={styles.tab}>
              <Text style={styles.tabText} numberOfLines={1}>{match.competition.name}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${match.competition.name}: ${match.homeTeam.name} versus ${match.awayTeam.name}`}
              onPress={() => onOpenFootball(date)}
              style={styles.body}
            >
              <View style={styles.team}>
                <View style={styles.badgeWrap}>
                  <TeamBadge logoUrl={match.homeTeam.logoUrl} name={match.homeTeam.name} />
                  <FootballGoalBalls count={goals?.home ?? 0} token={goals?.createdAt} />
                </View>
                <Text style={styles.teamName} numberOfLines={2}>{match.homeTeam.name}</Text>
              </View>
              <View style={styles.center}>
                {live ? (
                  <>
                    <Text style={styles.centerMain}>{match.homeScore ?? '-'} - {match.awayScore ?? '-'}</Text>
                    <Text style={styles.liveMinute}>{match.minute === null ? 'LIVE' : `LIVE ${match.minute}′`}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.centerMain}>{formatWestAfricaKickoff(match.startsAt)}</Text>
                    <Text style={styles.centerSub}>{formatLagosDate(match.startsAt)}</Text>
                  </>
                )}
                {isOffline ? <Text style={styles.offline}>Offline</Text> : null}
              </View>
              <View style={styles.team}>
                <View style={styles.badgeWrap}>
                  <TeamBadge logoUrl={match.awayTeam.logoUrl} name={match.awayTeam.name} />
                  <FootballGoalBalls count={goals?.away ?? 0} token={goals?.createdAt} direction="down" />
                </View>
                <Text style={styles.teamName} numberOfLines={2}>{match.awayTeam.name}</Text>
              </View>
            </Pressable>
            {live ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Pin ${match.homeTeam.name} versus ${match.awayTeam.name} livescore`}
                onPress={() => onPin(match, date)}
                style={styles.pinButton}
              >
                <Ionicons name="pin-outline" size={15} color={theme.accent} />
                <Text style={styles.pinText}>Pin live score</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

export function TeamBadge({ logoUrl, name, compact = false }: { logoUrl?: string; name: string; compact?: boolean }) {
  return (
    <View style={[styles.badge, compact && styles.compactBadge]}>
      {logoUrl ? (
        <Image source={{ uri: logoUrl }} resizeMode="contain" style={styles.badgeImage} />
      ) : (
        <Text style={styles.badgeInitial}>{name.slice(0, 1).toLocaleUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingHorizontal: 16 },
  card: { backgroundColor: theme.surface, borderRadius: 16, minHeight: 170, overflow: 'hidden', width: 310 },
  tab: {
    alignSelf: 'center',
    backgroundColor: theme.background,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    maxWidth: 220,
    paddingHorizontal: 18,
    paddingVertical: 5,
  },
  tabText: { color: theme.text, fontSize: 13, fontWeight: '700' },
  body: { alignItems: 'center', flex: 1, flexDirection: 'row', paddingHorizontal: 8 },
  team: { alignItems: 'center', flex: 1 },
  badgeWrap: { alignItems: 'center', height: 32, justifyContent: 'center', width: 40 },
  badge: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  compactBadge: { backgroundColor: theme.background, borderRadius: 17, height: 34, width: 34 },
  badgeImage: { height: '100%', width: '100%' },
  badgeInitial: { color: theme.text, fontSize: 21, fontWeight: '900' },
  teamName: { color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 32, width: 76 },
  centerMain: { color: theme.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  centerSub: { color: theme.secondaryText, fontSize: 12, marginTop: 2 },
  liveMinute: { color: theme.accent, fontSize: 11, fontWeight: '900', marginTop: 2 },
  offline: { color: theme.secondaryText, fontSize: 10, marginTop: 4 },
  pinButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingBottom: 12,
  },
  pinText: { color: theme.accent, fontSize: 12, fontWeight: '800' },
});
