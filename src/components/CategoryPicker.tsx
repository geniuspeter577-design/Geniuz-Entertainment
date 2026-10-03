import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TITLE_CATEGORIES } from '../constants/categories';
import { theme } from '../theme';

export function CategoryPicker({
  selected,
  onChange,
  disabled = false,
}: {
  selected: readonly string[];
  onChange: (categories: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (category: string) => {
    onChange(
      selected.includes(category)
        ? selected.filter((selectedCategory) => selectedCategory !== category)
        : [...selected, category],
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Categories</Text>
      <View style={styles.chips}>
        {TITLE_CATEGORIES.map((category) => {
          const checked = selected.includes(category);
          return (
            <Pressable
              key={category}
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled }}
              disabled={disabled}
              onPress={() => toggle(category)}
              style={[styles.chip, checked && styles.selectedChip]}
            >
              <Text style={[styles.chipText, checked && styles.selectedText]}>{category}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function CategoryLabels({ categories }: { categories: readonly string[] }) {
  if (!categories.length) {
    return null;
  }
  return (
    <View style={styles.labels}>
      {categories.slice(0, 3).map((category) => (
        <Text key={category} style={styles.labelChip} numberOfLines={1}>
          {category}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  selectedChip: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.secondaryText, fontSize: 12, fontWeight: '700' },
  selectedText: { color: theme.background },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  labelChip: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(14,16,20,0.78)',
    color: theme.text,
    fontSize: 9,
    fontWeight: '700',
  },
});
