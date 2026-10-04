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

import { isFeatureEnabled } from '../../config/features';
import { theme } from '../../theme';
import { isPlayerGestureArea } from '../../utils/playerControls';

type GestureSide = 'left' | 'right';
type GestureFeedback =
  | { kind: 'seek'; label: string }
  | { kind: 'level'; side: GestureSide; value: number };

type PlayerHeaderProps = {
  player: ReturnType<typeof useVideoPlayer>;
  playbackUrl?: string;
  isLoading: boolean;
  error?: string;
  onRetry: () => void;
  isFullscreen?: boolean;
  gestureFeedback?: GestureFeedback;
  getGestureValue: (side: GestureSide) => number;
  onVerticalDrag: (side: GestureSide, startValue: number, deltaY: number, height: number) => void;
  onSeekBy: (side: GestureSide) => void;
};

export function PlayerHeader({
  player,
  playbackUrl,
  isLoading,
  error,
  onRetry,
  isFullscreen = false,
  gestureFeedback,
  getGestureValue,
  onVerticalDrag,
  onSeekBy,
}: PlayerHeaderProps) {
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const touchStartRef = useRef<{ x: number; y: number; pageX: number; pageY: number; side: GestureSide } | undefined>(undefined);
  const dragStartRef = useRef<{ side: GestureSide; value: number } | undefined>(undefined);
  const lastTapRef = useRef<{ side: GestureSide; time: number } | undefined>(undefined);
  const draggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const canUseGestures = Boolean(playbackUrl) && !isLoading && !error;

  const recordTouchStart = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    wasDragRef.current = false;
    if (!canUseGestures) {
      touchStartRef.current = undefined;
      return;
    }
    touchStartRef.current = {
      x: locationX,
      y: locationY,
      pageX,
      pageY,
      side: locationX < dimensionsRef.current.width / 2 ? 'left' : 'right',
    };
  };

  const shouldCaptureVerticalDrag = (event: GestureResponderEvent) => {
    const start = touchStartRef.current;
    const { width, height } = dimensionsRef.current;
    const { pageX, pageY } = event.nativeEvent;
    const dx = pageX - (start?.pageX ?? pageX);
    const dy = pageY - (start?.pageY ?? pageY);
    return Boolean(
      canUseGestures &&
        start &&
        isPlayerGestureArea(start.x, start.y, width, height) &&
        Math.abs(dy) > 8 &&
        Math.abs(dy) > Math.abs(dx) * 1.2,
    );
  };

  const beginVerticalDrag = () => {
    const start = touchStartRef.current;
    if (start) {
      dragStartRef.current = { side: start.side, value: getGestureValue(start.side) };
      draggingRef.current = true;
      wasDragRef.current = true;
    }
  };

  const updateVerticalDrag = (event: GestureResponderEvent) => {
    const drag = dragStartRef.current;
    const { height } = dimensionsRef.current;
    const deltaY = event.nativeEvent.pageY - (touchStartRef.current?.pageY ?? event.nativeEvent.pageY);
    if (drag && height > 0) {
      onVerticalDrag(drag.side, drag.value, deltaY, height);
    }
  };

  const finishVerticalDrag = () => {
    draggingRef.current = false;
    dragStartRef.current = undefined;
  };

  const recordTouchEnd = () => {
    const start = touchStartRef.current;
    const { width, height } = dimensionsRef.current;
    touchStartRef.current = undefined;
    if (
      !start ||
      wasDragRef.current ||
      draggingRef.current ||
      !isPlayerGestureArea(start.x, start.y, width, height)
    ) {
      return;
    }
    const now = Date.now();
    if (lastTapRef.current?.side === start.side && now - lastTapRef.current.time <= 300) {
      lastTapRef.current = undefined;
      onSeekBy(start.side);
    } else {
      lastTapRef.current = { side: start.side, time: now };
    }
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    dimensionsRef.current = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };
  };

  return (
    <View
      style={[styles.container, isFullscreen && styles.fullscreenContainer]}
      onLayout={handleLayout}
      onTouchStart={recordTouchStart}
      onTouchEnd={recordTouchEnd}
      onStartShouldSetResponder={() => false}
      onMoveShouldSetResponder={shouldCaptureVerticalDrag}
      onResponderGrant={beginVerticalDrag}
      onResponderMove={updateVerticalDrag}
      onResponderRelease={finishVerticalDrag}
      onResponderTerminate={finishVerticalDrag}
      onResponderTerminationRequest={() => false}
    >
      {playbackUrl ? (
        <VideoView
          player={player}
          style={[styles.video, isFullscreen && styles.fullscreenVideo]}
          nativeControls
          fullscreenOptions={{ enable: false }}
          contentFit="contain"
          allowsPictureInPicture={false}
        />
      ) : null}
      {isFeatureEnabled('qualityOptions') ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          style={[styles.qualityPill, styles.disabledQuality]}
        >
          <Text style={styles.qualityText}>Standard quality · Go HD ›</Text>
        </Pressable>
      ) : null}
      {isLoading ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.overlayText}>Preparing your video...</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.overlay}>
          <Ionicons name="alert-circle-outline" size={28} color={theme.text} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {gestureFeedback?.kind === 'seek' ? (
        <View pointerEvents="none" style={styles.seekFeedback} accessibilityLiveRegion="polite">
          <Text style={styles.feedbackText}>{gestureFeedback.label}</Text>
        </View>
      ) : null}
      {gestureFeedback?.kind === 'level' ? (
        <View
          pointerEvents="none"
          style={[
            styles.levelFeedback,
            gestureFeedback.side === 'left' ? styles.levelFeedbackLeft : styles.levelFeedbackRight,
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.feedbackText}>
            {gestureFeedback.side === 'left' ? 'Brightness' : 'Volume'}
          </Text>
          <View style={styles.levelTrack}>
            <View
              style={[
                styles.levelFill,
                { height: `${Math.round(gestureFeedback.value * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.feedbackText}>{Math.round(gestureFeedback.value * 100)}%</Text>
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
  },
  video: { width: '100%', height: '100%' },
  fullscreenContainer: {
    flex: 1,
    aspectRatio: undefined,
  },
  fullscreenVideo: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  qualityPill: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  disabledQuality: { opacity: 0.75 },
  qualityText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  overlayText: { color: theme.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  errorText: { color: theme.text, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  retryButton: {
    minWidth: 96,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
  },
  retryText: { color: theme.background, fontSize: 15, fontWeight: '800' },
  seekFeedback: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: theme.scrim,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  levelFeedback: {
    position: 'absolute',
    top: '30%',
    bottom: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  levelFeedbackLeft: { left: 20 },
  levelFeedbackRight: { right: 20 },
  levelTrack: {
    width: 5,
    flex: 1,
    maxHeight: 120,
    backgroundColor: theme.surface,
    borderRadius: 999,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  levelFill: {
    width: '100%',
    backgroundColor: theme.accent,
  },
  feedbackText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: '#000000',
    textShadowRadius: 4,
  },
});
