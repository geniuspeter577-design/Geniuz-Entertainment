import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { continueWatching, mockMedia, premiumPicks, trendingTitles } from '../../src/data/mockData';
import { theme } from '../../src/theme';

export default function HomeScreen() {
  const featured = mockMedia[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>Geniuz+</Text>
          <Pressable accessibilityRole="button" style={styles.iconButton}>
            <Ionicons name="notifications-outline" size={22} color={theme.text} />
          </Pressable>
        </View>

        <Pressable
          style={styles.heroCard}
          onPress={() => router.push({ pathname: '/content/[slug]', params: { slug: featured.slug } })}
        >
          <Image source={{ uri: featured.backdrop }} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
          <View style={styles.heroMeta}>
            <Text style={styles.heroTag}>Premium pick</Text>
            <Text style={styles.heroTitle}>{featured.title}</Text>
            <Text style={styles.heroSubtitle}>{featured.tag} • {featured.rating}</Text>
            <View style={styles.heroActions}>
              <Pressable style={styles.primaryAction}>
                <Text style={styles.primaryActionText}>Play now</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction}>
                <Ionicons name="add-outline" size={18} color={theme.text} />
              </Pressable>
            </View>
          </View>
        </Pressable>

        <SectionHeader title="Continue watching" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowList}>
          {continueWatching.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              onPress={() => router.push({ pathname: '/content/[slug]', params: { slug: item.slug } })}
            />
          ))}
        </ScrollView>

        <SectionHeader title="Trending right now" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowList}>
          {trendingTitles.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              onPress={() => router.push({ pathname: '/content/[slug]', params: { slug: item.slug } })}
            />
          ))}
        </ScrollView>

        <SectionHeader title="Premium picks" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowList}>
          {premiumPicks.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              onPress={() => router.push({ pathname: '/content/[slug]', params: { slug: item.slug } })}
              compact
            />
          ))}
        </ScrollView>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 18,
  },
  brand: {
    fontSize: 28,
    color: theme.text,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  heroCard: {
    position: 'relative',
    height: 280,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 4,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(7,10,13,0.24)',
  },
  heroMeta: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  heroTag: {
    alignSelf: 'flex-start',
    color: theme.accentSoft,
    backgroundColor: 'rgba(8,10,12,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontWeight: '700',
    fontSize: 11,
    marginBottom: 10,
    overflow: 'hidden',
  },
  heroTitle: {
    color: theme.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.9,
    marginBottom: 6,
  },
  heroSubtitle: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryAction: {
    backgroundColor: theme.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  primaryActionText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryAction: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rowList: {
    paddingRight: 18,
    paddingBottom: 4,
  },
});
