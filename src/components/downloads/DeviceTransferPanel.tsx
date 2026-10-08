import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../state/AuthContext';
import { useDownloads } from '../../state/DownloadsContext';
import { useNetwork } from '../../state/NetworkContext';
import { supabase } from '../../services/supabase';
import {
  deviceTransferService,
  parseTransferConnectionCode,
} from '../../services/DeviceTransferService';
import { theme } from '../../theme';

export function DeviceTransferPanel() {
  const auth = useAuth();
  const downloads = useDownloads();
  const { isOnline } = useNetwork();
  const [receiveCode, setReceiveCode] = useState('');
  const [receiveExpiresAt, setReceiveExpiresAt] = useState('');
  const [sendCode, setSendCode] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [progress, setProgress] = useState<{ current: number; total: number }>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [isReceiving, setIsReceiving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const senderController = useRef<AbortController | null>(null);
  const receiveAvailable = useMemo(
    () => downloads.records.filter((record) => record.status === 'downloaded'),
    [downloads.records],
  );
  const selectedRecord = receiveAvailable.find((record) => record.item.id === selectedId);

  const getAccessToken = useCallback(async () => {
    if (!auth.session || !supabase) {
      throw new Error('Sign in to start a device transfer.');
    }
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw new Error('Your session could not be verified. Sign in again.');
    }
    const token = data.session?.access_token;
    if (!token) {
      throw new Error('Your session expired. Sign in again.');
    }
    return token;
  }, [auth.session]);

  useEffect(() => () => {
    senderController.current?.abort();
    void deviceTransferService.stopReceiver().catch((stopError: unknown) => {
      console.error('[DeviceTransfer] Could not stop the receive server while leaving the screen.', stopError);
    });
  }, []);

  const startReceiving = async () => {
    setError(undefined);
    setNotice(undefined);
    if (!auth.session) {
      auth.openSignInSheet();
      return;
    }
    if (!isOnline) {
      setError('Connect to the internet to authorize a transfer, then connect both devices to the same Wi-Fi or hotspot.');
      return;
    }
    try {
      const token = await getAccessToken();
      const receiver = await deviceTransferService.startReceiver(token, {
        canReceive: (contentId) => !downloads.records.some(
          (record) => record.item.id === contentId && record.status === 'downloaded',
        ),
        onProgress: (current, total) => setProgress({ current, total }),
        onReceived: downloads.registerReceived,
        onComplete: (title) => {
          setReceiveCode('');
          setReceiveExpiresAt('');
          setIsReceiving(false);
          setProgress(undefined);
          setNotice(`${title} was verified and added to Received.`);
        },
        onError: setError,
      });
      setReceiveCode(receiver.code);
      setReceiveExpiresAt(receiver.expiresAt);
      setIsReceiving(true);
      setNotice('Keep this screen open and share the receive code with the sender on the same Wi-Fi or hotspot.');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'The receive session could not be started.');
    }
  };

  const stopReceiving = async () => {
    setError(undefined);
    try {
      await deviceTransferService.stopReceiver();
      setReceiveCode('');
      setReceiveExpiresAt('');
      setIsReceiving(false);
      setProgress(undefined);
      setNotice('Receive session stopped.');
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'The receive session could not be stopped.');
    }
  };

  const sendFile = async () => {
    setError(undefined);
    setNotice(undefined);
    if (!auth.session) {
      auth.openSignInSheet();
      return;
    }
    if (!isOnline) {
      setError('Connect to the internet to authorize a transfer.');
      return;
    }
    if (!selectedRecord) {
      setError('Select a downloaded title to send.');
      return;
    }
    let address;
    try {
      address = parseTransferConnectionCode(sendCode);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Enter a valid receive code.');
      return;
    }
    const controller = new AbortController();
    senderController.current = controller;
    setIsSending(true);
    setProgress({ current: 0, total: selectedRecord.size });
    try {
      const token = await getAccessToken();
      await deviceTransferService.sendFile({
        address,
        record: selectedRecord,
        accessToken: token,
        signal: controller.signal,
        onProgress: (current, total) => setProgress({ current, total }),
      });
      setNotice(`${selectedRecord.item.title} was sent and verified by the receiving device.`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'The file could not be sent.');
    } finally {
      senderController.current = null;
      setProgress(undefined);
      setIsSending(false);
    }
  };

  const progressPercent = progress?.total
    ? Math.min(100, Math.floor((progress.current / progress.total) * 100))
    : 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Device-to-device transfer</Text>
      <Text style={styles.description}>
        Receiving is free. Sending requires active Member access, verified by the server.
      </Text>
      {!auth.session ? (
        <Pressable onPress={() => auth.openSignInSheet()} style={styles.action}>
          <Text style={styles.actionText}>Sign in to transfer</Text>
        </Pressable>
      ) : null}
      {!isOnline ? (
        <Text style={styles.muted}>
          Internet access is needed to authorize the transfer. Devices must also share a Wi-Fi network or hotspot.
        </Text>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Receive</Text>
        <Text style={styles.muted}>Start a temporary receive session, then share its code with the sender.</Text>
        {isReceiving ? (
          <>
            <Text selectable style={styles.code}>{receiveCode}</Text>
            <Text style={styles.muted}>
              Session expires {new Date(receiveExpiresAt).toLocaleTimeString()}.
            </Text>
            <Pressable onPress={() => void stopReceiving()} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Stop receiving</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => void startReceiving()} style={styles.action}>
            <Ionicons name="radio-outline" size={18} color={theme.background} />
            <Text style={styles.actionText}>Start receiving</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Send</Text>
        <Text style={styles.muted}>Choose a verified download and enter the receiver’s code.</Text>
        {receiveAvailable.length === 0 ? (
          <Text style={styles.muted}>Download a title to this device before sending.</Text>
        ) : (
          <View style={styles.choices}>
            {receiveAvailable.map((record) => (
              <Pressable
                key={record.item.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedId === record.item.id }}
                onPress={() => setSelectedId(record.item.id)}
                style={[styles.choice, selectedId === record.item.id && styles.choiceSelected]}
              >
                <Text numberOfLines={1} style={styles.choiceText}>{record.item.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSending}
          onChangeText={setSendCode}
          placeholder="Paste receive code"
          placeholderTextColor={theme.secondaryText}
          style={styles.input}
          value={sendCode}
        />
        {isSending ? (
          <Pressable
            onPress={() => senderController.current?.abort()}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Cancel sending</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!selectedRecord || receiveAvailable.length === 0}
            onPress={() => void sendFile()}
            style={[styles.action, (!selectedRecord || receiveAvailable.length === 0) && styles.disabled]}
          >
            <Ionicons name="send-outline" size={17} color={theme.background} />
            <Text style={styles.actionText}>Send file</Text>
          </Pressable>
        )}
      </View>
      {progress ? (
        <View style={styles.progress}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.muted}>{progressPercent}% transferred</Text>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={styles.footnote}>Device transfer requires a Geniuz+ development build. It is not available in Expo Go.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    gap: 12,
    marginTop: 18,
    padding: 16,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  description: { color: theme.secondaryText, fontSize: 13, lineHeight: 19 },
  section: { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, gap: 10, paddingTop: 14 },
  sectionTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  muted: { color: theme.secondaryText, fontSize: 12, lineHeight: 17 },
  action: {
    alignItems: 'center',
    backgroundColor: theme.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  actionText: { color: theme.background, fontSize: 14, fontWeight: '700' },
  secondaryAction: {
    alignItems: 'center',
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  secondaryActionText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  code: {
    backgroundColor: theme.background,
    borderRadius: 8,
    color: theme.accent,
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  choices: { gap: 8 },
  choice: { borderColor: theme.border, borderRadius: 10, borderWidth: 1, padding: 10 },
  choiceSelected: { borderColor: theme.accent },
  choiceText: { color: theme.text, fontSize: 13 },
  input: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 10,
    borderWidth: 1,
    color: theme.text,
    fontSize: 13,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  disabled: { opacity: 0.45 },
  progress: { gap: 6 },
  progressTrack: { backgroundColor: theme.background, borderRadius: 4, height: 6, overflow: 'hidden' },
  progressFill: { backgroundColor: theme.accent, height: '100%' },
  error: { color: theme.error, fontSize: 13, lineHeight: 18 },
  notice: { color: theme.accent, fontSize: 13, lineHeight: 18 },
  footnote: { color: theme.secondaryText, fontSize: 11, lineHeight: 16 },
});
