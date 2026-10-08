import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SubtitleTrack } from '../../repositories/SupabaseMovieRepository';
import { theme } from '../../theme';

type Props = {
  visible: boolean;
  tracks: readonly SubtitleTrack[];
  selectedTrackId: string | null;
  isLoading: boolean;
  error?: string;
  onClose: () => void;
  onSelect: (trackId: string | null) => void;
  onRetry: () => void;
};

export function SubtitleSheet({
  visible,
  tracks,
  selectedTrackId,
  isLoading,
  error,
  onClose,
  onSelect,
  onRetry,
}: Props) {
  const renderOption = (id: string | null, label: string) => {
    const selected = selectedTrackId === id;
    return (
      <Pressable
        key={id ?? 'off'}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={() => onSelect(id)}
        style={[styles.option, selected && styles.selectedOption]}
      >
        <Text style={[styles.optionText, selected && styles.selectedOptionText]}>{label}</Text>
        {selected ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close subtitles" onPress={onClose} style={styles.dismissArea} />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.grabBar} />
          <View style={styles.header}>
            <Text style={styles.title}>Language / Subtitles</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close subtitles" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView>
            {renderOption(null, 'Off')}
            {isLoading ? (
              <View style={styles.notice}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.noticeText}>Loading available subtitles…</Text>
              </View>
            ) : null}
            {error ? (
              <View style={styles.notice}>
                <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
            {tracks.map((track) =>
              renderOption(track.id, `${track.languageLabel} (${track.format.toUpperCase()})`),
            )}
            {!isLoading && !error && tracks.length === 0 ? (
              <Text style={styles.noticeText}>No subtitle tracks are available for this video.</Text>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '68%',
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  grabBar: {
    alignSelf: 'center',
    backgroundColor: theme.border,
    borderRadius: 99,
    height: 4,
    marginBottom: 16,
    marginTop: 10,
    width: 42,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 40,
  },
  option: {
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: 8,
  },
  selectedOption: {
    backgroundColor: 'rgba(114, 240, 106, 0.08)',
  },
  optionText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  selectedOptionText: {
    color: theme.accent,
  },
  notice: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  noticeText: {
    color: theme.secondaryText,
    fontSize: 13,
    paddingVertical: 12,
    textAlign: 'center',
  },
  error: {
    color: theme.error,
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    padding: 8,
  },
  retryText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});
