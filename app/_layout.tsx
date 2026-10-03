import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { OfflineBanner } from '../src/components/OfflineBanner';
import { theme } from '../src/theme';
import { DownloadsProvider } from '../src/state/DownloadsContext';
import { LibraryProvider } from '../src/state/LibraryContext';
import { NetworkProvider } from '../src/state/NetworkContext';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme !== 'light';

  return (
    <NetworkProvider>
      <LibraryProvider>
        <DownloadsProvider>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <OfflineBanner />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: theme.background,
              },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="content/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="admin" options={{ presentation: 'modal' }} />
            <Stack.Screen name="watch/[id]" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="+not-found" />
          </Stack>
        </DownloadsProvider>
      </LibraryProvider>
    </NetworkProvider>
  );
}
