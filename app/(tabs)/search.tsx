import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { mockMedia } from '../../src/data/mockData';
import { theme } from '../../src/theme';

const categories = ['All', 'Sci‑Fi', 'Action', 'Drama', 'Live', 'Thriller'];

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const results = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    return mockMedia.filter((item) => {
      const matchesCategory =
        selectedCategory === 'All' || item.genres.some((genre) => genre.toLowerCase() === selectedCategory.toLowerCase());
      const queryMatches =
        !cleanQuery ||
        item.title.toLowerCase().includes(cleanQuery) ||
        item.tag.toLowerCase().includes(cleanQuery) ||
        item.genres.some((genre) => genre.toLowerCase().includes(cleanQuery));

      return matchesCategory && queryMatches;
    });
  }, [query, selectedCategory]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Discover</Text>

        <View style={styles.searchContainer}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search movies, shows, genres"
            placeholderTextColor={theme.secondaryText}
            style={styles.input}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {categories.map((category) => (
            <Pressable
              key={category}
              onPress={() => setSelectedCategory(category)}
              style={[styles.chip, selectedCategory === category && styles.activeChip]}
            >
              <Text style={[styles.chipText, selectedCategory === category && styles.activeChipText]}>
                {category}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <SectionHeader title={query ? 'Results' : 'Popular now'} />

        <View style={styles.grid}>
          {results.length ? (
            results.map((item) => (
              <PosterCard
                key={item.id}
                item={item}
                compact
                onPress={() => router.push({ pathname: '/content/[slug]', params: { slug: item.slug } })}
              />
            ))
          ) : (
            <Text style={styles.emptyState}>No titles match your search.</Text>
          )}
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
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  header: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 18,
    letterSpacing: -0.9,
  },
  searchContainer: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  input: {
    color: theme.text,
    fontSize: 16,
    paddingVertical: 4,
  },
  chipRow: {
    paddingVertical: 18,
    paddingRight: 18,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    marginRight: 10,
  },
  activeChip: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  chipText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 12,
  },
  activeChipText: {
    color: theme.background,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  emptyState: {
    color: theme.secondaryText,
    fontSize: 15,
    marginTop: 8,
  },
});
