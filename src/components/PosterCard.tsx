import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { MediaItem } from '../data/mockData';
import { theme } from '../theme';

type PosterCardProps = {
  item: MediaItem;
  onPress: () => void;
  compact?: boolean;
};

export function PosterCard({ item, onPress, compact = false }: PosterCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, compact && styles.compactCard]}
      accessibilityRole="button"
    >
      <Image source={{ uri: item.poster }} style={[styles.image, compact && styles.compactImage]} />
      <View style={styles.badgeRow}>
        {item.isPremium ? <Text style={styles.badge}>Premium</Text> : null}
        {item.isNew ? <Text style={[styles.badge, styles.newBadge]}>New</Text> : null}
      </View>
      <View style={styles.metaWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.meta}>
          {item.year} • {item.duration}
        </Text>
      </View>
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
});
