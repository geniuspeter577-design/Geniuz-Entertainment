import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardAwareTextInput } from '../KeyboardAwareScrollView';

import { useAuth } from '../../state/AuthContext';
import { theme } from '../../theme';
import { isValidDateOfBirth } from '../../utils/accountProfile';

export type SignInSheetMode = 'sign-in' | 'create-account' | 'reset-password';

type Props = {
  visible: boolean;
  initialMode: SignInSheetMode;
  onClose: () => void;
};

export function SignInToContinueSheet({ visible, initialMode, onClose }: Props) {
  const { signIn, signUp, signInWithGoogle, completeDateOfBirth, resetPassword, resendConfirmation } = useAuth();
  const [mode, setMode] = useState<SignInSheetMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [googleNeedsDateOfBirth, setGoogleNeedsDateOfBirth] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const switchMode = (next: SignInSheetMode) => {
    setMode(next);
    setError(undefined);
    setMessage(undefined);
  };

  const resendEmailConfirmation = async () => {
    if (!email.trim()) {
      setError('Enter your email address to resend the confirmation link.');
      return;
    }
    setError(undefined);
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      await resendConfirmation(email);
      setMessage('A new confirmation email has been sent.');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Could not resend the confirmation email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWithGoogle = async () => {
    setError(undefined);
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      const result = await signInWithGoogle();
      if (result.cancelled) {
        setMessage('Google sign-in was cancelled.');
        return;
      }
      if (result.needsDateOfBirth) {
        if (isValidDateOfBirth(dateOfBirth)) {
          await completeDateOfBirth(dateOfBirth);
          onClose();
          return;
        }
        setGoogleNeedsDateOfBirth(true);
        setMessage('Enter your date of birth to finish setting up your account.');
        return;
      }
      onClose();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Google sign-in could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveGoogleDateOfBirth = async () => {
    setError(undefined);
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      await completeDateOfBirth(dateOfBirth);
      onClose();
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : 'Your date of birth could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = async () => {
    setError(undefined);
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      if (mode === 'create-account') {
        if (displayName.trim().length < 1 || displayName.trim().length > 80) {
          throw new Error('Display name must be between 1 and 80 characters.');
        }
        const result = await signUp(email, password, displayName, dateOfBirth);
        if (result.hasSession) {
          onClose();
        } else {
          setMode('sign-in');
          setError(undefined);
          setMessage('Check your email to confirm your account, then sign in.');
        }
      } else if (mode === 'reset-password') {
        await resetPassword(email);
        setMessage('If an account uses this email, a password reset link is on its way.');
      } else {
        await signIn(email, password);
        onClose();
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Account request failed. Retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close sign in" onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView pointerEvents="box-none" style={styles.safeArea}>
          <KeyboardAwareScrollView
            contentContainerStyle={styles.sheet}
            keyboardAvoidingViewStyle={styles.sheetKeyboardContainer}
            style={styles.sheetScrollView}
          >
            <View style={styles.header}>
              <View style={styles.titleWrap}>
                <Text style={styles.title}>Sign in to continue</Text>
                <Text style={styles.subtitle}>Your watchlist and profile stay with your account.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            {mode === 'create-account' ? (
              <KeyboardAwareTextInput
                accessibilityLabel="Display name"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                maxLength={80}
                placeholder="Display name"
                placeholderTextColor={theme.secondaryText}
                style={styles.input}
              />
            ) : null}
            {mode === 'create-account' || googleNeedsDateOfBirth ? (
              <KeyboardAwareTextInput
                accessibilityLabel="Date of birth"
                value={dateOfBirth}
                onChangeText={setDateOfBirth}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                placeholder="Date of birth (YYYY-MM-DD)"
                placeholderTextColor={theme.secondaryText}
                style={styles.input}
              />
            ) : null}
            <KeyboardAwareTextInput
              accessibilityLabel="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email address"
              placeholderTextColor={theme.secondaryText}
              style={styles.input}
            />
            {mode !== 'reset-password' ? (
              <>
                <KeyboardAwareTextInput
                  accessibilityLabel="Password"
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoComplete={mode === 'create-account' ? 'new-password' : 'password'}
                  secureTextEntry
                  placeholder="Password"
                  placeholderTextColor={theme.secondaryText}
                  style={styles.input}
                />
                {mode === 'create-account' ? (
                  <Text style={styles.passwordHint}>Use at least 8 characters.</Text>
                ) : null}
              </>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            {googleNeedsDateOfBirth ? (
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void saveGoogleDateOfBirth()}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>{isSubmitting ? 'Saving…' : 'Complete account'}</Text>
              </Pressable>
            ) : null}
            {error?.toLowerCase().includes('confirm your email') ? (
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting || !email.trim()}
                onPress={() => void resendEmailConfirmation()}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>{isSubmitting ? 'Sending…' : 'Resend confirmation'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || !email.trim() || (mode !== 'reset-password' && !password)}
              onPress={() => void submit()}
              style={[styles.primaryButton, (isSubmitting || !email.trim() || (mode !== 'reset-password' && !password)) && styles.disabledButton]}
            >
              <Text style={styles.primaryText}>
                {isSubmitting ? 'Please wait…' : mode === 'create-account' ? 'Create account' : mode === 'reset-password' ? 'Send reset link' : 'Sign in'}
              </Text>
            </Pressable>
            {!googleNeedsDateOfBirth && mode !== 'reset-password' ? (
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void continueWithGoogle()}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>{isSubmitting ? 'Connecting…' : 'Continue with Google'}</Text>
              </Pressable>
            ) : null}
            {mode === 'sign-in' ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => switchMode('create-account')} style={styles.linkButton}>
                  <Text style={styles.linkText}>Create account</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => switchMode('reset-password')} style={styles.linkButton}>
                  <Text style={styles.linkText}>Forgot password?</Text>
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => switchMode('sign-in')} style={styles.linkButton}>
                <Text style={styles.linkText}>Back to sign in</Text>
              </Pressable>
            )}
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.scrim },
  safeArea: { flex: 1, justifyContent: 'flex-end' },
  sheetKeyboardContainer: { justifyContent: 'flex-end' },
  sheetScrollView: { flex: 0, maxHeight: '90%' },
  sheet: { gap: 12, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, backgroundColor: theme.background, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  titleWrap: { flex: 1 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: theme.secondaryText, fontSize: 13, lineHeight: 18, marginTop: 5 },
  passwordHint: { color: theme.secondaryText, fontSize: 12 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.surface },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, color: theme.text, paddingHorizontal: 14 },
  error: { color: theme.error, fontSize: 13, lineHeight: 18 },
  message: { color: theme.success, fontSize: 13, lineHeight: 18 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.accent },
  secondaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  secondaryButtonText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  disabledButton: { opacity: 0.55 },
  primaryText: { color: theme.background, fontSize: 15, fontWeight: '800' },
  linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
});
