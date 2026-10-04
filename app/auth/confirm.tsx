import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { useAuth } from '../../src/state/AuthContext';
import { supabase } from '../../src/services/supabase';
import { theme } from '../../src/theme';

export default function EmailConfirmationScreen() {
  const { code: routeCode } = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(routeCode) ? routeCode[0] : routeCode;
  const { openSignInSheet } = useAuth();
  const [isChecking, setIsChecking] = useState(Boolean(supabase));
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState<string | undefined>(
    supabase ? undefined : 'Account service is not configured.',
  );

  useEffect(() => {
    const authClient = supabase?.auth;
    if (!authClient) {
      return;
    }
    let active = true;
    const confirmEmail = async () => {
      try {
        if (code) {
          const { error: exchangeError } = await authClient.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }
        const { data, error: sessionError } = await authClient.getSession();
        if (sessionError) {
          throw sessionError;
        }
        if (active) {
          setHasSession(Boolean(data.session));
          setIsChecking(false);
        }
      } catch {
        if (active) {
          setError('This confirmation link is invalid or expired. You can sign in if your email is already confirmed.');
          setIsChecking(false);
        }
      }
    };
    void confirmEmail();
    return () => {
      active = false;
    };
  }, [code]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>Email confirmation</Text>
        {isChecking ? <ContentNotice message="Checking your confirmation link…" /> : null}
        {error ? <ContentNotice message={error} tone="error" /> : null}
        {!isChecking && !error ? (
          <ContentNotice message={hasSession ? 'Your email is confirmed.' : 'Email confirmed. Sign in to continue.'} />
        ) : null}
        {!isChecking ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (hasSession) {
                router.replace('/(tabs)/profile');
              } else {
                openSignInSheet('sign-in');
              }
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{hasSession ? 'Go to profile' : 'Sign in'}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { flex: 1, justifyContent: 'center', gap: 16, padding: 20 },
  title: { color: theme.text, fontSize: 24, fontWeight: '800' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.accent },
  buttonText: { color: theme.background, fontSize: 15, fontWeight: '800' },
});
