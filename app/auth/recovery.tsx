import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../../src/components/ContentNotice';
import { supabase } from '../../src/services/supabase';
import { theme } from '../../src/theme';
import { KeyboardAwareScrollView, KeyboardAwareTextInput } from '../../src/components/KeyboardAwareScrollView';
import { getFriendlyAuthError } from '../../src/utils/accountAuth';
import { backOrReplace } from '../../src/utils/navigation';

export default function PasswordRecoveryScreen() {
  const { code: routeCode } = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(routeCode) ? routeCode[0] : routeCode;
  const [isReady, setIsReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(
    supabase ? undefined : 'Account service is not configured.',
  );
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const authClient = supabase?.auth;
    if (!authClient) {
      return;
    }
    let active = true;
    const establishRecoverySession = async () => {
      try {
        if (code) {
          const { error: exchangeError } = await authClient.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }
        const { data, error: sessionError } = await authClient.getSession();
        if (sessionError || !data.session) {
          throw sessionError ?? new Error('The recovery link is invalid or expired.');
        }
        if (active) {
          setIsReady(true);
          setError(undefined);
        }
      } catch {
        if (active) {
          setError('This password reset link is invalid or expired. Request a new reset link and try again.');
        }
      }
    };
    void establishRecoverySession();
    return () => {
      active = false;
    };
  }, [code]);

  const savePassword = async () => {
    setError(undefined);
    setMessage(undefined);
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!supabase) {
      setError('Account service is not configured.');
      return;
    }
    setIsSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        throw updateError;
      }
      setMessage('Password updated. You can now use your new password.');
      setPassword('');
      setConfirmPassword('');
    } catch (updateError) {
      const friendlyError = getFriendlyAuthError(updateError);
      setError(friendlyError === 'Your account request could not be completed. Check your details and try again.'
        ? 'Your password could not be updated. The reset link may have expired; request a new one and retry.'
        : friendlyError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => backOrReplace('/')} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Reset password</Text>
        {error ? <ContentNotice message={error} tone="error" /> : null}
        {message ? <ContentNotice message={message} tone="warning" /> : null}
        {isReady ? (
          <View style={styles.form}>
            <KeyboardAwareTextInput
              accessibilityLabel="New password"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              placeholder="New password"
              placeholderTextColor={theme.secondaryText}
              style={styles.input}
            />
            <Text style={styles.passwordHint}>Use at least 8 characters.</Text>
            <KeyboardAwareTextInput
              accessibilityLabel="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              placeholder="Confirm new password"
              placeholderTextColor={theme.secondaryText}
              style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => void savePassword()} style={[styles.button, isSaving && styles.disabled]}>
              <Text style={styles.buttonText}>{isSaving ? 'Saving…' : 'Save new password'}</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  content: { flex: 1, padding: 18, gap: 16 },
  backButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8 },
  backText: { color: theme.accent, fontSize: 15, fontWeight: '700' },
  title: { color: theme.text, fontSize: 25, fontWeight: '800' },
  form: { gap: 12 },
  passwordHint: { color: theme.secondaryText, fontSize: 12 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, color: theme.text, paddingHorizontal: 14 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.accent },
  disabled: { opacity: 0.55 },
  buttonText: { color: theme.background, fontSize: 15, fontWeight: '800' },
});
