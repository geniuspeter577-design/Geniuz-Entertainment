import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

let configurationError: string | undefined;
let client: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabasePublishableKey) {
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (
      (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      throw new Error('The Supabase URL must use HTTP or HTTPS and must not contain credentials.');
    }

    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storage: AsyncStorage,
      },
    });
  } catch (error) {
    configurationError =
      error instanceof Error ? error.message : 'The Supabase settings are invalid.';
    console.error('[Supabase] Invalid public configuration.', error);
  }
} else if (supabaseUrl || supabasePublishableKey) {
  configurationError =
    'Set both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.';
}

export const supabase = client;
export const supabaseConfigurationError = configurationError;
export const isSupabaseConfigured = client !== null;
