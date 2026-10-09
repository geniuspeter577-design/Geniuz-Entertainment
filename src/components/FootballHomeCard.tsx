import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { FootballMatch } from '../models/football';
import { getKickoffPresentation, sortHomeFootballMatches } from '../utils/footballScores';
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

export function FootballHomeCard({ matches, date, goalSignals, isOffline, onOpenFootball, onPin }: Props) {
  const liveUpcoming = sortHomeFootballMatches(matches);
  if (liveUpcoming.length === 0) {
    return null;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
      {liveUpcoming.map((match) => {
        const live = match.status === 'live';
        const kickoff = !live ? getKickoffPresentation(match.startsAt) : undefined;
        const goals = goalSignals[match.id];
        const subtitle = isOffline
          ? 'Offline · last available score'
          : match.round ?? (live ? 'Live match' : 'Scheduled fixture');
        return (
          <View key={match.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${match.competition.name}: ${match.homeTeam.name} versus ${match.awayTeam.name}`}
              onPress={() => onOpenFootball(date)}
              style={styles.body}
            >
              <View style={styles.topLine}>
                <Text style={styles.competition} numberOfLines={1}>{match.competition.name}</Text>
                {live ? (
                  <Text style={styles.minute}>{match.minute === null ? 'LIVE' : `LIVE · ${match.minute}′`}</Text>
                ) : null}
              </View>
              <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
              <View style={styles.matchup}>
                <View style={styles.team}>
                  <View style={styles.badgeWrap}>
                    <TeamBadge logoUrl={match.homeTeam.logoUrl} name={match.homeTeam.name} />
                    <FootballGoalBalls count={goals?.home ?? 0} token={goals?.createdAt} />
                  </View>
                  <Text style={styles.teamName} numberOfLines={1}>{match.homeTeam.name}</Text>
                </View>
                <View style={styles.center}>
                  {live ? (
                    <Text style={styles.score}>{match.homeScore ?? '–'} <Text style={styles.dash}>–</Text> {match.awayScore ?? '–'}</Text>
                  ) : (
                    <Text style={styles.kickoff}>{kickoff?.label}</Text>
                  )}
                  {kickoff?.comingSoon ? <Text style={styles.comingSoon}>Coming soon</Text> : null}
                </View>
                <View style={styles.team}>
                  <View style={styles.badgeWrap}>
                    <TeamBadge logoUrl={match.awayTeam.logoUrl} name={match.awayTeam.name} />
                    <FootballGoalBalls count={goals?.away ?? 0} token={goals?.createdAt} direction="down" />
                  </View>
                  <Text style={styles.teamName} numberOfLines={1}>{match.awayTeam.name}</Text>
                </View>
              </View>
            </Pressable>
            {live ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Pin ${match.homeTeam.name} versus ${match.awayTeam.name} live score`}
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
  list: { gap: 12, paddingRight: 18 },
  card: { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: 12, borderWidth: 1, minHeight: 204, overflow: 'hidden', padding: 14, width: 286 },
  body: { flex: 1 },
  topLine: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'space-between', minHeight: 22 },
  competition: { color: theme.text, flex: 1, fontSize: 12, fontWeight: '800' },
  minute: { color: theme.accent, fontSize: 11, fontWeight: '900' },
  subtitle: { color: theme.secondaryText, fontSize: 10, marginTop: 2 },
  matchup: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 },
  team: { alignItems: 'center', flex: 1, gap: 6, minWidth: 0 },
  badgeWrap: { height: 54, justifyContent: 'center', position: 'relative', width: 70, alignItems: 'center' },
  badge: { alignItems: 'center', backgroundColor: theme.background, borderColor: theme.border, borderRadius: 27, borderWidth: 1, height: 54, justifyContent: 'center', overflow: 'hidden', width: 54 },
  compactBadge: { borderRadius: 17, height: 34, width: 34 },
  badgeImage: { height: '72%', width: '72%' },
  badgeInitial: { color: theme.text, fontSize: 21, fontWeight: '900' },
  teamName: { color: theme.text, fontSize: 11, fontWeight: '700', maxWidth: '100%', textAlign: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', minWidth: 94, paddingHorizontal: 2 },
  score: { color: theme.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  dash: { color: theme.secondaryText },
  kickoff: { color: theme.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  comingSoon: { color: theme.secondaryText, fontSize: 9, marginTop: 4 },
  pinButton: { alignItems: 'center', borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 34, marginTop: 8 },
  pinText: { color: theme.accent, fontSize: 11, fontWeight: '800' },
});
