import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import type { AppNotification } from '../../src/services/NotificationsStore';
import { loadNotifications } from '../../src/services/NotificationsStore';
import { useAuth } from '../../src/state/AuthContext';
import { useLibrary } from '../../src/state/LibraryContext';
import { theme } from '../../src/theme';
import { getProfileInitial } from '../../src/utils/accountAuth';
import { getMeScreenData, getShortPublicId } from '../../src/utils/meScreen';

const officialSiteUrl = process.env.EXPO_PUBLIC_OFFICIAL_SITE_URL?.trim();

type MeRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  trailing?: React.ReactNode;
};

function MeRow({ icon, title, subtitle, onPress, trailing }: MeRowProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={theme.accent} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {trailing ?? <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const auth = useAuth();
  const library = useLibrary();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationError, setNotificationError] = useState<string>();
  const [profileMessage, setProfileMessage] = useState<string>();
  const meData = getMeScreenData(library, notifications);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setNotificationsLoading(true);
      void loadNotifications()
        .then((items) => {
          if (active) {
            setNotifications(items);
            setNotificationError(undefined);
            setNotificationsLoading(false);
          }
        })
        .catch((error: unknown) => {
          console.error('[Me] Could not load unread message count.', error);
          if (active) {
            setNotificationError('Your unread message count could not be loaded.');
            setNotificationsLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const openEditProfile = () => {
    if (auth.session) {
      router.push('/edit-profile');
    } else {
      auth.openSignInSheet('sign-in');
    }
  };

  const copyPublicId = async () => {
    if (!auth.profile?.public_id) {
      return;
    }
    try {
      await Clipboard.setStringAsync(auth.profile.public_id);
      setProfileMessage('User ID copied.');
    } catch (error) {
      console.error('[Me] Could not copy user ID.', error);
      Alert.alert('Copy failed', 'Your user ID could not be copied. Please try again.');
    }
  };

  const openOfficialSite = async () => {
    if (!officialSiteUrl) {
      Alert.alert('Official site', 'Coming soon');
      return;
    }
    try {
      const parsedUrl = new URL(officialSiteUrl);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('The official site address must use HTTP or HTTPS.');
      }
      await Linking.openURL(parsedUrl.toString());
    } catch (error) {
      console.error('[Me] Could not open the official site.', error);
      Alert.alert(
        'Could not open official site',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  };

  const showComingSoon = (feature: string) => {
    Alert.alert(feature, 'Coming soon');
  };

  const displayName = auth.session
    ? auth.profile?.display_name || auth.session.user.email || 'Geniuz+ user'
    : 'Sign in';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Text style={styles.header}>Me</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings, coming soon"
            onPress={() => showComingSoon('Settings')}
            style={styles.settingsButton}
          >
            <Ionicons name="settings-outline" size={21} color={theme.text} />
          </Pressable>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={auth.session ? 'Edit profile' : 'Sign in'}
              onPress={openEditProfile}
              style={styles.avatar}
            >
              {auth.profile?.avatar_url ? (
                <Image source={{ uri: auth.profile.avatar_url }} style={styles.avatarImage} />
              ) : auth.session ? (
                <Text style={styles.avatarText}>
                  {getProfileInitial(auth.profile?.display_name, auth.session.user.email)}
                </Text>
              ) : (
                <Ionicons name="person" size={25} color={theme.background} />
              )}
            </Pressable>
            <View style={styles.userInfo}>
              <Pressable accessibilityRole="button" onPress={openEditProfile}>
                <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              </Pressable>
              {!auth.session ? (
                <Text style={styles.profileHint}>Save your list and progress</Text>
              ) : null}
              {auth.profile?.public_id ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Copy user ID ${auth.profile.public_id}`}
                  onPress={() => void copyPublicId()}
                  style={styles.userIdChip}
                >
                  <Text style={styles.userIdText}>{getShortPublicId(auth.profile.public_id)}</Text>
                  <Ionicons name="copy-outline" size={13} color={theme.secondaryText} />
                </Pressable>
              ) : auth.session ? (
                <Text style={styles.profileHint}>
                  {auth.isLoading ? 'Loading user ID…' : 'User ID unavailable'}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={auth.session ? 'Edit profile' : 'Sign in'}
              onPress={openEditProfile}
              style={styles.editButton}
            >
              <Ionicons name="chevron-forward" size={21} color={theme.secondaryText} />
            </Pressable>
          </View>
          {profileMessage ? <Text style={styles.profileMessage}>{profileMessage}</Text> : null}
        </View>

        {auth.isLoading ? <ContentNotice message="Loading your account…" /> : null}
        {auth.profileError ? <ContentNotice message={auth.profileError} tone="error" /> : null}
        {notificationError ? <ContentNotice message={notificationError} tone="error" /> : null}
        {library.error ? (
          <ContentNotice
            message={library.error}
            tone="error"
            actionLabel="Retry"
            onAction={library.retryLoad}
          />
        ) : null}

        <View style={styles.section}>
          <MeRow
            icon="globe-outline"
            title="Official site"
            subtitle={officialSiteUrl ? 'Visit our official site' : 'Coming soon'}
            onPress={() => void openOfficialSite()}
          />
        </View>

        {/* TODO: Keep this visual-only until membership and payment requirements are defined. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Member card, coming soon"
          onPress={() => showComingSoon('Membership')}
          style={styles.memberCard}
        >
          <View style={styles.memberTopLine}>
            <Ionicons name="star" size={18} color={theme.gold} />
            <Text style={styles.memberEyebrow}>MEMBER</Text>
          </View>
          <Text style={styles.memberTitle}>Geniuz+ membership</Text>
          <Text style={styles.memberSubtitle}>Membership benefits are coming soon.</Text>
        </Pressable>

        <View style={styles.historySection}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/library')}
            style={styles.sectionHeadingRow}
          >
            <Text style={styles.sectionHeading}>Watch History</Text>
            <Ionicons name="chevron-forward" size={19} color={theme.secondaryText} />
          </Pressable>
          {library.isLoading ? (
            <Text style={styles.emptyText}>Loading your watch history…</Text>
          ) : meData.watchHistory.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyStrip}
            >
              {meData.watchHistory.map(({ item, progress }) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Continue watching ${item.title}, ${progress}% complete`}
                  onPress={() => router.push({ pathname: '/watch/[id]', params: { id: item.id } })}
                  style={styles.historyItem}
                >
                  {item.posterUrl ? (
                    <Image source={{ uri: item.posterUrl }} style={styles.poster} resizeMode="cover" />
                  ) : (
                    <View style={[styles.poster, styles.posterPlaceholder]}>
                      <Ionicons name="film-outline" size={24} color={theme.secondaryText} />
                    </View>
                  )}
                  <Text style={styles.historyTitle} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progress}%` }]} />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.emptyText}>Your watch history will appear here.</Text>
          )}
        </View>

        <View style={styles.section}>
          <MeRow
            icon="bookmark-outline"
            title="My List"
            subtitle="Your saved titles"
            onPress={() => router.push('/(tabs)/library')}
            trailing={<Text style={styles.count}>{meData.myListCount}</Text>}
          />
        </View>

        <View style={styles.section}>
          <MeRow
            icon="chatbubble-ellipses-outline"
            title="Messages"
            subtitle={notificationsLoading ? 'Loading messages…' : 'Notifications and updates'}
            onPress={() => router.push('/notifications')}
            trailing={
              meData.unreadMessagesCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{meData.unreadMessagesCount}</Text>
                </View>
              ) : undefined
            }
          />
        </View>

        <View style={styles.section}>
          <MeRow
            icon="swap-horizontal-outline"
            title="Transfer"
            subtitle="Coming soon"
            onPress={() => showComingSoon('Transfer')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: 18, paddingBottom: 32 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 14,
  },
  header: { color: theme.text, fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  settingsButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 14,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: theme.background, fontWeight: '800', fontSize: 22 },
  userInfo: { flex: 1, minWidth: 0, marginLeft: 13 },
  name: { color: theme.text, fontSize: 17, fontWeight: '800' },
  userIdChip: {
    alignSelf: 'flex-start',
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.background,
    paddingHorizontal: 9,
    marginTop: 7,
  },
  userIdText: { color: theme.secondaryText, fontSize: 11, fontWeight: '700' },
  profileHint: { color: theme.secondaryText, fontSize: 12, marginTop: 6 },
  editButton: { minWidth: 36, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  profileMessage: { color: theme.secondaryText, fontSize: 12, marginTop: 8 },
  section: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  row: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  rowSubtitle: { color: theme.secondaryText, fontSize: 12, marginTop: 4 },
  memberCard: {
    backgroundColor: theme.surface,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.gold,
    padding: 17,
    marginBottom: 14,
  },
  memberTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  memberEyebrow: { color: theme.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  memberTitle: { color: theme.gold, fontSize: 19, fontWeight: '800' },
  memberSubtitle: { color: theme.secondaryText, fontSize: 12, marginTop: 5 },
  historySection: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeadingRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  sectionHeading: { color: theme.text, fontSize: 15, fontWeight: '800' },
  historyStrip: { paddingHorizontal: 14, paddingBottom: 14, gap: 11 },
  historyItem: { width: 92 },
  poster: { width: 92, height: 122, borderRadius: 9, backgroundColor: theme.background },
  posterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  historyTitle: { color: theme.text, fontSize: 11, fontWeight: '700', marginTop: 7 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.surfaceSoft,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: theme.accent },
  emptyText: { color: theme.secondaryText, fontSize: 12, paddingHorizontal: 14, paddingBottom: 15 },
  count: { color: theme.text, fontSize: 14, fontWeight: '800', paddingHorizontal: 8 },
  unreadBadge: {
    minWidth: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: '#E5484D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
});
