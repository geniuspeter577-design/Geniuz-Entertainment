import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
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
import { formatBytes, type OfflineDownloadRecord } from '../../src/services/OfflineDownloadService';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { getMeScreenData } from '../../src/utils/meScreen';

type DownloadTab = 'geniuz' | 'local' | 'received';

const tabs: { id: DownloadTab; title: string }[] = [
  { id: 'geniuz', title: 'Geniuz+ downloads' },
  { id: 'local', title: 'Local files' },
  { id: 'received', title: 'Received' },
];

function getWatchedLabel(record: OfflineDownloadRecord, watchHistory: ReturnType<typeof getMeScreenData>['watchHistory']) {
  const entry = watchHistory.find((candidate) => candidate.item.id === record.item.id);
  if (!entry) {
    return 'Not watched';
  }
  return `${entry.progress}% watched`;
}

function showDownloadDetails(record: OfflineDownloadRecord) {
  Alert.alert(
    record.item.title,
    [
      record.item.type === 'series' || record.item.parentSeriesId ? 'Series' : 'Movie',
      `File size: ${formatBytes(record.size)}`,
      `Exact bytes: ${record.size.toLocaleString()}`,
      `Status: ${record.status}`,
      `Downloaded: ${new Date(record.date).toLocaleString()}`,
    ].join('\n'),
  );
}

