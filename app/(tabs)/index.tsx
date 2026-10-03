import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
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
import { HomeHeroCarousel } from '../../src/components/HomeHeroCarousel';
import { OfflineState } from '../../src/components/OfflineState';
import { SectionHeader } from '../../src/components/SectionHeader';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { MockContentRepository } from '../../src/repositories/MockContentRepository';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { formatRuntime } from '../../src/utils/contentPresentation';
import {
  isDemoCatalogEnabled,
  loadPublishedCatalog,
  sortPublishedNewest,
} from '../../src/utils/publishedCatalog';

const demoRepository = new MockContentRepository();

export default function HomeScreen() {
  const { isOnline, retryConnection } = useNetwork();
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const loadCatalog = useCallback(async () => {
    const catalog = await loadPublishedCatalog(
      () => {
        if (!supabaseMovieRepository) {
          throw new Error('Supabase catalog is not configured.');
        }
        return supabaseMovieRepository.getPublishedMovies();
      },
      () => {
        if (!supabaseMovieRepository) {
          throw new Error('Supabase catalog is not configured.');
        }
        return supabaseMovieRepository.getPublishedSeries();
      },
    );

    if (
      isDemoCatalogEnabled &&
      !catalog.hasFailures &&
      catalog.movies.length + catalog.series.length === 0
    ) {
      const demos = await demoRepository.getPopular();
      return {
        data: {
          movies: demos.filter((item) => item.type === 'movie'),
          series: demos.filter((item) => item.type !== 'movie'),
          hasFailures: false,
          showingDemo: true,
        },
        source: 'mock' as const,
      };
    }
    return { data: { ...catalog, showingDemo: false }, source: 'supabase' as const };
  }, []);
  const catalogQuery = useContentQuery('home-supabase-catalog', loadCatalog, isOnline);
  const { continueWatching, isInWatchlist, toggleWatchlist } = useLibrary();
  const movies = catalogQuery.data?.movies ?? [];
  const series = catalogQuery.data?.series ?? [];
  const publishedItems = sortPublishedNewest([...movies, ...series]);
  const heroItems = publishedItems.slice(0, 5);
  const listedIds = new Set(publishedItems.map((item) => item.id));
  const recent = continueWatching.filter(
    ({ item }) => listedIds.has(item.id) || (catalogQuery.data?.showingDemo && item.source === 'mock'),
  );
  const genres = [...new Set(publishedItems.flatMap((item) => item.genres))];
  const genresWithItems = genres
    .map((genre) => ({
      genre,
      items: publishedItems.filter((item) =>
        item.genres.some((itemGenre) => itemGenre.toLocaleLowerCase() === genre.toLocaleLowerCase()),
      ),
    }))
    .filter(({ items }) => items.length > 0);
  const retryCatalog = catalogQuery.retry;

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isCheckingConnection}
              onRefresh={() => {
                setIsCheckingConnection(true);
                void retryConnection().finally(() => setIsCheckingConnection(false));
              }}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
        >
          <Text style={styles.brand}>Geniuz+</Text>
          <OfflineState onRetry={() => void retryConnection()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const noTitles = !catalogQuery.isLoading && !catalogQuery.data?.hasFailures && !publishedItems.length;
  const catalogError = catalogQuery.error || (catalogQuery.data?.hasFailures
    ? 'Some titles could not be loaded. Please retry.'
    : undefined);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={catalogQuery.isRefreshing}
            onRefresh={retryCatalog}
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

        {catalogError ? (
          <ContentNotice
            message={catalogError}
            tone="error"
            actionLabel="Retry"
            onAction={retryCatalog}
            autoHideMs={5000}
          />
        ) : null}
        {catalogQuery.data?.showingDemo ? (
          <ContentNotice message="Demo catalog — titles shown here are sample content, not playable streams." />
        ) : null}

        {heroItems.length ? (
          <HomeHeroCarousel
            items={heroItems}
            isLoading={catalogQuery.isLoading}
            isInWatchlist={isInWatchlist}
            onToggleWatchlist={(item) => void toggleWatchlist(item)}
          />
        ) : null}
        {catalogQuery.isLoading ? <ContentNotice message="Loading published titles…" /> : null}
        {noTitles ? <Text style={styles.emptyText}>No titles yet</Text> : null}

        {recent.length ? (
          <>
            <SectionHeader title="Continue watching" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowList}>
              {recent.map((entry) => (
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
                    <Text style={styles.continueCaption}>
                      {formatRuntime(entry.item)} • {entry.progress}%
                    </Text>
                    <View style={styles.continueTrack}>
                      <View style={[styles.continueFill, { width: `${entry.progress}%` }]} />
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {publishedItems.length ? (
          <>
            <ContentRail
              title="Latest"
              items={publishedItems}
              isLoading={catalogQuery.isLoading}
              retry={retryCatalog}
              emptyMessage="No titles yet"
            />
            {movies.length ? (
              <ContentRail
                title="Movies"
                items={sortPublishedNewest(movies)}
                isLoading={false}
                retry={retryCatalog}
                emptyMessage="No movies yet"
              />
            ) : null}
            {series.length ? (
              <ContentRail
                title="Series"
                items={sortPublishedNewest(series)}
                isLoading={false}
                retry={retryCatalog}
                emptyMessage="No series yet"
              />
            ) : null}
            {genresWithItems.map(({ genre, items }) => (
              <ContentRail
                key={genre}
                title={genre}
                items={items}
                isLoading={false}
                retry={retryCatalog}
                emptyMessage={`No ${genre} titles yet`}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: 18, paddingBottom: 30 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 18,
  },
  brand: { fontSize: 28, color: theme.text, fontWeight: '800', letterSpacing: -0.8 },
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
  emptyText: { color: theme.secondaryText, fontSize: 14, paddingVertical: 18 },
  rowList: { paddingRight: 18, paddingBottom: 4 },
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
  continuePoster: { width: 70, height: '100%' },
  continueMeta: { flex: 1, justifyContent: 'center', padding: 10 },
  continueTitle: { color: theme.text, fontWeight: '700', fontSize: 14 },
  continueCaption: { color: theme.secondaryText, fontSize: 11, marginVertical: 6 },
  continueTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: theme.surfaceSoft,
  },
  continueFill: { height: '100%', backgroundColor: theme.accent },
});
