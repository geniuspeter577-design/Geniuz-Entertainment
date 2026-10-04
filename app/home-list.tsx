import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { PosterCard } from '../src/components/PosterCard';
import type { ContentItem } from '../src/models/content';
import {
  supabaseMovieRepository,
  type PublishedTitlesFilter,
} from '../src/repositories/SupabaseMovieRepository';
import { useLibrary } from '../src/state/LibraryContext';
import { theme } from '../src/theme';
import { backOrReplace } from '../src/utils/navigation';
import { getRankedHomeListItems } from '../src/utils/homeList';

const PAGE_SIZE = 24;

function getPublishedFilter(kind: string | undefined, value: string | undefined) {
  if (kind === 'trending' || kind === 'movies' || kind === 'series' || kind === 'shorts') {
    return { kind } satisfies PublishedTitlesFilter;
  }
  if ((kind === 'category' || kind === 'genre') && value?.trim()) {
    return { kind, value: value.trim() } satisfies PublishedTitlesFilter;
  }
  return undefined;
}

export default function HomeListScreen() {
  const params = useLocalSearchParams<{
    kind?: string | string[];
    value?: string | string[];
    title?: string | string[];
  }>();
  const kind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const value = Array.isArray(params.value) ? params.value[0] : params.value;
  const titleParam = Array.isArray(params.title) ? params.title[0] : params.title;
  const filter = useMemo(() => getPublishedFilter(kind, value), [kind, value]);
  const isContinueWatching = kind === 'continue-watching';
  const { continueWatching, isLoading: isLibraryLoading } = useLibrary();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const itemsRef = useRef<ContentItem[]>([]);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (reset = false) => {
    if (loadingRef.current || (!reset && !hasMoreRef.current)) {
      return;
    }
    if (!isContinueWatching && !filter) {
      setError('This title list is not available.');
      setIsLoading(false);
      return;
    }

    loadingRef.current = true;
    const offset = reset ? 0 : offsetRef.current;
    setError(undefined);
    setIsLoading(reset && itemsRef.current.length === 0);
    setIsRefreshing(reset && itemsRef.current.length > 0);
    setIsLoadingMore(!reset);

    try {
      let pageItems: ContentItem[];
      let pageHasMore: boolean;
      if (isContinueWatching) {
        const entries = [...continueWatching]
          .filter(({ item }) => item.availability.discoverable)
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
        const page = entries.slice(offset, offset + PAGE_SIZE);
        pageItems = page.map(({ item }) => item);
        pageHasMore = offset + page.length < entries.length;
      } else {
        if (!supabaseMovieRepository) {
          throw new Error('The published catalog is not available.');
        }
        const page = await supabaseMovieRepository.getPublishedTitlesPage(filter!, offset, PAGE_SIZE);
        pageItems = page.items;
        pageHasMore = page.hasMore;
      }

      const nextItems = reset ? pageItems : [...itemsRef.current, ...pageItems];
      itemsRef.current = nextItems;
      setItems(nextItems);
      offsetRef.current = offset + pageItems.length;
      hasMoreRef.current = pageHasMore;
    } catch (loadError) {
      hasMoreRef.current = false;
      setError(loadError instanceof Error ? loadError.message : 'Could not load titles. Please retry.');
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
      setIsLoadingMore(false);
      setIsRefreshing(false);
    }
  }, [continueWatching, filter, isContinueWatching]);

  useEffect(() => {
    if (isContinueWatching && isLibraryLoading) {
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        itemsRef.current = [];
        offsetRef.current = 0;
        hasMoreRef.current = true;
        setItems([]);
        setIsLoading(true);
        setError(undefined);
        void loadPage(true);
      }
    });
    return () => {
      active = false;
    };
  }, [isContinueWatching, isLibraryLoading, loadPage]);

  const screenTitle = titleParam?.trim() || 'Titles';
  const rankedItems = useMemo(
    () => getRankedHomeListItems(items, kind === 'trending'),
    [items, kind],
  );
  const retry = useCallback(() => {
    hasMoreRef.current = true;
    void loadPage(true);
  }, [loadPage]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => backOrReplace('/')}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={2}>{screenTitle}</Text>
      </View>
      <FlatList
        data={rankedItems}
        keyExtractor={({ item }) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadPage(true)}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        onEndReached={() => void loadPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={error && items.length ? (
          <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={retry} />
        ) : null}
        ListEmptyComponent={isLoading ? (
          <ContentNotice message={`Loading ${screenTitle.toLowerCase()}…`} />
        ) : error ? (
          <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={retry} />
        ) : (
          <ContentNotice message="Nothing here yet." />
        )}
        ListFooterComponent={isLoadingMore ? <ActivityIndicator color={theme.accent} style={styles.footer} /> : null}
        renderItem={({ item: entry }) => (
          <View style={styles.gridCell}>
            <PosterCard
              item={entry.item}
              grid
              fillContainer
              rank={entry.rank}
              onPress={() => router.push({ pathname: '/content/[id]', params: { id: entry.item.id } })}
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  header: { paddingHorizontal: 18, paddingBottom: 12 },
  backButton: { minHeight: 42, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 12 },
  backText: { color: theme.accent, fontSize: 15, fontWeight: '700' },
  title: { color: theme.text, fontSize: 25, fontWeight: '800' },
  listContent: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 28, gap: 12 },
  gridRow: { gap: 12 },
  gridCell: { flex: 1 },
  footer: { paddingVertical: 18 },
});