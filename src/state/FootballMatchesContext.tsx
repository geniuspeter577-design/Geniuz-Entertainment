import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { FootballMatch, FootballMatchesResponse } from '../models/football';
import { getFootballMatches } from '../services/createContentService';
import { getGoalBallCounts } from '../utils/footballPin';
import { useNetwork } from './NetworkContext';
import { getWestAfricaDate } from '../utils/footballScores';

type FootballDateState = {
  matches: FootballMatch[];
  stale: boolean;
  isLoading: boolean;
  error?: string;
  lastFetchedAt?: number;
};

type GoalSignal = { home: number; away: number; createdAt: number };
type PinnedMatch = { date: string; matchId: string };

type FootballContextValue = {
  today: string;
  selectedDate: string;
  entries: Record<string, FootballDateState>;
  goalSignals: Record<string, GoalSignal>;
  pinned: PinnedMatch | null;
  pinnedMatch: FootballMatch | undefined;
  selectDate: (date: string) => void;
  retryDate: (date?: string) => void;
  pinMatch: (match: FootballMatch, date?: string) => void;
  unpinMatch: () => void;
};

const FootballMatchesContext = createContext<FootballContextValue | null>(null);
const LIVE_CACHE_MS = 60_000;
const NON_LIVE_CACHE_MS = 10 * 60_000;

export function FootballMatchesProvider({ children }: React.PropsWithChildren) {
  const network = useNetwork();
  const today = useMemo(() => getWestAfricaDate(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [entries, setEntries] = useState<Record<string, FootballDateState>>({});
  const [goalSignals, setGoalSignals] = useState<Record<string, GoalSignal>>({});
  const [pinned, setPinned] = useState<PinnedMatch | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const entriesRef = useRef<Record<string, FootballDateState>>({});
  const requestsRef = useRef(new Map<string, Promise<void>>());

  const updateEntry = useCallback((date: string, updater: (previous: FootballDateState) => FootballDateState) => {
    const previous = entriesRef.current[date] ?? { matches: [], stale: false, isLoading: false };
    const next = { ...entriesRef.current, [date]: updater(previous) };
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const requestDate = useCallback((date: string, force = false) => {
    const existingRequest = requestsRef.current.get(date);
    if (existingRequest) {
      return existingRequest;
    }
    const current = entriesRef.current[date];
    const ttl = current?.matches.some((match) => match.status === 'live') ? LIVE_CACHE_MS : NON_LIVE_CACHE_MS;
    if (!force && current?.lastFetchedAt && Date.now() - current.lastFetchedAt < ttl) {
      if (current.error) {
        updateEntry(date, (previous) => ({ ...previous, error: undefined }));
      }
      return Promise.resolve();
    }
    if (!network.isOnline) {
      updateEntry(date, (previous) => ({ ...previous, isLoading: false, error: 'You’re offline. Football scores need an internet connection.' }));
      return Promise.resolve();
    }

    updateEntry(date, (previous) => ({ ...previous, isLoading: true, error: undefined }));
    const request = getFootballMatches(date)
      .then((response: FootballMatchesResponse) => {
        const oldMatches = new Map((current?.matches ?? []).map((match) => [match.id, match]));
        const signals: Record<string, GoalSignal> = {};
        for (const match of response.matches) {
          const old = oldMatches.get(match.id);
          const goals = getGoalBallCounts(old, match);
          if (goals.home > 0 || goals.away > 0) {
            signals[match.id] = { ...goals, createdAt: Date.now() };
          }
        }
        const signalIds = response.matches.map((match) => match.id);
        setGoalSignals((previous) => {
          const next = { ...previous };
          for (const id of signalIds) {
            delete next[id];
          }
          return { ...next, ...signals };
        });
        if (Object.keys(signals).length > 0) {
          const signalTimes = Object.fromEntries(Object.entries(signals).map(([id, signal]) => [id, signal.createdAt]));
          setTimeout(() => setGoalSignals((previous) => {
            const next = { ...previous };
            for (const [id, createdAt] of Object.entries(signalTimes)) {
              if (next[id]?.createdAt === createdAt) {
                delete next[id];
              }
            }
            return next;
          }), 1_800);
        }
        updateEntry(date, (previous) => ({
          ...previous,
          matches: response.matches,
          stale: response.stale,
          error: undefined,
          isLoading: false,
          lastFetchedAt: Date.now(),
        }));
      })
      .catch((error: unknown) => {
        updateEntry(date, (previous) => ({
          ...previous,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Football scores could not be loaded.',
        }));
      })
      .finally(() => requestsRef.current.delete(date));
    requestsRef.current.set(date, request);
    return request;
  }, [network.isOnline, updateEntry]);

  useEffect(() => {
    void Promise.resolve().then(() => requestDate(today));
  }, [requestDate, today]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const homeHasLiveMatch = Boolean(entries[today]?.matches.some((match) => match.status === 'live'));
  const selectedHasLiveMatch = Boolean(entries[selectedDate]?.matches.some((match) => match.status === 'live'));
  useEffect(() => {
    if (!network.isOnline || appState !== 'active') {
      return undefined;
    }
    const liveDates = [...new Set([
      ...(homeHasLiveMatch ? [today] : []),
      ...(selectedHasLiveMatch ? [selectedDate] : []),
    ])];
    if (liveDates.length === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      for (const date of liveDates) {
        void requestDate(date, true);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [appState, homeHasLiveMatch, network.isOnline, requestDate, selectedDate, selectedHasLiveMatch, today]);

  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    void requestDate(date);
  }, [requestDate]);
  const retryDate = useCallback((date = selectedDate) => {
    void requestDate(date, true);
  }, [requestDate, selectedDate]);
  const pinMatch = useCallback((match: FootballMatch, date = selectedDate) => {
    if (match.status === 'live') {
      setPinned({ date, matchId: match.id });
    }
  }, [selectedDate]);
  const pinnedMatch = pinned
    ? entries[pinned.date]?.matches.find((match) => match.id === pinned.matchId)
    : undefined;

  const value = useMemo<FootballContextValue>(() => ({
    today,
    selectedDate,
    entries,
    goalSignals,
    pinned,
    pinnedMatch,
    selectDate,
    retryDate,
    pinMatch,
    unpinMatch: () => setPinned(null),
  }), [entries, goalSignals, pinMatch, pinned, pinnedMatch, retryDate, selectDate, selectedDate, today]);

  return <FootballMatchesContext.Provider value={value}>{children}</FootballMatchesContext.Provider>;
}

export function useFootballMatches() {
  const context = useContext(FootballMatchesContext);
  if (!context) {
    throw new Error('useFootballMatches must be used within FootballMatchesProvider.');
  }
  return context;
}
