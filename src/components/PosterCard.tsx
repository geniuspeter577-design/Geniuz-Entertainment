import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ContentItem } from '../models/content';
import { theme } from '../theme';
import { formatRuntime } from '../utils/contentPresentation';

type PosterCardProps = {
  item: ContentItem;
  onPress: () => void;
  compact?: boolean;
  progress?: number;
};

export function PosterCard({ item, onPress, compact = false, progress }: PosterCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, compact && styles.compactCard]}
      accessibilityRole="button"
      accessibilityLabel={`View ${item.title}`}
    >
      <Image
        source={
          item.posterUrl
            ? { uri: item.posterUrl }
            : require('../../assets/icon.png')
        }
        style={[styles.image, compact && styles.compactImage]}
        resizeMode="cover"
      />
      <View style={styles.badgeRow}>
        {item.availability.premium ? <Text style={styles.badge}>Premium</Text> : null}
        {item.isNewRelease ? <Text style={[styles.badge, styles.newBadge]}>New</Text> : null}
      </View>
      <View style={styles.metaWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.meta}>
          {item.year ?? '—'} • {formatRuntime(item)}
        </Text>
      </View>
      {typeof progress === 'number' ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(progress, 100))}%` }]} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 176,
    marginRight: 14,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  compactCard: {
    width: 152,
  },
  image: {
    width: '100%',
    height: 240,
  },
  compactImage: {
    height: 210,
  },
  badgeRow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: 'rgba(15, 17, 22, 0.78)',
    color: theme.accentSoft,
    borderRadius: 999,
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontWeight: '700',
    overflow: 'hidden',
  },
  newBadge: {
    backgroundColor: theme.accent,
    color: theme.background,
  },
  title: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  meta: {
    color: theme.secondaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  metaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 28,
    paddingBottom: 12,
    backgroundColor: 'rgba(8,10,12,0.6)',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.accent,
  },
});
