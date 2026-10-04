import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { KeyboardAwareScrollView, KeyboardAwareTextInput } from '../../src/components/KeyboardAwareScrollView';
import { OfflineState } from '../../src/components/OfflineState';
import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import { MockContentRepository } from '../../src/repositories/MockContentRepository';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import {
  isDemoCatalogEnabled,
  loadPublishedCatalog,
  searchPublishedCatalog,
  sortPublishedNewest,
} from '../../src/utils/publishedCatalog';

const demoRepository = new MockContentRepository();

export default function SearchScreen() {
  const { isOnline, retryConnection } = useNetwork();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

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
      () => {
        if (!supabaseMovieRepository) {
          throw new Error('Supabase catalog is not configured.');
        }
        return supabaseMovieRepository.getPublishedShorts();
      },
    );
    if (
      isDemoCatalogEnabled &&
      !catalog.hasFailures &&
      catalog.movies.length + catalog.series.length + catalog.shorts.length === 0
    ) {
      const demos = await demoRepository.getPopular();
      return {
        data: {
          ...catalog,
          movies: demos.filter((item) => item.type === 'movie'),
          series: demos.filter((item) => item.type === 'series'),
          shorts: [],
          showingDemo: true,
        },
        source: 'mock' as const,
      };
    }
    return { data: { ...catalog, showingDemo: false }, source: 'supabase' as const };
  }, []);
  const catalogQuery = useContentQuery('search-supabase-catalog', loadCatalog, isOnline);
  const catalogItems = useMemo(
    () => sortPublishedNewest([
      ...(catalogQuery.data?.movies ?? []),
      ...(catalogQuery.data?.series ?? []),
      ...(catalogQuery.data?.shorts ?? []),
    ]),
    [catalogQuery.data],
  );
  const genres = useMemo(
    () => [...new Set(catalogItems.flatMap((item) => item.genres))],
    [catalogItems],
  );
  const visibleItems = useMemo(() => {
    const searched = searchPublishedCatalog(catalogItems, debouncedQuery);
    return selectedGenre === 'All'
      ? searched
      : searched.filter((item) =>
          item.genres.some((genre) => genre.toLocaleLowerCase() === selectedGenre.toLocaleLowerCase()),
        );
  }, [catalogItems, debouncedQuery, selectedGenre]);
  const retry = catalogQuery.retry;
  const hasError = catalogQuery.error || catalogQuery.data?.hasFailures;

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OfflineState onRetry={() => void retryConnection()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={catalogQuery.isRefreshing}
            onRefresh={retry}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <Text style={styles.header}>Discover</Text>

        <View style={styles.searchContainer}>
          <KeyboardAwareTextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search title, genre, or year"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
            accessibilityLabel="Search titles, genres, and years"
            returnKeyType="search"
          />
        </View>

        {genres.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {['All', ...genres].map((genre) => (
              <Pressable
                key={genre}
                onPress={() => setSelectedGenre(genre)}
                style={[styles.chip, selectedGenre === genre && styles.activeChip]}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedGenre === genre }}
              >
                <Text style={[styles.chipText, selectedGenre === genre && styles.activeChipText]}>
                  {genre}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {hasError ? (
          <ContentNotice
            message={catalogQuery.error ?? 'Some titles could not be loaded. Please retry.'}
            tone="error"
            actionLabel="Retry"
            onAction={retry}
            autoHideMs={5000}
          />
        ) : null}
        {catalogQuery.data?.showingDemo ? (
          <ContentNotice message="Demo catalog — search results are sample content." />
        ) : null}
        {catalogQuery.isLoading ? <ContentNotice message="Loading published titles…" /> : null}
        <SectionHeader title={debouncedQuery ? 'Results' : 'Published titles'} />

        {!catalogQuery.isLoading && !hasError && visibleItems.length === 0 ? (
          <ContentNotice message={catalogItems.length ? 'No results' : 'No titles yet'} />
        ) : null}

        <View style={styles.grid}>
          {visibleItems.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              compact
              onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
            />
          ))}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: 18, paddingBottom: 30 },
  header: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 18,
    letterSpacing: -0.9,
  },
  searchContainer: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  input: { color: theme.text, fontSize: 16, paddingVertical: 4 },
  chipRow: { paddingVertical: 18, paddingRight: 18 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    marginRight: 10,
  },
  activeChip: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontWeight: '700', fontSize: 12 },
  activeChipText: { color: theme.background },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
});
