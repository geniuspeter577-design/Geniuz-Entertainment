import { router, Stack } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { ShortsFeed } from '../src/components/ShortsFeed';
import { supabaseMovieRepository } from '../src/repositories/SupabaseMovieRepository';
import { useNetwork } from '../src/state/NetworkContext';
import { theme } from '../src/theme';
import { useContentQuery } from '../src/hooks/useContentQuery';

export default function ShortsScreen() {
  const { isOnline } = useNetwork();
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const loadShorts = useCallback(async () => {
    if (!supabaseMovieRepository) {
      throw new Error('Short videos are not configured.');
    }
    return { data: await supabaseMovieRepository.getPublishedShorts(), source: 'supabase' as const };
  }, []);
  const query = useContentQuery('shorts-feed', loadShorts, isOnline);
  const height = Math.max(1, dimensions.height - insets.top - insets.bottom);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ orientation: 'portrait', statusBarHidden: false, navigationBarHidden: false }} />
      {!isOnline ? (
        <View style={styles.messageState}>
          <ContentNotice message="Connect to the internet to watch Shorts." tone="warning" />
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.button}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      ) : query.isLoading ? (
        <View style={styles.messageState}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.loadingText}>Loading Shorts…</Text>
        </View>
      ) : query.error ? (
        <View style={styles.messageState}>
          <ContentNotice message={query.error} tone="error" actionLabel="Retry" onAction={query.retry} />
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.button}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      ) : query.data?.length ? (
        <ShortsFeed items={query.data} height={height} onBack={() => router.back()} />
      ) : (
        <View style={styles.messageState}>
          <ContentNotice message="No Shorts are available yet." />
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.button}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  messageState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingText: { color: theme.text, fontSize: 14 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 8, backgroundColor: theme.accent },
  buttonText: { color: theme.background, fontWeight: '800' },
});
