import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { isFeatureEnabled } from '../../config/features';
import { theme } from '../../theme';

type PlayerHeaderProps = {
  player: ReturnType<typeof useVideoPlayer>;
  playbackUrl?: string;
  isLoading: boolean;
  error?: string;
  onRetry: () => void;
};

export function PlayerHeader({
  player,
  playbackUrl,
  isLoading,
  error,
  onRetry,
}: PlayerHeaderProps) {
  return (
    <View style={styles.container}>
      {playbackUrl ? (
        <VideoView
          player={player}
          style={styles.video}
          nativeControls
          fullscreenOptions={{ enable: true }}
          contentFit="contain"
          allowsPictureInPicture
        />
      ) : null}
      {isFeatureEnabled('qualityOptions') ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => undefined}
          style={styles.qualityPill}
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
});