export default function DownloadsScreen() {
  const { isOnline } = useNetwork();
  const library = useLibrary();
  const {
    records,
    availableSpaceBytes,
    isLoading,
    isRefreshing,
    error,
    download,
    cancel,
    pause,
    resume,
    remove,
    refresh,
  } = useDownloads();
  const [selectedTab, setSelectedTab] = useState<DownloadTab>('geniuz');
  const watchHistory = useMemo(
    () => getMeScreenData({ watchlist: [], continueWatching: library.continueWatching }, []).watchHistory,
    [library.continueWatching],
  );
  const storageUsed = records
    .filter((record) => record.status === 'downloaded')
    .reduce((total, record) => total + record.size, 0);

  const runAction = (action: () => Promise<void>, title: string, fallback: string) => {
    void action().catch((actionError: unknown) =>
      Alert.alert(
        title,
        actionError instanceof Error ? actionError.message : fallback,
      ),
    );
  };

  const confirmDelete = (record: OfflineDownloadRecord) => {
    Alert.alert(
      'Delete download?',
      `Remove ${record.item.title} from this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => runAction(() => remove(record.item.id), 'Download error', 'Could not delete this download.'),
        },
      ],
    );
  };

  const showMenu = (record: OfflineDownloadRecord) => {
    const buttons = [
      { text: 'Details', onPress: () => showDownloadDetails(record) },
      ...(record.status === 'downloading'
        ? [{ text: 'Pause', onPress: () => runAction(() => pause(record.item.id), 'Download error', 'Could not pause this download.') }]
        : []),
      ...(record.status === 'paused'
        ? [{
            text: 'Resume',
            onPress: () => runAction(() => resume(record.item.id), 'Download error', 'Could not resume this download.'),
          }]
        : []),
      ...(record.status !== 'downloaded' && record.status !== 'queued' && record.status !== 'downloading' && record.status !== 'paused' && isOnline
        ? [{
            text: 'Retry',
            onPress: () => runAction(() => download(record.item), 'Download error', 'The download failed. Please retry.'),
          }]
        : []),
      { text: 'Delete', style: 'destructive' as const, onPress: () => confirmDelete(record) },
    ];
    Alert.alert('Download options', record.item.title, buttons);
  };

  const visibleRecords = selectedTab === 'geniuz' ? records : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void refresh()}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <Text style={styles.header}>Downloads</Text>
        <View style={styles.storageCard}>
          <View style={styles.storageStat}>
            <Text style={styles.storageLabel}>Storage used</Text>
            <Text style={styles.storageValue}>{formatBytes(storageUsed)}</Text>
          </View>
          <View style={styles.storageDivider} />
          <View style={styles.storageStat}>
            <Text style={styles.storageLabel}>Available</Text>
            <Text style={styles.storageValue}>
              {availableSpaceBytes === null ? 'Unavailable' : formatBytes(availableSpaceBytes)}
            </Text>
          </View>
          <Text style={styles.storageUnit}>Binary units: KiB, MiB, GiB (base 1024)</Text>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedTab === tab.id }}
              onPress={() => setSelectedTab(tab.id)}
              style={[styles.tab, selectedTab === tab.id && styles.selectedTab]}
            >
              <Text style={[styles.tabText, selectedTab === tab.id && styles.selectedTabText]}>
                {tab.title}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? <ContentNotice message={error} tone="error" /> : null}
        {isLoading ? <ContentNotice message="Loading your downloads…" /> : null}

        {selectedTab !== 'geniuz' ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={34} color={theme.secondaryText} />
            <Text style={styles.emptyTitle}>Coming soon</Text>
            <Text style={styles.emptyText}>
              {selectedTab === 'local'
                ? 'Browsing local video files is not available yet.'
                : 'Received files will appear here when device transfer is available.'}
            </Text>
          </View>
        ) : null}

        {!isLoading && selectedTab === 'geniuz' && visibleRecords.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-download-outline" size={36} color={theme.accent} />
            <Text style={styles.emptyTitle}>No downloads yet</Text>
            <Text style={styles.emptyText}>
              Titles you download will be ready to watch here, even when you’re offline.
            </Text>
          </View>
        ) : null}

        {visibleRecords.map((record) => {
          const isDownloaded = record.status === 'downloaded';
          const isActive = record.status === 'downloading' || record.status === 'paused';
          const typeLabel =
            record.item.type === 'series' || record.item.parentSeriesId ? 'Series' : 'Movie';
          const statusLabel = isDownloaded
            ? formatBytes(record.size)
            : record.status === 'downloading'
              ? `${formatBytes(record.size)} · Downloading ${record.progress}%`
              : record.status === 'paused'
                ? `${formatBytes(record.size)} · Paused at ${record.progress}%`
                : record.status === 'queued'
                  ? `${formatBytes(record.size)} · Queued`
                  : record.status === 'canceled'
                    ? 'Download canceled'
                    : 'Download failed';
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
                  <View style={styles.titleHeading}>
                    <Text style={styles.movieTitle} numberOfLines={2}>
                      {record.item.title}
                    </Text>
                    <Text style={styles.typeBadge}>{typeLabel}</Text>
                  </View>
                  <Text style={styles.movieMeta}>{statusLabel}</Text>
                  {isDownloaded ? (
                    <Text style={styles.watchedLabel}>{getWatchedLabel(record, watchHistory)}</Text>
                  ) : null}
                  {record.status === 'downloading' || record.status === 'paused' ? (
                    <View
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: 100, now: record.progress }}
                      style={styles.progressTrack}
                    >
                      <View style={[styles.progressFill, { width: `${record.progress}%` }]} />
                    </View>
                  ) : null}
                  {isDownloaded ? <Text style={styles.offlineCaption}>Tap to play offline</Text> : null}
                  {!isOnline && !isDownloaded ? (
                    <Text style={styles.offlineCaption}>Offline · reconnect to retry</Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`More options for ${record.item.title}`}
                onPress={() => showMenu(record)}
                style={styles.actionButton}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={theme.text} />
              </Pressable>
              {record.status === 'queued' || isActive ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel ${record.item.title} download`}
                  onPress={() => runAction(() => cancel(record.item.id), 'Download error', 'Could not cancel this download.')}
                  style={styles.actionButton}
                >
                  <Ionicons name="close" size={19} color={theme.text} />
                </Pressable>
              ) : null}
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    marginBottom: 14,
  },
  storageStat: {
    flex: 1,
  },
  storageDivider: {
    width: 1,
    backgroundColor: theme.border,
    marginHorizontal: 14,
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
  storageUnit: {
    color: theme.secondaryText,
    fontSize: 10,
    marginTop: 13,
    width: '100%',
  },
  tabs: {
    backgroundColor: theme.surface,
    borderRadius: 13,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 4,
  },
  selectedTab: {
    backgroundColor: theme.surfaceSoft,
  },
  tabText: {
    color: theme.secondaryText,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  selectedTabText: {
    color: theme.accent,
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
  titleHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6,
  },
  movieTitle: {
    color: theme.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  typeBadge: {
    color: theme.secondaryText,
    fontSize: 9,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: theme.surfaceSoft,
    borderRadius: 7,
  },
  movieMeta: {
    color: theme.secondaryText,
    fontSize: 12,
    marginTop: 6,
  },
  watchedLabel: {
    color: theme.text,
    fontSize: 11,
    marginTop: 5,
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
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 40,
  },
});
