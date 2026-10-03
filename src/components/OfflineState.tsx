import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

export function OfflineState({
  onRetry,
  message = "You're offline. Only downloaded titles are available.",
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline mode</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/downloads')}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryText}>Go to My downloads</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Retry connection</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: 24, marginTop: 36 },
  title: { color: theme.text, fontSize: 21, fontWeight: '800', marginBottom: 8 },
  message: { color: theme.secondaryText, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  primaryButton: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    marginTop: 20,
    borderRadius: 14,
    backgroundColor: theme.accent,
  },
  primaryText: { color: theme.background, fontSize: 14, fontWeight: '800' },
  retryButton: { paddingHorizontal: 18, paddingVertical: 14 },
  retryText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
});
