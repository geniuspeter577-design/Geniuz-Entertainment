import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { mockMedia } from '../../src/data/mockData';
import { theme } from '../../src/theme';

export default function ContentDetailsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const media = mockMedia.find((item) => item.slug === slug) ?? mockMedia[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <Image source={{ uri: media.backdrop }} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
        </View>

        <View style={styles.contentWrap}>
          <Text style={styles.tag}>{media.tag}</Text>
          <Text style={styles.title}>{media.title}</Text>
          <Text style={styles.meta}>{media.year} • {media.duration} • {media.rating}</Text>

          <View style={styles.actionsRow}>
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Play now</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>+ My list</Text>
            </Pressable>
          </View>

          <Text style={styles.description}>{media.description}</Text>

          <View style={styles.pillRow}>
            {media.genres.map((genre) => (
              <Text key={genre} style={styles.pill}>
                {genre}
              </Text>
            ))}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Cast</Text>
            <Text style={styles.infoValue}>Riley Cross • Nia Brooks • Jae Mercer</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Director</Text>
            <Text style={styles.infoValue}>A. K. Sol</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  heroWrap: {
    position: 'relative',
    height: 320,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(5, 8, 11, 0.32)',
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 18,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(11, 12, 15, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentWrap: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 36,
  },
  tag: {
    color: theme.accent,
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 8,
  },
  meta: {
    color: theme.secondaryText,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryButtonText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 15,
  },
  description: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 18,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  pill: {
    backgroundColor: theme.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  infoCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 12,
  },
  infoLabel: {
    color: theme.secondaryText,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
