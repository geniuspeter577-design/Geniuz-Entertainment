import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { useMembership } from '../src/hooks/useMembership';
import { createMemberCheckout } from '../src/services/MembershipClient';
import { useAuth } from '../src/state/AuthContext';
import { theme } from '../src/theme';
import { getProfileInitial } from '../src/utils/accountAuth';
import { formatMembershipDate } from '../src/utils/membership';

export default function MembershipScreen() {
  const auth = useAuth();
  const membership = useMembership();
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string>();
  const paymentWasPending = useRef(false);
  const currentStatus = membership.status;
  const pendingReference = currentStatus?.pendingPayment?.reference;
  const refreshMembership = membership.refresh;
  const isOnline = membership.isOnline;
  const hasMemberAccess = currentStatus?.status === 'active' || currentStatus?.status === 'grace';

  useEffect(() => {
    if (currentStatus?.pendingPayment) {
      paymentWasPending.current = true;
    }
    if (paymentWasPending.current && hasMemberAccess && !currentStatus?.pendingPayment) {
      paymentWasPending.current = false;
      router.back();
    }
  }, [currentStatus, hasMemberAccess]);

  useEffect(() => {
    if (!pendingReference || !isOnline) {
      return undefined;
    }
    const timer = setInterval(() => void refreshMembership(), 8_000);
    return () => clearInterval(timer);
  }, [isOnline, pendingReference, refreshMembership]);

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  const handleMemberAction = async () => {
    setCheckoutError(undefined);
    if (!auth.session) {
      auth.openSignInSheet('sign-in');
      return;
    }
    if (hasMemberAccess) {
      return;
    }
    if (membership.status?.pendingPayment) {
      const status = await membership.refresh();
      if (status?.status === 'active' || status?.status === 'grace') {
        close();
      }
      return;
    }
    if (!membership.isOnline) {
      setCheckoutError('You’re offline. Reconnect to open secure checkout.');
      return;
    }
    setIsCheckingOut(true);
    try {
      const checkout = await createMemberCheckout();
      const checkoutUrl = new URL(checkout.authorizationUrl);
      if (
        checkoutUrl.protocol !== 'https:' ||
        (checkoutUrl.hostname !== 'paystack.com' && !checkoutUrl.hostname.endsWith('.paystack.com'))
      ) {
        throw new Error('The secure payment link is invalid. Please retry.');
      }
      await WebBrowser.openBrowserAsync(checkoutUrl.toString());
      const status = await membership.refresh();
      if (status?.status === 'active' || status?.status === 'grace') {
        close();
      } else if (status?.pendingPayment) {
        paymentWasPending.current = true;
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Checkout could not be opened. Please retry.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const displayName = auth.profile?.display_name || auth.session?.user.email || 'Visitor';
  const priceText = membership.plan
    ? `NGN ${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(membership.plan.priceNgn)} / month`
    : 'Membership price unavailable';
  const membershipUntil = membership.status?.status === 'grace'
    ? membership.status.graceUntil
    : membership.status?.currentPeriodEnd;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Member page" onPress={close} style={styles.closeButton}>
          <Ionicons name="close" size={22} color={theme.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            {auth.profile?.avatar_url ? (
              <Image source={{ uri: auth.profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitial}>{getProfileInitial(auth.profile?.display_name, auth.session?.user.email)}</Text>
            )}
          </View>
          <View style={styles.memberBadge}>
            <Ionicons name="star" size={14} color={theme.background} />
            <Text style={styles.memberBadgeText}>MEMBER</Text>
          </View>
          <Text style={styles.personName} numberOfLines={1}>{displayName}</Text>
        </View>

        <Text style={styles.title}>Become a Member</Text>
        <Text style={styles.price}>{priceText}</Text>
        <Text style={styles.priceNote}>Cancel anytime by not renewing · no automatic card charging</Text>

        {membership.isLoading ? <ContentNotice message="Loading membership details…" /> : null}
        {!membership.isOnline ? <ContentNotice message="You’re offline. Saved membership details may be unavailable." /> : null}
        {membership.error ? (
          <ContentNotice
            message={membership.error}
            tone="error"
            actionLabel="Retry"
            onAction={() => void membership.refresh()}
          />
        ) : null}
        {checkoutError ? <ContentNotice message={checkoutError} tone="error" /> : null}
        {currentStatus?.pendingPayment ? (
          <ContentNotice message="Payment pending. Member access starts after Paystack confirms your payment." />
        ) : null}

        <View style={styles.benefits}>
          <Text style={styles.sectionTitle}>Member benefits</Text>
          <Benefit icon="swap-horizontal-outline" text="Send and receive files between devices" />
          <Benefit icon="eye-off-outline" text="Ad-free viewing" />
          <Benefit icon="shield-checkmark-outline" text="Member badge on your profile" />
          <Benefit icon="cash-outline" text="Post REELS and Earn in Dollars" />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {hasMemberAccess ? (
          <Text style={styles.memberUntil}>
            {membership.status?.status === 'grace' ? 'Grace period until ' : 'You are a Member until '}
            {formatMembershipDate(membershipUntil)}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={isCheckingOut || auth.isLoading || (Boolean(auth.session) && (!membership.isOnline || !membership.plan))}
            onPress={() => void handleMemberAction()}
            style={[styles.primaryButton, (isCheckingOut || auth.isLoading || (Boolean(auth.session) && (!membership.isOnline || !membership.plan))) && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>
              {isCheckingOut ? 'Opening secure checkout…' : !auth.session ? 'Sign in to continue' : membership.status?.pendingPayment ? 'Check payment status' : 'Get Member badge'}
            </Text>
          </Pressable>
        )}
        <Text style={styles.terms}>One-month membership. No automatic card charging. Payment status updates after provider confirmation.</Text>
      </View>
    </SafeAreaView>
  );
}

function Benefit({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: theme.background, flex: 1 },
  topBar: { alignItems: 'flex-end', paddingHorizontal: 18, paddingTop: 4 },
  closeButton: { alignItems: 'center', backgroundColor: theme.surface, borderColor: theme.border, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  content: { alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingBottom: 20, paddingTop: 10 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 2, width: '100%' },
  avatar: { alignItems: 'center', backgroundColor: theme.surface, borderColor: theme.gold, borderRadius: 38, borderWidth: 2, height: 76, justifyContent: 'center', overflow: 'hidden', width: 76 },
  avatarImage: { height: '100%', width: '100%' },
  avatarInitial: { color: theme.text, fontSize: 27, fontWeight: '800' },
  memberBadge: { alignItems: 'center', backgroundColor: theme.gold, borderRadius: 12, flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  memberBadgeText: { color: theme.background, fontSize: 10, fontWeight: '900' },
  personName: { color: theme.secondaryText, fontSize: 14, fontWeight: '600', maxWidth: '90%' },
  title: { color: theme.text, fontSize: 27, fontWeight: '900', textAlign: 'center' },
  price: { color: theme.gold, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  priceNote: { color: theme.secondaryText, fontSize: 13 },
  benefits: { alignSelf: 'stretch', backgroundColor: theme.surface, borderColor: theme.border, borderRadius: 12, borderWidth: 1, gap: 15, marginTop: 8, padding: 16 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  benefit: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  benefitText: { color: theme.text, flex: 1, fontSize: 14, lineHeight: 20 },
  unavailableBenefit: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  unavailableText: { color: theme.secondaryText, flex: 1, fontSize: 13, lineHeight: 19 },
  footer: { backgroundColor: theme.background, borderTopColor: theme.border, borderTopWidth: 1, gap: 9, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  primaryButton: { alignItems: 'center', backgroundColor: theme.gold, borderRadius: 10, justifyContent: 'center', minHeight: 52, paddingHorizontal: 16 },
  primaryButtonText: { color: theme.background, fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  memberUntil: { color: theme.gold, fontSize: 16, fontWeight: '800', textAlign: 'center', paddingVertical: 10 },
  terms: { color: theme.secondaryText, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
