import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

type ContentNoticeProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'info' | 'warning' | 'error';
};

export function ContentNotice({
  message,
  actionLabel,
  onAction,
  tone = 'info',
}: ContentNoticeProps) {
  return (
    <View style={[styles.container, tone === 'warning' && styles.warning, tone === 'error' && styles.error]}>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
  },
  warning: {
    borderColor: theme.warning,
  },
  error: {
    borderColor: '#B44848',
  },
  message: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
  },
  actionText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});
