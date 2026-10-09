import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

const CARD_WIDTH = 160;
const CARD_GAP = 8;
const STEP = CARD_WIDTH + CARD_GAP;
const SLIDE_MS = 5000;

function formatLagosDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

// Live clock (mm:ss). If the provider sends a minute, the clock starts from it and
// the seconds are counted here (approximate). If it sends none, the clock is
// ESTIMATED from the kick-off time (45 min, 15 min break, second half).
// It is replaced by the real minute when the provider sends it.
function pad(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

function estimateClock(startsAt: string, nowMs: number): string {
  const elapsed = Math.floor((nowMs - new Date(startsAt).getTime()) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < 1) {
    return '00:00';
  }
  if (elapsed <= 45 * 60) {
    return `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}`;
  }
  if (elapsed <= 60 * 60) {
    return 'HT';
  }
  const second = elapsed - 15 * 60;
  if (second > 90 * 60) {
    return '90+';
  }
  return `${pad(Math.floor(second / 60))}:${pad(second % 60)}`;
}

function LiveClock({ match }: { match: FootballMatch }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [seen, setSeen] = useState({ minute: match.minute, at: nowMs });
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  if (seen.minute !== match.minute) {
    setSeen({ minute: match.minute, at: nowMs });
  }
  let label: string;
  if (match.minute !== null) {
    const seconds = Math.min(59, Math.max(0, Math.floor((nowMs - seen.at) / 1000)));
    label = `${pad(match.minute)}:${pad(seconds)}`;
  } else {
    label = estimateClock(match.startsAt, nowMs);
  }
  return <Text style={styles.liveMinute}>{label}</Text>;
}

export function FootballHomeCard({ matches, date, goalSignals, isOffline, onOpenFootball, onPin }: Props) {
  const sortedMatches = sortHomeFootballMatches(matches);
  const liveOnly = sortedMatches.filter((match) => match.status === 'live');
  const liveUpcoming = liveOnly.length > 0 ? liveOnly : sortedMatches;
  const count = liveUpcoming.length;
  const listRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTouching, setIsTouching] = useState(false);
  useEffect(() => {
    if (count < 2 || isTouching || isOffline) {
      return;
    }
    const slide = setInterval(() => {
      const nextIndex = (activeIndex + 1) % count;
      listRef.current?.scrollTo({ x: nextIndex * STEP, animated: true });
      setActiveIndex(nextIndex);
    }, SLIDE_MS);
    return () => clearInterval(slide);
  }, [activeIndex, count, isTouching, isOffline]);

  useEffect(() => {
    if (count > 0 && activeIndex > count - 1) {
      setActiveIndex(count - 1);
    }
  }, [activeIndex, count]);

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / STEP);
    setActiveIndex(Math.max(0, Math.min(count - 1, index)));
    setIsTouching(false);
  };

  if (count === 0) {
    return null;
  }

  return (
    <View>
      <ScrollView
        ref={listRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        snapToInterval={STEP}
        decelerationRate="fast"
        onScrollBeginDrag={() => setIsTouching(true)}
        onMomentumScrollEnd={handleScrollEnd}
      >
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
                      <LiveClock match={match} />
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
                  <Ionicons name="pin-outline" size={11} color={theme.accent} />
                  <Text style={styles.pinText}>Pin live score</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {count > 1 ? (
        <View style={styles.dots} accessibilityLabel={`Match ${activeIndex + 1} of ${count}`}>
          {liveUpcoming.map((match, index) => (
            <Pressable
              key={match.id}
              accessibilityRole="button"
              accessibilityLabel={`Show match ${index + 1}`}
              onPress={() => {
                listRef.current?.scrollTo({ x: index * STEP, animated: true });
                setActiveIndex(index);
              }}
              style={[styles.dot, index === activeIndex && styles.activeDot]}
            />
          ))}
        </View>
      ) : null}
    </View>
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
  list: { gap: CARD_GAP, paddingHorizontal: 16 },
  card: { backgroundColor: theme.surface, borderRadius: 12, minHeight: 92, overflow: 'hidden', width: CARD_WIDTH },
  tab: {
    alignSelf: 'center',
    backgroundColor: theme.background,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxWidth: 130,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  tabText: { color: theme.text, fontSize: 10, fontWeight: '700' },
  body: { alignItems: 'center', flex: 1, flexDirection: 'row', paddingHorizontal: 4 },
  team: { alignItems: 'center', flex: 1 },
  badgeWrap: { alignItems: 'center', height: 22, justifyContent: 'center', width: 28 },
  badge: { alignItems: 'center', height: 22, justifyContent: 'center', width: 22 },
  compactBadge: { backgroundColor: theme.background, borderRadius: 17, height: 34, width: 34 },
  badgeImage: { height: '100%', width: '100%' },
  badgeInitial: { color: theme.text, fontSize: 14, fontWeight: '900' },
  teamName: { color: theme.text, fontSize: 9, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 22, width: 52 },
  centerMain: { color: theme.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  centerSub: { color: theme.secondaryText, fontSize: 9, marginTop: 1 },
  liveMinute: { color: theme.accent, fontSize: 10, fontWeight: '900', marginTop: 1, textAlign: 'center' },
  offline: { color: theme.secondaryText, fontSize: 8, marginTop: 2 },
  pinButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    paddingBottom: 5,
  },
  pinText: { color: theme.accent, fontSize: 9, fontWeight: '800' },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center', paddingTop: 6 },
  dot: { backgroundColor: theme.secondaryText, borderRadius: 4, height: 7, opacity: 0.5, width: 7 },
  activeDot: { backgroundColor: theme.accent, opacity: 1, width: 19 },
});
