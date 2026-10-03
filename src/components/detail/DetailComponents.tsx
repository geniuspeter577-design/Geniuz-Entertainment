import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PosterCard } from '../PosterCard';
import type { ContentItem } from '../../models/content';
import { isFeatureEnabled } from '../../config/features';
import { formatBytes } from '../../services/OfflineDownloadService';
import { theme } from '../../theme';
import { formatRuntime } from '../../utils/contentPresentation';

type TitleRowProps = {
  title: string;
  onInfo: () => void;
};

export function TitleRow({ title, onInfo }: TitleRowProps) {
  return (
    <View style={styles.titleRow}>
      <Text style={styles.title}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={onInfo} style={styles.infoButton}>
        <Text style={styles.infoText}>Info</Text>
        <Ionicons name="chevron-forward" size={16} color={theme.accent} />
      </Pressable>
    </View>
  );
}

type MetaRowProps = {
  item: ContentItem;
  extra?: string;
};

export function MetaRow({ item, extra }: MetaRowProps) {
  const fields = [
    item.rating === undefined ? undefined : item.rating.toFixed(1),
    item.year === undefined ? undefined : String(item.year),
    item.genres[0],
    item.runtimeMinutes === undefined ? undefined : formatRuntime(item),
    extra,
  ].filter((field): field is string => Boolean(field));

  return (
    <View style={styles.metaRow}>
      <Ionicons
        name={item.type === 'series' || item.type === 'tv' ? 'tv-outline' : 'film-outline'}
        size={16}
        color={theme.secondaryText}
      />
      {fields.map((field, index) => (
        <React.Fragment key={`${field}-${index}`}>
          <Text style={styles.metaText}>{field}</Text>
          {index < fields.length - 1 ? <Text style={styles.metaDot}>·</Text> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

type ActionChipsProps = {
  saved: boolean;
  downloadLabel: string;
  onToggleList: () => void;
  onShare: () => void;
  onDownload: () => void;
  onMyDownloads: () => void;
};

export function ActionChips({
  saved,
  downloadLabel,
  onToggleList,
  onShare,
  onDownload,
  onMyDownloads,
}: ActionChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.actionRow}
    >
      <ActionChip icon={saved ? 'checkmark' : 'add'} label={saved ? 'In my list' : 'Add to list'} onPress={onToggleList} />
      <ActionChip icon="share-social-outline" label="Share" onPress={onShare} />
      <ActionChip
        icon="download-outline"
        label={downloadLabel}
        onPress={onDownload}
      />
      <ActionChip icon="folder-open-outline" label="My downloads" onPress={onMyDownloads} />
    </ScrollView>
  );
}

type ActionChipProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function ActionChip({ icon, label, onPress, disabled = false }: ActionChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionChip, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={17} color={disabled ? theme.secondaryText : theme.text} />
      <Text style={[styles.actionText, disabled && styles.mutedText]}>{label}</Text>
    </Pressable>
  );
}

type VersionsCardProps = {
  item: ContentItem;
  onDownload: () => void;
  disabled?: boolean;
};

export function VersionsCard({ item, onDownload, disabled = false }: VersionsCardProps) {
  return (
    <View style={styles.versionCard}>
      <View style={styles.versionIcon}>
        <Ionicons name="videocam-outline" size={21} color={theme.accent} />
      </View>
      <View style={styles.versionCopy}>
        <Text style={styles.versionTitle}>Original</Text>
        <Text style={styles.versionMeta}>
          {[item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : undefined, formatRuntime(item)]
            .filter(Boolean)
            .join(' · ') || 'File details unavailable'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Download original video"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onDownload}
        style={[styles.versionDownload, disabled && styles.disabled]}
      >
        <Ionicons name="download-outline" size={19} color={disabled ? theme.secondaryText : theme.background} />
      </Pressable>
    </View>
  );
}

type DetailTabsProps = {
  selected: 'similar' | 'comments';
  onChange: (tab: 'similar' | 'comments') => void;
};

export function DetailTabs({ selected, onChange }: DetailTabsProps) {
  return (
    <View style={styles.tabs}>
      {(['similar', 'comments'] as const).map((tab) => (
        <Pressable
          key={tab}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === tab }}
          onPress={() => onChange(tab)}
          style={[styles.tab, selected === tab && styles.selectedTab]}
        >
          <Text style={[styles.tabText, selected === tab && styles.selectedTabText]}>
            {tab === 'similar' ? 'More like this' : 'Comments'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type PosterGridProps = {
  items: ContentItem[];
  currentId: string;
};

export function PosterGrid({ items, currentId }: PosterGridProps) {
  const gridItems = items.filter((item) => item.id !== currentId).slice(0, 9);
  return (
    <View style={styles.posterGrid}>
      {gridItems.map((item) => (
        <PosterCard
          key={item.id}
          item={item}
          compact
          grid
          onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
        />
      ))}
    </View>
  );
}

type FloatingDownloadCTAProps = {
  visible: boolean;
  sizeLabel?: string;
  label?: string;
  onPress: () => void;
};

export function FloatingDownloadCTA({
  visible,
  sizeLabel,
  label = 'Download',
  onPress,
}: FloatingDownloadCTAProps) {
  if (!visible) {
    return null;
  }

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.floatingCta}>
      <Ionicons name="download-outline" size={18} color={theme.background} />
      <Text style={styles.floatingText}>{label}{sizeLabel ? ` (${sizeLabel})` : ''}</Text>
    </Pressable>
  );
}

export function PremiumBanner() {
  if (!isFeatureEnabled('premiumBanner')) {
    return null;
  }
  return (
    <View style={styles.premiumBanner}>
      <Text style={styles.premiumTitle}>Premium</Text>
      <Text style={styles.premiumText}>Premium features are coming soon.</Text>
    </View>
  );
}

export function QuickBuzzTeaser() {
  return (
    <View style={styles.quickBuzz}>
      <View>
        <Text style={styles.quickBuzzTitle}>QuickBuzz</Text>
        <Text style={styles.quickBuzzCopy}>Short clips are coming soon.</Text>
      </View>
      <Ionicons name="play-circle-outline" size={26} color={theme.accent} />
    </View>
  );
}

export function DetailSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.skeletonHero} />
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonMeta} />
      <View style={styles.skeletonActions} />
      <View style={styles.skeletonCard} />
      <View style={styles.skeletonCard} />
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: theme.text, fontSize: 28, fontWeight: '800', flex: 1 },
  infoButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  infoText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  metaText: { color: theme.secondaryText, fontSize: 14 },
  metaDot: { color: theme.secondaryText, fontSize: 14 },
  actionRow: { gap: 8, paddingVertical: 16, paddingRight: 18 },
  actionChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  actionText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  mutedText: { color: theme.secondaryText },
  disabled: { opacity: 0.65 },
  versionCard: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
  },
  versionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
  },
  versionCopy: { flex: 1 },
  versionTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  versionMeta: { color: theme.secondaryText, fontSize: 14, marginTop: 4 },
  versionDownload: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
  },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border, marginTop: 24 },
  tab: { minHeight: 48, justifyContent: 'center', marginRight: 24, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  selectedTab: { borderBottomColor: theme.accent },
  tabText: { color: theme.secondaryText, fontSize: 15, fontWeight: '700' },
  selectedTabText: { color: theme.text },
  posterGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 16 },
  floatingCta: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 18,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 20,
    elevation: 6,
  },
  floatingText: { color: theme.background, fontSize: 15, fontWeight: '800' },
  premiumBanner: { backgroundColor: theme.surface, borderRadius: 12, padding: 16, marginVertical: 12 },
  premiumTitle: { color: theme.gold, fontWeight: '800', fontSize: 16 },
  premiumText: { color: theme.text, fontSize: 14, marginTop: 4 },
  quickBuzz: {
    minHeight: 72,
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  quickBuzzTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  quickBuzzCopy: { color: theme.secondaryText, fontSize: 14, marginTop: 4 },
  skeletonWrap: { padding: 18, gap: 14 },
  skeletonHero: { width: '100%', height: 240, borderRadius: 12, backgroundColor: theme.surface },
  skeletonTitle: { width: '68%', height: 28, borderRadius: 8, backgroundColor: theme.surface },
  skeletonMeta: { width: '48%', height: 16, borderRadius: 8, backgroundColor: theme.surface },
  skeletonActions: { width: '100%', height: 46, borderRadius: 999, backgroundColor: theme.surface },
  skeletonCard: { width: '100%', height: 76, borderRadius: 12, backgroundColor: theme.surface },
});
