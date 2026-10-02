import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../src/theme';

const downloads = [
  { title: 'The Last Horizon', size: '1.8 GB', percent: 82, status: 'Downloading' },
  { title: 'Night of Ember', size: '960 MB', percent: 46, status: 'Queued' },
  { title: 'Midnight Bloom', size: '1.1 GB', percent: 100, status: 'Ready to watch' },
];

export default function DownloadsScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Downloads</Text>

        <View style={styles.banner}>
          <Text style={styles.bannerEyebrow}>Offline mode</Text>
          <Text style={styles.bannerTitle}>4 titles ready for travel</Text>
        </View>

        {downloads.map((item) => (
          <View key={item.title} style={styles.itemCard}>
            <View style={styles.cover} />
            <View style={styles.infoWrap}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemMeta}>{item.size}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${item.percent}%` }]} />
              </View>
              <Text style={styles.status}>{item.status}</Text>
            </View>
          </View>
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
  banner: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginBottom: 18,
  },
  bannerEyebrow: {
    color: theme.accent,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  bannerTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
  },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
  },
  cover: {
    width: 82,
    height: 96,
    borderRadius: 14,
    backgroundColor: theme.surfaceAlt,
  },
  infoWrap: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  itemTitle: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 5,
  },
  itemMeta: {
    color: theme.secondaryText,
    fontSize: 12,
    marginBottom: 10,
  },
  barTrack: {
    height: 8,
    backgroundColor: '#2A2F38',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8,
  },
  barFill: {
    height: '100%',
    backgroundColor: theme.accent,
    borderRadius: 999,
  },
  status: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
  },
});
