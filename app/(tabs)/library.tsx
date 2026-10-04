import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { OfflineState } from '../../src/components/OfflineState';
import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import { MockContentRepository } from '../../src/repositories/MockContentRepository';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { isDemoCatalogEnabled, loadPublishedCatalog } from '../../src/utils/publishedCatalog';

const demoRepository = new MockContentRepository();

export default function LibraryScreen() {
  const { isOnline, retryConnection } = useNetwork();
  const { continueWatching, error, isLoading, retryLoad, watchlist } = useLibrary();
  const loadCatalog = useCallback(
    () =>
      loadPublishedCatalog(
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
        () => {
          if (!supabaseMovieRepository) {
            throw new Error('Supabase catalog is not configured.');
          }
          return supabaseMovieRepository.getPublishedShorts();
        },
      ).then(async (catalog) => ({
        data: {
          ...catalog,
          demos:
            isDemoCatalogEnabled && !catalog.hasFailures && !catalog.movies.length && !catalog.series.length && !catalog.shorts.length
              ? await demoRepository.getPopular()
              : [],
        },
        source: 'supabase' as const,
      })),
    [],
  );
  const catalogQuery = useContentQuery('library-supabase-catalog', loadCatalog, isOnline);
  const publishedIds = new Set([
    ...(catalogQuery.data?.movies ?? []).map(({ id }) => id),
    ...(catalogQuery.data?.series ?? []).map(({ id }) => id),
    ...(catalogQuery.data?.shorts ?? []).map(({ id }) => id),
  ]);
  const demoIds = new Set((catalogQuery.data?.demos ?? []).map(({ id }) => id));
  const visibleWatchlist = watchlist.filter(
    (item) => publishedIds.has(item.id) || demoIds.has(item.id),
  );
  const visibleContinueWatching = continueWatching.filter(
    ({ item }) => publishedIds.has(item.id) || demoIds.has(item.id),
  );
  const retryAll = () => {
    retryLoad();
    catalogQuery.retry();
  };
  const refreshing = isLoading || catalogQuery.isRefreshing;

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OfflineState
          onRetry={() => void retryConnection()}
          message="Your online library is unavailable offline. Downloaded titles remain ready in My downloads."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={retryAll}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <Text style={styles.header}>My library</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Watchlist</Text>
            <Text style={styles.summaryValue}>{visibleWatchlist.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>In progress</Text>
            <Text style={styles.summaryValue}>{visibleContinueWatching.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Offline</Text>
            <Text style={styles.summaryValue}>0</Text>
          </View>
        </View>

        {(isLoading || catalogQuery.isLoading) ? <ContentNotice message="Loading your library…" /> : null}
        {error ? (
          <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={retryLoad} />
        ) : null}
        {catalogQuery.error || catalogQuery.data?.hasFailures ? (
          <ContentNotice
            message={catalogQuery.error ?? 'Some titles could not be loaded. Please retry.'}
            tone="error"
            actionLabel="Retry"
            onAction={retryAll}
            autoHideMs={5000}
          />
        ) : null}
        {catalogQuery.data?.demos.length ? (
          <ContentNotice message="Demo catalog — saved sample titles are shown." />
        ) : null}

        <SectionHeader title="My watchlist" />
        <View style={styles.grid}>
          {visibleWatchlist.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              compact
              onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
            />
          ))}
        </View>
        {!isLoading && !catalogQuery.isLoading && !error && visibleWatchlist.length === 0 ? (
          <Text style={styles.emptyText}>No titles yet</Text>
        ) : null}

        <SectionHeader title="Recently watched" />
        {visibleContinueWatching.map((entry) => (
          <Pressable
            key={entry.item.id}
            style={styles.rowItem}
            onPress={() =>
              router.push({ pathname: '/content/[id]', params: { id: entry.item.id } })
            }
          >
            <Image
              source={
                entry.item.posterUrl
                  ? { uri: entry.item.posterUrl }
                  : require('../../assets/icon.png')
              }
              style={styles.rowCover}
              resizeMode="cover"
            />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>{entry.item.title}</Text>
              <Text style={styles.rowMeta}>{entry.item.type} • {entry.progress}% complete</Text>
            </View>
            <Text style={styles.rowProgress}>{entry.progress}%</Text>
          </Pressable>
        ))}
        {!visibleContinueWatching.length ? (
          <Text style={styles.emptyText}>Viewing progress will be saved here when playback is available.</Text>
        ) : null}
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
  header: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 20,
    letterSpacing: -0.9,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  summaryLabel: {
    color: theme.secondaryText,
    fontSize: 12,
    marginBottom: 6,
  },
  summaryValue: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  rowCover: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
  },
  rowInfo: {
    flex: 1,
    marginLeft: 12,
  },
  rowTitle: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  rowMeta: {
    color: theme.secondaryText,
    fontSize: 12,
  },
  rowProgress: {
    color: theme.accent,
    fontWeight: '800',
    fontSize: 12,
  },
  emptyText: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
});
