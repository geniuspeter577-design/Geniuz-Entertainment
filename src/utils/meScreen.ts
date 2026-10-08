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
    watchHistory: library.continueWatching,
    myListCount: library.watchlist.length,
    unreadMessagesCount: getUnreadNotificationCount(notifications),
  };
}
