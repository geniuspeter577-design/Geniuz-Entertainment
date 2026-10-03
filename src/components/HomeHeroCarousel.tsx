import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { ContentItem } from '../models/content';
import { theme } from '../theme';
import { formatGenres, formatRating } from '../utils/contentPresentation';
import { TitleImage } from './TitleImage';

export function HomeHeroCarousel({
  items,
  isLoading,
  isInWatchlist,
  onToggleWatchlist,
  offline = false,
}: {
  items: ContentItem[];
  isLoading: boolean;
  isInWatchlist: (id: string) => boolean;
  onToggleWatchlist: (item: ContentItem) => void;
  offline?: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const width = screenWidth;
  const height = width * 9 / 16;
  const listRef = useRef<FlatList<ContentItem>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTouching, setIsTouching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (items.length < 2 || isTouching || offline) {
        return;
      }
      const interval = setInterval(() => {
        const nextIndex = (activeIndex + 1) % items.length;
        listRef.current?.scrollToOffset({ offset: nextIndex * width, animated: true });
        setActiveIndex(nextIndex);
      }, 5000);
      return () => clearInterval(interval);
    }, [activeIndex, isTouching, items.length, offline, width]),
  );

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActiveIndex(Math.max(0, Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))));
  };

  if (isLoading) {
    return (
      <View style={[styles.outer, { height }]}>
        <View style={[styles.skeleton, { height }]}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.skeletonText}>Loading new titles…</Text>
        </View>
      </View>
    );
  }
  if (!items.length) {
    return null;
  }

  const renderSlide = ({ item, index }: { item: ContentItem; index: number }) => (
    <View
      style={[styles.slide, { width, height }]}
      accessibilityLabel={`Slide ${index + 1} of ${items.length}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View details for ${item.title}`}
        onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
        style={StyleSheet.absoluteFill}
      >
        <TitleImage uri={item.coverUrl ?? item.posterUrl} style={styles.image} iconSize={48} />
      </Pressable>
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(14,16,20,0)',
          'rgba(14,16,20,0.02)',
          'rgba(14,16,20,0.12)',
          'rgba(14,16,20,0.4)',
          'rgba(14,16,20,0.85)',
        ]}
        locations={[0, 0.18, 0.42, 0.72, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.bottomGradient}
      />
      <View style={styles.meta}>
        <Text
          accessibilityLabel={`Slide ${index + 1} of ${items.length}`}
          style={styles.newBadge}
        >
          New
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View details for ${item.title}`}
          onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
        >
          <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {formatGenres(item)} · {formatRating(item)}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View details for ${item.title}`}
            onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
            style={styles.detailsButton}
          >
            <Text style={styles.detailsText}>View details</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isInWatchlist(item.id) ? 'Remove from My List' : 'Add to My List'}
            onPress={() => onToggleWatchlist(item)}
            style={styles.addButton}
          >
            <Ionicons
              name={isInWatchlist(item.id) ? 'checkmark' : 'add'}
              size={21}
              color={theme.text}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.outer} onTouchStart={() => setIsTouching(true)} onTouchEnd={() => setIsTouching(false)}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        keyExtractor={(item) => item.id}
        renderItem={renderSlide}
        getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollBeginDrag={() => setIsTouching(true)}
        onScrollEndDrag={() => setIsTouching(false)}
      />
      {items.length > 1 ? (
        <View style={styles.dots} accessibilityLabel={`Slide ${activeIndex + 1} of ${items.length}`}>
          {items.map((item, index) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Go to slide ${index + 1} of ${items.length}`}
              accessibilityState={{ selected: index === activeIndex }}
              onPress={() => {
                listRef.current?.scrollToOffset({ offset: index * width, animated: true });
                setActiveIndex(index);
              }}
              style={[styles.dot, index === activeIndex && styles.activeDot]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { marginHorizontal: -18, marginBottom: 10 },
  slide: { aspectRatio: 16 / 9, overflow: 'hidden', backgroundColor: theme.surface },
  skeleton: {
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  skeletonText: { color: theme.secondaryText, fontSize: 13, fontWeight: '600' },
  image: { width: '100%', height: '100%' },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '38%',
  },
  meta: { position: 'absolute', left: 20, right: 20, bottom: 20 },
  newBadge: {
    alignSelf: 'flex-start',
    color: theme.background,
    backgroundColor: theme.accent,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    fontWeight: '800',
    fontSize: 11,
    marginBottom: 6,
    overflow: 'hidden',
  },
  title: { color: theme.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: theme.muted, fontSize: 13, fontWeight: '600', marginTop: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 9 },
  detailsButton: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  detailsText: { color: theme.background, fontSize: 13, fontWeight: '800' },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(26,29,35,0.9)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.secondaryText },
  activeDot: { width: 19, backgroundColor: theme.accent },
});
