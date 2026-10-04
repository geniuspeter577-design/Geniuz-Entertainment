import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import type { ContentItem } from '../models/content';
import { theme } from '../theme';
import { ContentNotice } from './ContentNotice';
import { PosterCard } from './PosterCard';
import { SectionHeader } from './SectionHeader';

type ContentRailProps = {
  title: string;
  items: ContentItem[];
  isLoading: boolean;
  error?: string;
  retry: () => void;
  onSeeAll: () => void;
  compact?: boolean;
  emptyMessage: string;
};

export function ContentRail({
  title,
  items,
  isLoading,
  error,
  retry,
  onSeeAll,
  compact,
  emptyMessage,
}: ContentRailProps) {
  return (
    <>
      <SectionHeader title={title} onSeeAll={onSeeAll} />
      {isLoading ? <ContentNotice message={`Loading ${title.toLowerCase()}…`} /> : null}
      {error ? (
        <ContentNotice
          message={error}
          tone="error"
          actionLabel="Retry"
          onAction={retry}
          autoHideMs={5000}
        />
      ) : null}
      {!isLoading && !error && items.length === 0 ? (
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowList}>
        {items.map((item) => (
          <PosterCard
            key={item.id}
            item={item}
            compact={compact}
            onPress={() => router.push({ pathname: '/content/[id]', params: { id: item.id } })}
          />
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  rowList: {
    paddingRight: 18,
    paddingBottom: 4,
  },
});
