import type { Session, SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { AccountProfile } from '../models/profile';
import { ProfileRepository, type AccountProfileUpdate } from '../services/ProfileRepository';
import { supabase } from '../services/supabase';
import {
  createAccount,
  getAuthState,
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
  signUp: (email: string, password: string, displayName: string) => Promise<{ hasSession: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
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

  const signUp = useCallback((email: string, password: string, displayName: string) => {
    if (!authClient) {
      return Promise.reject(new Error('Account service is not configured.'));
    }
    return createAccount(authClient, email, password, displayName, Linking.createURL('auth/confirm'));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!authClient) {
      throw new Error('Account service is not configured.');
    }
    await signInToAccount(authClient, email, password);
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
    signOut,
    resetPassword,
    updateDisplayName,
    updateProfile,
    refreshProfile,
    openSignInSheet,
    closeSignInSheet,
  }), [session, profile, isLoading, profileError, signUp, signIn, signOut, resetPassword, updateDisplayName, updateProfile, refreshProfile, openSignInSheet, closeSignInSheet]);

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
