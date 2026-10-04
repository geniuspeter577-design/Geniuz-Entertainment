import type { Session, SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import type { AccountProfile } from '../models/profile';
import { ProfileRepository, type AccountProfileUpdate } from '../services/ProfileRepository';
import { supabase } from '../services/supabase';
import {
  createAccount,
  getAuthState,
  getFriendlyAuthError,
  logAuthErrorContext,
  resendConfirmation,
  sendPasswordReset,
  signInToAccount,
  signOutOfAccount,
  type AccountAuthClient,
} from '../utils/accountAuth';
import { SignInToContinueSheet, type SignInSheetMode } from '../components/auth/SignInToContinueSheet';

type AuthContextValue = {
  session: Session | null;
  profile: AccountProfile | null;
  isLoading: boolean;
  profileError?: string;
  isAdmin: boolean;
  signUp: (email: string, password: string, displayName: string, dateOfBirth: string) => Promise<{ hasSession: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<{ cancelled: boolean; needsDateOfBirth: boolean }>;
  completeDateOfBirth: (dateOfBirth: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateProfile: (profile: Partial<AccountProfileUpdate>) => Promise<void>;
  refreshProfile: () => Promise<void>;
  openSignInSheet: (mode?: SignInSheetMode) => void;
  closeSignInSheet: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const profileRepository = supabase ? new ProfileRepository(supabase) : null;
const authClient = supabase?.auth as unknown as AccountAuthClient | undefined;

if (Platform.OS === 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [profileError, setProfileError] = useState<string>();
  const [signInSheetMode, setSignInSheetMode] = useState<SignInSheetMode | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    if (!profileRepository) {
      setProfile(null);
      return;
    }
    try {
      const result = await profileRepository.getForUser(userId);
      setProfile(result);
      setProfileError(undefined);
    } catch {
      setProfile(null);
      setProfileError('Your profile could not be loaded. Retry to try again.');
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) {
        return;
      }
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setProfileError(undefined);
        setIsLoading(false);
      } else {
        setIsLoading(true);
        void Promise.resolve().then(() => loadProfile(nextSession.user.id)).finally(() => {
          if (active) {
            setIsLoading(false);
          }
        });
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      setSession(data.session);
      if (data.session) {
        void loadProfile(data.session.user.id).finally(() => {
          if (active) {
            setIsLoading(false);
          }
        });
      } else {
        setProfile(null);
        setIsLoading(false);
      }
    }).catch(() => {
      if (active) {
        setProfileError('Your session could not be restored. Sign in again.');
        setIsLoading(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signUp = useCallback((email: string, password: string, displayName: string, dateOfBirth: string) => {
    if (!authClient) {
      return Promise.reject(new Error('Account service is not configured.'));
    }
    return createAccount(authClient, email, password, displayName, dateOfBirth, Linking.createURL('auth/confirm'));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!authClient) {
      throw new Error('Account service is not configured.');
    }
    await signInToAccount(authClient, email, password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      throw new Error('Account service is not configured.');
    }
    const redirectTo = Linking.createURL('auth/confirm');
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) {
        logAuthErrorContext('googleSignIn', error);
        throw new Error(getFriendlyAuthError(error));
      }
      return { cancelled: false, needsDateOfBirth: false };
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) {
      logAuthErrorContext('googleSignIn', error);
      throw new Error(getFriendlyAuthError(error));
    }
    if (!data.url) {
      throw new Error('Google sign-in is not configured. Enable Google in Supabase Authentication settings.');
    }

    const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (browserResult.type !== 'success') {
      return { cancelled: true, needsDateOfBirth: false };
    }

    let callbackUrl: URL;
    try {
      callbackUrl = new URL(browserResult.url);
    } catch {
      throw new Error('Google sign-in returned an invalid callback. Please retry.');
    }
    if (callbackUrl.searchParams.has('error')) {
      throw new Error('Google sign-in was not completed. Please retry.');
    }
    const code = callbackUrl.searchParams.get('code');
    if (!code) {
      throw new Error('Google sign-in did not return a session. Please retry.');
    }
    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError || !exchangeData.session) {
      if (exchangeError) {
        logAuthErrorContext('googleSessionExchange', exchangeError);
      }
      throw new Error('Google sign-in could not establish a session. Please retry.');
    }

    setSession(exchangeData.session);
    if (!profileRepository) {
      return { cancelled: false, needsDateOfBirth: true };
    }
    setIsLoading(true);
    try {
      const nextProfile = await profileRepository.getForUser(exchangeData.session.user.id);
      setProfile(nextProfile);
      setProfileError(undefined);
      return { cancelled: false, needsDateOfBirth: !nextProfile?.date_of_birth };
    } catch {
      setProfileError('Your profile could not be loaded. Retry to try again.');
      throw new Error('Your profile could not be loaded after Google sign-in. Please retry.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const completeDateOfBirth = useCallback(async (dateOfBirth: string) => {
    if (!session || !profileRepository) {
      throw new Error('Sign in to complete your profile.');
    }
    await profileRepository.completeDateOfBirth(dateOfBirth);
    setProfile(await profileRepository.getForUser(session.user.id));
  }, [session]);

  const resendConfirmationForEmail = useCallback(async (email: string) => {
    if (!authClient) {
      throw new Error('Account service is not configured.');
    }
    await resendConfirmation(authClient, email);
  }, []);

  const signOut = useCallback(async () => {
    if (!authClient) {
      throw new Error('Account service is not configured.');
    }
    await signOutOfAccount(authClient);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!authClient) {
      throw new Error('Account service is not configured.');
    }
    await sendPasswordReset(authClient, email, Linking.createURL('auth/recovery'));
  }, []);

  const updateDisplayName = useCallback(async (displayName: string) => {
    if (!session || !profileRepository) {
      throw new Error('Sign in to update your profile.');
    }
    const updated = await profileRepository.updateDisplayName(session.user.id, displayName);
    setProfile(updated);
    setProfileError(undefined);
  }, [session]);

  const updateProfile = useCallback(async (updates: Partial<AccountProfileUpdate>) => {
    if (!session || !profileRepository) {
      throw new Error('Sign in to update your profile.');
    }
    const updated = await profileRepository.updateProfile(session.user.id, updates);
    setProfile(updated);
    setProfileError(undefined);
  }, [session]);

  const refreshProfile = useCallback(async () => {
    if (!session) {
      setProfile(null);
      return;
    }
    await loadProfile(session.user.id);
  }, [loadProfile, session]);

  const openSignInSheet = useCallback((mode: SignInSheetMode = 'sign-in') => {
    setSignInSheetMode(mode);
  }, []);
  const closeSignInSheet = useCallback(() => setSignInSheetMode(null), []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    isLoading,
    profileError,
    isAdmin: getAuthState(session).isAdmin,
    signUp,
    signIn,
    signInWithGoogle,
    completeDateOfBirth,
    resendConfirmation: resendConfirmationForEmail,
    signOut,
    resetPassword,
    updateDisplayName,
    updateProfile,
    refreshProfile,
    openSignInSheet,
    closeSignInSheet,
  }), [session, profile, isLoading, profileError, signUp, signIn, signInWithGoogle, completeDateOfBirth, resendConfirmationForEmail, signOut, resetPassword, updateDisplayName, updateProfile, refreshProfile, openSignInSheet, closeSignInSheet]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SignInToContinueSheet
        key={signInSheetMode ?? 'closed'}
        visible={signInSheetMode !== null}
        initialMode={signInSheetMode ?? 'sign-in'}
        onClose={closeSignInSheet}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}

export type { SupabaseClient };
