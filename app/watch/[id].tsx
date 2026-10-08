import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { createVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { PlayerHeader } from '../../src/components/detail/PlayerHeader';
import type { ContentItem, EpisodeItem } from '../../src/models/content';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useAuth } from '../../src/state/AuthContext';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { getUserAppSettings } from '../../src/services/TrailerAutoplayPreference';
import { theme } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { getFriendlyPlaybackError, getPlaybackErrorDetails, isExpiredPlaybackLinkError, PlaybackError } from '../../src/utils/playbackError';
import {
  getNextPlayerFit,
  getSeekTarget,
  PLAYER_CONTROLS_AUTO_HIDE_MS,
  runPlayerActionIfActive,
  setPlayerCurrentTime,
  setPlayerTimeUpdateInterval,
  shouldAutoHidePlayerControls,
  type PlayerFitMode,
} from '../../src/utils/playerControls';
import { backOrReplace } from '../../src/utils/navigation';
import { nextEpisodeInSeries } from '../../src/utils/episodeSelection';
import {
  NEXT_EPISODE_COUNTDOWN_SECONDS,
  isEpisodeWatchedAtPosition,
} from '../../src/utils/episodePlayback';
import { getFileExtension, isVideoFormatLikelySupported } from '../../src/utils/videoFile';

