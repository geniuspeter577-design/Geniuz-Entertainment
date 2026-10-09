import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getUserAppSettings, setUserAppSettings } from '../services/TrailerAutoplayPreference';
import { useAuth } from '../state/AuthContext';
import { useFootballMatches } from '../state/FootballMatchesContext';
import { theme } from '../theme';
import { getFootballPinPosition, snapFootballPinCorner, type FootballPinCorner, type PinPoint } from '../utils/footballPin';
import { FootballGoalBalls } from './FootballGoalBalls';
import { CelebrationLogo, LiveClock, TeamBadge, goalMinuteLabel, type Celebration } from './FootballHomeCard';

const PIN_SIZE = { width: 252, height: 104 };
const DEFAULT_CORNER: FootballPinCorner = 'top-right';

export function FootballScorePin() {
  const auth = useAuth();
  const football = useFootballMatches();
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const [layoutReady, setLayoutReady] = useState(false);
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragStart = useRef<PinPoint>({ x: 0, y: 0 });
  const positionRef = useRef<PinPoint>({ x: 0, y: 0 });
  const dimensionsRef = useRef({ viewport, insets });
  const userIdRef = useRef(auth.session?.user.id);
  dimensionsRef.current = { viewport, insets };
  userIdRef.current = auth.session?.user.id;

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let savedCorner = DEFAULT_CORNER;
      if (auth.session?.user.id) {
        try {
          savedCorner = (await getUserAppSettings(auth.session.user.id)).footballPinCorner ?? DEFAULT_CORNER;
        } catch (error) {
          console.warn('[FootballPin] Could not load the saved position.', error);
        }
      }
      if (!active) {
        return;
      }
      const target = getFootballPinPosition(savedCorner, viewport, PIN_SIZE, insets);
      positionRef.current = target;
      position.setValue(target);
      setLayoutReady(true);
    };
    void restore();
    return () => { active = false; };
  }, [auth.session?.user.id, insets.bottom, insets.left, insets.right, insets.top, position, viewport.height, viewport.width]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => {
      dragStart.current = positionRef.current;
    },
    onPanResponderMove: (_event, gesture) => {
      const next = { x: dragStart.current.x + gesture.dx, y: dragStart.current.y + gesture.dy };
      positionRef.current = next;
      position.setValue(next);
    },
    onPanResponderRelease: (_event, gesture) => {
      const current = { x: dragStart.current.x + gesture.dx, y: dragStart.current.y + gesture.dy };
      const dimensions = dimensionsRef.current;
      const target = snapFootballPinCorner(current, dimensions.viewport, PIN_SIZE, dimensions.insets);
      positionRef.current = { x: target.x, y: target.y };
      Animated.spring(position, { toValue: { x: target.x, y: target.y }, useNativeDriver: false, damping: 24, stiffness: 240 }).start();
      const currentUserId = userIdRef.current;
      if (currentUserId) {
        void getUserAppSettings(currentUserId)
          .then((settings) => setUserAppSettings(currentUserId, { ...settings, footballPinCorner: target.corner }))
          .catch((error: unknown) => console.warn('[FootballPin] Could not save the position.', error));
      }
    },
  }), [position]);

  const match = football.pinnedMatch;
  const goal = match ? football.goalSignals[match.id] : undefined;
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const handledGoal = useRef<Record<string, number>>({});
  const primedFor = useRef<string | null>(null);
  const celebrationKey = celebration ? `${celebration.matchId}-${celebration.token}` : null;

  // Same goal celebration as the Home card. A newly pinned match never replays old goals.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!match) {
        primedFor.current = null;
        return;
      }
      const token = goal?.createdAt;
      if (primedFor.current !== match.id) {
        primedFor.current = match.id;
        handledGoal.current[match.id] = typeof token === 'number' ? token : 0;
        return;
      }
      if (match.status !== 'live' || !goal || typeof token !== 'number' || handledGoal.current[match.id] === token) {
        return;
      }
      handledGoal.current[match.id] = token;
      const homeGoals = goal.home ?? 0;
      const awayGoals = goal.away ?? 0;
      if (homeGoals <= 0 && awayGoals <= 0) {
        return;
      }
      const team = homeGoals >= awayGoals ? 'home' : 'away';
      setCelebration({
        matchId: match.id,
        team,
        count: team === 'home' ? homeGoals : awayGoals,
        token,
        minute: goalMinuteLabel(match, Date.now()),
        phase: 'goal',
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [goal, match]);

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
  if (!football.pinned || !match || !layoutReady) {
    return null;
  }

  const openFootball = () => {
    football.selectDate(football.pinned!.date);
    router.navigate({ pathname: '/(tabs)', params: { category: 'Football' } });
  };

  const celebrating = celebration && celebration.matchId === match.id ? celebration : null;
  const scoringTeam = celebrating && celebrating.team === 'away' ? match.awayTeam : match.homeTeam;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        {...panResponder.panHandlers}
        pointerEvents="auto"
        style={[styles.pin, { width: PIN_SIZE.width, height: PIN_SIZE.height, transform: position.getTranslateTransform() }]}
      >
        <View style={styles.topLine}>
          <Text numberOfLines={1} style={styles.competition}>{match.competition.name}</Text>
          {match.status === 'live' ? (
            <LiveClock key={`${match.id}-${match.minute ?? 'x'}`} match={match} />
          ) : (
            <Text style={styles.minute}>{match.status === 'finished' ? 'FT' : match.status.toLocaleUpperCase()}</Text>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Close pinned score" hitSlop={7} onPress={football.unpinMatch} style={styles.close}>
            <Ionicons name="close" size={16} color={theme.text} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${match.competition.name} in Football`} onPress={openFootball} style={styles.matchRow}>
          <View style={styles.team}>
            <View style={styles.badgeWrap}>
              <TeamBadge compact logoUrl={match.homeTeam.logoUrl} name={match.homeTeam.name} />
              <FootballGoalBalls count={goal?.home ?? 0} token={goal?.createdAt} />
            </View>
            <Text numberOfLines={1} style={styles.teamName}>{match.homeTeam.name}</Text>
          </View>
          <Text style={styles.score}>{match.homeScore ?? '–'}–{match.awayScore ?? '–'}</Text>
          <View style={styles.team}>
            <View style={styles.badgeWrap}>
              <TeamBadge compact logoUrl={match.awayTeam.logoUrl} name={match.awayTeam.name} />
              <FootballGoalBalls count={goal?.away ?? 0} token={goal?.createdAt} direction="down" />
            </View>
            <Text numberOfLines={1} style={styles.teamName}>{match.awayTeam.name}</Text>
          </View>
        </Pressable>
        {celebrating ? (
          <View style={styles.celebration} pointerEvents="none">
            {celebrating.phase === 'goal' ? (
              <View style={styles.celebrationRow}>
                <View style={styles.celebrationLogoWrap}>
                  <CelebrationLogo logoUrl={scoringTeam.logoUrl} name={scoringTeam.name} />
                  <FootballGoalBalls
                    count={celebrating.count}
                    token={celebrating.token}
                    direction={celebrating.team === 'away' ? 'down' : undefined}
                  />
                </View>
                <Text style={styles.goalText}>GOAL!!!</Text>
              </View>
            ) : (
              <>
                <Text style={styles.scorerTeam} numberOfLines={2}>{scoringTeam.name}</Text>
                <Text style={styles.scorerMinute}>{`Goal ${celebrating.minute}`}</Text>
              </>
            )}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    backgroundColor: theme.surface,
    borderColor: theme.accent,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 20,
    left: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    position: 'absolute',
    shadowColor: theme.shadow,
    shadowOpacity: 0.36,
    shadowRadius: 12,
    zIndex: 9999,
  },
  topLine: { alignItems: 'center', flexDirection: 'row', gap: 5, height: 20 },
  competition: { color: theme.text, flex: 1, fontSize: 10, fontWeight: '800' },
  minute: { color: theme.accent, fontSize: 10, fontWeight: '900' },
  close: { alignItems: 'center', height: 24, justifyContent: 'center', width: 24 },
  matchRow: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  team: { alignItems: 'center', flex: 1, gap: 2, minWidth: 0 },
  badgeWrap: { alignItems: 'center', height: 36, justifyContent: 'center', position: 'relative', width: 48 },
  teamName: { color: theme.text, fontSize: 9, fontWeight: '700', maxWidth: '100%' },
  celebration: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  celebrationRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  celebrationLogoWrap: { alignItems: 'center', height: 50, justifyContent: 'center', width: 60 },
  goalText: { color: theme.accent, fontSize: 24, fontWeight: '900' },
  scorerTeam: { color: theme.text, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  scorerMinute: { color: theme.accent, fontSize: 18, fontWeight: '900', marginTop: 4 },
  score: { color: theme.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 54, textAlign: 'center' },
});
