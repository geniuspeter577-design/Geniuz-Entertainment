import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
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
import type { ContentItem } from '../../src/models/content';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { MockContentRepository } from '../../src/repositories/MockContentRepository';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { loadNotifications, getUnreadNotificationCount } from '../../src/services/NotificationsStore';
import { formatRuntime } from '../../src/utils/contentPresentation';
import { resetHomeToTrending } from '../../src/utils/homeNavigation';
import {
  getHomeCategoryItems,
  isDemoCatalogEnabled,
  loadPublishedCatalog,
  sortPublishedNewest,
} from '../../src/utils/publishedCatalog';
import { createHomeShuffleSeed, shuffleHomeCategoryRows } from '../../src/utils/homeRowShuffle';

const demoRepository = new MockContentRepository();
const EMPTY_CONTENT_ITEMS: ContentItem[] = [];
type HomeTabsNavigation = {
  addListener: (eventName: 'tabPress', listener: () => void) => () => void;
};

export default function HomeScreen() {
  const { isOnline, retryConnection } = useNetwork();
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [shuffleSeed, setShuffleSeed] = useState(createHomeShuffleSeed);
  const [tabIndicatorLeft] = useState(() => new Animated.Value(0));
  const [tabIndicatorWidth] = useState(() => new Animated.Value(0));
  const tabLayoutsRef = useRef(new Map<string, { x: number; width: number }>());
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
  const movies = catalogQuery.data?.movies ?? EMPTY_CONTENT_ITEMS;
  const series = catalogQuery.data?.series ?? EMPTY_CONTENT_ITEMS;
  const shorts = catalogQuery.data?.shorts ?? EMPTY_CONTENT_ITEMS;
  const publishedItems = useMemo(
    () => sortPublishedNewest([...movies, ...series, ...shorts]),
    [movies, series, shorts],
  );
  const heroItems = useMemo(() => publishedItems.slice(0, 5), [publishedItems]);
  const categoryTabs = useMemo(
    () => [
      { key: 'Trending', label: 'Trending' },
      { key: 'Anime', label: 'Anime' },
      { key: 'Animation', label: 'Animation' },
      { key: 'Kids', label: 'Kids' },
      { key: 'Reels', label: 'Reels' },
      { key: 'TV', label: 'TV' },
      { key: 'Nollywood', label: 'Nollywood' },
      { key: 'Football', label: 'Football' },
    ],
    [],
  );
  const [selectedCategory, setSelectedCategory] = useState('Trending');
  const tabsScrollRef = useRef<ScrollView | null>(null);
  const homeScrollRef = useRef<ScrollView | null>(null);
  const navigation = useNavigation<HomeTabsNavigation>('/(tabs)');
  const resetHomeView = useCallback(
    () => resetHomeToTrending(
      selectedCategory,
      setSelectedCategory,
      () => homeScrollRef.current?.scrollTo({ y: 0, animated: false }),
    ),
    [selectedCategory],
  );
  useEffect(
    () => navigation.addListener('tabPress', resetHomeView),
    [navigation, resetHomeView],
  );
  const activeCategoryItems = useMemo(
    () =>
      selectedCategory === 'Trending'
        ? publishedItems
        : selectedCategory === 'TV'
          ? getHomeCategoryItems(publishedItems, selectedCategory)
          : selectedCategory === 'Reels'
            ? shorts.filter((item) => item.availability.discoverable)
            : getHomeCategoryItems(publishedItems, selectedCategory),
    [publishedItems, selectedCategory, shorts],
  );
  const activeHeroItems = useMemo(
    () =>
      selectedCategory === 'Trending'
        ? heroItems
        : selectedCategory === 'Reels'
          ? []
          : sortPublishedNewest(activeCategoryItems).slice(0, 5),
    [activeCategoryItems, heroItems, selectedCategory],
  );

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
  useEffect(() => {
    const layout = tabLayoutsRef.current.get(selectedCategory);
    if (!layout) {
      return;
    }
    Animated.parallel([
      Animated.spring(tabIndicatorLeft, {
        toValue: layout.x,
        damping: 24,
        stiffness: 260,
        mass: 0.8,
        useNativeDriver: false,
      }),
      Animated.spring(tabIndicatorWidth, {
        toValue: layout.width,
        damping: 24,
        stiffness: 260,
        mass: 0.8,
        useNativeDriver: false,
      }),
    ]).start();
  }, [selectedCategory, tabIndicatorLeft, tabIndicatorWidth]);
  const listedIds = new Set(publishedItems.map((item) => item.id));
  const recent = continueWatching.filter(
    ({ item }) => listedIds.has(item.id) || (catalogQuery.data?.showingDemo && item.source === 'mock'),
  );
  const categoryRows = useMemo(() => {
    const rows = selectedCategory === 'Trending'
      ? [
          {
            key: 'latest',
            title: 'Latest',
            listKind: 'trending',
            listValue: undefined,
            items: publishedItems,
            emptyMessage: 'Nothing here yet',
            isLoading: catalogQuery.isLoading,
          },
          ...(movies.length
            ? [{
                key: 'movies',
                title: 'Movies',
                listKind: 'movies',
                listValue: undefined,
                items: sortPublishedNewest(movies),
                emptyMessage: 'Nothing here yet',
                isLoading: false,
              }]
            : []),
          ...(series.length
            ? [{
                key: 'series',
                title: 'Series',
                listKind: 'series',
                listValue: undefined,
                items: sortPublishedNewest(series),
                emptyMessage: 'Nothing here yet',
                isLoading: false,
              }]
            : []),
          ...[...new Set(publishedItems.flatMap((item) => item.genres))]
            .map((genre) => ({
              key: `genre:${genre}`,
              title: genre,
              listKind: 'genre',
              listValue: genre,
              items: publishedItems.filter((item) =>
                item.genres.some((itemGenre) => itemGenre.toLocaleLowerCase() === genre.toLocaleLowerCase()),
              ),
              emptyMessage: 'Nothing here yet',
              isLoading: false,
            }))
            .filter(({ items }) => items.length > 0),
        ]
      : activeCategoryItems.length
        ? [{
            key: `category:${selectedCategory}`,
            title: selectedCategory,
            listKind: selectedCategory === 'TV'
              ? 'series'
              : selectedCategory === 'Reels'
                ? 'shorts'
                : 'category',
            listValue: selectedCategory,
            items: activeCategoryItems,
            emptyMessage: 'Nothing here yet',
            isLoading: catalogQuery.isLoading,
          }]
        : [];
    return shuffleHomeCategoryRows(rows, shuffleSeed);
  }, [
    activeCategoryItems,
    catalogQuery.isLoading,
    movies,
    publishedItems,
    selectedCategory,
    series,
    shuffleSeed,
  ]);
  const retryCatalog = catalogQuery.retry;
  const refreshCatalog = useCallback(() => {
    setShuffleSeed(createHomeShuffleSeed(shuffleSeed));
    retryCatalog();
  }, [retryCatalog, shuffleSeed]);

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
          ref={homeScrollRef}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isCheckingConnection}
              onRefresh={() => {
                setIsCheckingConnection(true);
                refreshCatalog();
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
          <OfflineState onRetry={() => {
            refreshCatalog();
            void retryConnection();
          }} />
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
            onRefresh={refreshCatalog}
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
            onAction={refreshCatalog}
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
            <View style={styles.categoryTabsTrack}>
              <Animated.View
                pointerEvents="none"
                style={[styles.categoryTabIndicator, { left: tabIndicatorLeft, width: tabIndicatorWidth }]}
              />
              {categoryTabs.map(({ key, label }) => {
                const isSelected = selectedCategory === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${label} category`}
                    onLayout={(event) => {
                      const { x, width } = event.nativeEvent.layout;
                      tabLayoutsRef.current.set(key, { x, width });
                      if (isSelected) {
                        tabIndicatorLeft.setValue(x);
                        tabIndicatorWidth.setValue(width);
                      }
                    }}
                    onPress={() => {
                      setSelectedCategory(key);
                      if (key === 'Reels') {
                        // TODO: Member reel upload, gated on membership (Phase 2 + Phase 6).
                        router.push('/shorts');
                      }
                    }}
                    style={[styles.categoryTab, isSelected && styles.selectedCategoryTab]}
                  >
                    <Text style={[styles.categoryTabText, isSelected && styles.selectedCategoryTabText]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
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
        {noTitles ? <Text style={styles.emptyText}>Nothing here yet</Text> : null}
        {!catalogQuery.isLoading && !catalogQuery.data?.hasFailures && selectedCategory !== 'Trending' && activeCategoryItems.length === 0 ? (
          <Text style={styles.emptyText}>Nothing here yet</Text>
        ) : null}

        {recent.length ? (
          <>
            <SectionHeader
              title="Continue watching"
              onSeeAll={() => router.push({
                pathname: '/home-list',
                params: { kind: 'continue-watching', title: 'Continue watching' },
              })}
            />
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
          categoryRows.map(({ key, title, items, isLoading, emptyMessage, listKind, listValue }) => (
            <ContentRail
              key={key}
              title={title}
              items={items}
              isLoading={isLoading}
              retry={refreshCatalog}
              emptyMessage={emptyMessage}
              onSeeAll={() => router.push({
                pathname: '/home-list',
                params: {
                  kind: listKind,
                  ...(listValue ? { value: listValue } : {}),
                  title,
                },
              })}
            />
          ))
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
  categoryTabs: { paddingTop: 4, paddingBottom: 12, paddingHorizontal: 2 },
  categoryTabsTrack: { flexDirection: 'row', position: 'relative', paddingBottom: 3 },
  categoryTabIndicator: { position: 'absolute', bottom: 0, height: 3, borderRadius: 2, backgroundColor: theme.accent },
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
    borderBottomColor: 'transparent',
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
