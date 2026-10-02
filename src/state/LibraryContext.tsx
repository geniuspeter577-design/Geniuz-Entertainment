import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { ContentItem, ContentType, ContinueWatchingEntry } from '../models/content';

const STORAGE_KEY = '@geniuz/library/v1';
const CONTENT_TYPES = new Set<ContentType>([
  'movie',
  'series',
  'tv',
  'anime',
  'kids',
  'nollywood',
  'african',
  'short',
  'sports',
  'live',
  'music',
]);
const CONTENT_SOURCES = new Set(['geniuz', 'tmdb', 'mock', 'anilist', 'other']);

type LibraryState = {
  watchlist: ContentItem[];
  continueWatching: ContinueWatchingEntry[];
};

type LibraryContextValue = LibraryState & {
  isLoading: boolean;
  isSaving: boolean;
  error?: string;
  isInWatchlist: (id: string) => boolean;
  toggleWatchlist: (item: ContentItem) => Promise<void>;
  recordProgress: (
    item: ContentItem,
    positionSeconds: number,
    durationSeconds: number,
  ) => Promise<void>;
  retryLoad: () => void;
};

const EMPTY_LIBRARY: LibraryState = { watchlist: [], continueWatching: [] };
const LibraryContext = createContext<LibraryContextValue | null>(null);

function isContentItem(value: unknown): value is ContentItem {
  if (typeof value !== 'object' || value === null || !('availability' in value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  const availability = item.availability;

  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.type === 'string' &&
    CONTENT_TYPES.has(item.type as ContentType) &&
    typeof item.source === 'string' &&
    CONTENT_SOURCES.has(item.source) &&
    Array.isArray(item.genres) &&
    item.genres.every((genre) => typeof genre === 'string') &&
    typeof availability === 'object' &&
    availability !== null &&
    'discoverable' in availability &&
    typeof availability.discoverable === 'boolean' &&
    'stream' in availability &&
    typeof availability.stream === 'boolean' &&
    'download' in availability &&
    typeof availability.download === 'boolean' &&
    'premium' in availability &&
    typeof availability.premium === 'boolean'
  );
}

function isContinueWatchingEntry(value: unknown): value is ContinueWatchingEntry {
  if (typeof value !== 'object' || value === null || !('item' in value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    isContentItem(entry.item) &&
    typeof entry.progress === 'number' &&
    Number.isFinite(entry.progress) &&
    entry.progress >= 0 &&
    entry.progress <= 100 &&
    typeof entry.updatedAt === 'string' &&
    (entry.positionSeconds === undefined ||
      (typeof entry.positionSeconds === 'number' &&
        Number.isFinite(entry.positionSeconds) &&
        entry.positionSeconds >= 0))
  );
}

function parseLibrary(value: string | null): LibraryState {
  if (!value) {
    return EMPTY_LIBRARY;
  }

  const parsed: unknown = JSON.parse(value);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('watchlist' in parsed) ||
    !Array.isArray(parsed.watchlist) ||
    !parsed.watchlist.every(isContentItem) ||
    !('continueWatching' in parsed) ||
    !Array.isArray(parsed.continueWatching) ||
    !parsed.continueWatching.every(isContinueWatchingEntry)
  ) {
    throw new Error('Stored library data has an unsupported format.');
  }

  return {
    watchlist: parsed.watchlist,
    continueWatching: parsed.continueWatching,
  };
}

export function LibraryProvider({ children }: React.PropsWithChildren) {
  const [library, setLibrary] = useState<LibraryState>(EMPTY_LIBRARY);
  const [error, setError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadedAttempt, setLoadedAttempt] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const libraryRef = useRef(library);
  const isMounted = useRef(true);
  const savingRef = useRef(false);
  const isLoading = loadedAttempt !== loadAttempt;
  const currentError = loadedAttempt === loadAttempt ? error : undefined;

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then(parseLibrary)
      .then((storedLibrary) => {
        if (active) {
          libraryRef.current = storedLibrary;
          setLibrary(storedLibrary);
          setError(undefined);
          setLoadedAttempt(loadAttempt);
        }
      })
      .catch((loadError: unknown) => {
        console.error('[Library] Failed to read saved library data.', loadError);
        if (active) {
          setError('Your saved library could not be loaded. Retry to try again.');
          setLoadedAttempt(loadAttempt);
        }
      });

    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const commitLibrary = useCallback(
    async (update: (current: LibraryState) => LibraryState) => {
      if (isLoading || currentError || savingRef.current) {
        if (!savingRef.current) {
          setError('Wait for your saved library to load before changing your watchlist.');
        }
        return;
      }

      savingRef.current = true;
      setIsSaving(true);

      try {
        const next = update(libraryRef.current);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...next }));
        if (isMounted.current) {
          libraryRef.current = next;
          setLibrary(next);
          setError(undefined);
        }
      } catch (storageError) {
        console.error('[Library] Failed to save watchlist changes.', storageError);
        if (isMounted.current) {
          setError('Your watchlist change could not be saved. Check device storage and try again.');
        }
      } finally {
        savingRef.current = false;
        if (isMounted.current) {
          setIsSaving(false);
        }
      }
    },
    [currentError, isLoading],
  );

  const toggleWatchlist = useCallback(
    (item: ContentItem) =>
      commitLibrary((current) => {
        const exists = current.watchlist.some((savedItem) => savedItem.id === item.id);
        return {
          ...current,
          watchlist: exists
            ? current.watchlist.filter((savedItem) => savedItem.id !== item.id)
            : [item, ...current.watchlist],
        };
      }),
    [commitLibrary],
  );

  const recordProgress = useCallback(
    (item: ContentItem, positionSeconds: number, durationSeconds: number) => {
      if (
        !Number.isFinite(positionSeconds) ||
        positionSeconds < 0 ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0
      ) {
        throw new RangeError('Playback progress requires a non-negative position and positive duration.');
      }

      const progress = Math.min(100, Math.round((positionSeconds / durationSeconds) * 100));
      const updatedAt = new Date().toISOString();

      return commitLibrary((current) => ({
        ...current,
        continueWatching:
          progress >= 100
            ? current.continueWatching.filter((entry) => entry.item.id !== item.id)
            : [
                {
                  item,
                  progress,
                  positionSeconds,
                  updatedAt,
                },
                ...current.continueWatching.filter((entry) => entry.item.id !== item.id),
              ],
      }));
    },
    [commitLibrary],
  );

  const isInWatchlist = useCallback(
    (id: string) => library.watchlist.some((item) => item.id === id),
    [library.watchlist],
  );

  const retryLoad = useCallback(() => setLoadAttempt((current) => current + 1), []);

  return (
    <LibraryContext.Provider
      value={{
        ...library,
        isLoading,
        isSaving,
        error: currentError,
        isInWatchlist,
        toggleWatchlist,
        recordProgress,
        retryLoad,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);

  if (!context) {
    throw new Error('useLibrary must be used within LibraryProvider.');
  }

  return context;
}
