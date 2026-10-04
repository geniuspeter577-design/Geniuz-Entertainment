import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';

import type { ContentItem } from '../models/content';
import { supabaseMovieRepository } from '../repositories/SupabaseMovieRepository';
import { theme } from '../theme';

type ShortsFeedProps = {
  items: ContentItem[];
  height: number;
  onBack: () => void;
};

function ShortVideo({ item, height, isActive }: {
  item: ContentItem;
  height: number;
  isActive: boolean;
}) {
  const player = useVideoPlayer(null);
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    if (!isActive) {
      player.pause();
      return () => {
        active = false;
      };
    }
    void Promise.resolve().then(() => {
      if (!supabaseMovieRepository) {
        throw new Error('Short videos are not configured.');
      }
      return supabaseMovieRepository.getPlaybackUrl(item);
    }).then((url) => {
      if (active) {
        setError(undefined);
        setPlaybackUrl(url);
      }
    }).catch(() => {
      if (active) {
        setError('This short could not be loaded. Retry to try again.');
      }
    });
    return () => {
      active = false;
      player.pause();
    };
  }, [isActive, item, player, retry]);

  useEffect(() => {
    if (!isActive || !playbackUrl) {
      player.pause();
      return;
    }
    let active = true;
    void player.replaceAsync(playbackUrl).then(() => {
      if (active) {
        player.play();
      }
    }).catch(() => {
      if (active) {
        setError('This short could not be played. Retry to try again.');
      }
    });
    return () => {
      active = false;
      player.pause();
    };
  }, [isActive, playbackUrl, player]);

  return (
    <View style={[styles.videoPage, { height }]}>
      {playbackUrl ? (
        <VideoView
          accessibilityLabel={`Short video: ${item.title}`}
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          surfaceType="textureView"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      ) : null}
      {!playbackUrl && !error ? <ActivityIndicator color={theme.accent} /> : null}
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            setPlaybackUrl(undefined);
            setRetry((value) => value + 1);
          }} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <View pointerEvents="none" style={styles.caption}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={3}>{item.description}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function ShortsFeed({ items, height, onBack }: ShortsFeedProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = viewableItems.find((token) => token.isViewable);
    if (typeof visible?.index === 'number') {
      setActiveIndex(visible.index);
    }
  }, []);
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 80 }), []);
  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<ContentItem>) => (
    <ShortVideo item={item} height={height} isActive={index === activeIndex} />
  ), [activeIndex, height]);

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        pagingEnabled
        snapToInterval={height}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_data, index) => ({ length: height, offset: height * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back from shorts"
        onPress={onBack}
        style={styles.backButton}
      >
        <Ionicons name="arrow-back" size={22} color={theme.text} />
      </Pressable>
      <Text style={styles.counter}>{items.length ? `${activeIndex + 1} / ${items.length}` : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  videoPage: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
  backButton: {
    position: 'absolute',
    top: 12,
    left: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1D23CC',
  },
  counter: { position: 'absolute', top: 25, right: 18, color: theme.text, fontSize: 13, fontWeight: '700' },
  caption: { position: 'absolute', bottom: 26, left: 18, right: 18, gap: 6 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  description: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  errorCard: { alignItems: 'center', gap: 14, padding: 24, maxWidth: 320 },
  errorText: { color: theme.text, fontSize: 15, textAlign: 'center' },
  retryButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 8, backgroundColor: theme.accent },
  retryText: { color: theme.background, fontWeight: '800' },
});
