import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import { contentService } from '../../src/services/createContentService';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useLibrary } from '../../src/state/LibraryContext';
import { theme } from '../../src/theme';
import { formatGenres, formatRating, formatRuntime } from '../../src/utils/contentPresentation';

export default function ContentDetailsScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const library = useLibrary();
  const downloads = useDownloads();
  const fallbackItem =
    library.watchlist.find((item) => item.id === id) ??
    library.continueWatching.find((entry) => entry.item.id === id)?.item;
  const loadContent = useCallback(
    () =>
      id.startsWith('geniuz:movie:') && supabaseMovieRepository
        ? supabaseMovieRepository.getById(id).then((data) => ({ data, source: 'supabase' as const }))
        : contentService.getById(id, fallbackItem),
    [fallbackItem, id],
  );
  const content = useContentQuery(`content:${id}`, loadContent);
  const media = content.data;
  const { error: libraryError, isInWatchlist, isLoading: libraryLoading, isSaving: librarySaving, toggleWatchlist } = library;

  if (content.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ContentNotice message="Loading title details…" />
      </SafeAreaView>
    );
  }

  if (content.error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ContentNotice message={content.error} tone="error" actionLabel="Retry" onAction={content.retry} />
        <Pressable style={styles.homeButton} onPress={() => router.replace('/')}>
          <Text style={styles.homeButtonText}>Back to Geniuz+</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!media) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ContentNotice message="This title could not be found in the available catalog." />
        <Pressable style={styles.homeButton} onPress={() => router.replace('/')}>
          <Text style={styles.homeButtonText}>Back to Geniuz+</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const saved = isInWatchlist(media.id);
  const downloadRecord = downloads.records.find((record) => record.item.id === media.id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isDownloaded = downloadRecord?.status === 'downloaded';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <Image
            source={
              media.backdropUrl
                ? { uri: media.backdropUrl }
                : require('../../assets/icon.png')
            }
            style={styles.heroImage}
            resizeMode="cover"
          />
          <View style={styles.heroOverlay} />
        </View>

        <View style={styles.contentWrap}>
          {content.warning ? (
            <ContentNotice
              message={content.warning}
              tone="warning"
              actionLabel="Retry"
              onAction={content.retry}
            />
          ) : null}
          {libraryError ? <ContentNotice message={libraryError} tone="error" /> : null}
          {downloads.error ? <ContentNotice message={downloads.error} tone="error" /> : null}
          <Text style={styles.tag}>{formatGenres(media)}</Text>
          <Text style={styles.title}>{media.title}</Text>
          <Text style={styles.meta}>
            {media.year ?? '—'} • {formatRuntime(media)} • {formatRating(media)}
          </Text>

          <View style={styles.actionsRow}>
            {media.availability.stream && media.mediaPath ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.push({ pathname: '/watch/[id]', params: { id: media.id } })}
              >
                <Text style={[styles.primaryButtonText, styles.playButtonText]}>Play movie</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.primaryButton, styles.disabledButton]} disabled>
                <Text style={styles.primaryButtonText}>Playback unavailable</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.secondaryButton}
              disabled={libraryLoading || librarySaving}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from My List' : 'Add to My List'}
              onPress={() => void toggleWatchlist(media)}
            >
              <Text style={styles.secondaryButtonText}>{saved ? '✓ In My List' : '+ My List'}</Text>
            </Pressable>
            {media.availability.download ? (
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(isDownloaded)}
                style={[styles.secondaryButton, isDownloaded && styles.disabledButton]}
                onPress={() => {
                  if (isDownloading) {
                    void downloads.cancel(media.id).catch((error: unknown) =>
                      Alert.alert('Download error', error instanceof Error ? error.message : 'Could not cancel this download.'),
                    );
                  } else {
                    void downloads.download(media).catch((error: unknown) =>
                      Alert.alert('Download error', error instanceof Error ? error.message : 'The download failed. Please retry.'),
                    );
                  }
                }}
              >
                <Text style={styles.secondaryButtonText}>
                  {isDownloaded
                    ? 'Downloaded'
                    : isDownloading
                      ? `Cancel ${downloadRecord.progress}%`
                      : downloadRecord?.status === 'failed' || downloadRecord?.status === 'canceled'
                        ? 'Retry download'
                        : 'Download'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.description}>
            {media.description || 'No description is available for this title yet.'}
          </Text>

          <View style={styles.pillRow}>
            {media.genres.map((genre) => (
              <Text key={genre} style={styles.pill}>
                {genre}
              </Text>
            ))}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Availability</Text>
            <Text style={styles.infoValue}>
              {media.availability.stream
                ? media.availability.download
                  ? 'Streaming and offline downloads are available.'
                  : 'Streaming is available. Offline downloads are not enabled for this title.'
                : 'Discovery listing only. Streaming and downloads are not enabled.'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  heroWrap: {
    position: 'relative',
    height: 320,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(5, 8, 11, 0.32)',
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 18,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(11, 12, 15, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentWrap: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 36,
  },
  tag: {
    color: theme.accent,
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 8,
  },
  meta: {
    color: theme.secondaryText,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  disabledButton: {
    backgroundColor: theme.surfaceSoft,
  },
  playButtonText: {
    color: theme.background,
  },
  primaryButtonText: {
    color: theme.text,
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryButtonText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 15,
  },
  description: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 18,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  pill: {
    backgroundColor: theme.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  infoCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 12,
  },
  infoLabel: {
    color: theme.secondaryText,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  homeButton: {
    alignSelf: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 8,
  },
  homeButtonText: {
    color: theme.background,
    fontSize: 14,
    fontWeight: '800',
  },
});
