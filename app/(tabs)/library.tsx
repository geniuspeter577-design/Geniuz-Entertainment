import { router } from 'expo-router';
import React from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { useLibrary } from '../../src/state/LibraryContext';
import { theme } from '../../src/theme';

export default function LibraryScreen() {
  const { continueWatching, error, isLoading, retryLoad, watchlist } = useLibrary();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>My library</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Watchlist</Text>
            <Text style={styles.summaryValue}>{watchlist.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>In progress</Text>
            <Text style={styles.summaryValue}>{continueWatching.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Offline</Text>
            <Text style={styles.summaryValue}>0</Text>
          </View>
        </View>

        {isLoading ? <ContentNotice message="Loading your device library…" /> : null}
        {error ? (
          <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={retryLoad} />
        ) : null}

        <SectionHeader title="My watchlist" />
        <View style={styles.grid}>
          {watchlist.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              compact
              onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
            />
          ))}
        </View>
        {!isLoading && !error && watchlist.length === 0 ? (
          <Text style={styles.emptyText}>Add titles to My List and they’ll be saved on this device.</Text>
        ) : null}

        <SectionHeader title="Recently watched" />
        {continueWatching.map((entry) => (
          <Pressable
            key={entry.item.id}
            style={styles.rowItem}
            onPress={() =>
              router.push({ pathname: '/content/[id]', params: { id: entry.item.id } })
            }
          >
            <Image
              source={
                entry.item.posterUrl
                  ? { uri: entry.item.posterUrl }
                  : require('../../assets/icon.png')
              }
              style={styles.rowCover}
              resizeMode="cover"
            />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>{entry.item.title}</Text>
              <Text style={styles.rowMeta}>{entry.item.type} • {entry.progress}% complete</Text>
            </View>
            <Text style={styles.rowProgress}>{entry.progress}%</Text>
          </Pressable>
        ))}
        {!continueWatching.length ? (
          <Text style={styles.emptyText}>Viewing progress will be saved here when playback is available.</Text>
        ) : null}
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  summaryLabel: {
    color: theme.secondaryText,
    fontSize: 12,
    marginBottom: 6,
  },
  summaryValue: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  rowCover: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
  },
  rowInfo: {
    flex: 1,
    marginLeft: 12,
  },
  rowTitle: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  rowMeta: {
    color: theme.secondaryText,
    fontSize: 12,
  },
  rowProgress: {
    color: theme.accent,
    fontWeight: '800',
    fontSize: 12,
  },
  emptyText: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
});
