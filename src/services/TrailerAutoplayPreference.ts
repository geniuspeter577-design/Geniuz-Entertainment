import AsyncStorage from '@react-native-async-storage/async-storage';
import { PLAYER_SPEED_OPTIONS } from '../utils/playerControls';

const AUTOPLAY_TRAILERS_KEY = 'geniuz:autoplay-trailers';
const SETTINGS_KEY = '@geniuz/settings/v1';

export const DEFAULT_PLAYBACK_SPEEDS = PLAYER_SPEED_OPTIONS;

export type WatchPreference = 'streaming' | 'download';

export type UserAppSettings = {
  autoplayNextEpisode: boolean;
  defaultPlaybackSpeed: typeof DEFAULT_PLAYBACK_SPEEDS[number];
  wifiOnlyDownloads: boolean;
  watchPreference: WatchPreference;
};

const DEFAULT_USER_SETTINGS: UserAppSettings = {
  autoplayNextEpisode: false,
  defaultPlaybackSpeed: 1,
  wifiOnlyDownloads: false,
  watchPreference: 'streaming',
};

function getSettingsKey(userId: string) {
  if (!userId.trim()) {
    throw new Error('A signed-in user is required to load app settings.');
  }
  return `${SETTINGS_KEY}:${encodeURIComponent(userId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUserAppSettings(value: string | null): UserAppSettings {
  if (!value) {
    return { ...DEFAULT_USER_SETTINGS };
  }
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error('Saved app settings have an unsupported format.');
  }
  const speed = DEFAULT_PLAYBACK_SPEEDS.find((candidate) => candidate === parsed.defaultPlaybackSpeed) ?? 1;
  return {
    autoplayNextEpisode:
      typeof parsed.autoplayNextEpisode === 'boolean'
        ? parsed.autoplayNextEpisode
        : DEFAULT_USER_SETTINGS.autoplayNextEpisode,
    defaultPlaybackSpeed: speed,
    wifiOnlyDownloads:
      typeof parsed.wifiOnlyDownloads === 'boolean'
        ? parsed.wifiOnlyDownloads
        : DEFAULT_USER_SETTINGS.wifiOnlyDownloads,
    watchPreference: parsed.watchPreference === 'download' ? 'download' : 'streaming',
  };
}

export async function getUserAppSettings(userId: string): Promise<UserAppSettings> {
  return parseUserAppSettings(await AsyncStorage.getItem(getSettingsKey(userId)));
}

export async function setUserAppSettings(
  userId: string,
  settings: UserAppSettings,
): Promise<void> {
  await AsyncStorage.setItem(getSettingsKey(userId), JSON.stringify(settings));
}

export async function getAutoplayTrailers(): Promise<boolean> {
  const value = await AsyncStorage.getItem(AUTOPLAY_TRAILERS_KEY);
  return value === null || value === 'true';
}

export async function setAutoplayTrailers(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTOPLAY_TRAILERS_KEY, String(enabled));
}
