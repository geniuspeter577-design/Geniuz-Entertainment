import { Ionicons } from '@expo/vector-icons';
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
import { getMeScreenData } from '../../src/utils/meScreen';

type MeRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
};

function MeRow({ icon, title, subtitle, onPress, trailing }: MeRowProps) {
  const content = (
    <>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={theme.accent} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} /> : null)}
    </>
  );

  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.row}>{content}</View>
  );
}

export default function ProfileScreen() {
  const auth = useAuth();
  const library = useLibrary();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationError, setNotificationError] = useState<string>();
  const [profileMessage, setProfileMessage] = useState<string>();
  const meData = getMeScreenData(library, notifications);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadNotifications()
        .then((items) => {
          if (active) {
            setNotifications(items);
            setNotificationError(undefined);
          }
        })
        .catch((error: unknown) => {
          console.error('[Me] Could not load unread message count.', error);
          if (active) {
            setNotificationError('Your unread message count could not be loaded.');
          }
        });
      return () => {
        active = false;
      };
    }, []),
  );

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

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can sign in again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void auth.signOut().catch((error: unknown) => {
          Alert.alert('Sign out failed', error instanceof Error ? error.message : 'Please try again.');
        }),
      },
    ]);
  };

  const displayName = auth.profile?.display_name || auth.session?.user.email || 'Guest profile';
  const userIdLabel = auth.profile?.public_id
    ? `ID  ${auth.profile.public_id}`
    : auth.session
      ? auth.isLoading
        ? 'Loading user ID…'
        : 'User ID unavailable'
      : 'Sign in for your user ID';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Me</Text>

        <View style={styles.profileCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            onPress={() => router.push('/edit-profile')}
            style={styles.profileHeader}
          >
            <View style={styles.avatar}>
              {auth.profile?.avatar_url ? (
                <Image source={{ uri: auth.profile.avatar_url }} style={styles.avatarImage} />
              ) : auth.session ? (
                <Text style={styles.avatarText}>
                  {getProfileInitial(auth.profile?.display_name, auth.session.user.email)}
                </Text>
              ) : (
                <Ionicons name="person" size={26} color={theme.background} />
              )}
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.editHint}>Edit profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={auth.profile?.public_id ? `Copy user ID ${auth.profile.public_id}` : userIdLabel}
            disabled={!auth.profile?.public_id}
            onPress={() => void copyPublicId()}
            style={styles.userIdChip}
          >
            <Text style={styles.userIdText}>{userIdLabel}</Text>
            {auth.profile?.public_id ? (
              <Ionicons name="copy-outline" size={14} color={theme.secondaryText} />
            ) : null}
          </Pressable>
          {profileMessage ? <Text style={styles.profileMessage}>{profileMessage}</Text> : null}
        </View>

        {auth.isLoading ? <ContentNotice message="Loading your account…" /> : null}
        {auth.profileError ? <ContentNotice message={auth.profileError} tone="error" /> : null}
        {notificationError ? <ContentNotice message={notificationError} tone="error" /> : null}
        {library.error ? (
          <ContentNotice message={library.error} tone="error" actionLabel="Retry" onAction={library.retryLoad} />
        ) : null}

        <View style={styles.section}>
          <MeRow
            icon="globe-outline"
            title="Official site"
            subtitle="Coming soon"
          />
        </View>

        {/* TODO: Connect membership status and billing only after product/payment requirements are provided. */}
        <View style={styles.memberCard}>
          <View style={styles.memberTopLine}>
            <Ionicons name="star" size={18} color={theme.gold} />
            <Text style={styles.memberEyebrow}>MEMBER</Text>
          </View>
          <Text style={styles.memberTitle}>Geniuz+ membership</Text>
          <Text style={styles.memberSubtitle}>Membership benefits are coming soon.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Watch History</Text>
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
                  <Image
                    source={item.posterUrl ? { uri: item.posterUrl } : require('../../assets/icon.png')}
                    style={styles.poster}
                    resizeMode="cover"
                  />
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
            subtitle="Notifications and updates"
            onPress={() => router.push('/notifications')}
            trailing={
              meData.unreadMessagesCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{meData.unreadMessagesCount}</Text>
                </View>
              ) : null
            }
          />
        </View>

        <View style={styles.section}>
          <MeRow
            icon="swap-horizontal-outline"
            title="Transfer"
            subtitle="Coming soon"
          />
        </View>

        <View style={styles.footerActions}>
          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/downloads')} style={styles.footerButton}>
            <Ionicons name="download-outline" size={18} color={theme.secondaryText} />
            <Text style={styles.footerButtonText}>Downloads</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={styles.footerButton}>
            <Ionicons name="settings-outline" size={18} color={theme.secondaryText} />
            <Text style={styles.footerButtonText}>Settings</Text>
          </Pressable>
          {auth.session ? (
            <Pressable accessibilityRole="button" onPress={confirmSignOut} style={styles.footerButton}>
              <Ionicons name="log-out-outline" size={18} color={theme.error} />
              <Text style={styles.signOutText}>Log out</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => auth.openSignInSheet('sign-in')} style={styles.footerButton}>
              <Ionicons name="log-in-outline" size={18} color={theme.accent} />
              <Text style={styles.footerButtonText}>Sign in</Text>
            </Pressable>
          )}
        </View>

        {auth.isAdmin ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/admin')} style={styles.adminAction}>
            <Text style={styles.adminTitle}>Admin dashboard</Text>
            <Text style={styles.adminDescription}>Manage titles, uploads and system status.</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  header: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 20,
    letterSpacing: -0.9,
  },
  profileCard: {
    backgroundColor: theme.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 18,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: theme.background, fontWeight: '800', fontSize: 22 },
  userInfo: { flex: 1, minWidth: 0, marginLeft: 14, marginRight: 8 },
  name: { color: theme.text, fontSize: 19, fontWeight: '800' },
  editHint: { color: theme.secondaryText, fontSize: 13, marginTop: 4 },
  userIdChip: {
    minHeight: 34,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.background,
    paddingHorizontal: 12,
    marginTop: 14,
  },
  userIdText: { color: theme.secondaryText, fontSize: 12, fontWeight: '700' },
  profileMessage: { color: theme.secondaryText, fontSize: 12, marginTop: 8 },
  section: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 14,
    overflow: 'hidden',
  },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  rowSubtitle: { color: theme.secondaryText, fontSize: 12, marginTop: 4 },
  memberCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.gold,
    padding: 18,
    marginBottom: 18,
  },
  memberTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  memberEyebrow: { color: theme.gold, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  memberTitle: { color: theme.gold, fontSize: 20, fontWeight: '800' },
  memberSubtitle: { color: theme.secondaryText, fontSize: 13, marginTop: 6 },
  sectionHeading: { color: theme.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 14, paddingTop: 14 },
  historyStrip: { padding: 14, gap: 12 },
  historyItem: { width: 96 },
  poster: { width: 96, height: 128, borderRadius: 10, backgroundColor: theme.surfaceAlt },
  historyTitle: { color: theme.text, fontSize: 12, fontWeight: '700', marginTop: 7 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: theme.surfaceSoft, overflow: 'hidden', marginTop: 6 },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: theme.accent },
  emptyText: { color: theme.secondaryText, fontSize: 13, padding: 14 },
  count: { color: theme.text, fontSize: 15, fontWeight: '800', paddingHorizontal: 8 },
  unreadBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  unreadBadgeText: { color: theme.background, fontSize: 12, fontWeight: '900' },
  footerActions: { gap: 8, paddingVertical: 8 },
  footerButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  footerButtonText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  signOutText: { color: theme.error, fontSize: 14, fontWeight: '700' },
  adminAction: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginTop: 8,
  },
  adminTitle: { color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 5 },
  adminDescription: { color: theme.secondaryText, fontSize: 13, lineHeight: 19 },
});
