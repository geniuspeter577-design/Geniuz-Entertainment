import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createChunkedSecureStorage } from '../utils/secureStorage';

const nativeStorage = createChunkedSecureStorage(SecureStore);

export const authStorage = Platform.OS === 'web'
  ? {
      getItem: AsyncStorage.getItem,
      setItem: AsyncStorage.setItem,
      removeItem: AsyncStorage.removeItem,
    }
  : {
      async getItem(key: string) {
        const secureValue = await nativeStorage.getItem(key);
        if (secureValue !== null) {
          return secureValue;
        }
        const legacyValue = await AsyncStorage.getItem(key);
        if (legacyValue !== null) {
          await nativeStorage.setItem(key, legacyValue);
          await AsyncStorage.removeItem(key).catch(() => undefined);
        }
        return legacyValue;
      },
      async setItem(key: string, value: string) {
        await nativeStorage.setItem(key, value);
        await AsyncStorage.removeItem(key).catch(() => undefined);
      },
      async removeItem(key: string) {
        await Promise.all([nativeStorage.removeItem(key), AsyncStorage.removeItem(key)]);
      },
    };
