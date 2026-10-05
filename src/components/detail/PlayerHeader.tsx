import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { theme } from '../../theme';
import {
  clampPlayerValue,
  formatPlaybackTime,
  getSeekBarTarget,
} from '../../utils/playerControls';

type PlayerHeaderProps = {
  player: ReturnType<typeof useVideoPlayer>;
  playbackUrl?: string;
  title: string;
  isLoading: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bufferedPosition: number;
  error?: string;
  showControls: boolean;
  isLandscape: boolean;
  onBack: () => void;
  onToggleControls: () => void;
  onPlayPause: () => void;
  onSeekBy: (seconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onSeekingChange: (isSeeking: boolean) => void;
  onRetry: () => void;
};

export function PlayerHeader({
  player,
  playbackUrl,
  title,
  isLoading,
  isBuffering,
  isPlaying,
  currentTime,
  duration,
  bufferedPosition,
  error,
  showControls,
  isLandscape,
  onBack,
  onToggleControls,
  onPlayPause,
  onSeekBy,
  onSeekTo,
  onSeekingChange,
  onRetry,
}: PlayerHeaderProps) {
  const seekBarWidth = useRef(0);
  const progress = duration > 0 ? clampPlayerValue(currentTime / duration) : 0;
  const bufferedProgress = duration > 0 ? clampPlayerValue(bufferedPosition / duration) : 0;

  const seekFromEvent = (event: GestureResponderEvent) => {
    onSeekTo(getSeekBarTarget(event.nativeEvent.locationX, seekBarWidth.current, duration));
  };
  const handleSeekBarLayout = (event: LayoutChangeEvent) => {
    seekBarWidth.current = event.nativeEvent.layout.width;
  };

  return (
    <View style={[styles.container, isLandscape && styles.landscapeContainer]}>
      {playbackUrl ? (
        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          contentFit="contain"
          allowsPictureInPicture={false}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={showControls ? 'Hide playback controls' : 'Show playback controls'}
        onPress={onToggleControls}
        style={StyleSheet.absoluteFill}
      />
      {isBuffering ? (
        <View pointerEvents="none" style={styles.bufferingBadge}>
          <ActivityIndicator color={theme.accent} size="small" />
          <Text style={styles.bufferingText}>{isLoading ? 'Loading' : 'Buffering'}</Text>
        </View>
      ) : null}
      {showControls ? (
        <View style={styles.controls} pointerEvents="box-none">
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              style={styles.backButton}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          </View>

          {error ? (
            <View style={styles.errorPanel}>
              <Ionicons name="alert-circle-outline" size={30} color={theme.text} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.centerControls} pointerEvents="box-none">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back 10 seconds"
                  onPress={() => onSeekBy(-10)}
                  style={styles.skipButton}
                  hitSlop={8}
                >
                  <Ionicons name="play-back" size={28} color={theme.text} />
                  <Text style={styles.skipText}>10</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                  onPress={onPlayPause}
                  style={styles.playButton}
                  hitSlop={8}
                >
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={38} color={theme.background} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Forward 10 seconds"
                  onPress={() => onSeekBy(10)}
                  style={styles.skipButton}
                  hitSlop={8}
                >
                  <Ionicons name="play-forward" size={28} color={theme.text} />
                  <Text style={styles.skipText}>10</Text>
                </Pressable>
              </View>

              <View style={styles.seekControls}>
                <Text style={styles.timeText}>{formatPlaybackTime(currentTime)}</Text>
                <View
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Playback position"
                  accessibilityValue={{
                    min: 0,
                    max: duration > 0 ? duration : 0,
                    now: Math.min(currentTime, duration),
                    text: `${formatPlaybackTime(currentTime)} of ${duration > 0 ? formatPlaybackTime(duration) : 'unknown duration'}`,
                  }}
                  accessibilityActions={[{ name: 'increment', label: 'Forward 10 seconds' }, { name: 'decrement', label: 'Back 10 seconds' }]}
                  onAccessibilityAction={(event) => {
                    onSeekBy(event.nativeEvent.actionName === 'increment' ? 10 : -10);
                  }}
                  onLayout={handleSeekBarLayout}
                  onStartShouldSetResponder={() => duration > 0}
                  onMoveShouldSetResponder={() => duration > 0}
                  onResponderGrant={(event) => {
                    onSeekingChange(true);
                    seekFromEvent(event);
                  }}
                  onResponderMove={seekFromEvent}
                  onResponderRelease={(event) => {
                    seekFromEvent(event);
                    onSeekingChange(false);
                  }}
                  onResponderTerminate={() => onSeekingChange(false)}
                  style={styles.seekBarTouchTarget}
                >
                  <View pointerEvents="none" style={styles.seekTrack}>
                    <View style={[styles.seekBuffered, { width: `${bufferedProgress * 100}%` }]} />
                    <View style={[styles.seekProgress, { width: `${progress * 100}%` }]} />
                    <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                  </View>
                </View>
                <Text style={styles.timeText}>{duration > 0 ? formatPlaybackTime(duration) : '--:--'}</Text>
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.background,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  landscapeContainer: {
    flex: 1,
    aspectRatio: undefined,
  },
  video: {
    ...StyleSheet.absoluteFill,
  },
  controls: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(14, 16, 20, 0.18)',
  },
  topBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: theme.scrim,
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: theme.surface,
  },
  title: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
  },
  centerControls: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    transform: [{ translateY: -34 }],
  },
  skipButton: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: 'rgba(26, 29, 35, 0.9)',
  },
  skipText: {
    position: 'absolute',
    color: theme.text,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 15,
  },
  playButton: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 35,
    backgroundColor: theme.accent,
  },
  seekControls: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: theme.scrim,
  },
  timeText: {
    minWidth: 42,
    color: theme.text,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  seekBarTouchTarget: {
    height: 44,
    flex: 1,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 4,
    borderRadius: 4,
    backgroundColor: theme.surfaceSoft,
    justifyContent: 'center',
  },
  seekBuffered: {
    position: 'absolute',
    height: 4,
    borderRadius: 4,
    backgroundColor: theme.secondaryText,
  },
  seekProgress: {
    height: 4,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
  seekThumb: {
    position: 'absolute',
    top: -5,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: theme.accent,
  },
  bufferingBadge: {
    position: 'absolute',
    top: 72,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: theme.scrim,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bufferingText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '600',
  },
  errorPanel: {
    position: 'absolute',
    top: '25%',
    left: 24,
    right: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    maxWidth: 440,
    color: theme.text,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 104,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.accent,
    paddingHorizontal: 20,
  },
  retryText: {
    color: theme.background,
    fontSize: 15,
    fontWeight: '800',
  },
});
