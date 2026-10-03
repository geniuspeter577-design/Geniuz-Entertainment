import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { ContentRail } from '../../src/components/ContentRail';
import { OfflineState } from '../../src/components/OfflineState';
import { SectionHeader } from '../../src/components/SectionHeader';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import type { ContentItem } from '../../src/models/content';
import { contentService } from '../../src/services/createContentService';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { formatGenres, formatRating, formatRuntime } from '../../src/utils/contentPresentation';

export default function HomeScreen() {
  const { isOnline, retryConnection } = useNetwork();
  const trendingQuery = useContentQuery('home-trending', contentService.getTrending, isOnline);
  const popularQuery = useContentQuery('home-popular', contentService.getPopular, isOnline);
  const upcomingQuery = useContentQuery('home-upcoming', contentService.getUpcoming, isOnline);
  const nowPlayingQuery = useContentQuery('home-now-playing', contentService.getNowPlaying, isOnline);
  const moviesQuery = useContentQuery('home-movies', contentService.getMovies, isOnline);
  const seriesQuery = useContentQuery('home-series', contentService.getSeries, isOnline);
  const animeQuery = useContentQuery('home-anime', contentService.getAnime, isOnline);
  const loadUploadedMovies = useCallback(
    async () => ({
      data: supabaseMovieRepository ? await supabaseMovieRepository.getPublished() : [],
      source: 'supabase' as const,
    }),
    [],
  );
  const uploadedMoviesQuery = useContentQuery('uploaded-movies', loadUploadedMovies, isOnline);
  const downloads = useDownloads();
  const retryUploadedMovies = uploadedMoviesQuery.retry;
  useFocusEffect(
    useCallback(() => {
      if (isOnline) {
        retryUploadedMovies();
      }
    }, [isOnline, retryUploadedMovies]),
  );
  const {
    continueWatching,
    error: libraryError,
    isInWatchlist,
    isLoading: libraryLoading,
    isSaving: librarySaving,
    toggleWatchlist,
  } = useLibrary();
  const trending = trendingQuery.data ?? [];
  const popular = popularQuery.data ?? [];
  const upcoming = upcomingQuery.data ?? [];
  const nowPlaying = nowPlayingQuery.data ?? [];
  const movies = moviesQuery.data ?? [];
  const series = seriesQuery.data ?? [];
  const anime = animeQuery.data ?? [];
  const uploadedMovies = uploadedMoviesQuery.data ?? [];
  const featured: ContentItem | undefined = trending[0];
  const premiumPicks = popular.filter((item) => item.availability.premium);
  const retries = [
    trendingQuery.retry,
    popularQuery.retry,
    upcomingQuery.retry,
    nowPlayingQuery.retry,
    moviesQuery.retry,
    seriesQuery.retry,
    animeQuery.retry,
  ];
  const refreshHome = () => {
    retries.forEach((retry) => retry());
    retryUploadedMovies();
  };
  const refreshing = [
    trendingQuery,
    popularQuery,
    upcomingQuery,
    nowPlayingQuery,
    moviesQuery,
    seriesQuery,
    animeQuery,
    uploadedMoviesQuery,
  ].some((query) => query.isRefreshing);

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OfflineState onRetry={() => void retryConnection()} />
      </SafeAreaView>
    );
  }
  const warnings = [
    {
      message:
        trendingQuery.warning ??
        popularQuery.warning ??
        upcomingQuery.warning ??
        nowPlayingQuery.warning ??
        moviesQuery.warning ??
        seriesQuery.warning ??
        animeQuery.warning,
      onAction: () => {
        retries.forEach((retry) => retry());
      },
    },
    ...(libraryError ? [{ message: libraryError }] : []),
  ].filter((warning) => Boolean(warning.message));

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshHome}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.headerRow}>
          <Text style={styles.brand}>Geniuz+</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            style={styles.iconButton}
            disabled
            accessibilityState={{ disabled: true }}
          >
            <Ionicons name="notifications-outline" size={22} color={theme.text} />
          </Pressable>
        </View>

        {warnings.map((warning) => (
          <ContentNotice
            key={warning.message}
            message={warning.message!}
            tone={warning.onAction ? 'warning' : 'error'}
            actionLabel={warning.onAction ? 'Retry' : undefined}
            onAction={warning.onAction}
          />
        ))}
        {downloads.error ? <ContentNotice message={downloads.error} tone="error" /> : null}
        {!trendingQuery.isLoading && trendingQuery.source === 'mock' && !trendingQuery.warning ? (
          <ContentNotice message="Preview catalog — titles shown here are sample content, not playable streams." />
        ) : null}

        {trendingQuery.isLoading ? (
          <ContentNotice message="Loading featured titles…" />
        ) : trendingQuery.error ? (
          <ContentNotice message={trendingQuery.error} tone="error" actionLabel="Retry" onAction={trendingQuery.retry} />
        ) : featured ? (
          <View style={styles.heroCard}>
            <Image
              source={
                featured.backdropUrl
                  ? { uri: featured.backdropUrl }
                  : require('../../assets/icon.png')
              }
              style={styles.heroImage}
              resizeMode="cover"
            />
            <View style={styles.heroOverlay} />
            <View style={styles.heroMeta}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View details for ${featured.title}`}
                onPress={() => router.push({ pathname: '/content/[id]', params: { id: featured.id } })}
              >
                <Text style={styles.heroTag}>
                  {featured.availability.premium ? 'Premium pick' : 'Featured'}
                </Text>
                <Text style={styles.heroTitle}>{featured.title}</Text>
                <Text style={styles.heroSubtitle}>
                  {formatGenres(featured)} • {formatRating(featured)}
                </Text>
              </Pressable>
              <View style={styles.heroActions}>
                <Pressable
                  style={styles.primaryAction}
                  onPress={() => router.push({ pathname: '/content/[id]', params: { id: featured.id } })}
                >
                  <Text style={styles.primaryActionText}>View details</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isInWatchlist(featured.id) ? 'Remove from My List' : 'Add to My List'}
                  disabled={libraryLoading || librarySaving}
                  style={styles.secondaryAction}
                  onPress={() => void toggleWatchlist(featured)}
                >
                  <Ionicons
                    name={isInWatchlist(featured.id) ? 'checkmark' : 'add-outline'}
                    size={18}
                    color={theme.text}
                  />
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <ContentNotice message="No featured titles are available right now." />
        )}

        <SectionHeader title="Continue watching" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowList}>
          {continueWatching.map((entry) => (
            <Pressable
              key={entry.item.id}
              accessibilityRole="button"
              accessibilityLabel={`Continue ${entry.item.title}`}
              onPress={() =>
                router.push({ pathname: '/content/[id]', params: { id: entry.item.id } })
              }
              style={styles.continueCard}
            >
              <Image
                source={
                  entry.item.posterUrl
                    ? { uri: entry.item.posterUrl }
                    : require('../../assets/icon.png')
                }
                style={styles.continuePoster}
                resizeMode="cover"
              />
              <View style={styles.continueMeta}>
                <Text style={styles.continueTitle} numberOfLines={1}>{entry.item.title}</Text>
                <Text style={styles.continueCaption}>{formatRuntime(entry.item)} • {entry.progress}%</Text>
                <View style={styles.continueTrack}>
                  <View style={[styles.continueFill, { width: `${entry.progress}%` }]} />
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
        {!continueWatching.length ? (
          <Text style={styles.continueEmpty}>
            Your viewing progress will appear here when playback is available.
          </Text>
        ) : null}

        {uploadedMovies.length || uploadedMoviesQuery.isLoading || uploadedMoviesQuery.error ? (
          <ContentRail
            title="On Geniuz+"
            items={uploadedMovies}
            isLoading={uploadedMoviesQuery.isLoading}
            error={uploadedMoviesQuery.error}
            retry={uploadedMoviesQuery.retry}
            emptyMessage="No movies have been published yet."
          />
        ) : null}

        <ContentRail
          title="Trending right now"
          items={trending}
          isLoading={trendingQuery.isLoading}
          error={trendingQuery.error}
          retry={trendingQuery.retry}
          emptyMessage="No trending titles are available right now."
        />
        <ContentRail
          title="Popular picks"
          items={popular}
          isLoading={popularQuery.isLoading}
          error={popularQuery.error}
          retry={popularQuery.retry}
          emptyMessage="No popular titles are available right now."
        />
        <ContentRail
          title="Now playing"
          items={nowPlaying}
          isLoading={nowPlayingQuery.isLoading}
          error={nowPlayingQuery.error}
          retry={nowPlayingQuery.retry}
          emptyMessage="No now-playing titles are available right now."
        />
        <ContentRail
          title="Coming soon"
          items={upcoming}
          isLoading={upcomingQuery.isLoading}
          error={upcomingQuery.error}
          retry={upcomingQuery.retry}
          emptyMessage="No upcoming titles are available right now."
        />
        <ContentRail
          title="Movies"
          items={movies}
          isLoading={moviesQuery.isLoading}
          error={moviesQuery.error}
          retry={moviesQuery.retry}
          emptyMessage="No movies are available right now."
        />
        <ContentRail
          title="Series"
          items={series}
          isLoading={seriesQuery.isLoading}
          error={seriesQuery.error}
          retry={seriesQuery.retry}
          emptyMessage="No series are available right now."
        />
        <ContentRail
          title="Anime"
          items={anime}
          isLoading={animeQuery.isLoading}
          error={animeQuery.error}
          retry={animeQuery.retry}
          compact
          emptyMessage="No anime metadata is available in this catalog."
        />
        <ContentRail
          title="Premium picks"
          items={premiumPicks}
          isLoading={popularQuery.isLoading}
          error={popularQuery.error}
          retry={popularQuery.retry}
          compact
          emptyMessage="Premium availability is not provided by the discovery catalog."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 18,
  },
  brand: {
    fontSize: 28,
    color: theme.text,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  heroCard: {
    position: 'relative',
    height: 280,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 4,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(7,10,13,0.24)',
  },
  heroMeta: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  heroTag: {
    alignSelf: 'flex-start',
    color: theme.accentSoft,
    backgroundColor: 'rgba(8,10,12,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontWeight: '700',
    fontSize: 11,
    marginBottom: 10,
    overflow: 'hidden',
  },
  heroTitle: {
    color: theme.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.9,
    marginBottom: 6,
  },
  heroSubtitle: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryAction: {
    backgroundColor: theme.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  primaryActionText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryAction: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rowList: {
    paddingRight: 18,
    paddingBottom: 4,
  },
  continueEmpty: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  continueCard: {
    width: 250,
    height: 100,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    marginRight: 12,
  },
  continuePoster: {
    width: 70,
    height: '100%',
  },
  continueMeta: {
    flex: 1,
    justifyContent: 'center',
    padding: 10,
  },
  continueTitle: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 14,
  },
  continueCaption: {
    color: theme.secondaryText,
    fontSize: 11,
    marginVertical: 6,
  },
  continueTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: theme.surfaceSoft,
  },
  continueFill: {
    height: '100%',
    backgroundColor: theme.accent,
  },
});
