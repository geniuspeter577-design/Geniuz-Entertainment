import { Link, Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '../src/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>This screen doesn’t exist.</Text>
        <Link href="/" style={styles.link}>
          Go to home screen
        </Link>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
    padding: 20,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  link: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: '700',
  },
});
