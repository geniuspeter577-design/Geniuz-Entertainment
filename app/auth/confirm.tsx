import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { KeyboardAwareScrollView, KeyboardAwareTextInput } from '../../src/components/KeyboardAwareScrollView';
import { useAuth } from '../../src/state/AuthContext';
import { supabase } from '../../src/services/supabase';
import { theme } from '../../src/theme';

export default function EmailConfirmationScreen() {
  const { code: routeCode } = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(routeCode) ? routeCode[0] : routeCode;
  const { openSignInSheet, completeDateOfBirth } = useAuth();
  const [isChecking, setIsChecking] = useState(Boolean(supabase));
  const [hasSession, setHasSession] = useState(false);
  const [needsDateOfBirth, setNeedsDateOfBirth] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [isSavingDateOfBirth, setIsSavingDateOfBirth] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string | undefined>(
    supabase ? undefined : 'Account service is not configured.',
  );

  useEffect(() => {
    const supabaseClient = supabase;
    const authClient = supabaseClient?.auth;
    if (!authClient || !supabaseClient) {
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
          if (data.session) {
            const { data: profile, error: profileError } = await supabaseClient
              .from('profiles')
              .select('date_of_birth')
              .eq('id', data.session.user.id)
              .maybeSingle();
            if (profileError) {
              throw profileError;
            }
            const profileRecord = profile as { date_of_birth?: string | null } | null;
            setNeedsDateOfBirth(!profileRecord?.date_of_birth);
          }
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

  const saveDateOfBirth = async () => {
    setIsSavingDateOfBirth(true);
    setError(undefined);
    try {
      await completeDateOfBirth(dateOfBirth);
      setNeedsDateOfBirth(false);
      setMessage('Your profile is complete.');
    } catch (dateError) {
      setError(dateError instanceof Error ? dateError.message : 'Your date of birth could not be saved.');
    } finally {
      setIsSavingDateOfBirth(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Email confirmation</Text>
        {isChecking ? <ContentNotice message="Checking your confirmation link…" /> : null}
        {error ? <ContentNotice message={error} tone="error" /> : null}
        {!isChecking && !error && !needsDateOfBirth ? (
          <ContentNotice message={hasSession ? 'Your email is confirmed.' : 'Email confirmed. Sign in to continue.'} />
        ) : null}
        {!isChecking && !error && needsDateOfBirth ? (
          <View style={styles.form}>
            <Text style={styles.helper}>Enter your date of birth to finish setting up your Google account.</Text>
            <KeyboardAwareTextInput
              accessibilityLabel="Date of birth"
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.secondaryText}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={isSavingDateOfBirth} onPress={() => void saveDateOfBirth()} style={styles.button}>
              <Text style={styles.buttonText}>{isSavingDateOfBirth ? 'Saving…' : 'Complete profile'}</Text>
            </Pressable>
          </View>
        ) : null}
        {message ? <ContentNotice message={message} /> : null}
        {!isChecking ? (
          <Pressable
            accessibilityRole="button"
            disabled={needsDateOfBirth || isSavingDateOfBirth}
            onPress={() => {
              if (hasSession) {
                router.replace('/(tabs)/profile');
              } else {
                openSignInSheet('sign-in');
              }
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{needsDateOfBirth ? 'Complete your profile first' : hasSession ? 'Go to profile' : 'Sign in'}</Text>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { flex: 1, justifyContent: 'center', gap: 16, padding: 20 },
  form: { gap: 10 },
  helper: { color: theme.secondaryText, fontSize: 13, lineHeight: 18 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, color: theme.text, paddingHorizontal: 14 },
  title: { color: theme.text, fontSize: 24, fontWeight: '800' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.accent },
  buttonText: { color: theme.background, fontSize: 15, fontWeight: '800' },
});
