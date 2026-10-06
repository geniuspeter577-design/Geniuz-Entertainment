import * as ScreenOrientation from 'expo-screen-orientation';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { createVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { PlayerHeader } from '../../src/components/detail/PlayerHeader';
import type { ContentItem } from '../../src/models/content';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useNetwork } from '../../src/state/NetworkContext';
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
import { getFileExtension, isVideoFormatLikelySupported } from '../../src/utils/videoFile';

export default function WatchScreen() {
  const { id: routeId, trailer: routeTrailer } = useLocalSearchParams<{ id: string; trailer?: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const isTrailer = routeTrailer === '1';
  const player = useMemo(() => createVideoPlayer(null), []);
  const downloads = useDownloads();
  const { isOnline } = useNetwork();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const localDownload = downloads.records.find(
    (record) => record.item.id === id && record.status === 'downloaded',
  );
  const [movie, setMovie] = useState<ContentItem>();
  const [seriesTitle, setSeriesTitle] = useState<string>();
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [isOfflinePlayback, setIsOfflinePlayback] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [playerStatus, setPlayerStatus] = useState(player.status);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string>();
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [fitMode, setFitMode] = useState<PlayerFitMode>('contain');
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const [isRotateLocked, setIsRotateLocked] = useState(false);
  const playerReleasedRef = useRef(false);
  const expiredLinkRetryRef = useRef(false);
  const failureHandledRef = useRef(false);

  const releasePlayer = useCallback(() => {
    if (playerReleasedRef.current) {
      return;
    }
    playerReleasedRef.current = true;
    player.pause();
    player.release();
    setIsPlaying(false);
  }, [player]);

  const downloadRecord = downloads.records.find((record) => record.item.id === id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isQueued = downloadRecord?.status === 'queued';
  const isDownloaded = downloadRecord?.status === 'downloaded';
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const bufferedPosition = Number.isFinite(player.bufferedPosition) ? player.bufferedPosition : 0;
  const isBuffering = isLoading || playerStatus === 'loading';
  const playerTitle =
    isTrailer
      ? `Trailer · ${movie?.title ?? ''}`
      : movie?.parentSeriesId && movie.episodeNumber
        ? `${seriesTitle ?? movie.title} S${String(movie.seasonNumber ?? 1).padStart(2, '0')} E${String(movie.episodeNumber).padStart(2, '0')}`
        : movie?.title ?? 'Now playing';

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
    };
  }, []);

  useEffect(() => {
    setPlayerTimeUpdateInterval(player, 0.25);
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime: time }) => {
      setCurrentTime(time);
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying: playing }) => {
      setIsPlaying(playing);
    });
    return () => {
      timeSubscription.remove();
      playingSubscription.remove();
    };
  }, [player]);

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
      } else if (status === 'error') {
        handlePlayerFailure(playerError);
      }
    });
    return () => subscription.remove();
  }, [handlePlayerFailure, player]);

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
  }, [handlePlayerFailure, player, playbackUrl]);

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
    <SafeAreaView style={styles.safeArea}>
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
