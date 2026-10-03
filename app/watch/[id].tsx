import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import * as Brightness from 'expo-brightness';
import * as ScreenOrientation from 'expo-screen-orientation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { OfflineState } from '../../src/components/OfflineState';
import { PlayerHeader } from '../../src/components/detail/PlayerHeader';
import type { ContentItem } from '../../src/models/content';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { nextEpisodeInSeries } from '../../src/utils/episodeSelection';
import {
  getDragTarget,
  getSeekTarget,
  setPlayerVolume,
  togglePlayerOrientation,
} from '../../src/utils/playerControls';
import { getFileExtension, isVideoFormatLikelySupported } from '../../src/utils/videoFile';

const PLAYER_GESTURE_HINT_KEY = 'geniuz:player-gesture-hint-dismissed';

type PlayerGestureFeedback =
  | { kind: 'seek'; label: string }
  | { kind: 'level'; side: 'left' | 'right'; value: number };

export default function WatchScreen() {
  const { id: routeId, trailer: routeTrailer } = useLocalSearchParams<{ id: string; trailer?: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const isTrailer = routeTrailer === '1';
  const player = useVideoPlayer(null);
  const downloads = useDownloads();
  const { isOnline } = useNetwork();
  const localDownload = downloads.records.find(
    (record) => record.item.id === id && record.status === 'downloaded',
  );
  const [movie, setMovie] = useState<ContentItem>();
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [isOfflinePlayback, setIsOfflinePlayback] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [playbackEnded, setPlaybackEnded] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [gestureFeedback, setGestureFeedback] = useState<PlayerGestureFeedback>();
  const [showGestureHint, setShowGestureHint] = useState(false);
  const originalOrientationLock = useRef<ScreenOrientation.OrientationLock | undefined>(undefined);
  const originalBrightness = useRef<number | undefined>(undefined);
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const brightnessRef = useRef(0.5);
  const [nextEpisodeState, setNextEpisodeState] = useState<{
    currentId: string;
    episode?: ContentItem;
  }>();
  const downloadRecord = downloads.records.find((record) => record.item.id === id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isQueued = downloadRecord?.status === 'queued';
  const isDownloaded = downloadRecord?.status === 'downloaded';
  const downloadedEpisodes = downloads.records
    .map((record) => record.item)
    .filter(
      (item): item is ContentItem & { episodeNumber: number; seasonNumber: number } =>
        item.parentSeriesId === movie?.parentSeriesId &&
        typeof item.episodeNumber === 'number' &&
        typeof item.seasonNumber === 'number',
    );
  const offlineNextEpisode =
    movie && isOfflinePlayback
      ? nextEpisodeInSeries(downloadedEpisodes, movie.id)
      : undefined;
  const nextEpisode =
    isOfflinePlayback
      ? offlineNextEpisode
      : nextEpisodeState?.currentId === movie?.id
      ? nextEpisodeState?.episode
        : undefined;

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    let active = true;
    void ScreenOrientation.getOrientationLockAsync()
      .then((lock) => {
        if (active) {
          originalOrientationLock.current = lock;
        }
      })
      .catch((orientationError: unknown) => {
        console.error('[WatchScreen] Could not read the original screen orientation.', orientationError);
      });
    return () => {
      active = false;
      const previousLock = originalOrientationLock.current;
      if (previousLock !== undefined) {
        void ScreenOrientation.lockAsync(previousLock).catch((orientationError: unknown) => {
          console.error('[WatchScreen] Could not restore the original screen orientation.', orientationError);
        });
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return;
    }
    let active = true;
    void Brightness.getBrightnessAsync()
      .then((value) => {
        if (active) {
          originalBrightness.current = value;
          brightnessRef.current = value;
        }
      })
      .catch((brightnessError: unknown) => {
        console.error('[WatchScreen] Could not read the original display brightness.', brightnessError);
      });
    return () => {
      active = false;
      const previousBrightness = originalBrightness.current;
      if (previousBrightness !== undefined) {
        void Brightness.setBrightnessAsync(previousBrightness).catch((brightnessError: unknown) => {
          console.error('[WatchScreen] Could not restore the original display brightness.', brightnessError);
        });
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PLAYER_GESTURE_HINT_KEY)
      .then((dismissed) => {
        if (active && dismissed !== 'true') {
          setShowGestureHint(true);
        }
      })
      .catch((storageError: unknown) => {
        console.error('[WatchScreen] Could not read the player gesture hint preference.', storageError);
        if (active) {
          setShowGestureHint(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (feedbackTimeout.current) {
        clearTimeout(feedbackTimeout.current);
      }
    },
    [],
  );

  const showFeedback = useCallback((feedback: PlayerGestureFeedback) => {
    if (feedbackTimeout.current) {
      clearTimeout(feedbackTimeout.current);
    }
    setGestureFeedback(feedback);
    feedbackTimeout.current = setTimeout(() => setGestureFeedback(undefined), 1100);
  }, []);

  const getGestureValue = useCallback(
    (side: 'left' | 'right') => (side === 'left' ? brightnessRef.current : player.volume),
    [player],
  );

  const handleVerticalDrag = useCallback(
    (side: 'left' | 'right', startValue: number, deltaY: number, height: number) => {
      const value = getDragTarget(startValue, deltaY, height);
      if (side === 'left') {
        if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
          return;
        }
        brightnessRef.current = value;
        void Brightness.setBrightnessAsync(value).catch((brightnessError: unknown) => {
          console.error('[WatchScreen] Could not change the display brightness.', brightnessError);
        });
      } else {
        setPlayerVolume(player, value);
      }
      showFeedback({ kind: 'level', side, value });
    },
    [player, showFeedback],
  );

  const handleSeekBy = useCallback(
    (side: 'left' | 'right') => {
      const delta = side === 'right' ? 10 : -10;
      player.seekBy(
        getSeekTarget(player.currentTime, player.duration, delta) - player.currentTime,
      );
      showFeedback({ kind: 'seek', label: `${delta > 0 ? '+' : ''}${delta}s` });
    },
    [player, showFeedback],
  );

  const rotatePlayer = async () => {
    const landscape = togglePlayerOrientation(isLandscape);
    if (Platform.OS === 'web') {
      Alert.alert('Rotation unavailable', 'Screen rotation controls are available in the mobile app.');
      return;
    }
    try {
      await ScreenOrientation.lockAsync(
        landscape
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
      setIsLandscape(landscape);
    } catch (orientationError) {
      console.error('[WatchScreen] Could not change screen orientation.', orientationError);
      Alert.alert('Rotation unavailable', 'Could not rotate the screen on this device.');
    }
  };

  const dismissGestureHint = () => {
    setShowGestureHint(false);
    void AsyncStorage.setItem(PLAYER_GESTURE_HINT_KEY, 'true').catch((storageError: unknown) => {
      console.error('[WatchScreen] Could not save the player gesture hint preference.', storageError);
      Alert.alert('Could not save setting', 'The player gesture tip may appear again next time.');
    });
  };

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
      setIsOfflinePlayback(false);
      setPlaybackEnded(false);

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
          setError('This video format may not play on this device.');
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
        setError('You are offline. Only downloaded titles can be played.');
        setIsLoading(false);
        return;
      }

      if (isTrailer) {
        if (!supabaseMovieRepository) {
          setError('Trailers are unavailable without a connection.');
          setIsLoading(false);
          return;
        }
        try {
          const title = await supabaseMovieRepository.getById(id);
          if (!title?.trailerStorageKey) {
            throw new Error('This title does not have an available trailer.');
          }
          const url = await supabaseMovieRepository.getTrailerPlaybackUrl(title);
          if (active) {
            setMovie(title);
            setPlaybackUrl(url);
            setIsOfflinePlayback(false);
          }
        } catch (trailerError) {
          if (active) {
            setError(
              trailerError instanceof Error
                ? trailerError.message
                : 'Could not prepare this trailer. Please retry.',
            );
          }
        } finally {
          if (active) {
            setIsLoading(false);
          }
        }
        return;
      }

      const isEpisode = id.startsWith('geniuz:episode:');
      if (
        !supabaseMovieRepository ||
        (!isEpisode && !id.startsWith('geniuz:movie:') && !id.startsWith('geniuz:series:'))
      ) {
        setError('This title is not available for streaming.');
        setIsLoading(false);
        return;
      }

      try {
        const movie = isEpisode
          ? await supabaseMovieRepository.getEpisodeById(id)
          : await supabaseMovieRepository.getById(id);
        if (!movie?.availability.stream || !movie.mediaPath) {
          throw new Error('This title is not published for streaming.');
        }

        const extension = movie.fileExtension ?? getFileExtension(movie.mediaPath);
        if (
          !isVideoFormatLikelySupported(
            extension,
            Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
              ? Platform.OS
              : 'other',
          )
        ) {
          throw new Error('This video format may not play on this device.');
        }

        const url = isEpisode
          ? await supabaseMovieRepository.getEpisodePlaybackUrl(movie)
          : await supabaseMovieRepository.getPlaybackUrl(movie);
        if (active) {
          setMovie(movie);
          setIsOfflinePlayback(false);
          setPlaybackUrl(url);
        }
      } catch (loadError) {
        console.error('[WatchScreen] Could not prepare movie playback.');
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not prepare this movie for playback. Please try again.',
          );
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
    if (!playbackUrl) {
      return;
    }

    let active = true;
    void player
      .replaceAsync(playbackUrl)
      .then(() => {
        if (active) {
          player.play();
        }
      })
      .catch(() => {
        console.error('[WatchScreen] Video player could not load the movie.');
        if (active) {
          setError('Could not load the video. Check your connection and retry.');
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      player.pause();
    };
  }, [player, playbackUrl]);

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        console.error('[WatchScreen] Video playback failed.');
        setError('Could not play this video. Check your connection and retry.');
        setIsLoading(false);
        player.pause();
      }
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => setPlaybackEnded(true));
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    if (!movie?.parentSeriesId || !movie.episodeNumber || isOfflinePlayback) {
      return;
    }

    let active = true;
    void supabaseMovieRepository
      ?.getSeasons(movie.parentSeriesId)
      .then((seasons) => {
        if (active) {
          setNextEpisodeState({
            currentId: movie.id,
            episode: nextEpisodeInSeries(
              seasons.flatMap((season) => season.episodes),
              movie.id,
            ),
          });
        }
      })
      .catch((sequenceError: unknown) => {
        console.error('[WatchScreen] Could not load the next episode.', sequenceError);
      });
    return () => {
      active = false;
    };
  }, [isOfflinePlayback, movie?.id, movie?.parentSeriesId, movie?.episodeNumber]);

  const retryPlayback = () => {
    setError(undefined);
    setIsLoading(true);
    setPlaybackUrl(undefined);
    setRetryAttempt((attempt) => attempt + 1);
  };

  return (
    <SafeAreaView style={[styles.safeArea, isLandscape && styles.fullscreenSafeArea]}>
      <Stack.Screen
        options={{
          orientation: isLandscape ? 'landscape' : 'portrait',
          statusBarHidden: isLandscape,
          navigationBarHidden: isLandscape,
        }}
      />
      <PlayerHeader
        player={player}
        playbackUrl={playbackUrl}
        isLoading={isLoading}
        error={error}
        onRetry={retryPlayback}
        isFullscreen={isLandscape}
        gestureFeedback={gestureFeedback}
        getGestureValue={getGestureValue}
        onVerticalDrag={handleVerticalDrag}
        onSeekBy={handleSeekBy}
      />
      {showGestureHint ? (
        <View style={[styles.gestureHint, isLandscape && styles.fullscreenGestureHint]}>
          <Text style={styles.gestureHintText}>
            Double-tap left/right to skip 10 seconds. Swipe vertically on the left for brightness and right for volume.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss player gesture tip"
            onPress={dismissGestureHint}
            style={styles.dismissHintButton}
          >
            <Text style={styles.dismissHintText}>Got it</Text>
          </Pressable>
        </View>
      ) : null}
      {!isLandscape && !isOnline && !isOfflinePlayback ? (
        <OfflineState
          onRetry={() => void retryPlayback()}
          message="You are offline. Download this title while connected to watch it here."
        />
      ) : null}
      <View style={[styles.header, isLandscape && styles.fullscreenHeader]}>
        {!isLandscape ? (
          <View style={styles.headerTitle}>
            <Text style={styles.title}>{isTrailer ? `Trailer · ${movie?.title ?? ''}` : 'Now playing'}</Text>
          </View>
        ) : null}
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>‹  Back</Text>
          </Pressable>
          <RotateButton isLandscape={isLandscape} onPress={() => void rotatePlayer()} />
        </View>
      </View>
      {!isLandscape && !isTrailer && movie?.availability.download ? (
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(isDownloaded)}
          onPress={() => {
            if (isDownloading || isQueued) {
              void downloads.cancel(movie.id).catch((downloadError: unknown) =>
                Alert.alert(
                  'Download error',
                  downloadError instanceof Error ? downloadError.message : 'Could not cancel this download.',
                ),
              );
            } else {
              void downloads.download(movie).catch((downloadError: unknown) =>
                Alert.alert(
                  'Download error',
                  downloadError instanceof Error ? downloadError.message : 'The download failed. Please retry.',
                ),
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
      {!isLandscape && playbackEnded && nextEpisode ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace({ pathname: '/watch/[id]', params: { id: nextEpisode.id } })}
          style={styles.nextEpisodeButton}
        >
          <Text style={styles.nextEpisodeText}>Next episode</Text>
          <Text style={styles.nextEpisodeTitle} numberOfLines={1}>{nextEpisode.title}</Text>
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

function RotateButton({ isLandscape, onPress }: { isLandscape: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Rotate screen"
      onPress={onPress}
      style={styles.rotateButton}
    >
      <Ionicons
        name={isLandscape ? 'phone-portrait-outline' : 'phone-landscape-outline'}
        size={20}
        color={theme.accent}
      />
      <Text style={styles.rotateText}>Rotate screen</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  fullscreenSafeArea: {
    padding: 0,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
  },
  headerTitle: {
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  fullscreenHeader: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: {
    color: theme.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  rotateButton: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
  },
  rotateText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
  },
  downloadButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginHorizontal: 18,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  downloadButtonText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  nextEpisodeButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 18,
    marginTop: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  nextEpisodeText: { color: theme.accent, fontSize: 14, fontWeight: '800' },
  nextEpisodeTitle: { color: theme.text, fontSize: 14, flex: 1, textAlign: 'right' },
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
  gestureHint: {
    marginHorizontal: 18,
    marginTop: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
  },
  fullscreenGestureHint: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 24,
    zIndex: 2,
    margin: 0,
  },
  gestureHintText: { color: theme.text, flex: 1, fontSize: 12, lineHeight: 18 },
  dismissHintButton: {
    minWidth: 56,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.accent,
    paddingHorizontal: 12,
  },
  dismissHintText: { color: theme.background, fontSize: 13, fontWeight: '800' },
});
