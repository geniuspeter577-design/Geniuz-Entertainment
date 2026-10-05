import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { useAuth } from '../../src/state/AuthContext';
import { theme } from '../../src/theme';
import { getProfileInitial } from '../../src/utils/accountAuth';

const quickActions = [
  { label: 'Account', route: '/edit-profile' as const },
  { label: 'Watchlist', route: '/(tabs)/library' as const },
  { label: 'Downloads', route: '/(tabs)/downloads' as const },
  { label: 'Notifications', route: '/notifications' as const },
  { label: 'Settings', route: '/settings' as const },
];

export default function ProfileScreen() {
  const auth = useAuth();
  const [profileMessage, setProfileMessage] = useState<string>();

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

  const copyPublicId = async () => {
    if (auth.profile?.public_id) {
      await Clipboard.setStringAsync(auth.profile.public_id);
      setProfileMessage('Account ID copied.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Profile</Text>

        <View style={styles.profileCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            onPress={() => router.push('/edit-profile')}
            style={styles.avatarButton}
          >
            <View style={styles.avatar}>
              {auth.profile?.avatar_url ? (
                <Image source={{ uri: auth.profile.avatar_url }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{auth.session ? getProfileInitial(auth.profile?.display_name, auth.session.user.email) : 'G+'}</Text>
              )}
            </View>
            <View style={styles.avatarEditBadge}>
              <Ionicons name="pencil" size={12} color={theme.background} />
            </View>
          </Pressable>
          <View style={styles.userInfo}>
            <Text style={styles.name}>{auth.session ? auth.profile?.display_name ?? auth.session.user.email ?? 'Geniuz+ user' : 'Guest profile'}</Text>
            <Text style={styles.handle}>
              {auth.session ? auth.profile?.username ? `@${auth.profile.username}` : 'Geniuz+ account' : 'Browsing as a guest'}
            </Text>
          </View>
        </View>

        {auth.isLoading ? <ContentNotice message="Loading your account…" /> : null}
        {auth.profileError ? <ContentNotice message={auth.profileError} tone="error" /> : null}
        {auth.session && auth.profile ? (
          <View style={styles.profileCard}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Copy account ID ${auth.profile.public_id}`} onPress={() => void copyPublicId()} style={styles.publicIdChip}>
              <Text style={styles.publicIdLabel}>ID</Text>
              <Text style={styles.publicIdValue}>{auth.profile.public_id}</Text>
              <Text style={styles.publicIdCopy}>Copy</Text>
            </Pressable>
            {profileMessage ? <Text style={styles.profileMessage}>{profileMessage}</Text> : null}
            <Pressable accessibilityRole="button" onPress={confirmSignOut} style={styles.signOutButton}>
              <Text style={styles.signOutText}>Log out</Text>
            </Pressable>
          </View>
        ) : !auth.session ? (
          <Pressable accessibilityRole="button" onPress={() => auth.openSignInSheet('sign-in')} style={styles.signInButton}>
            <Text style={styles.signInButtonText}>Sign in / Create account</Text>
          </Pressable>
        ) : null}

        <View style={styles.planCard}>
          <Text style={styles.planLabel}>Geniuz+ membership</Text>
          <Text style={styles.planMeta}>Subscription management is not connected.</Text>
          <View style={[styles.planButton, styles.disabledPlanButton]}>
            <Text style={styles.planButtonText}>Coming soon</Text>
          </View>
        </View>

        {auth.isAdmin ? <Pressable
          accessibilityRole="button"
          style={styles.adminAction}
          onPress={() => router.push('/admin')}
        >
          <Text style={styles.adminTitle}>Admin dashboard</Text>
          <Text style={styles.adminDescription}>Manage titles, uploads and system status.</Text>
        </Pressable> : null}
        <View style={styles.grid}>
          {quickActions.map(({ label, route }) => (
            <Pressable
              key={label}
              style={styles.actionCard}
              accessibilityRole="button"
              onPress={() => {
                if (label === 'Account' && !auth.session) {
                  auth.openSignInSheet('sign-in');
                  return;
                }
                router.push(route);
              }}
            >
              <Text style={styles.actionText}>{label}</Text>
            </Pressable>
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
  avatarButton: { position: 'relative', alignSelf: 'flex-start' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 32 },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
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
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.surface,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 22,
  },
  userInfo: {
    marginLeft: 16,
  },
  name: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  handle: {
    color: theme.secondaryText,
    fontSize: 13,
    marginTop: 4,
  },
  planCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginBottom: 18,
  },
  planLabel: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  planMeta: {
    color: theme.secondaryText,
    fontSize: 13,
    marginBottom: 14,
  },
  planButton: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
  },
  planButtonText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 13,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  adminAction: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 18,
  },
  adminTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 5,
  },
  adminDescription: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
  },
  actionCard: {
    width: '48%',
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  actionText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 15,
  },
  signInButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
    borderRadius: 8,
    marginBottom: 18,
    paddingHorizontal: 16,
  },
  signInButtonText: { color: theme.background, fontSize: 15, fontWeight: '800' },
  disabledPlanButton: { opacity: 0.55 },
  editNameButton: { minHeight: 44, justifyContent: 'center' },
  editNameText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
  publicIdChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, paddingHorizontal: 12, marginTop: 6 },
  publicIdLabel: { color: theme.secondaryText, fontSize: 12, fontWeight: '700' },
  publicIdValue: { color: theme.text, fontSize: 14, fontWeight: '800' },
  publicIdCopy: { color: theme.accent, fontSize: 12, fontWeight: '800' },
  profileMessage: { color: theme.secondaryText, fontSize: 13, marginTop: 8 },
  signOutButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8 },
  signOutText: { color: theme.error, fontWeight: '700' },
});
