import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  LayoutAnimation,
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

const CARD_WIDTH = 184;
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

function pad(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

// ESTIMATED clock when the provider sends no minute: 45 min, 15 min break, second half.
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

type Celebration = {
  matchId: string;
  team: 'home' | 'away';
  count: number;
  token: number;
  minute: string;
  phase: 'goal' | 'scorer';
};

function goalMinuteLabel(match: FootballMatch, nowMs: number): string {
  if (match.minute !== null) {
    return `${match.minute}′`;
  }
  const minutes = parseInt(estimateClock(match.startsAt, nowMs), 10);
  return Number.isFinite(minutes) ? `${minutes}′` : '';
}

// Live clock mm:ss. Remounted (via key) whenever the provider minute changes,
// so the seconds restart from the new minute. Seconds are counted here (approximate).
function LiveClock({ match }: { match: FootballMatch }) {
  const [startedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  let label: string;
  if (match.minute !== null) {
    const seconds = Math.min(59, Math.max(0, Math.floor((nowMs - startedAt) / 1000)));
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
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const handled = useRef<Record<string, number>>({});
  const primed = useRef(false);
  const isCelebrating = celebration !== null;

  const fits = layoutWidth > 0 && contentWidth > 0 && contentWidth <= layoutWidth + 4;
  const maxX = Math.max(0, contentWidth - layoutWidth);
  const safeIndex = count > 0 ? activeIndex % count : 0;
  const ordered = fits
    ? [...liveUpcoming.slice(safeIndex), ...liveUpcoming.slice(0, safeIndex)]
    : liveUpcoming;

  useEffect(() => {
    if (count < 2 || isTouching || isOffline || isCelebrating) {
      return;
    }
    const slide = setInterval(() => {
      const next = (safeIndex + 1) % count;
      if (fits) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      } else {
        listRef.current?.scrollTo({ x: Math.min(next * STEP, maxX), animated: true });
      }
      setActiveIndex(next);
    }, SLIDE_MS);
    return () => clearInterval(slide);
  }, [count, fits, isCelebrating, isOffline, isTouching, maxX, safeIndex]);

  const celebrationKey = celebration ? `${celebration.matchId}-${celebration.token}` : null;

  // Goal detection: a new goal signal on a live match brings that card to the front.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!primed.current) {
        primed.current = true;
        for (const match of liveUpcoming) {
          const oldToken = goalSignals[match.id]?.createdAt;
          if (typeof oldToken === 'number') {
            handled.current[match.id] = oldToken;
          }
        }
        return;
      }
      for (let index = 0; index < liveUpcoming.length; index += 1) {
        const match = liveUpcoming[index];
        const signal = goalSignals[match.id];
        const token = signal?.createdAt;
        if (match.status !== 'live' || !signal || typeof token !== 'number') {
          continue;
        }
        if (handled.current[match.id] === token) {
          continue;
        }
        handled.current[match.id] = token;
        const homeGoals = signal.home ?? 0;
        const awayGoals = signal.away ?? 0;
        if (homeGoals <= 0 && awayGoals <= 0) {
          continue;
        }
        const team = homeGoals >= awayGoals ? 'home' : 'away';
        if (fits) {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        } else {
          listRef.current?.scrollTo({ x: Math.min(index * STEP, maxX), animated: true });
        }
        setActiveIndex(index);
        setCelebration({
          matchId: match.id,
          team,
          count: team === 'home' ? homeGoals : awayGoals,
          token,
          minute: goalMinuteLabel(match, Date.now()),
          phase: 'goal',
        });
        break;
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [fits, goalSignals, liveUpcoming, maxX]);

  // GOAL!!! for 3.5 s, then team name and minute for 3.5 s, then back to normal.
  useEffect(() => {
    if (!celebrationKey) {
      return;
    }
    const toScorer = setTimeout(
      () => setCelebration((current) => (current ? { ...current, phase: 'scorer' } : current)),
      3500,
    );
    const done = setTimeout(() => setCelebration(null), 7000);
    return () => {
      clearTimeout(toScorer);
      clearTimeout(done);
    };
  }, [celebrationKey]);

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    const index = maxX > 0 && x >= maxX - 2 ? count - 1 : Math.round(x / STEP);
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
        onLayout={(event) => setLayoutWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContentWidth(width)}
        onScrollBeginDrag={() => setIsTouching(true)}
        onScrollEndDrag={() => setTimeout(() => setIsTouching(false), 1500)}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {ordered.map((match) => {
          const live = match.status === 'live';
          const goals = goalSignals[match.id];
          const celebrating = celebration && celebration.matchId === match.id ? celebration : null;
          const scoringTeam = celebrating && celebrating.team === 'away' ? match.awayTeam : match.homeTeam;
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
                      <LiveClock key={`${match.id}-${match.minute ?? 'x'}`} match={match} />
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
                  <Ionicons name="pin-outline" size={12} color={theme.accent} />
                  <Text style={styles.pinText}>Pin live score</Text>
                </Pressable>
              ) : null}
              {celebrating ? (
                <View style={styles.celebration} pointerEvents="none">
                  {celebrating.phase === 'goal' ? (
                    <>
                      <View style={styles.celebrationLogoWrap}>
                        <CelebrationLogo logoUrl={scoringTeam.logoUrl} name={scoringTeam.name} />
                        <FootballGoalBalls
                          count={celebrating.count}
                          token={celebrating.token}
                          direction={celebrating.team === 'away' ? 'down' : undefined}
                        />
                      </View>
                      <Text style={styles.goalText}>GOAL!!!</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.scorerTeam} numberOfLines={2}>{scoringTeam.name}</Text>
                      <Text style={styles.scorerMinute}>{`Goal ${celebrating.minute}`}</Text>
                    </>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {count > 1 ? (
        <View style={styles.dots} accessibilityLabel={`Match ${safeIndex + 1} of ${count}`}>
          {liveUpcoming.map((match, index) => (
            <Pressable
              key={match.id}
              accessibilityRole="button"
              accessibilityLabel={`Show match ${index + 1}`}
              onPress={() => {
                if (!fits) {
                  listRef.current?.scrollTo({ x: Math.min(index * STEP, maxX), animated: true });
                }
                setActiveIndex(index);
              }}
              style={[styles.dot, index === safeIndex && styles.activeDot]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CelebrationLogo({ logoUrl, name }: { logoUrl?: string; name: string }) {
  return logoUrl ? (
    <Image source={{ uri: logoUrl }} resizeMode="contain" style={styles.celebrationLogo} />
  ) : (
    <Text style={styles.celebrationInitial}>{name.slice(0, 1).toLocaleUpperCase()}</Text>
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
  card: { backgroundColor: theme.surface, borderRadius: 12, minHeight: 106, overflow: 'hidden', width: CARD_WIDTH },
  tab: {
    alignSelf: 'center',
    backgroundColor: theme.background,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  tabText: { color: theme.text, fontSize: 11, fontWeight: '700' },
  body: { alignItems: 'center', flex: 1, flexDirection: 'row', paddingHorizontal: 4 },
  team: { alignItems: 'center', flex: 1 },
  badgeWrap: { alignItems: 'center', height: 26, justifyContent: 'center', width: 32 },
  badge: { alignItems: 'center', height: 26, justifyContent: 'center', width: 26 },
  compactBadge: { backgroundColor: theme.background, borderRadius: 17, height: 34, width: 34 },
  badgeImage: { height: '100%', width: '100%' },
  badgeInitial: { color: theme.text, fontSize: 16, fontWeight: '900' },
  teamName: { color: theme.text, fontSize: 10, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 26, width: 58 },
  centerMain: { color: theme.text, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  centerSub: { color: theme.secondaryText, fontSize: 10, marginTop: 1 },
  liveMinute: { color: theme.accent, fontSize: 11, fontWeight: '900', marginTop: 1, textAlign: 'center' },
  offline: { color: theme.secondaryText, fontSize: 8, marginTop: 2 },
  pinButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    paddingBottom: 5,
  },
  pinText: { color: theme.accent, fontSize: 10, fontWeight: '800' },
  celebration: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: theme.surface,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  celebrationLogoWrap: { alignItems: 'center', height: 50, justifyContent: 'center', width: 60 },
  celebrationLogo: { height: 44, width: 44 },
  celebrationInitial: { color: theme.text, fontSize: 30, fontWeight: '900' },
  goalText: { color: theme.accent, fontSize: 20, fontWeight: '900', marginTop: 2 },
  scorerTeam: { color: theme.text, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  scorerMinute: { color: theme.accent, fontSize: 16, fontWeight: '900', marginTop: 4 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center', paddingTop: 6 },
  dot: { backgroundColor: theme.secondaryText, borderRadius: 4, height: 7, opacity: 0.5, width: 7 },
  activeDot: { backgroundColor: theme.accent, opacity: 1, width: 19 },
});
