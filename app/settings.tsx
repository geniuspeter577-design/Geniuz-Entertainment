import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Switch, Text, View } from 'react-native';

import { ContentNotice } from '../src/components/ContentNotice';
import { getAutoplayTrailers, setAutoplayTrailers } from '../src/services/TrailerAutoplayPreference';
import { theme } from '../src/theme';

export default function SettingsScreen() {
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  const loadPreference = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      setAutoplayEnabled(await getAutoplayTrailers());
    } catch (preferenceError) {
      console.error('[Settings] Could not load trailer autoplay preference.', preferenceError);
      setError('Autoplay trailers setting could not be loaded. Retry to try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getAutoplayTrailers()
      .then((enabled) => {
        if (active) {
          setAutoplayEnabled(enabled);
        }
      })
      .catch((preferenceError: unknown) => {
        console.error('[Settings] Could not load trailer autoplay preference.', preferenceError);
        if (active) {
          setError('Autoplay trailers setting could not be loaded. Retry to try again.');
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const changeAutoplay = async (enabled: boolean) => {
    setIsSaving(true);
    setError(undefined);
    try {
      await setAutoplayTrailers(enabled);
      setAutoplayEnabled(enabled);
    } catch (preferenceError) {
      console.error('[Settings] Could not save trailer autoplay preference.', preferenceError);
      setError('Autoplay trailers setting could not be saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>
      {error ? <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={() => void loadPreference()} /> : null}
      <View style={styles.settingCard}>
        <View style={styles.settingCopy}>
          <Text style={styles.settingTitle}>Autoplay trailers</Text>
          <Text style={styles.settingDescription}>
            Trailer previews start muted on title pages. Streaming trailers uses mobile data.
          </Text>
        </View>
        <Switch
          accessibilityRole="switch"
          accessibilityLabel="Autoplay trailers"
          accessibilityState={{ checked: autoplayEnabled, disabled: isLoading || isSaving }}
          value={autoplayEnabled}
          disabled={isLoading || isSaving}
          onValueChange={(enabled) => void changeAutoplay(enabled)}
          trackColor={{ false: theme.border, true: theme.accent }}
          thumbColor={theme.text}
        />
        <Text style={styles.switchValue}>{isLoading ? 'Loading…' : autoplayEnabled ? 'On' : 'Off'}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background, paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, marginBottom: 20 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  title: { color: theme.text, fontSize: 28, fontWeight: '800' },
  settingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 18,
  },
  settingCopy: { flex: 1 },
  settingTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  settingDescription: { color: theme.secondaryText, fontSize: 13, lineHeight: 19, marginTop: 6 },
  switchValue: { color: theme.accent, fontSize: 12, fontWeight: '800', minWidth: 34 },
});
