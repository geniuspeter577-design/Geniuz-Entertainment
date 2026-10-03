import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { useDownloads } from '../../src/state/DownloadsContext';
import { formatBytes } from '../../src/services/OfflineDownloadService';
import { theme } from '../../src/theme';

export default function DownloadsScreen() {
  const { records, isLoading, error, download, cancel, remove } = useDownloads();
  const storageUsed = records
    .filter((record) => record.status === 'downloaded')
    .reduce((total, record) => total + record.size, 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Downloads</Text>
        <View style={styles.storageCard}>
          <Text style={styles.storageLabel}>Storage used</Text>
          <Text style={styles.storageValue}>{formatBytes(storageUsed)}</Text>
        </View>

        {error ? <ContentNotice message={error} tone="error" /> : null}
        {isLoading ? <ContentNotice message="Loading your downloads…" /> : null}
        {!isLoading && records.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-download-outline" size={36} color={theme.accent} />
            <Text style={styles.emptyTitle}>No downloads yet</Text>
            <Text style={styles.emptyText}>
              Titles you download will be ready to watch here, even when you’re offline.
            </Text>
          </View>
        ) : null}

        {records.map((record) => {
          const isDownloaded = record.status === 'downloaded';
          const isDownloading = record.status === 'downloading';
          return (
            <View key={record.item.id} style={styles.downloadCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isDownloaded ? `Play ${record.item.title} offline` : `${record.item.title} download status`
                }
                disabled={!isDownloaded}
                onPress={() =>
                  router.push({ pathname: '/watch/[id]', params: { id: record.item.id } })
                }
                style={styles.titleRow}
              >
                <Image
                  source={
                    record.item.posterUrl
                      ? { uri: record.item.posterUrl }
                      : require('../../assets/icon.png')
                  }
                  style={styles.poster}
                  resizeMode="cover"
                />
                <View style={styles.titleInfo}>
                  <Text style={styles.movieTitle} numberOfLines={2}>
                    {record.item.title}
                  </Text>
                  <Text style={styles.movieMeta}>
                    {isDownloaded
                      ? formatBytes(record.size)
                      : isDownloading
                        ? `${formatBytes(record.size)} · Downloading ${record.progress}%`
                        : record.status === 'canceled'
                          ? 'Download canceled'
                          : 'Download failed'}
                  </Text>
                  {isDownloading ? (
                    <View
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: 100, now: record.progress }}
                      style={styles.progressTrack}
                    >
                      <View style={[styles.progressFill, { width: `${record.progress}%` }]} />
                    </View>
                  ) : null}
                  {isDownloaded ? <Text style={styles.offlineCaption}>Tap to play offline</Text> : null}
                </View>
              </Pressable>
              <View style={styles.actions}>
                {isDownloading ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel ${record.item.title} download`}
                    onPress={() =>
                      void cancel(record.item.id).catch((actionError: unknown) =>
                        Alert.alert(
                          'Download error',
                          actionError instanceof Error ? actionError.message : 'Could not cancel this download.',
                        ),
                      )
                    }
                    style={styles.actionButton}
                  >
                    <Ionicons name="close" size={19} color={theme.text} />
                  </Pressable>
                ) : !isDownloaded ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Retry ${record.item.title} download`}
                    onPress={() =>
                      void download(record.item).catch((actionError: unknown) =>
                        Alert.alert(
                          'Download error',
                          actionError instanceof Error ? actionError.message : 'The download failed. Please retry.',
                        ),
                      )
                    }
                    style={styles.actionButton}
                  >
                    <Ionicons name="refresh" size={19} color={theme.text} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${record.item.title} download`}
                  onPress={() =>
                    void remove(record.item.id).catch((actionError: unknown) =>
                      Alert.alert(
                        'Download error',
                        actionError instanceof Error ? actionError.message : 'Could not delete this download.',
                      ),
                    )
                  }
                  style={styles.actionButton}
                >
                  <Ionicons name="trash-outline" size={18} color={theme.text} />
                </Pressable>
              </View>
            </View>
          );
        })}
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
  storageCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 10,
  },
  storageLabel: {
    color: theme.secondaryText,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  storageValue: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 5,
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    marginTop: 10,
    padding: 24,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
  },
  emptyText: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  downloadCard: {
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    padding: 12,
  },
  titleRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  poster: {
    width: 66,
    height: 88,
    borderRadius: 10,
    backgroundColor: theme.surfaceSoft,
  },
  titleInfo: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  movieTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  movieMeta: {
    color: theme.secondaryText,
    fontSize: 12,
    marginTop: 6,
  },
  offlineCaption: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 7,
  },
  progressTrack: {
    backgroundColor: theme.surfaceSoft,
    borderRadius: 4,
    height: 5,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: theme.accent,
    height: '100%',
  },
  actions: {
    flexDirection: 'row',
    marginLeft: 8,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 40,
  },
});
