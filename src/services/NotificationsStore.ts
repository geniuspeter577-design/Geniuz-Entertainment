import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationKind = 'broadcast' | 'personal' | 'system';

export type AppNotification = {
  id: string;
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  contentId?: string | null;
  createdAt: string;
  read: boolean;
};

const NOTIFICATIONS_STORAGE_KEY = '@geniuz/notifications/v1';

export async function loadNotifications(): Promise<AppNotification[]> {
  const raw = await AsyncStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveNotifications(notifications: AppNotification[]) {
  await AsyncStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
}

export function getUnreadNotificationCount(notifications: readonly AppNotification[]) {
  return notifications.filter((notification) => !notification.read).length;
}

export async function markNotificationRead(notificationId: string) {
  const notifications = await loadNotifications();
  const next = notifications.map((notification) =>
    notification.id === notificationId ? { ...notification, read: true } : notification,
  );
  await saveNotifications(next);
  return next;
}

export async function markAllNotificationsRead() {
  const notifications = await loadNotifications();
  const next = notifications.map((notification) => ({ ...notification, read: true }));
  await saveNotifications(next);
  return next;
}

export async function dismissNotification(notificationId: string) {
  const notifications = await loadNotifications();
  const next = notifications.filter((notification) => notification.id !== notificationId);
  await saveNotifications(next);
  return next;
}

export async function createBroadcastNotification(
  title: string,
  body: string,
  options?: { contentId?: string | null; userId?: string | null; kind?: NotificationKind },
) {
  const notifications = await loadNotifications();
  const next: AppNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    userId: options?.userId ?? null,
    kind: options?.kind ?? 'broadcast',
    title,
    body,
    contentId: options?.contentId ?? null,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const result = [next, ...notifications].sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );
  await saveNotifications(result);
  return result;
}
