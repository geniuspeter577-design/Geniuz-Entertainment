import type { AppNotification } from '../services/NotificationsStore';
import type { ContentItem, ContinueWatchingEntry } from '../models/content';
import { getUnreadNotificationCount } from '../services/NotificationsStore';

type MeScreenLibrary = {
  watchlist: readonly ContentItem[];
  continueWatching: readonly ContinueWatchingEntry[];
};

export function getMeScreenData(
  library: MeScreenLibrary,
  notifications: readonly AppNotification[],
) {
  return {
    watchHistory: [...library.continueWatching]
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
      .map((entry) => {
        const durationSeconds = entry.durationSeconds ?? entry.item.durationSeconds;
        const progress =
          entry.positionSeconds !== undefined &&
          durationSeconds !== undefined &&
          Number.isFinite(durationSeconds) &&
          durationSeconds > 0
            ? Math.min(100, Math.max(0, Math.round((entry.positionSeconds / durationSeconds) * 100)))
            : entry.progress;
        return { ...entry, progress };
      }),
    myListCount: library.watchlist.length,
    unreadMessagesCount: getUnreadNotificationCount(notifications),
  };
}

export function getShortPublicId(publicId: string) {
  return `ID ····${publicId.slice(-4)}`;
}
