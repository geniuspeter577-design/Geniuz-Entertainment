import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { EpisodeItem, SeasonItem } from '../../models/content';
import type { OfflineDownloadRecord } from '../../services/OfflineDownloadService';
import { formatBytes } from '../../services/OfflineDownloadService';
import { theme } from '../../theme';
import { orderEpisodes, selectEpisodes, totalEpisodeSize } from '../../utils/episodeSelection';

type SeasonSheetProps = {
  visible: boolean;
  seasons: SeasonItem[];
  selectedSeasonId?: string;
  onClose: () => void;
  onSelect: (season: SeasonItem) => void;
};

export function SeasonSheet({
  visible,
  seasons,
  selectedSeasonId,
  onClose,
  onSelect,
}: SeasonSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.grabBar} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{seasons.length} seasons</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close seasons" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView>
            {seasons.map((season) => {
              const selected = season.id === selectedSeasonId;
              return (
                <Pressable
                  key={season.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(season)}
                  style={[styles.seasonRow, selected && styles.selectedSeason]}
                >
                  <View style={styles.seasonNumber}>
                    <Text style={[styles.seasonNumberText, selected && styles.selectedSeasonText]}>
                      {season.seasonNumber}
                    </Text>
                  </View>
                  <View style={styles.seasonCopy}>
                    <Text style={styles.seasonTitle}>Season {season.seasonNumber}</Text>
                    <Text style={styles.seasonMeta}>
                      {season.episodes.length} episodes
                      {season.year ? ` · ${season.year}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.viewEpisodes, selected && styles.selectedSeasonText]}>
                    View episodes
                  </Text>
                </Pressable>
              );
            })}
            {!seasons.length ? <Text style={styles.emptyText}>No seasons are available yet.</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

type EpisodeChipsProps = {
  episodes: EpisodeItem[];
  records: OfflineDownloadRecord[];
  selectedId?: string;
  onPlay: (episode: EpisodeItem) => void;
  onDownload: (episode: EpisodeItem) => void;
};

export function EpisodeChips({ episodes, records, selectedId, onPlay, onDownload }: EpisodeChipsProps) {
  const ordered = orderEpisodes(episodes);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.episodeChipRow}>
      <View style={[styles.episodeChip, !selectedId && styles.selectedEpisodeChip]}>
        <Text style={[styles.episodeChipText, !selectedId && styles.selectedEpisodeText]}>All</Text>
      </View>
      {ordered.map((episode) => {
        const record = records.find((candidate) => candidate.item.id === episode.id);
        const isDownloading = record?.status === 'downloading';
        const isQueued = record?.status === 'queued';
        const isDownloaded = record?.status === 'downloaded';
        const hasFailed = record?.status === 'failed' || record?.status === 'canceled';
        return (
          <View
            key={episode.id}
            style={[styles.episodeChip, selectedId === episode.id && styles.selectedEpisodeChip]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play episode ${episode.episodeNumber}, ${episode.title}`}
              onPress={() => onPlay(episode)}
              style={styles.episodePlay}
            >
              <Text style={[styles.episodeChipText, selectedId === episode.id && styles.selectedEpisodeText]}>
                E{String(episode.episodeNumber).padStart(2, '0')} ·{' '}
                {isDownloading
                  ? `${record.progress}%`
                  : isQueued
                    ? 'Queued'
                    : episode.fileSizeBytes
                      ? formatBytes(episode.fileSizeBytes)
                      : '—'}
              </Text>
            </Pressable>
            {episode.availability.download ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isDownloading || isQueued
                    ? `Cancel episode ${episode.episodeNumber} download`
                    : isDownloaded
                      ? `Play downloaded episode ${episode.episodeNumber}`
                      : hasFailed
                        ? `Retry episode ${episode.episodeNumber} download`
                        : `Download episode ${episode.episodeNumber}`
                }
                onPress={() => onDownload(episode)}
                style={styles.episodeDownload}
              >
                <Ionicons
                  name={
                    isDownloaded
                      ? 'checkmark-circle'
                      : isDownloading || isQueued
                        ? 'close'
                        : hasFailed
                          ? 'refresh'
                          : 'download-outline'
                  }
                  size={15}
                  color={theme.accent}
                />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

type SeriesDownloadSheetProps = {
  visible: boolean;
  season: SeasonItem;
  records: OfflineDownloadRecord[];
  onClose: () => void;
  onQueue: (episodes: EpisodeItem[]) => void;
  onCancel: (episodeId: string) => void;
};

export function SeriesDownloadSheet({
  visible,
  season,
  records,
  onClose,
  onQueue,
  onCancel,
}: SeriesDownloadSheetProps) {
  const downloadable = season.episodes.filter((episode) => episode.availability.download);
  const queueable = downloadable.filter(
    (episode) =>
      !records.some(
        (record) =>
          record.item.id === episode.id &&
          (record.status === 'queued' ||
            record.status === 'downloading' ||
            record.status === 'downloaded'),
      ),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    queueable.map((episode) => episode.id),
  );
  const selected = selectEpisodes(queueable, selectedIds);
  const totalSize = totalEpisodeSize(selected);

  const toggleEpisode = (episodeId: string) => {
    setSelectedIds((ids) =>
      ids.includes(episodeId) ? ids.filter((id) => id !== episodeId) : [...ids, episodeId],
    );
  };
  const toggleAll = () => {
    setSelectedIds((ids) =>
      ids.length === queueable.length ? [] : queueable.map((item) => item.id),
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.grabBar} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Download season {season.seasonNumber}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close downloads" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: queueable.length > 0 && selected.length === queueable.length,
                disabled: queueable.length === 0,
              }}
              disabled={queueable.length === 0}
              onPress={toggleAll}
              style={styles.selectAll}
            >
              <Ionicons
                name={
                  queueable.length > 0 && selected.length === queueable.length
                    ? 'checkbox'
                    : 'square-outline'
                }
                size={21}
                color={theme.accent}
              />
              <Text style={styles.selectAllText}>Select all available episodes</Text>
            </Pressable>
            {orderEpisodes(season.episodes).map((episode) => {
              const record = records.find((download) => download.item.id === episode.id);
              const alreadyDownloaded = record?.status === 'downloaded';
              const isActive =
                record?.status === 'queued' || record?.status === 'downloading';
              const checked = selected.some((selectedEpisode) => selectedEpisode.id === episode.id);
              return (
                <Pressable
                  key={episode.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: alreadyDownloaded || checked,
                    disabled: !episode.availability.download || alreadyDownloaded || isActive,
                  }}
                  disabled={!episode.availability.download || alreadyDownloaded || isActive}
                  onPress={() => toggleEpisode(episode.id)}
                  style={styles.episodeRow}
                >
                  <Ionicons
                    name={
                      alreadyDownloaded
                        ? 'checkmark-circle'
                        : checked
                          ? 'checkbox'
                          : 'square-outline'
                    }
                    size={21}
                    color={
                      episode.availability.download || alreadyDownloaded
                        ? theme.accent
                        : theme.secondaryText
                    }
                  />
                  <View style={styles.episodeCopy}>
                    <Text style={styles.episodeTitle}>
                      S{String(season.seasonNumber).padStart(2, '0')} E{String(episode.episodeNumber).padStart(2, '0')} · {episode.title}
                    </Text>
                    <Text style={styles.episodeMeta}>
                      {episode.fileSizeBytes ? formatBytes(episode.fileSizeBytes) : 'Size unavailable'}
                      {episode.runtimeMinutes ? ` · ${episode.runtimeMinutes} min` : ''}
                      {record?.status === 'queued' ? ' · Queued' : ''}
                      {record?.status === 'downloading' ? ` · ${record.progress}%` : ''}
                      {record?.status === 'downloaded' ? ' · Downloaded' : ''}
                      {record?.status === 'failed' ? ' · Failed · Retry' : ''}
                      {!episode.availability.download ? ' · Downloads not available' : ''}
                    </Text>
                    {record?.status === 'downloading' ? (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${record.progress}%` }]} />
                      </View>
                    ) : null}
                  </View>
                  {isActive ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel episode ${episode.episodeNumber} download`}
                      onPress={() => onCancel(episode.id)}
                      style={styles.cancelButton}
                    >
                      <Ionicons name="close" size={19} color={theme.text} />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
            {!downloadable.length ? (
              <Text style={styles.emptyText}>Downloads are not available for episodes in this season.</Text>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={!selected.length}
            onPress={() => onQueue(selected)}
            style={[styles.primaryButton, !selected.length && styles.disabledButton]}
          >
            <Text style={styles.primaryText}>
              Download ({selected.length}) · {formatBytes(totalSize)}
            </Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.scrim },
  dismissArea: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    maxHeight: '88%',
    backgroundColor: theme.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  grabBar: { width: 42, height: 4, borderRadius: 2, backgroundColor: theme.secondaryText, alignSelf: 'center', marginTop: 10, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { color: theme.text, fontSize: 20, fontWeight: '800', flex: 1 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  seasonRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: 'transparent' },
  selectedSeason: { backgroundColor: theme.surfaceAlt, borderColor: theme.accent },
  seasonNumber: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.background },
  seasonNumberText: { color: theme.text, fontSize: 17, fontWeight: '800' },
  selectedSeasonText: { color: theme.accent },
  seasonCopy: { flex: 1 },
  seasonTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  seasonMeta: { color: theme.secondaryText, fontSize: 14, marginTop: 4 },
  viewEpisodes: { color: theme.secondaryText, fontSize: 14, fontWeight: '600' },
  episodeChipRow: { gap: 8, paddingVertical: 12, paddingRight: 18 },
  episodeChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 999, paddingLeft: 14, paddingRight: 8 },
  selectedEpisodeChip: { backgroundColor: theme.accent, borderColor: theme.accent },
  episodeChipText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  selectedEpisodeText: { color: theme.background },
  episodePlay: { minHeight: 42, justifyContent: 'center' },
  episodeDownload: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  selectAll: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  selectAllText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  episodeRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: theme.surface, borderRadius: 12, padding: 12, marginBottom: 8 },
  episodeCopy: { flex: 1 },
  episodeTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  episodeMeta: { color: theme.secondaryText, fontSize: 14, marginTop: 4 },
  progressTrack: { height: 4, backgroundColor: theme.surfaceSoft, borderRadius: 2, marginTop: 7 },
  progressFill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  cancelButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: theme.secondaryText, fontSize: 14, lineHeight: 20, paddingVertical: 18 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent, borderRadius: 999, marginTop: 14 },
  disabledButton: { backgroundColor: theme.surfaceSoft },
  primaryText: { color: theme.background, fontSize: 15, fontWeight: '800' },
});
