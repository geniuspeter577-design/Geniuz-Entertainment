import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { loadNotifications, getUnreadNotificationCount } from '../../src/services/NotificationsStore';
import { formatRuntime } from '../../src/utils/contentPresentation';
import {
  getCategoryItems,
  isDemoCatalogEnabled,
  loadPublishedCatalog,
  sortPublishedNewest,
} from '../../src/utils/publishedCatalog';

const demoRepository = new MockContentRepository();

export default function HomeScreen() {
  const { isOnline, retryConnection } = useNetwork();
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
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
          movies: demos.filter((item) => item.type === 'movie'),
          series: demos.filter((item) => item.type === 'series'),
          shorts: [],
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
  const shorts = catalogQuery.data?.shorts ?? [];
  const publishedItems = sortPublishedNewest([...movies, ...series, ...shorts]);
  const heroItems = publishedItems.slice(0, 5);
  const categoryTabs = useMemo(
    () => [
      { key: 'Trending', label: 'Trending' },
      { key: 'Anime', label: 'Anime' },
      { key: 'Kids', label: 'Kids' },
      { key: 'Shorts', label: 'Shorts' },
      { key: 'TV', label: 'TV' },
      { key: 'Nollywood', label: 'Nollywood' },
      { key: 'Football', label: 'Football' },
    ],
    [],
  );
  const [selectedCategory, setSelectedCategory] = useState('Trending');
  const tabsScrollRef = useRef<ScrollView | null>(null);
  const activeCategoryItems = selectedCategory === 'Trending'
    ? publishedItems
    : selectedCategory === 'TV'
      ? series
      : selectedCategory === 'Shorts'
        ? shorts
        : getCategoryItems(publishedItems, selectedCategory);
  const activeHeroItems = selectedCategory === 'Trending'
    ? heroItems
    : selectedCategory === 'Shorts'
      ? []
      : sortPublishedNewest(activeCategoryItems).slice(0, 5);

  useEffect(() => {
    const selectedIndex = categoryTabs.findIndex(({ key }) => key === selectedCategory);
    if (selectedIndex < 0) {
      return;
    }
    tabsScrollRef.current?.scrollTo({
      x: Math.max(0, selectedIndex * 118 - 24),
      y: 0,
      animated: true,
    });
  }, [categoryTabs, selectedCategory]);
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

  useEffect(() => {
    let active = true;
    void loadNotifications().then((items) => {
      if (active) {
        setUnreadCount(getUnreadNotificationCount(items));
      }
    }).catch((error: unknown) => {
      console.error('[Home] Could not load notifications.', error);
    });
    return () => {
      active = false;
    };
  }, []);

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
          <View style={styles.brandGroup}>
            <Image
              source={require('../../assets/branding/logo-mark.png')}
              style={styles.brandMark}
              resizeMode="contain"
            />
            <Text style={styles.brand}>Geniuz+</Text>
          </View>
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
          <View style={styles.brandGroup}>
            <Image
              source={require('../../assets/branding/logo-mark.png')}
              style={styles.brandMark}
              resizeMode="contain"
            />
            <Text style={styles.brand}>Geniuz+</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
            style={styles.iconButton}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications-outline" size={22} color={theme.text} />
            {unreadCount > 0 ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View> : null}
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

        {categoryTabs.length > 1 ? (
          <ScrollView
            ref={tabsScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryTabs}
            snapToInterval={120}
          >
            {categoryTabs.map(({ key, label }) => {
              const isSelected = selectedCategory === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${label} category`}
                  onPress={() => {
                    setSelectedCategory(key);
                    if (key === 'Shorts') {
                      router.push('/shorts');
                    }
                  }}
                  style={[styles.categoryTab, isSelected && styles.selectedCategoryTab]}
                >
                  <Text style={[styles.categoryTabText, isSelected && styles.selectedCategoryTabText]}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {activeHeroItems.length ? (
          <HomeHeroCarousel
            items={activeHeroItems}
            isLoading={catalogQuery.isLoading}
            isInWatchlist={isInWatchlist}
            onToggleWatchlist={(item) => void toggleWatchlist(item)}
          />
        ) : null}
        {catalogQuery.isLoading ? <ContentNotice message="Loading published titles…" /> : null}
        {noTitles ? <Text style={styles.emptyText}>No titles yet</Text> : null}
        {!catalogQuery.isLoading && !catalogQuery.data?.hasFailures && selectedCategory !== 'Trending' && activeCategoryItems.length === 0 ? (
          <Text style={styles.emptyText}>No titles in this category yet</Text>
        ) : null}

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
          (() => {
            if (selectedCategory === 'Trending') {
              return (
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
              );
            }

            return activeCategoryItems.length ? (
              <ContentRail
                title={selectedCategory}
                items={activeCategoryItems}
                isLoading={catalogQuery.isLoading}
                retry={retryCatalog}
                emptyMessage={`No ${selectedCategory} titles yet`}
              />
            ) : null;
          })()
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
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    flexShrink: 1,
  },
  brandMark: {
    width: 24,
    height: 24,
    marginRight: 8,
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
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    color: theme.background,
    fontSize: 10,
    fontWeight: '800',
  },
  emptyText: { color: theme.secondaryText, fontSize: 14, paddingVertical: 18 },
  categoryTabs: { paddingTop: 4, paddingBottom: 12, paddingHorizontal: 2, gap: 8 },
  categoryTab: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    marginRight: 8,
  },
  selectedCategoryTab: {
    borderBottomColor: theme.accent,
  },
  categoryTabText: {
    color: theme.secondaryText,
    fontSize: 13,
    fontWeight: '700',
  },
  selectedCategoryTabText: {
    color: theme.text,
    fontWeight: '800',
  },
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
