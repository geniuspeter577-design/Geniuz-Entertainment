import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { supabase } from '../src/services/supabase';
import { theme } from '../src/theme';
import { isAdminMetadata } from '../src/utils/adminAccess';

type StatusName = 'backend' | 'supabase' | 'bucket' | 'presignedRead';
type CheckStatus = 'ok' | 'not_ok';
type SystemChecks = Record<StatusName, CheckStatus>;

const checkLabels: Record<StatusName, string> = {
  backend: 'Backend reachable',
  supabase: 'Supabase reachable',
  bucket: 'B2 bucket reachable',
  presignedRead: 'Presigned read test',
};

function parseChecks(value: unknown): SystemChecks | undefined {
  if (typeof value !== 'object' || value === null || !('checks' in value)) {
    return undefined;
  }
  const checks = value.checks;
  if (typeof checks !== 'object' || checks === null) {
    return undefined;
  }
  const candidate = checks as Record<string, unknown>;
  const names: StatusName[] = ['backend', 'supabase', 'bucket', 'presignedRead'];
  if (names.some((name) => candidate[name] !== 'ok' && candidate[name] !== 'not_ok')) {
    return undefined;
  }
  return Object.fromEntries(names.map((name) => [name, candidate[name]])) as SystemChecks;
}

export default function AdminStatusScreen() {
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(supabase ? undefined : false);
  const [checks, setChecks] = useState<SystemChecks>();
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | undefined>(
    supabase ? undefined : 'Supabase is not configured.',
  );

  const runChecks = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }
    setIsChecking(true);
    setError(undefined);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token) {
        setIsAdmin(false);
        setError('Admin sign-in is required.');
        return;
      }
      if (!isAdminMetadata(data.session.user.app_metadata)) {
        setIsAdmin(false);
        setError('Admin access is required.');
        return;
      }
      setIsAdmin(true);
      const apiBaseUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim().replace(/\/+$/, '');
      if (!apiBaseUrl) {
        setError('The backend URL is not configured.');
        return;
      }
      const response = await fetch(`${apiBaseUrl}/admin/system-status`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Admin session expired. Sign in again and retry.'
          : 'System status could not be loaded. Retry.');
      }
      const nextChecks = parseChecks(await response.json());
      if (!nextChecks) {
        throw new Error('System status response was invalid. Retry.');
      }
      setChecks(nextChecks);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'System status could not be loaded. Retry.');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      return;
    }
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) {
        return;
      }
      const authorized = !sessionError && isAdminMetadata(data.session?.user.app_metadata);
      setIsAdmin(authorized);
      if (authorized) {
        void runChecks();
      }
    }).catch(() => {
      if (active) {
        setIsAdmin(false);
        setError('Admin access could not be verified.');
      }
    });
    return () => {
      active = false;
    };
  }, [runChecks]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={21} color={theme.text} />
        </Pressable>
        <Text style={styles.title}>System status</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {isAdmin === false ? (
          <ContentNotice message={error ?? 'Admin access is required.'} tone="error" actionLabel="Back" onAction={() => router.back()} />
        ) : null}
        {isAdmin === undefined ? <ContentNotice message="Checking admin access…" /> : null}
        {isAdmin && error ? <ContentNotice message={error} tone="error" actionLabel="Retry" onAction={() => void runChecks()} /> : null}
        {isAdmin ? (
          <>
            {checks ? (
              <View style={styles.checkList}>
                {(Object.keys(checkLabels) as StatusName[]).map((name) => {
                  const isOk = checks[name] === 'ok';
                  return (
                    <View key={name} style={styles.checkRow}>
                      <Text style={styles.checkLabel}>{checkLabels[name]}</Text>
                      <View style={styles.statusValue}>
                        <Ionicons name={isOk ? 'checkmark-circle' : 'close-circle'} size={20} color={isOk ? theme.success : theme.error} />
                        <Text style={[styles.statusText, { color: isOk ? theme.success : theme.error }]}>{isOk ? 'OK' : 'NOT OK'}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" disabled={isChecking} onPress={() => void runChecks()} style={[styles.retryButton, isChecking && styles.disabledButton]}>
              <Ionicons name="refresh" size={17} color={theme.background} />
              <Text style={styles.retryText}>{isChecking ? 'Checking…' : 'Run checks again'}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.surface },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  content: { padding: 18, gap: 16 },
  checkList: { borderTopWidth: 1, borderTopColor: theme.border },
  checkRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  checkLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
  statusValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 12, fontWeight: '800' },
  retryButton: { minHeight: 46, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: theme.accent },
  retryText: { color: theme.background, fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
});
