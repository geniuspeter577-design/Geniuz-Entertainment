import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { PosterCard } from '../../src/components/PosterCard';
import { SectionHeader } from '../../src/components/SectionHeader';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import { contentService } from '../../src/services/createContentService';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { theme } from '../../src/theme';

const categories = ['All', 'Science Fiction', 'Action', 'Drama', 'Live', 'Thriller'];

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const searchContent = useCallback(
    () =>
      contentService.search(debouncedQuery, {
        ...(selectedCategory === 'All' ? {} : { genre: selectedCategory }),
      }),
    [debouncedQuery, selectedCategory],
  );
  const search = useContentQuery(
    `search:${debouncedQuery}:${selectedCategory}`,
    searchContent,
  );
  const searchUploaded = useCallback(
    async () => ({
      data: supabaseMovieRepository
        ? await supabaseMovieRepository.searchPublished(
            debouncedQuery,
            selectedCategory === 'All' ? undefined : selectedCategory,
          )
        : [],
      source: 'supabase' as const,
    }),
    [debouncedQuery, selectedCategory],
  );
  const uploadedSearch = useContentQuery(
    `uploaded-search:${debouncedQuery}:${selectedCategory}`,
    searchUploaded,
  );
  const retryUploadedSearch = uploadedSearch.retry;
  useFocusEffect(
    useCallback(() => {
      retryUploadedSearch();
    }, [retryUploadedSearch]),
  );
  const results = [...(search.data ?? []), ...(uploadedSearch.data ?? [])];

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
            accessibilityLabel="Search movies, shows, and genres"
            returnKeyType="search"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {categories.map((category) => (
            <Pressable
              key={category}
              onPress={() => setSelectedCategory(category)}
              style={[styles.chip, selectedCategory === category && styles.activeChip]}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCategory === category }}
            >
              <Text style={[styles.chipText, selectedCategory === category && styles.activeChipText]}>
                {category}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {search.warning ? (
          <ContentNotice
            message={search.warning}
            tone="warning"
            actionLabel="Retry"
            onAction={search.retry}
          />
        ) : null}
        {!search.isLoading &&
        search.source === 'mock' &&
        !search.warning &&
        uploadedSearch.data?.length === 0 ? (
          <ContentNotice message="Preview catalog — search results are sample content." />
        ) : null}
        <SectionHeader title={debouncedQuery ? 'Results' : 'Popular now'} />

        {search.isLoading || uploadedSearch.isLoading ? (
          <ContentNotice message="Searching the catalog…" />
        ) : null}
        {search.error ? (
          <ContentNotice
            message={search.error}
            tone="error"
            actionLabel="Retry"
            onAction={search.retry}
          />
        ) : null}
        {!search.isLoading &&
        !uploadedSearch.isLoading &&
        !search.error &&
        !uploadedSearch.error &&
        results.length === 0 ? (
          <ContentNotice message="No titles match your search. Try another title or genre." />
        ) : null}

        {uploadedSearch.error ? (
          <ContentNotice
            message={uploadedSearch.error}
            tone="error"
            actionLabel="Retry"
            onAction={uploadedSearch.retry}
          />
        ) : null}

        <View style={styles.grid}>
          {results.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              compact
              onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
            />
          ))}
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
});