export default function WatchScreen() {
  const { id: routeId, trailer: routeTrailer } = useLocalSearchParams<{ id: string; trailer?: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const isTrailer = routeTrailer === '1';
  const player = useMemo(() => createVideoPlayer(null), []);
  const downloads = useDownloads();
  const auth = useAuth();
  const { continueWatching, isLoading: isLibraryLoading, recordProgress } = useLibrary();
  const { isOnline } = useNetwork();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const localDownload = downloads.records.find(
    (record) => record.item.id === id && record.status === 'downloaded',
  );
  const [movie, setMovie] = useState<ContentItem>();
  const [seriesTitle, setSeriesTitle] = useState<string>();
  const [seriesCatalog, setSeriesCatalog] = useState<{
    seriesId: string;
    episodes: EpisodeItem[];
    error?: string;
  }>();
  const [seriesEpisodeRetryAttempt, setSeriesEpisodeRetryAttempt] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [isOfflinePlayback, setIsOfflinePlayback] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [playerStatus, setPlayerStatus] = useState(player.status);
  const [isPlaying, setIsPlaying] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string>();
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [autoplaySettings, setAutoplaySettings] = useState<{ userId: string; enabled: boolean }>();
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<{
    episodeId: string;
    seconds: number;
  } | null>(null);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [fitMode, setFitMode] = useState<PlayerFitMode>('contain');
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const [isRotateLocked, setIsRotateLocked] = useState(false);
  const playerReleasedRef = useRef(false);
  const expiredLinkRetryRef = useRef(false);
  const failureHandledRef = useRef(false);
  const resumeAppliedRef = useRef(false);
  const finishedProgressRef = useRef(false);
  const autoplayCanceledRef = useRef<string | undefined>(undefined);
  const saveProgressRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    const session = auth.session;
    if (!session) {
      return () => {
        active = false;
      };
    }
    void getUserAppSettings(session.user.id)
      .then((settings) => {
        if (active) {
          setPlaybackSpeed(settings.defaultPlaybackSpeed);
          setAutoplaySettings({
            userId: session.user.id,
            enabled: settings.autoplayNextEpisode,
          });
        }
      })
      .catch((settingsError: unknown) => {
        logger.warn('[Player] Could not load default playback speed.', settingsError);
        if (active) {
          setError('Your playback speed preference could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, [auth.session]);

  const autoplayNextEpisodeEnabled = Boolean(
    auth.session &&
      autoplaySettings?.userId === auth.session.user.id &&
      autoplaySettings.enabled,
  );

  const saveProgress = useCallback(() => {
    if (isTrailer || !movie || finishedProgressRef.current) {
      return;
    }

    const durationSeconds = Number.isFinite(player.duration) && player.duration > 0
      ? player.duration
      : movie.durationSeconds ?? 0;
    const positionSeconds = Number.isFinite(player.currentTime) ? player.currentTime : 0;
    if (durationSeconds <= 0 || positionSeconds <= 0) {
      return;
    }

    const isSeriesEpisode = movie.parentSeriesId !== undefined;
    const episodeReachedWatchedThreshold = isEpisodeWatchedAtPosition(
      movie.id,
      positionSeconds,
      durationSeconds,
    );
    if (
      isSeriesEpisode
        ? episodeReachedWatchedThreshold
        : durationSeconds - positionSeconds <= 30
    ) {
      finishedProgressRef.current = true;
      void recordProgress(movie, durationSeconds, durationSeconds);
      return;
    }

    void recordProgress(movie, Math.min(positionSeconds, durationSeconds), durationSeconds);
  }, [isTrailer, movie, player, recordProgress]);

  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  const releasePlayer = useCallback(() => {
    if (playerReleasedRef.current) {
      return;
    }
    playerReleasedRef.current = true;
    saveProgressRef.current();
    player.pause();
    player.release();
    setIsPlaying(false);
  }, [player]);

  const downloadRecord = downloads.records.find((record) => record.item.id === id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isQueued = downloadRecord?.status === 'queued';
  const isDownloaded = downloadRecord?.status === 'downloaded';
  const parentSeriesId = movie?.parentSeriesId;
  const downloadedEpisodes = downloads.records
    .filter(
      (record) =>
        record.status === 'downloaded' &&
        record.item.parentSeriesId === parentSeriesId &&
        typeof record.item.episodeNumber === 'number',
    )
    .map((record) => record.item);
  const episodeCandidates =
    parentSeriesId && seriesCatalog?.seriesId === parentSeriesId
      ? seriesCatalog.episodes
      : downloadedEpisodes;
  const nextEpisode = movie?.parentSeriesId
    ? nextEpisodeInSeries(episodeCandidates, movie.id)
    : undefined;
  const nextEpisodeDownloaded = downloads.records.some(
    (record) => record.status === 'downloaded' && record.item.id === nextEpisode?.id,
  );
  const canPlayNextEpisode = Boolean(nextEpisode && (isOnline || nextEpisodeDownloaded));
  const currentCountdown =
    nextEpisodeCountdown && nextEpisodeCountdown.episodeId === movie?.id
      ? nextEpisodeCountdown.seconds
      : null;
  const seriesCatalogError =
    seriesCatalog?.seriesId === parentSeriesId ? seriesCatalog?.error : undefined;
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const bufferedPosition = Number.isFinite(player.bufferedPosition) ? player.bufferedPosition : 0;
  const isBuffering = isLoading || playerStatus === 'loading';
  const playerTitle =
    isTrailer
      ? `Trailer · ${movie?.title ?? ''}`
      : movie?.parentSeriesId && movie.episodeNumber
        ? `${seriesTitle ?? movie.title} S${String(movie.seasonNumber ?? 1).padStart(2, '0')} E${String(movie.episodeNumber).padStart(2, '0')}`
        : movie?.title ?? 'Now playing';

  const openNextEpisode = useCallback(() => {
    if (!nextEpisode || !canPlayNextEpisode) {
      return;
    }
    autoplayCanceledRef.current = movie?.id;
    setNextEpisodeCountdown(null);
    router.replace({ pathname: '/watch/[id]', params: { id: nextEpisode.id } });
  }, [canPlayNextEpisode, movie?.id, nextEpisode]);

  useEffect(() => {
    if (!parentSeriesId || !isOnline || !supabaseMovieRepository) {
      return;
    }
    let active = true;
    void supabaseMovieRepository
      .getSeasons(`geniuz:series:${parentSeriesId}`)
      .then((seasons) => {
        if (active) {
          const hasEpisodeLoadErrors = seasons.some((season) => season.episodesError);
          setSeriesCatalog({
            seriesId: parentSeriesId,
            episodes: seasons.flatMap((season) => season.episodes),
            ...(hasEpisodeLoadErrors
              ? { error: 'Some episodes could not be loaded. Try again when online.' }
              : {}),
          });
        }
      })
      .catch((catalogError: unknown) => {
        logger.warn('[Player] Could not load the episode list.', catalogError);
        if (active) {
          setSeriesCatalog({
            seriesId: parentSeriesId,
            episodes: [],
            error: 'The next episode could not be loaded. Try again when online.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [isOnline, parentSeriesId, seriesEpisodeRetryAttempt]);

  useEffect(() => {
    if (
      !movie?.parentSeriesId ||
      !autoplayNextEpisodeEnabled ||
      !nextEpisode ||
      !canPlayNextEpisode ||
      currentCountdown !== null ||
      autoplayCanceledRef.current === movie.id ||
      !isEpisodeWatchedAtPosition(movie.id, currentTime, duration)
    ) {
      return;
    }
    setNextEpisodeCountdown({
      episodeId: movie.id,
      seconds: NEXT_EPISODE_COUNTDOWN_SECONDS,
    });
  }, [
    autoplayNextEpisodeEnabled,
    canPlayNextEpisode,
    currentCountdown,
    currentTime,
    duration,
    movie,
    nextEpisode,
  ]);

  useEffect(() => {
    if (
      !nextEpisodeCountdown ||
      !appIsActive ||
      nextEpisodeCountdown.episodeId !== movie?.id ||
      !nextEpisode ||
      !canPlayNextEpisode
    ) {
      return;
    }
    const timeout = setTimeout(() => {
      if (nextEpisodeCountdown.seconds <= 1) {
        openNextEpisode();
      } else {
        setNextEpisodeCountdown((current) =>
          current?.episodeId === nextEpisodeCountdown.episodeId
            ? { ...current, seconds: current.seconds - 1 }
            : current,
        );
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [
    appIsActive,
    canPlayNextEpisode,
    movie?.id,
    nextEpisode,
    nextEpisodeCountdown,
    openNextEpisode,
  ]);

  useEffect(() => {
    playerReleasedRef.current = false;
    return () => {
      releasePlayer();
    };
  }, [player, releasePlayer]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        releasePlayer();
      };
    }, [releasePlayer]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
      if (state !== 'active') {
        releasePlayer();
      }
    });
    return () => subscription.remove();
  }, [releasePlayer]);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      StatusBar.setHidden(false, 'fade');
    };
  }, []);

  useEffect(() => {
    StatusBar.setHidden(isLandscape, 'fade');
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [isLandscape]);

  useEffect(() => {
    setPlayerTimeUpdateInterval(player, 0.25);
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime: time }) => {
      setCurrentTime(time);
      const isEpisode = movie?.parentSeriesId !== undefined;
      const nearEnd =
        duration > 0 &&
        time > 0 &&
        (isEpisode
          ? isEpisodeWatchedAtPosition(movie.id, time, duration)
          : duration - time <= 30);
      if (nearEnd) {
        saveProgressRef.current();
      }
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying: playing }) => {
      setIsPlaying(playing);
      if (!playing) {
        saveProgressRef.current();
      }
    });
    return () => {
      timeSubscription.remove();
      playingSubscription.remove();
    };
  }, [
    autoplayNextEpisodeEnabled,
    canPlayNextEpisode,
    duration,
    movie,
    player,
  ]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = setInterval(() => saveProgressRef.current(), 10_000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    if (isPlayerLocked || !showControls || !shouldAutoHidePlayerControls(isPlaying, isSeeking)) {
      return;
    }
    const timeout = setTimeout(() => setShowControls(false), PLAYER_CONTROLS_AUTO_HIDE_MS);
    return () => clearTimeout(timeout);
  }, [isPlaying, isPlayerLocked, isSeeking, showControls]);

  const toggleLock = useCallback(() => {
    setIsPlayerLocked((locked) => {
      const nextLocked = !locked;
      setShowControls(!nextLocked);
      return nextLocked;
    });
    setSpeedMenuOpen(false);
  }, []);

  const toggleSpeedMenu = useCallback(() => {
    if (isPlayerLocked) {
      return;
    }
    setSpeedMenuOpen((open) => !open);
  }, [isPlayerLocked]);

  const cycleFitMode = useCallback(() => {
    setFitMode((current) => getNextPlayerFit(current));
  }, []);

  const toggleRotateLock = useCallback(async () => {
    const nextLocked = !isRotateLocked;
    await ScreenOrientation.lockAsync(
      nextLocked ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT,
    );
    setIsRotateLocked(nextLocked);
    setShowControls(true);
  }, [isRotateLocked]);

  const refreshExpiredLink = useCallback(async () => {
    if (!movie || isOfflinePlayback || !isOnline || !supabaseMovieRepository) {
      setError(getFriendlyPlaybackError(isOnline));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setPlaybackUrl(undefined);
    try {
      const freshUrl = isTrailer
        ? await supabaseMovieRepository.getTrailerPlaybackUrl(movie)
        : movie.id.startsWith('geniuz:episode:')
          ? await supabaseMovieRepository.getEpisodePlaybackUrl(movie)
          : await supabaseMovieRepository.getPlaybackUrl(movie);
      if (!playerReleasedRef.current) {
        setPlaybackUrl(freshUrl);
      }
    } catch (refreshError) {
      const { status, code } = getPlaybackErrorDetails(refreshError);
      loggerPlaybackWarning(status, code, 'SIGNED_URL_REFRESH_FAILED');
      if (!playerReleasedRef.current) {
        setError(
          isOnline
            ? 'The playback link expired and could not be refreshed. Check your connection and tap Retry.'
            : getFriendlyPlaybackError(false),
        );
        setIsLoading(false);
      }
    }
  }, [isOfflinePlayback, isOnline, isTrailer, movie]);

  const handlePlayerFailure = useCallback((playerError?: { message: string }) => {
    if (failureHandledRef.current || playerReleasedRef.current) {
      return;
    }
    failureHandledRef.current = true;
    setIsLoading(false);
    setShowControls(true);

    if (
      isExpiredPlaybackLinkError(playerError) &&
      !expiredLinkRetryRef.current &&
      !isOfflinePlayback &&
      isOnline &&
      movie
    ) {
      expiredLinkRetryRef.current = true;
      setError(undefined);
      void refreshExpiredLink();
      return;
    }

    setError(
      isExpiredPlaybackLinkError(playerError) && expiredLinkRetryRef.current && isOnline
        ? 'The playback link expired and could not be refreshed. Check your connection and tap Retry.'
        : getFriendlyPlaybackError(isOnline, playerError),
    );
  }, [isOfflinePlayback, isOnline, movie, refreshExpiredLink]);

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status, error: playerError }) => {
      setPlayerStatus(status);
      if (status === 'readyToPlay') {
        setIsLoading(false);
        if (!resumeAppliedRef.current && !isTrailer && movie) {
          resumeAppliedRef.current = true;
          const savedEntry = continueWatching.find((entry) => entry.item.id === movie.id);
          const savedDuration = player.duration > 0 ? player.duration : movie.durationSeconds ?? 0;
          const savedPosition = savedEntry?.positionSeconds ??
            (savedEntry && savedDuration > 0 ? (savedDuration * savedEntry.progress) / 100 : 0);
          if (savedPosition >= 10 && savedDuration - savedPosition > 30) {
            setPlayerCurrentTime(player, savedPosition);
            setCurrentTime(savedPosition);
          }
        }
      } else if (status === 'error') {
        handlePlayerFailure(playerError);
      }
    });
    return () => subscription.remove();
  }, [continueWatching, handlePlayerFailure, isTrailer, movie, player]);

  useEffect(() => {
    let active = true;

    async function loadPlayback() {
      if (downloads.isLoading) {
        return;
      }

      setIsLoading(true);
      setError(undefined);
      setPlaybackUrl(undefined);
      setMovie(undefined);
      setSeriesTitle(undefined);
      setIsOfflinePlayback(false);
      setCurrentTime(0);
      resumeAppliedRef.current = false;
      finishedProgressRef.current = false;
      setShowControls(true);
      setSpeedMenuOpen(false);
      expiredLinkRetryRef.current = false;
      failureHandledRef.current = false;

      if (localDownload && !isTrailer) {
        const extension =
          localDownload.item.fileExtension ?? getFileExtension(localDownload.item.mediaPath ?? '');
        if (
          !isVideoFormatLikelySupported(
            extension,
            Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
              ? Platform.OS
              : 'other',
          )
        ) {
          setError('This video format is not supported on this device. Try an MP4 version.');
          setIsLoading(false);
          return;
        }
        setMovie(localDownload.item);
        setIsOfflinePlayback(true);
        setPlaybackUrl(localDownload.filePath);
        setIsLoading(false);
        return;
      }

      if (!isOnline) {
        setError(getFriendlyPlaybackError(false));
        setIsLoading(false);
        return;
      }

      if (!supabaseMovieRepository) {
        setError('Video playback is unavailable right now. Please try again later.');
        setIsLoading(false);
        return;
      }

      try {
        if (isTrailer) {
          const title = await supabaseMovieRepository.getById(id);
          if (!title?.trailerStorageKey?.trim()) {
            throw new PlaybackError('Trailer unavailable.', 'TRAILER_NOT_FOUND', 404);
          }
          const url = await supabaseMovieRepository.getTrailerPlaybackUrl(title);
          if (active) {
            setMovie(title);
            setPlaybackUrl(url);
            setIsOfflinePlayback(false);
          }
          return;
        }

        const isEpisode = id.startsWith('geniuz:episode:');
        if (
          !isEpisode &&
          !id.startsWith('geniuz:movie:') &&
          !id.startsWith('geniuz:series:') &&
          !id.startsWith('geniuz:short:')
        ) {
          throw new PlaybackError('Title unavailable.', 'TITLE_UNAVAILABLE', 404);
        }
        const item = isEpisode
          ? await supabaseMovieRepository.getEpisodeById(id)
          : await supabaseMovieRepository.getById(id);
        if (!item) {
          throw new PlaybackError('Title unavailable.', 'TITLE_UNAVAILABLE', 404);
        }
        if (!item.availability.stream) {
          throw new PlaybackError('Title unavailable.', 'TITLE_NOT_PUBLISHED', 403);
        }
        if (!item.mediaPath?.trim()) {
          throw new PlaybackError('Video unavailable.', 'PLAYBACK_FILE_MISSING', 404);
        }

        const extension = item.fileExtension ?? getFileExtension(item.mediaPath);
        if (
          !isVideoFormatLikelySupported(
            extension,
            Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
              ? Platform.OS
              : 'other',
          )
        ) {
          throw new PlaybackError('Unsupported video format.', 'UNSUPPORTED_VIDEO_FORMAT');
        }

        const url = isEpisode
          ? await supabaseMovieRepository.getEpisodePlaybackUrl(item)
          : await supabaseMovieRepository.getPlaybackUrl(item);
        if (active) {
          setMovie(item);
          setIsOfflinePlayback(false);
          setPlaybackUrl(url);
          if (item.parentSeriesId) {
            void supabaseMovieRepository
              .getById(`geniuz:series:${item.parentSeriesId}`)
              .then((series) => {
                if (active && series) {
                  setSeriesTitle(series.title);
                }
              })
              .catch(() => {
                logger.warn('[WatchScreen] Could not load the series title.');
              });
          }
        }
      } catch (loadError) {
        const { status, code } = getPlaybackErrorDetails(loadError);
        loggerPlaybackWarning(status, code, 'PLAYBACK_PREPARATION_FAILED');
        if (active) {
          setError(getFriendlyPreparationError(code, isOnline));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadPlayback();
    return () => {
      active = false;
    };
  }, [downloads.isLoading, id, isOnline, isTrailer, localDownload, retryAttempt]);

  useEffect(() => {
    if (isLibraryLoading) {
      return;
    }
    if (!playbackUrl || playerReleasedRef.current) {
      return;
    }

    let active = true;
    failureHandledRef.current = false;
    void player
      .replaceAsync(playbackUrl)
      .then(() => {
        if (active && !playerReleasedRef.current) {
          player.play();
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          const { status, code } = getPlaybackErrorDetails(loadError);
          loggerPlaybackWarning(status, code, 'PLAYER_LOAD_FAILED');
          handlePlayerFailure(loadError instanceof Error ? { message: loadError.message } : undefined);
        }
      });

    return () => {
      active = false;
      if (!playerReleasedRef.current) {
        player.pause();
      }
    };
  }, [handlePlayerFailure, isLibraryLoading, player, playbackUrl]);

  const retryPlayback = () => {
    expiredLinkRetryRef.current = false;
    failureHandledRef.current = false;
    setError(undefined);
    setIsLoading(true);
    setPlaybackUrl(undefined);
    setRetryAttempt((attempt) => attempt + 1);
  };

  const seekTo = (seconds: number) => {
    if (playerReleasedRef.current) {
      return;
    }
    runPlayerActionIfActive(playerReleasedRef.current, () => setPlayerCurrentTime(player, seconds));
    setCurrentTime(seconds);
  };

  const seekBy = (seconds: number) => {
    seekTo(getSeekTarget(player.currentTime, duration, seconds));
  };

  const togglePlayback = () => {
    if (playerReleasedRef.current || error) {
      return;
    }
    setShowControls(true);
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, isLandscape && styles.landscapeSafeArea]}>
      <Stack.Screen
        options={{
          orientation: 'all',
          statusBarHidden: isLandscape,
          navigationBarHidden: isLandscape,
        }}
      />
      <PlayerHeader
        player={player}
        playbackUrl={playbackUrl}
        title={playerTitle}
        isLoading={isLoading}
        isBuffering={isBuffering}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        bufferedPosition={bufferedPosition}
        error={error}
        showControls={showControls}
        isLandscape={isLandscape}
        isLocked={isPlayerLocked}
        playbackSpeed={playbackSpeed}
        speedMenuOpen={speedMenuOpen}
        fitMode={fitMode}
        isRotateLocked={isRotateLocked}
        onBack={() => backOrReplace('/')}
        onToggleControls={() => setShowControls((visible) => !visible)}
        onToggleLock={toggleLock}
        onToggleSpeedMenu={toggleSpeedMenu}
        onSelectSpeed={(speed) => {
          setPlaybackSpeed(speed);
          setSpeedMenuOpen(false);
        }}
        onCycleFit={cycleFitMode}
        onToggleRotate={toggleRotateLock}
        onPlayPause={togglePlayback}
        onSeekBy={seekBy}
        onSeekTo={seekTo}
        onSeekingChange={setIsSeeking}
        onRetry={retryPlayback}
      />
      {!isLandscape && !isTrailer && movie?.parentSeriesId ? (
        <View style={styles.nextEpisodeCard}>
          <View style={styles.nextEpisodeCopy}>
            <Text style={styles.nextEpisodeHeading}>
              {currentCountdown !== null ? `Next episode starts in ${currentCountdown}s` : 'Up next'}
            </Text>
            <Text style={styles.nextEpisodeTitle} numberOfLines={2}>
              {nextEpisode
                ? `S${String(nextEpisode.seasonNumber ?? 1).padStart(2, '0')} E${String(nextEpisode.episodeNumber ?? 0).padStart(2, '0')} · ${nextEpisode.title}`
                : seriesCatalogError ??
                  (isOnline
                    ? seriesCatalog?.seriesId === parentSeriesId
                      ? 'No next episode is available.'
                      : 'Loading the episode list…'
                    : 'A connection or a downloaded next episode is needed to continue.')}
            </Text>
            {seriesCatalogError && isOnline ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSeriesEpisodeRetryAttempt((attempt) => attempt + 1)}
                style={styles.retryEpisodesButton}
              >
                <Text style={styles.retryEpisodesText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
          {canPlayNextEpisode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                currentCountdown !== null
                  ? 'Play next episode now'
                  : `Play next episode, ${nextEpisode?.title ?? ''}`
              }
              onPress={openNextEpisode}
              style={styles.nextEpisodeButton}
            >
              <Text style={styles.nextEpisodeButtonText}>
                {currentCountdown !== null ? 'Play now' : 'Next episode'}
              </Text>
            </Pressable>
          ) : nextEpisode ? (
            <Text style={styles.nextEpisodeUnavailable}>Not downloaded</Text>
          ) : null}
          {currentCountdown !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel automatic next episode"
              onPress={() => {
                autoplayCanceledRef.current = movie.id;
                setNextEpisodeCountdown(null);
              }}
              style={styles.cancelAutoplayButton}
            >
              <Text style={styles.cancelAutoplayText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {!isLandscape && !isTrailer && movie?.availability.download ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isDownloaded
              ? `${movie.title} downloaded`
              : isDownloading
                ? `Cancel ${movie.title} download`
                : isQueued
                  ? `Cancel queued download for ${movie.title}`
                  : `Download ${movie.title}`
          }
          disabled={Boolean(isDownloaded)}
          onPress={() => {
            if (isDownloading || isQueued) {
              void downloads.cancel(movie.id).catch(() =>
                Alert.alert('Download error', 'Could not cancel this download. Please try again.'),
              );
            } else {
              void downloads.download(movie).catch(() =>
                Alert.alert('Download error', 'The download failed. Please check your connection and retry.'),
              );
            }
          }}
          style={[styles.downloadButton, isDownloaded && styles.disabledButton]}
        >
          <Text style={styles.downloadButtonText}>
            {isDownloaded
              ? 'Downloaded'
              : isDownloading
                ? `Cancel download (${downloadRecord.progress}%)`
                : isQueued
                  ? 'Cancel queued download'
                  : 'Download'}
          </Text>
        </Pressable>
      ) : null}
      {!isLandscape && downloads.error ? <ContentNotice message={downloads.error} tone="error" /> : null}
      {!isLandscape ? (
        <Text style={styles.disclaimer}>
          {isOfflinePlayback
            ? 'Playing the saved file on this device.'
            : 'Playback is available for movies uploaded by an authorized Geniuz+ administrator.'}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

function getFriendlyPreparationError(code: string | undefined, isOnline: boolean) {
  if (!isOnline) {
    return getFriendlyPlaybackError(false);
  }
  if (code === 'UNSUPPORTED_VIDEO_FORMAT') {
    return 'This video format is not supported on this device. Try an MP4 version.';
  }
  if (code === 'PLAYBACK_FILE_MISSING' || code === 'PLAYBACK_FILE_NOT_FOUND' || code === 'TITLE_UNAVAILABLE') {
    return 'This video is not available right now.';
  }
  if (code === 'TRAILER_NOT_FOUND') {
    return 'A trailer is not available for this title.';
  }
  return getFriendlyPlaybackError(true);
}

function loggerPlaybackWarning(status: number | undefined, code: string | undefined, fallbackCode: string) {
  logger.warn('[WatchScreen] Playback request failed.', status ?? 'n/a', code ?? fallbackCode);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  landscapeSafeArea: {
    backgroundColor: '#000000',
  },
  downloadButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginHorizontal: 18,
    marginTop: 14,
    paddingHorizontal: 18,
  },
  downloadButtonText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  nextEpisodeCard: {
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  nextEpisodeCopy: {
    flex: 1,
    minWidth: 0,
  },
  nextEpisodeHeading: {
    color: theme.secondaryText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  nextEpisodeTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  nextEpisodeButton: {
    alignItems: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 13,
  },
  nextEpisodeButtonText: {
    color: theme.background,
    fontSize: 12,
    fontWeight: '800',
  },
  nextEpisodeUnavailable: {
    color: theme.secondaryText,
    fontSize: 11,
    fontWeight: '700',
  },
  cancelAutoplayButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 5,
  },
  cancelAutoplayText: {
    color: theme.secondaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  retryEpisodesButton: {
    alignSelf: 'flex-start',
    marginTop: 5,
  },
  retryEpisodesText: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.55,
  },
  disclaimer: {
    color: theme.secondaryText,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
});
