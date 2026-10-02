import { router } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { mockMedia } from '../../src/data/mockData';
import { theme } from '../../src/theme';

export default function LibraryScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>My library</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Watchlist</Text>
            <Text style={styles.summaryValue}>12</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Finished</Text>
            <Text style={styles.summaryValue}>8</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Saved</Text>
            <Text style={styles.summaryValue}>5</Text>
          </View>
        </View>

        <SectionHeader title="Saved to your library" />
        <View style={styles.grid}>
          {mockMedia.slice(0, 4).map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              compact
              onPress={() => router.push({ pathname: '/content/[slug]', params: { slug: item.slug } })}
            />
          ))}
        </View>

        <SectionHeader title="Recently watched" />
        {mockMedia.slice(1, 4).map((item) => (
          <Pressable key={item.id} style={styles.rowItem}>
            <View style={styles.rowCover} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowMeta}>{item.type} • {item.duration}</Text>
            </View>
            <Text style={styles.rowProgress}>{item.progress ?? 0}%</Text>
          </Pressable>
        ))}
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
});
