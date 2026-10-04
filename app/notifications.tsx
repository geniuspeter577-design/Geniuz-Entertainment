import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '../src/theme';
import {
  dismissNotification,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../src/services/NotificationsStore';
import { backOrReplace } from '../src/utils/navigation';

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshNotifications = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setNotifications(await loadNotifications());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadNotifications().then((items) => {
        if (active) {
          setNotifications(items);
        }
      }).catch((error: unknown) => {
        console.error('[Notifications] Could not load notifications.', error);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const handleOpenNotification = async (notification: AppNotification) => {
    setNotifications((current) => current.map((item) =>
      item.id === notification.id ? { ...item, read: true } : item,
    ));
    await markNotificationRead(notification.id);
    if (notification.contentId) {
      router.push({ pathname: '/content/[id]', params: { id: notification.contentId } });
    }
  };

  const handleDismiss = async (notificationId: string) => {
    setNotifications((current) => current.filter((item) => item.id !== notificationId));
    await dismissNotification(notificationId);
  };

  const handleMarkAllRead = async () => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setNotifications(await markAllNotificationsRead());
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => backOrReplace('/')}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark all as read"
          onPress={() => void handleMarkAllRead()}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Mark all as read</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refreshNotifications()} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {notifications.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyBody}>You’ll see new announcements and title updates here.</Text>
          </View>
        ) : (
          notifications.map((notification) => (
            <Pressable
              key={notification.id}
              onPress={() => void handleOpenNotification(notification)}
              style={[styles.card, !notification.read && styles.unreadCard]}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{notification.title}</Text>
                {!notification.read ? <View style={styles.unreadDot} /> : null}
              </View>
              <Text style={styles.cardBody}>{notification.body}</Text>
              <Text style={styles.cardMeta}>{new Date(notification.createdAt).toLocaleString()}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${notification.title}`}
                onPress={() => {
                  Alert.alert('Dismiss notification', 'Remove this notification from your inbox?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Dismiss', style: 'destructive', onPress: () => void handleDismiss(notification.id) },
                  ]);
                }}
                style={styles.dismissButton}
              >
                <Text style={styles.dismissText}>Dismiss</Text>
              </Pressable>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
    marginBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  title: { color: theme.text, fontSize: 28, fontWeight: '800' },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: theme.surface },
  secondaryButtonText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  emptyCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 24,
  },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  emptyBody: { color: theme.secondaryText, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 12,
  },
  unreadCard: { borderColor: theme.accent },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: '800', flex: 1 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent },
  cardBody: { color: theme.secondaryText, fontSize: 14, lineHeight: 20 },
  cardMeta: { color: theme.muted, fontSize: 11, marginTop: 8 },
  dismissButton: { marginTop: 12, alignSelf: 'flex-start' },
  dismissText: { color: '#FF7C7C', fontWeight: '700', fontSize: 12 },
});
