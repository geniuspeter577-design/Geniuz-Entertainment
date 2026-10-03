import React, { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { useAuth } from '../../src/state/AuthContext';
import { supabase } from '../../src/services/supabase';
import { theme } from '../../src/theme';
import { isAdminMetadata } from '../../src/utils/adminAccess';
import { getProfileInitial } from '../../src/utils/accountAuth';

const quickActions = ['Account', 'Watchlist', 'Downloads', 'Notifications', 'Settings'];

export default function ProfileScreen() {
  const auth = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const tapCount = useRef(0);
  const [editingName, setEditingName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState<string>();
  const displayName = displayNameDraft ?? auth.profile?.display_name ?? '';
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string>();

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setIsAdmin(isAdminMetadata(session?.user.app_metadata));
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        throw error;
      }
      if (active) {
        setIsAdmin(isAdminMetadata(data.session?.user.app_metadata));
      }
    }).catch((error: unknown) => {
      console.error('[Profile] Could not check the current session.', error);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleAvatarPress = () => {
    tapCount.current += 1;
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      router.push({ pathname: '/admin', params: { signin: '1' } });
    }
  };

  const saveDisplayName = async () => {
    setProfileBusy(true);
    setProfileMessage(undefined);
    try {
      await auth.updateDisplayName(displayName);
      setEditingName(false);
      setDisplayNameDraft(undefined);
      setProfileMessage('Display name saved.');
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Display name could not be saved. Retry.');
    } finally {
      setProfileBusy(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can sign in again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void auth.signOut() },
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
            accessibilityLabel="Geniuz+ profile avatar"
            onPress={handleAvatarPress}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{auth.session ? getProfileInitial(auth.profile?.display_name, auth.session.user.email) : 'G+'}</Text>
          </Pressable>
          <View style={styles.userInfo}>
            <Text style={styles.name}>{auth.session ? auth.profile?.display_name ?? auth.session.user.email ?? 'Geniuz+ user' : 'Guest profile'}</Text>
            <Text style={styles.handle}>{auth.session ? 'Geniuz+ account' : 'Browsing as a guest'}</Text>
          </View>
        </View>

        {auth.isLoading ? <ContentNotice message="Loading your account…" /> : null}
        {auth.profileError ? <ContentNotice message={auth.profileError} tone="error" /> : null}
        {auth.session && auth.profile ? (
          <View style={styles.profileCard}>
            {editingName ? (
              <View style={styles.editNameWrap}>
                <TextInput
                  accessibilityLabel="Display name"
                  value={displayName}
                  onChangeText={setDisplayNameDraft}
                  maxLength={80}
                  placeholder="Display name"
                  placeholderTextColor={theme.secondaryText}
                  style={styles.nameInput}
                />
                <Pressable accessibilityRole="button" disabled={profileBusy} onPress={() => void saveDisplayName()} style={styles.smallPrimaryButton}>
                  <Text style={styles.smallPrimaryText}>{profileBusy ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit display name" onPress={() => { setDisplayNameDraft(auth.profile?.display_name ?? ''); setEditingName(true); }} style={styles.editNameButton}>
                <Text style={styles.editNameText}>Edit display name</Text>
              </Pressable>
            )}
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
          <View style={styles.planButton}>
            <Text style={styles.planButtonText}>Not available yet</Text>
          </View>
        </View>

        {isAdmin || auth.isAdmin ? <Pressable
          accessibilityRole="button"
          style={styles.adminAction}
          onPress={() => router.push('/admin')}
        >
          <Text style={styles.adminTitle}>Admin console</Text>
          <Text style={styles.adminDescription}>Sign in to manage and upload your licensed movies.</Text>
        </Pressable> : null}
        <View style={styles.grid}>
          {quickActions.map((label) => (
            <Pressable
              key={label}
              style={styles.actionCard}
              disabled={label !== 'Settings' && label !== 'Notifications'}
              accessibilityRole="button"
              accessibilityState={{ disabled: label !== 'Settings' && label !== 'Notifications' }}
              onPress={() => {
                if (label === 'Settings') {
                  router.push('/settings');
                }
                if (label === 'Notifications') {
                  router.push('/notifications');
                }
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
  editNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  nameInput: { minHeight: 44, flex: 1, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, color: theme.text, paddingHorizontal: 12 },
  smallPrimaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.accent },
  smallPrimaryText: { color: theme.background, fontWeight: '800' },
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
