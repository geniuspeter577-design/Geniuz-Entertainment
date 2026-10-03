import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ContentItem } from '../models/content';
import { TitleImage } from './TitleImage';
import { useDownloads } from '../state/DownloadsContext';
import { theme } from '../theme';
import { formatRuntime } from '../utils/contentPresentation';

type PosterCardProps = {
  item: ContentItem;
  onPress: () => void;
  compact?: boolean;
  grid?: boolean;
  progress?: number;
};

export function PosterCard({ item, onPress, compact = false, grid = false, progress }: PosterCardProps) {
  const { records, download, cancel } = useDownloads();
  const downloadRecord = records.find((record) => record.item.id === item.id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isQueued = downloadRecord?.status === 'queued';
  const isDownloaded = downloadRecord?.status === 'downloaded';
  const hasFailed = downloadRecord?.status === 'failed' || downloadRecord?.status === 'canceled';

  return (
    <View style={[styles.card, compact && styles.compactCard, grid && styles.gridCard]}>
      <Pressable
        onPress={onPress}
        style={styles.cardPressable}
        accessibilityRole="button"
        accessibilityLabel={`View ${item.title}`}
      >
        <TitleImage
          uri={item.posterUrl}
          style={[styles.image, compact && styles.compactImage]}
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
      {item.availability.download ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isDownloading
              ? `Cancel download of ${item.title}`
              : isQueued
                ? `Cancel queued download of ${item.title}`
              : isDownloaded
                ? `${item.title} downloaded`
                : hasFailed
                  ? `Retry download of ${item.title}`
                : `Download ${item.title}`
          }
          accessibilityState={{ disabled: Boolean(isDownloaded) }}
          disabled={Boolean(isDownloaded)}
          onPress={() => {
            if (isDownloading || isQueued) {
              void cancel(item.id).catch((error: unknown) =>
                Alert.alert('Download error', error instanceof Error ? error.message : 'Could not cancel this download.'),
              );
            } else {
              void download(item).catch((error: unknown) =>
                Alert.alert('Download error', error instanceof Error ? error.message : 'The download failed. Please retry.'),
              );
            }
          }}
          style={[styles.downloadButton, grid && styles.gridDownloadButton]}
        >
          {isDownloading ? (
            <Text style={styles.downloadProgress}>{downloadRecord.progress}%</Text>
          ) : isQueued ? (
            <Text style={styles.downloadProgress}>Queued</Text>
          ) : (
            <Ionicons
              name={isDownloaded ? 'checkmark' : hasFailed ? 'refresh' : 'download-outline'}
              size={19}
              color={theme.text}
            />
          )}
        </Pressable>
      ) : null}
    </View>
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
  gridCard: {
    width: '31%',
    marginRight: 0,
  },
  cardPressable: {
    flex: 1,
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
  downloadButton: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 17, 22, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  gridDownloadButton: {
    right: 6,
    top: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  downloadProgress: {
    color: theme.text,
    fontSize: 10,
    fontWeight: '800',
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
