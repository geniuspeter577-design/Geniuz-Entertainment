import { Ionicons } from '@expo/vector-icons';
import { router, useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { TitleImage } from '../TitleImage';
import { logger } from '../../utils/logger';
import type { ContentItem } from '../../models/content';
import { supabaseMovieRepository } from '../../repositories/SupabaseMovieRepository';
import { useNetwork } from '../../state/NetworkContext';
import { theme } from '../../theme';
import { getAutoplayTrailers } from '../../services/TrailerAutoplayPreference';
import {
  setPlayerLoop,
  setPlayerMuted,
  setPlayerTimeUpdateInterval,
} from '../../utils/playerControls';
import { shouldAutoplayTrailer, toggleTrailerMuted } from '../../utils/trailerAutoplay';

type TitleTrailerHeroProps = {
  item: ContentItem;
  onPlay: () => void;
  onManualTrailer: () => void;
  onToggleList: () => void;
  onShare: () => void;
  saved: boolean;
  canPlay: boolean;
};

export function TitleTrailerHero({
  item,
  onPlay,
  onManualTrailer,
  onToggleList,
  onShare,
  saved,
  canPlay,
}: TitleTrailerHeroProps) {
  const player = useVideoPlayer(null);
  const isFocused = useIsFocused();
  const { isOnline } = useNetwork();
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [preferenceError, setPreferenceError] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const [isTrailerMuted, setIsTrailerMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTrailerLoading, setIsTrailerLoading] = useState(false);
  const [isTrailerUnavailable, setIsTrailerUnavailable] = useState(false);
  const [isTrailerVisible, setIsTrailerVisible] = useState(false);
  const [trailerEnded, setTrailerEnded] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [coverOpacity] = useState(() => new Animated.Value(1));
  const loadedTrailerKey = useRef<string | undefined>(undefined);
  const requestId = useRef(0);
  const preferenceReadyForFocus = useRef(false);
  const isTrailerMutedRef = useRef(true);
  const [trailerRetry, setTrailerRetry] = useState(0);
  const [isVideoMounted, setIsVideoMounted] = useState(false);
  const playerReleasedRef = useRef(false);

  const hasTrailer = Boolean(item.trailerStorageKey);
  const shouldAutoplay = shouldAutoplayTrailer({
    isPublished: item.availability.discoverable,
    isOnline,
    hasTrailer,
    autoplayEnabled,
    isFocused,
    isAppActive,
  });
  const coverUri = item.coverUrl ?? item.backdropUrl ?? item.posterUrl;

  useEffect(() => {
    setPlayerLoop(player, false);
  }, [player]);

  useEffect(() => {
    if (!isFocused) {
      preferenceReadyForFocus.current = false;
      return;
    }
    let active = true;
    preferenceReadyForFocus.current = false;
    void getAutoplayTrailers()
      .then((enabled) => {
        if (active) {
          setPreferenceError(false);
          setAutoplayEnabled(enabled);
          preferenceReadyForFocus.current = true;
          setPreferenceRevision((revision) => revision + 1);
        }
      })
      .catch((preferenceError: unknown) => {
        logger.warn('[TitleTrailerHero] Could not read trailer autoplay preference.');
        if (active) {
          setAutoplayEnabled(false);
          setPreferenceError(true);
          preferenceReadyForFocus.current = true;
          setPreferenceRevision((revision) => revision + 1);
        }
      });
    return () => {
      active = false;
      preferenceReadyForFocus.current = false;
    };
  }, [isFocused]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => () => {
    playerReleasedRef.current = true;
    try {
      player.pause();
    } catch {
      // ignore released-player cleanup edge cases
    }
    try {
      player.release();
    } catch {
      // ignore released-player cleanup edge cases
    }
  }, [player]);

  useEffect(() => {
    setPlayerTimeUpdateInterval(player, 0.25);
    const playingSubscription = player.addListener('playingChange', ({ isPlaying: playing }) => {
      setIsPlaying(playing);
    });
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime: time }) => {
      setCurrentTime(time);
    });
    const endSubscription = player.addListener('playToEnd', () => {
      player.pause();
      setIsPlaying(false);
      setTrailerEnded(true);
      setIsTrailerVisible(false);
      setShowOverlay(true);
      Animated.timing(coverOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    });
    const statusSubscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error' && loadedTrailerKey.current === item.trailerStorageKey) {
        try {
          player.pause();
        } catch {
          // player may already have been released during teardown
        }
        setIsPlaying(false);
        setIsTrailerLoading(false);
        setIsTrailerUnavailable(true);
        setIsVideoMounted(false);
        setIsTrailerVisible(false);
        setShowOverlay(true);
        coverOpacity.setValue(1);
        logger.warn('[TitleTrailerHero] Trailer playback failed.');
      }
    });
    return () => {
      playingSubscription.remove();
      timeSubscription.remove();
      endSubscription.remove();
      statusSubscription.remove();
    };
  }, [coverOpacity, item.trailerStorageKey, player]);

  useEffect(() => {
    if (!preferenceReadyForFocus.current || !shouldAutoplay) {
      if (!playerReleasedRef.current) {
        try {
          player.pause();
        } catch {
          // ignore released-player cleanup edge cases
        }
      }
      setIsPlaying(false);
      setIsTrailerVisible(false);
      coverOpacity.setValue(1);
      return;
    }

    const trailerKey = item.trailerStorageKey;
    if (!trailerKey) {
      return;
    }
    const currentRequestId = ++requestId.current;
    let active = true;
    const isCurrentRequest = () =>
      active &&
      currentRequestId === requestId.current &&
      preferenceReadyForFocus.current &&
      isFocused &&
      isAppActive;

    if (!supabaseMovieRepository) {
      void Promise.resolve().then(() => {
        if (isCurrentRequest()) {
          setIsTrailerLoading(false);
          setIsTrailerUnavailable(true);
        }
      });
      return () => {
        active = false;
        requestId.current += 1;
      };
    }

    if (loadedTrailerKey.current === trailerKey) {
      if (!trailerEnded) {
        setPlayerMuted(player, isTrailerMutedRef.current);
        player.play();
      }
      return () => {
        active = false;
        player.pause();
      };
    }

    setIsTrailerLoading(true);
    setIsTrailerUnavailable(false);
    setTrailerEnded(false);
    setIsVideoMounted(false);
    setIsTrailerVisible(false);
    setShowOverlay(true);
    setCurrentTime(0);
    coverOpacity.setValue(1);
    setPlayerMuted(player, isTrailerMutedRef.current);
    void supabaseMovieRepository
      .getTrailerPlaybackUrl(item)
      .then((url) => {
        if (!isCurrentRequest()) {
          return;
        }
        return player.replaceAsync(url).then(() => {
          if (isCurrentRequest()) {
            loadedTrailerKey.current = trailerKey;
            setIsVideoMounted(true);
            player.play();
          }
        });
      })
      .catch(() => {
        if (isCurrentRequest()) {
          setIsTrailerLoading(false);
          setIsTrailerUnavailable(true);
          setIsVideoMounted(false);
          setIsTrailerVisible(false);
          setShowOverlay(true);
          coverOpacity.setValue(1);
          logger.warn('[TitleTrailerHero] Could not prepare the trailer.');
        }
      });

    return () => {
      active = false;
      requestId.current += 1;
      if (!playerReleasedRef.current) {
        try {
          player.pause();
        } catch {
          // ignore released-player cleanup edge cases
        }
      }
    };
  }, [
    autoplayEnabled,
    coverOpacity,
    isAppActive,
    isFocused,
    isOnline,
    item,
    item.trailerStorageKey,
    player,
    preferenceRevision,
    shouldAutoplay,
    trailerEnded,
    trailerRetry,
  ]);

  useEffect(() => {
    if (!showOverlay || !isPlaying || trailerEnded) {
      return;
    }
    const timeout = setTimeout(() => setShowOverlay(false), 3000);
    return () => clearTimeout(timeout);
  }, [isPlaying, showOverlay, trailerEnded]);

  const retryTrailer = () => {
    setIsTrailerVisible(false);
    setIsVideoMounted(false);
    setIsTrailerLoading(true);
    setIsTrailerUnavailable(false);
    loadedTrailerKey.current = undefined;
    setTrailerRetry((attempt) => attempt + 1);
    setShowOverlay(true);
    coverOpacity.setValue(1);
  };

  const handleFirstFrame = () => {
    if (loadedTrailerKey.current !== item.trailerStorageKey || !hasTrailer) {
      return;
    }
    setIsTrailerLoading(false);
    setIsTrailerUnavailable(false);
    setIsTrailerVisible(true);
    coverOpacity.stopAnimation();
    Animated.timing(coverOpacity, {
      toValue: 0,
      duration: 320,
      useNativeDriver: true,
    }).start();
  };

  const replayTrailer = () => {
    if (isTrailerUnavailable || !loadedTrailerKey.current) {
      retryTrailer();
      return;
    }
    setTrailerEnded(false);
    setIsTrailerVisible(false);
    setShowOverlay(true);
    setCurrentTime(0);
    coverOpacity.setValue(1);
    player.seekBy(-player.currentTime);
    setPlayerMuted(player, isTrailerMuted);
    player.play();
  };

  const manualTrailerVisible =
    hasTrailer &&
    (!shouldAutoplay || isTrailerUnavailable) &&
    !isTrailerLoading &&
    !isTrailerVisible &&
    !trailerEnded;
  const progress = player.duration > 0 ? Math.min(1, currentTime / player.duration) : 0;

  return (
    <View style={styles.hero}>
      {isVideoMounted ? (
        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={false}
          contentFit="cover"
          onFirstFrameRender={handleFirstFrame}
        />
      ) : null}
      <Animated.View pointerEvents="none" style={[styles.coverFade, { opacity: coverOpacity }]}>
        <TitleImage uri={coverUri} style={styles.cover} iconSize={48} />
        <LinearGradient
          colors={[
            'rgba(14,16,20,0)',
            'rgba(14,16,20,0.02)',
            'rgba(14,16,20,0.12)',
            'rgba(14,16,20,0.4)',
            'rgba(14,16,20,0.85)',
          ]}
          locations={[0, 0.18, 0.42, 0.72, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.bottomGradient}
        />
      </Animated.View>
      {hasTrailer && isVideoMounted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showOverlay ? 'Hide trailer controls' : 'Show trailer controls'}
          onPress={() => setShowOverlay((visible) => !visible)}
          style={styles.videoTapLayer}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backButton}
      >
        <Ionicons name="arrow-back" size={22} color={theme.text} />
      </Pressable>

      {hasTrailer && (isTrailerVisible || isTrailerLoading) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isTrailerMuted ? 'Unmute trailer' : 'Mute trailer'}
          onPress={() => {
            const muted = toggleTrailerMuted(isTrailerMuted);
            isTrailerMutedRef.current = muted;
            setPlayerMuted(player, muted);
            setIsTrailerMuted(muted);
          }}
          style={styles.muteButton}
        >
          <Ionicons
            name={isTrailerMuted ? 'volume-mute-outline' : 'volume-high-outline'}
            size={22}
            color={theme.accent}
          />
        </Pressable>
      ) : null}

      {showOverlay ? (
        <View style={styles.overlay}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          {preferenceError ? (
            <Text style={styles.trailerNote}>Trailer autoplay setting could not be loaded.</Text>
          ) : isTrailerUnavailable ? (
            <Text style={styles.trailerNote}>Trailer unavailable</Text>
          ) : null}
          {trailerEnded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Replay trailer"
              onPress={replayTrailer}
              style={styles.playButton}
            >
              <Ionicons name="refresh" size={18} color={theme.background} />
              <Text style={styles.playButtonText}>Replay trailer</Text>
            </Pressable>
          ) : (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Play title"
                accessibilityState={{ disabled: !canPlay }}
                disabled={!canPlay}
                onPress={() => {
                  player.pause();
                  onPlay();
                }}
                style={[styles.playButton, !canPlay && styles.disabledPlayButton]}
              >
                <Ionicons name="play" size={18} color={theme.background} />
                <Text style={styles.playButtonText}>{canPlay ? 'Play' : 'Playback unavailable'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={saved ? 'Remove from My list' : 'Add to My list'}
                onPress={onToggleList}
                style={styles.actionButton}
              >
                <Ionicons name={saved ? 'checkmark' : 'add'} size={22} color={theme.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share title"
                onPress={onShare}
                style={styles.actionButton}
              >
                <Ionicons name="share-outline" size={18} color={theme.text} />
              </Pressable>
              {manualTrailerVisible ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Watch trailer"
                  onPress={onManualTrailer}
                  style={styles.manualTrailerButton}
                >
                  <Ionicons name="film-outline" size={19} color={theme.accent} />
                  <Text style={styles.manualTrailerText}>Watch trailer</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {isTrailerVisible ? (
        <View pointerEvents="none" style={styles.progressTrack}>
          <View style={[styles.progressValue, { width: `${progress * 100}%` }]} />
        </View>
      ) : null}
      {isTrailerLoading ? (
        <View pointerEvents="none" style={styles.loadingNote}>
          <Text style={styles.loadingText}>Loading trailer…</Text>
        </View>
      ) : null}
      {isTrailerUnavailable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry trailer"
          onPress={retryTrailer}
          style={styles.retryTrailer}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  coverFade: { ...StyleSheet.absoluteFill },
  cover: { width: '100%', height: '100%' },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '38%',
  },
  video: { ...StyleSheet.absoluteFill },
  videoTapLayer: { ...StyleSheet.absoluteFill, zIndex: 1 },
  backButton: {
    position: 'absolute',
    top: 14,
    left: 16,
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.scrim,
  },
  muteButton: {
    position: 'absolute',
    top: 14,
    right: 16,
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.scrim,
  },
  overlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 16,
    zIndex: 3,
    gap: 10,
  },
  title: { color: theme.text, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playButton: {
    minHeight: 44,
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 16,
    backgroundColor: theme.accent,
  },
  playButtonText: { color: theme.background, fontSize: 14, fontWeight: '800' },
  disabledPlayButton: { backgroundColor: theme.surfaceSoft },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.scrim,
  },
  manualTrailerButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.scrim,
    paddingHorizontal: 12,
  },
  manualTrailerText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressValue: { height: '100%', backgroundColor: theme.accent },
  loadingNote: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    zIndex: 3,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.scrim,
  },
  loadingText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  trailerNote: { color: theme.text, fontSize: 12, fontWeight: '700' },
  retryTrailer: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    zIndex: 4,
    minWidth: 60,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
  },
  retryText: { color: theme.accent, fontSize: 13, fontWeight: '800' },
});
