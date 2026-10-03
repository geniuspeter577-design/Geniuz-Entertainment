import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTOPLAY_TRAILERS_KEY = 'geniuz:autoplay-trailers';

export async function getAutoplayTrailers(): Promise<boolean> {
  const value = await AsyncStorage.getItem(AUTOPLAY_TRAILERS_KEY);
  return value === null || value === 'true';
}

export async function setAutoplayTrailers(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTOPLAY_TRAILERS_KEY, String(enabled));
}
