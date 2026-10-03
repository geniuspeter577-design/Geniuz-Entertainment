import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

type ContentNoticeProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'info' | 'warning' | 'error';
  autoHideMs?: number;
};

export function ContentNotice({
  message,
  actionLabel,
  onAction,
  tone = 'info',
  autoHideMs,
}: ContentNoticeProps) {
  const [dismissal, setDismissal] = useState<{ message: string; autoHideMs: number } | null>(null);

  useEffect(() => {
    if (autoHideMs === undefined) {
      return;
    }
    const timeout = setTimeout(() => setDismissal({ message, autoHideMs }), autoHideMs);
    return () => clearTimeout(timeout);
  }, [autoHideMs, message]);

  const isDismissed =
    autoHideMs !== undefined &&
    dismissal?.message === message &&
    dismissal.autoHideMs === autoHideMs;
  if (isDismissed) {
    return null;
  }

  return (
    <View style={[styles.container, tone === 'warning' && styles.warning, tone === 'error' && styles.error]}>
      <View style={styles.header}>
        <Text style={styles.message}>{message}</Text>
        {autoHideMs !== undefined ? (
          <Pressable
            onPress={() => {
              if (autoHideMs !== undefined) {
                setDismissal({ message, autoHideMs });
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss message"
            hitSlop={8}
            style={styles.dismiss}
          >
            <Ionicons name="close" size={18} color={theme.secondaryText} />
          </Pressable>
        ) : null}
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  warning: {
    borderColor: theme.warning,
  },
  error: {
    borderColor: '#B44848',
  },
  message: {
    flex: 1,
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  dismiss: { paddingLeft: 10, paddingTop: 1 },
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
