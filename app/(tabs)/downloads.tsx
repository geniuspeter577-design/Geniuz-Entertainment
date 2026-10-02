import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { theme } from '../../src/theme';

export default function DownloadsScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Downloads</Text>

        <View style={styles.banner}>
          <Text style={styles.bannerEyebrow}>Offline mode</Text>
          <Text style={styles.bannerTitle}>Downloads are not available yet</Text>
        </View>
        <ContentNotice message="Offline downloads require licensed content and a secure playback service. No titles have been downloaded." />
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
});
