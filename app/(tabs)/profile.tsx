import React, { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { supabase } from '../../src/services/supabase';
import { theme } from '../../src/theme';
import { isAdminMetadata } from '../../src/utils/adminAccess';

const quickActions = ['Account', 'Watchlist', 'Downloads', 'Notifications', 'Settings'];

export default function ProfileScreen() {
  const [isAdmin, setIsAdmin] = useState(false);
  const tapCount = useRef(0);

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
            <Text style={styles.avatarText}>G+</Text>
          </Pressable>
          <View style={styles.userInfo}>
            <Text style={styles.name}>Guest profile</Text>
            <Text style={styles.handle}>Sign-in is not connected</Text>
          </View>
        </View>

        <View style={styles.planCard}>
          <Text style={styles.planLabel}>Geniuz+ membership</Text>
          <Text style={styles.planMeta}>Subscription management is not connected.</Text>
          <View style={styles.planButton}>
            <Text style={styles.planButtonText}>Not available yet</Text>
          </View>
        </View>

        <ContentNotice message="Profile actions will be available when Geniuz+ account services are connected." />
        {isAdmin ? <Pressable
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
});
