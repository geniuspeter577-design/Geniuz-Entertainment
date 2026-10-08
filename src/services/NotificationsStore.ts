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

type NotificationRow = {
  id: string;
  user_id: string | null;
  type: NotificationKind;
  title: string;
  body: string;
  content_id: string | null;
  created_at: string;
  read_at: string | null;
};

type NotificationQueryResult = { data: NotificationRow[] | null; error: unknown | null };
type NotificationFilter = {
  eq: (column: string, value: string) => NotificationFilter;
  is: (column: string, value: null) => PromiseLike<{ error: unknown | null }>;
};
type NotificationsTableClient = {
  from: (table: 'notifications') => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => PromiseLike<NotificationQueryResult>;
    };
    update: (values: { read_at: string }) => NotificationFilter;
  };
};

const NOTIFICATIONS_STORAGE_KEY = '@geniuz/notifications/v1';
const DISMISSED_NOTIFICATIONS_STORAGE_KEY = '@geniuz/notifications/dismissed/v1';

async function getSupabaseClient() {
  try {
    return (await import('./supabase.js')).supabase;
  } catch {
    return null;
  }
}

async function loadLocalNotifications(): Promise<AppNotification[]> {
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

export async function loadNotifications(): Promise<AppNotification[]> {
  const local = await loadLocalNotifications();
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return local;
  }
  const dismissedRaw = await AsyncStorage.getItem(DISMISSED_NOTIFICATIONS_STORAGE_KEY);
  let dismissed = new Set<string>();
  try {
    dismissed = new Set<string>(dismissedRaw ? JSON.parse(dismissedRaw) as string[] : []);
  } catch {
    dismissed = new Set<string>();
  }
  const notificationClient = supabase as unknown as NotificationsTableClient;
  const { data, error } = await notificationClient
    .from('notifications')
    .select('id,user_id,type,title,body,content_id,created_at,read_at')
    .order('created_at', { ascending: false });
  if (error || !data) {
    return local;
  }
  const remote: AppNotification[] = data
    .filter((item) => !dismissed.has(item.id))
    .map((item) => ({
      id: item.id,
      userId: item.user_id,
      kind: item.type as NotificationKind,
      title: item.title,
      body: item.body,
      contentId: item.content_id,
      createdAt: item.created_at,
      read: item.read_at !== null,
    }));
  const merged = new Map<string, AppNotification>();
  for (const item of [...local, ...remote]) {
    merged.set(item.id, item);
  }
  const result = [...merged.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  await saveNotifications(result);
  return result;
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
  const supabase = await getSupabaseClient();
  if (supabase && /^[0-9a-f-]{36}$/i.test(notificationId)) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id) {
      const notificationClient = supabase as unknown as NotificationsTableClient;
      await notificationClient.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('id', notificationId).eq('user_id', data.session.user.id);
    }
  }
  return next;
}

export async function markAllNotificationsRead() {
  const notifications = await loadNotifications();
  const next = notifications.map((notification) => ({ ...notification, read: true }));
  await saveNotifications(next);
  const supabase = await getSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id) {
      const notificationClient = supabase as unknown as NotificationsTableClient;
      await notificationClient.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', data.session.user.id).is('read_at', null);
    }
  }
  return next;
}

export async function dismissNotification(notificationId: string) {
  const notifications = await loadNotifications();
  const next = notifications.filter((notification) => notification.id !== notificationId);
  await saveNotifications(next);
  const dismissedRaw = await AsyncStorage.getItem(DISMISSED_NOTIFICATIONS_STORAGE_KEY);
  let dismissed = new Set<string>();
  try {
    dismissed = new Set<string>(dismissedRaw ? JSON.parse(dismissedRaw) as string[] : []);
  } catch {
    dismissed = new Set<string>();
  }
  dismissed.add(notificationId);
  await AsyncStorage.setItem(DISMISSED_NOTIFICATIONS_STORAGE_KEY, JSON.stringify([...dismissed]));
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
