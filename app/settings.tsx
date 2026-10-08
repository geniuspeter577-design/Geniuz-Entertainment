import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { useAuth } from '../src/state/AuthContext';
import { useDownloads } from '../src/state/DownloadsContext';
import { useNetwork } from '../src/state/NetworkContext';
import {
  DEFAULT_PLAYBACK_SPEEDS,
  getAutoplayTrailers,
  getUserAppSettings,
  setAutoplayTrailers,
  setUserAppSettings,
  type UserAppSettings,
} from '../src/services/TrailerAutoplayPreference';
import { getUnreadNotificationCount, loadNotifications } from '../src/services/NotificationsStore';
import { getPlayerSpeedLabel } from '../src/utils/playerControls';
import { theme } from '../src/theme';
import { backOrReplace } from '../src/utils/navigation';

const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL?.trim();
const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL?.trim();

type SettingsCardProps = React.PropsWithChildren<{ title: string; icon: keyof typeof Ionicons.glyphMap }>;

function SettingsCard({ title, icon, children }: SettingsCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <Ionicons name={icon} size={18} color={theme.accent} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function SettingRow({
  title,
  subtitle,
  onPress,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={styles.settingRow}
    >
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle ? <Text style={styles.settingSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const auth = useAuth();
  const downloads = useDownloads();
  const network = useNetwork();
  const [settings, setSettings] = useState<UserAppSettings>();
  const [autoplayTrailers, setAutoplayTrailersState] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  const loadSettings = useCallback(async () => {
    if (!auth.session) {
      setSettings(undefined);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const [saved, trailers, notifications] = await Promise.all([
        getUserAppSettings(auth.session.user.id),
        getAutoplayTrailers(),
        loadNotifications(),
      ]);
      setSettings(saved);
      setAutoplayTrailersState(trailers);
      setUnreadCount(getUnreadNotificationCount(notifications));
    } catch (loadError) {
      console.error('[Settings] Could not load user settings.', loadError);
      setError('Settings could not be loaded. Retry to try again.');
    } finally {
      setIsLoading(false);
    }
  }, [auth.session]);

  useEffect(() => {
    void Promise.resolve().then(loadSettings);
  }, [loadSettings]);

  const updateSettings = async (update: Partial<UserAppSettings>) => {
    if (!auth.session || !settings) {
      auth.openSignInSheet('sign-in');
      return;
    }
    const next = { ...settings, ...update };
    setIsSaving(true);
    setError(undefined);
    try {
      await setUserAppSettings(auth.session.user.id, next);
      setSettings(next);
    } catch (saveError) {
      console.error('[Settings] Could not save user settings.', saveError);
      setError('Settings could not be saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const changeTrailerAutoplay = async (enabled: boolean) => {
    setIsSaving(true);
    setError(undefined);
    try {
      await setAutoplayTrailers(enabled);
      setAutoplayTrailersState(enabled);
    } catch (saveError) {
      console.error('[Settings] Could not save trailer autoplay preference.', saveError);
      setError('Trailer autoplay setting could not be saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const openExternalPage = async (url: string | undefined, label: string) => {
    if (!url) {
      Alert.alert(label, 'Coming soon');
      return;
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error(`${label} link must use HTTP or HTTPS.`);
      }
      await Linking.openURL(parsedUrl.toString());
    } catch (openError) {
      console.error(`[Settings] Could not open ${label.toLowerCase()} link.`, openError);
      Alert.alert(
        `Could not open ${label.toLowerCase()}`,
        openError instanceof Error ? openError.message : 'Please try again.',
      );
    }
  };

  const signOut = () => {
    Alert.alert('Sign out?', 'You can sign in again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void auth.signOut().catch((signOutError: unknown) => {
          Alert.alert(
            'Sign out failed',
            signOutError instanceof Error ? signOutError.message : 'Please try again.',
          );
        }),
      },
    ]);
  };

  const renderSwitch = (label: string, value: boolean, onValueChange: (next: boolean) => void) => (
    <Switch
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: isLoading || isSaving || !auth.session }}
      value={value}
      disabled={isLoading || isSaving || !auth.session}
      onValueChange={onValueChange}
      trackColor={{ false: theme.border, true: theme.accent }}
      thumbColor={theme.text}
    />
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => backOrReplace('/(tabs)/profile')}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!network.isOnline ? (
          <ContentNotice message="You’re offline. Saved settings are available; account changes need a connection." />
        ) : null}
        {error ? (
          <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={() => void loadSettings()} />
        ) : null}
        {isLoading ? <ContentNotice message="Loading settings…" /> : null}

        <SettingsCard title="Account" icon="person-circle-outline">
          {auth.session ? (
            <>
              <SettingRow
                title="Edit profile"
                subtitle={auth.profile?.display_name ?? auth.session.user.email ?? 'Your account'}
                onPress={() => router.push('/edit-profile')}
                trailing={<Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />}
              />
              <SettingRow
                title="Change password"
                subtitle="Manage your password and account security"
                onPress={() => router.push('/edit-profile')}
                trailing={<Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />}
              />
              <SettingRow
                title="Sign out"
                subtitle="Sign out of this device"
                onPress={signOut}
                trailing={<Ionicons name="log-out-outline" size={18} color={theme.secondaryText} />}
              />
            </>
          ) : (
            <SettingRow
              title="Sign in"
              subtitle="Sign in to manage your account and settings"
              onPress={() => auth.openSignInSheet('sign-in')}
              trailing={<Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />}
            />
          )}
        </SettingsCard>

        <SettingsCard title="Playback" icon="play-circle-outline">
          <SettingRow
            title="Autoplay next episode"
            subtitle="Start the next episode automatically"
            trailing={renderSwitch(
              'Autoplay next episode',
              settings?.autoplayNextEpisode ?? false,
              (enabled) => void updateSettings({ autoplayNextEpisode: enabled }),
            )}
          />
          <View style={styles.divider} />
          <Text style={styles.subsectionTitle}>Default speed</Text>
          <View style={styles.optionList}>
            {DEFAULT_PLAYBACK_SPEEDS.map((speed) => (
              <Pressable
                key={speed}
                accessibilityRole="button"
                accessibilityState={{
                  selected: settings?.defaultPlaybackSpeed === speed,
                  disabled: isLoading || isSaving || !auth.session,
                }}
                disabled={isLoading || isSaving || !auth.session}
                onPress={() => void updateSettings({ defaultPlaybackSpeed: speed })}
                style={[
                  styles.speedOption,
                  settings?.defaultPlaybackSpeed === speed && styles.selectedOption,
                ]}
              >
                <Text
                  style={[
                    styles.speedOptionText,
                    settings?.defaultPlaybackSpeed === speed && styles.selectedOptionText,
                  ]}
                >
                  {getPlayerSpeedLabel(speed)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.divider} />
          <SettingRow
            title="Autoplay trailers"
            subtitle="Start title previews muted"
            trailing={renderSwitch('Autoplay trailers', autoplayTrailers, (enabled) => void changeTrailerAutoplay(enabled))}
          />
        </SettingsCard>

        <SettingsCard title="Downloads" icon="download-outline">
          {downloads.records.length ? (
            <SettingRow
              title="Wi-Fi only"
              subtitle="Prevent downloads over mobile data"
              trailing={renderSwitch(
                'Wi-Fi only downloads',
                settings?.wifiOnlyDownloads ?? false,
                (enabled) => void updateSettings({ wifiOnlyDownloads: enabled }),
              )}
            />
          ) : (
            <Text style={styles.comingSoonText}>Download preferences appear when you have saved downloads.</Text>
          )}
        </SettingsCard>

        <SettingsCard title="Notifications" icon="notifications-outline">
          <SettingRow
            title="New releases"
            subtitle="Coming soon"
            onPress={() => Alert.alert('New release notifications', 'Coming soon')}
            trailing={<Text style={styles.comingSoonLabel}>Coming soon</Text>}
          />
          <View style={styles.divider} />
          <SettingRow
            title="Updates"
            subtitle={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
            onPress={() => router.push('/notifications')}
            trailing={<Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />}
          />
        </SettingsCard>

        <SettingsCard title="Watch options" icon="options-outline">
          <Text style={styles.settingSubtitle}>Choose your preferred way to watch</Text>
          <View style={styles.optionList}>
            {(['streaming', 'download'] as const).map((preference) => (
              <Pressable
                key={preference}
                accessibilityRole="button"
                accessibilityState={{
                  selected: settings?.watchPreference === preference,
                  disabled: isLoading || isSaving || !auth.session,
                }}
                disabled={isLoading || isSaving || !auth.session}
                onPress={() => void updateSettings({ watchPreference: preference })}
                style={[
                  styles.preferenceOption,
                  settings?.watchPreference === preference && styles.selectedOption,
                ]}
              >
                <Text
                  style={[
                    styles.speedOptionText,
                    settings?.watchPreference === preference && styles.selectedOptionText,
                  ]}
                >
                  {preference === 'streaming' ? 'Streaming' : 'Download'}
                </Text>
              </Pressable>
            ))}
          </View>
        </SettingsCard>

        <SettingsCard title="About" icon="information-circle-outline">
          <SettingRow
            title="App version"
            subtitle={Constants.expoConfig?.version ?? 'Unavailable'}
          />
          <View style={styles.divider} />
          <SettingRow
            title="Terms"
            subtitle={termsUrl ? 'Open terms of use' : 'Coming soon'}
            onPress={() => void openExternalPage(termsUrl, 'Terms')}
            trailing={<Ionicons name="open-outline" size={17} color={theme.secondaryText} />}
          />
          <View style={styles.divider} />
          <SettingRow
            title="Privacy"
            subtitle={privacyUrl ? 'Open privacy policy' : 'Coming soon'}
            onPress={() => void openExternalPage(privacyUrl, 'Privacy')}
            trailing={<Ionicons name="open-outline" size={17} color={theme.secondaryText} />}
          />
        </SettingsCard>

        {!auth.session ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => auth.openSignInSheet('sign-in')}
            style={styles.signInButton}
          >
            <Text style={styles.signInButtonText}>Sign in to save your settings</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    marginTop: 10,
    marginBottom: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  headerTitle: { color: theme.text, fontSize: 27, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 30 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 17,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  cardHeading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '800' },
  settingRow: {
    minHeight: 59,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  settingCopy: { flex: 1 },
  settingTitle: { color: theme.text, fontSize: 13, fontWeight: '700' },
  settingSubtitle: { color: theme.secondaryText, fontSize: 12, lineHeight: 17, marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  subsectionTitle: { color: theme.secondaryText, fontSize: 12, fontWeight: '700', marginTop: 13 },
  optionList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  speedOption: {
    minWidth: 48,
    minHeight: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  preferenceOption: {
    minHeight: 40,
    flex: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderWidth: 1,
  },
  selectedOption: { borderColor: theme.accent, backgroundColor: '#1B2A20' },
  speedOptionText: { color: theme.secondaryText, fontSize: 12, fontWeight: '800' },
  selectedOptionText: { color: theme.accent },
  comingSoonText: { color: theme.secondaryText, fontSize: 12, paddingBottom: 14, lineHeight: 17 },
  comingSoonLabel: { color: theme.secondaryText, fontSize: 11, fontWeight: '700' },
  signInButton: {
    minHeight: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    marginTop: 14,
  },
  signInButtonText: { color: theme.accent, fontSize: 13, fontWeight: '800' },
});
