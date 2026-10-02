import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../src/theme';

const quickActions = ['Account', 'Watchlist', 'Downloads', 'Notifications', 'Settings'];

export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>Profile</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>AP</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.name}>Ari Parker</Text>
            <Text style={styles.handle}>@ariparker • Premium</Text>
          </View>
        </View>

        <View style={styles.planCard}>
          <Text style={styles.planLabel}>Geniuz+ Premium</Text>
          <Text style={styles.planMeta}>Next billing: 12 Oct</Text>
          <Pressable style={styles.planButton}>
            <Text style={styles.planButtonText}>Manage plan</Text>
          </Pressable>
        </View>

        <View style={styles.grid}>
          {quickActions.map((label) => (
            <Pressable key={label} style={styles.actionCard}>
              <Text style={styles.actionText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  header: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 20,
    letterSpacing: -0.9,
  },
  profileCard: {
    backgroundColor: theme.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 22,
  },
  userInfo: {
    marginLeft: 16,
  },
  name: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  handle: {
    color: theme.secondaryText,
    fontSize: 13,
    marginTop: 4,
  },
  planCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginBottom: 18,
  },
  planLabel: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  planMeta: {
    color: theme.secondaryText,
    fontSize: 13,
    marginBottom: 14,
  },
  planButton: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
  },
  planButtonText: {
    color: theme.background,
    fontWeight: '800',
    fontSize: 13,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  actionCard: {
    width: '48%',
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  actionText: {
    color: theme.text,
    fontWeight: '700',
    fontSize: 15,
  },
});
