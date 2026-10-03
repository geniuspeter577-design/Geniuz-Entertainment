import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isFeatureEnabled } from '../../config/features';
import type { ContentItem } from '../../models/content';
import type { OfflineDownloadRecord } from '../../services/OfflineDownloadService';
import { formatBytes } from '../../services/OfflineDownloadService';
import { theme } from '../../theme';
import { getFileExtension, isVideoFormatLikelySupported } from '../../utils/videoFile';
import { VersionsCard } from './DetailComponents';

type DownloadSheetProps = {
  visible: boolean;
  item: ContentItem;
  record?: OfflineDownloadRecord;
  error?: string;
  unavailableReason?: string;
  onClose: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onPlayOffline: () => void;
};

export function DownloadSheet({
  visible,
  item,
  record,
  error,
  unavailableReason,
  onClose,
  onDownload,
  onCancel,
  onPlayOffline,
}: DownloadSheetProps) {
  const extension = item.fileExtension ?? getFileExtension(item.mediaPath ?? '');
  const platform =
    Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
      ? Platform.OS
      : 'other';
  const supported = isVideoFormatLikelySupported(extension, platform);
  const allowed = item.availability.download;
  const downloaded = record?.status === 'downloaded';
  const downloading = record?.status === 'downloading';
  const queued = record?.status === 'queued';
  const size = item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : 'Size unavailable';
  const stateMessage = unavailableReason ?? (!allowed
    ? 'Downloads are not available for this title.'
    : !supported
      ? 'This video format may not play on this device.'
      : platform === 'web'
        ? 'Offline downloads need the Geniuz+ phone app; they are not available in a browser.'
        : error ??
        (record?.status === 'failed'
          ? 'The download failed. Retry when your connection is available.'
          : undefined));

  let actionLabel = `Download (1) · ${size}`;
  let action = onDownload;
  let disabled = false;
  if (downloaded) {
    actionLabel = 'Play offline';
    action = onPlayOffline;
    disabled = false;
  } else if (downloading) {
    actionLabel = `Cancel download (${record.progress}%)`;
    action = onCancel;
    disabled = false;
  } else if (queued) {
    actionLabel = 'Cancel queued download';
    action = onCancel;
    disabled = false;
  } else if (!allowed) {
    actionLabel = 'Download unavailable';
  } else if (!supported) {
    actionLabel = 'Format may not play';
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close download sheet"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.sheet}>
            <View style={styles.grabBar} />
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Download</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <VersionsCard item={item} onDownload={onDownload} />
              <View style={styles.qualityHeader}>
                <Text style={styles.sectionLabel}>Quality</Text>
                <View style={styles.qualityRow}>
                  <View style={[styles.qualityChip, styles.selectedQuality]}>
                    <Text style={styles.selectedQualityText}>Original</Text>
                  </View>
                  {isFeatureEnabled('qualityOptions') ? (
                    (['720p', '1080p'] as const).map((quality) => (
                      <Pressable
                        key={quality}
                        accessibilityRole="button"
                        onPress={() => undefined}
                        style={styles.qualityChip}
                      >
                        <Ionicons name="ribbon" size={13} color={theme.gold} />
                        <Text style={styles.qualityText}>{quality} · Coming soon</Text>
                      </Pressable>
                    ))
                  ) : null}
                </View>
              </View>
              <Text style={styles.sectionLabel}>Your download</Text>
              <View style={styles.downloadRow}>
                <View style={styles.rowIcon}>
                  <Ionicons name="videocam-outline" size={20} color={theme.accent} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowMeta}>
                    {size}
                    {downloading ? ` · ${record.progress}%` : downloaded ? ' · Downloaded' : ''}
                    {queued ? ' · Queued' : ''}
                  </Text>
                  {downloading ? (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${record.progress}%` }]} />
                    </View>
                  ) : null}
                </View>
                {downloaded ? <Ionicons name="checkmark-circle" size={22} color={theme.accent} /> : null}
              </View>
              {stateMessage ? <Text style={styles.helperText}>{stateMessage}</Text> : null}
              {isFeatureEnabled('vipUpsell') ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => undefined}
                  style={styles.vipButton}
                >
                  <Ionicons name="ribbon" size={17} color={theme.gold} />
                  <Text style={styles.vipText}>VIP features · Coming soon</Text>
                </Pressable>
              ) : null}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={action}
              style={[styles.primaryButton, disabled && styles.disabledButton]}
            >
              <Text style={styles.primaryText}>{actionLabel}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.scrim },
  safeArea: { justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: theme.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  grabBar: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.secondaryText,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerTitle: { color: theme.text, fontSize: 21, fontWeight: '800' },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  qualityHeader: { marginTop: 22, marginBottom: 20 },
  sectionLabel: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  qualityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qualityChip: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  selectedQuality: { backgroundColor: theme.accent, borderColor: theme.accent },
  selectedQualityText: { color: theme.background, fontSize: 14, fontWeight: '800' },
  qualityText: { color: theme.secondaryText, fontSize: 14 },
  downloadRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  rowMeta: { color: theme.secondaryText, fontSize: 14, marginTop: 4 },
  progressTrack: { height: 4, backgroundColor: theme.surfaceSoft, borderRadius: 2, marginTop: 8 },
  progressFill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  helperText: { color: theme.secondaryText, fontSize: 14, lineHeight: 20, marginTop: 12 },
  vipButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.gold,
  },
  vipText: { color: theme.gold, fontSize: 14, fontWeight: '700' },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    marginTop: 18,
  },
  disabledButton: { backgroundColor: theme.surfaceSoft },
  primaryText: { color: theme.background, fontSize: 15, fontWeight: '800' },
});
