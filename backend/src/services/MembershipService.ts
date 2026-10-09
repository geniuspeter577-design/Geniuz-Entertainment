import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import type { Config } from '../config/config';
import { HttpError } from '../http/errors';
import { PaystackService, PaystackServiceError } from './PaystackService';
import { FlutterwaveGateway } from './PaymentGateway';
import type { PaymentGateway } from './PaymentGateway';
import { FlutterwaveService } from './FlutterwaveService';

type MembershipStatusResponse = {
  status: 'visitor' | 'active' | 'grace' | 'expired' | 'refunded';
  currentPeriodEnd?: string;
  graceUntil?: string;
  pendingPayment?: { reference: string; createdAt: string };
};

export type PaystackEvent = {
  id: string;
  event: string;
  data: { reference: string };
};

export interface MembershipOperations {
  getPlan(): ReturnType<MembershipService['getPlan']>;
  getStatus(client: SupabaseClient, userId: string): Promise<MembershipStatusResponse>;
  createCheckout(userId: string, email: string): Promise<{
    authorizationUrl: string;
    accessCode: string;
    reference: string;
    amountKobo: number;
    currency: string;
  }>;
  processWebhook(event: PaystackEvent, payload: Record<string, unknown>): Promise<{ status: string }>;
  refund(adminUserId: string, reference: string, reason: string): Promise<{ status: string; reference: string }>;
  runDailyMaintenance(): Promise<{ checked: number; remindersCreated: number }>;
}

export type MembershipServiceOptions = {
  adminClient?: SupabaseClient;
  paystack?: PaymentGateway;
  now?: () => Date;
};

export function getMembershipAccessStatus(
  membership: { status: string; current_period_end: string; grace_until: string } | null,
  now = new Date(),
): MembershipStatusResponse['status'] {
  if (!membership) {
    return 'visitor';
  }
  if (membership.status === 'refunded') {
    return 'refunded';
  }
  if (new Date(membership.current_period_end).getTime() > now.getTime()) {
    return 'active';
  }
  if (new Date(membership.grace_until).getTime() > now.getTime()) {
    return 'grace';
  }
  return 'expired';
}

export class MembershipService implements MembershipOperations {
  private readonly paystack: PaymentGateway;
  private readonly now: () => Date;

  constructor(private readonly config: Config, private readonly options: MembershipServiceOptions = {}) {
    this.paystack = options.paystack ?? (config.paymentProvider === 'flutterwave'
      ? new FlutterwaveGateway(new FlutterwaveService(config.flutterwaveSecretKey, config.flutterwaveRedirectUrl))
      : new PaystackService(config.paystackSecretKey));
    this.now = options.now ?? (() => new Date());
  }

  getPlan() {
    return {
      id: 'member',
      name: 'Member',
      currency: 'NGN',
      priceNgn: this.config.membershipPriceNgn,
      amountKobo: this.config.membershipPriceNgn * 100,
      intervalMonths: 1,
    };
  }

  async getStatus(client: SupabaseClient, userId: string): Promise<MembershipStatusResponse> {
    const [membershipResult, paymentResult] = await Promise.all([
      client
        .from('memberships')
        .select('status,current_period_end,grace_until')
        .eq('user_id', userId)
        .maybeSingle(),
      client
        .from('payments')
        .select('reference,created_at')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (membershipResult.error || paymentResult.error) {
      throw new HttpError(502, 'MEMBERSHIP_STATUS_UNAVAILABLE', 'Could not load membership status.');
    }

    const membership = membershipResult.data;
    const status = getMembershipAccessStatus(membership, this.now());

    return {
      status,
      ...(membership?.current_period_end ? { currentPeriodEnd: membership.current_period_end } : {}),
      ...(membership?.grace_until ? { graceUntil: membership.grace_until } : {}),
      ...(paymentResult.data ? {
        pendingPayment: {
          reference: paymentResult.data.reference,
          createdAt: paymentResult.data.created_at,
        },
      } : {}),
    };
  }

  async createCheckout(userId: string, email: string) {
    const admin = this.getAdminClient();
    this.requireTestPaystack();
    const reference = `geniuz_${this.now().getTime()}_${randomUUID()}`;
    const amountKobo = this.config.membershipPriceNgn * 100;
    const { error: insertError } = await admin.from('payments').insert({
      reference,
      user_id: userId,
      amount_kobo: amountKobo,
      status: 'pending',
    });
    if (insertError) {
      throw new HttpError(503, 'PAYMENT_RECORD_UNAVAILABLE', 'Could not start checkout. Please retry.');
    }
    try {
      const checkout = await this.paystack.initializeTransaction({ email, amountKobo, reference });
      return { ...checkout, amountKobo, currency: 'NGN' };
    } catch (error) {
      await admin.from('payments').update({ status: 'failed', updated_at: this.now().toISOString() }).eq('reference', reference);
      throw this.mapPaystackError(error);
    }
  }

  async processWebhook(event: PaystackEvent, payload: Record<string, unknown>) {
    const admin = this.getAdminClient();
    this.requireTestPaystack();
    const { data: priorEvent, error: priorError } = await admin
      .from('webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();
    if (priorError) {
      throw new HttpError(503, 'WEBHOOK_STORE_UNAVAILABLE', 'Could not process the payment event.');
    }
    if (priorEvent) {
      return { status: 'duplicate' };
    }

    let verifiedStatus = 'ignored';
    let amountKobo = 0;
    let currency = 'NGN';
    let channel: string | null = null;
    if (event.event === 'charge.success') {
      const verified = await this.paystack.verifyTransaction(event.data.reference).catch((error: unknown) => {
        throw this.mapPaystackError(error);
      });
      verifiedStatus = verified.status;
      amountKobo = verified.amount;
      currency = verified.currency;
      channel = verified.channel ?? null;
    }

    const { data, error } = await admin.rpc('apply_paystack_event', {
      p_event_id: event.id,
      p_event_type: event.event,
      p_reference: event.data.reference,
      p_verified_status: verifiedStatus,
      p_verified_amount_kobo: amountKobo,
      p_verified_currency: currency,
      p_channel: channel,
      p_payload: payload,
      p_grace_days: this.config.membershipGraceDays,
    });
    if (error) {
      throw new HttpError(503, 'PAYMENT_EVENT_UNAVAILABLE', 'Could not apply the verified payment event.');
    }
    return { status: String(data) };
  }

  async refund(adminUserId: string, reference: string, reason: string) {
    const admin = this.getAdminClient();
    this.requireTestPaystack();
    const { data: payment, error } = await admin
      .from('payments')
      .select('status')
      .eq('reference', reference)
      .maybeSingle();
    if (error) {
      throw new HttpError(503, 'REFUND_LOOKUP_FAILED', 'Could not load this payment.');
    }
    if (!payment || payment.status !== 'success') {
      throw new HttpError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a successful payment can be refunded.');
    }
    let providerReference: string;
    try {
      const result = await this.paystack.refundTransaction(reference);
      providerReference = this.getProviderReference(result, reference);
    } catch (error) {
      throw this.mapPaystackError(error);
    }
    const { data: result, error: refundError } = await admin.rpc('record_membership_refund', {
      p_reference: reference,
      p_admin_user_id: adminUserId,
      p_provider_reference: providerReference,
      p_reason: reason,
    });
    if (refundError || result !== 'refunded') {
      throw new HttpError(503, 'REFUND_AUDIT_FAILED', 'Paystack accepted the refund but its audit record could not be confirmed.');
    }
    return { status: 'refunded', reference };
  }

  async runDailyMaintenance() {
    const admin = this.getAdminClient();
    this.requireTestPaystack();
    const { data: pending, error } = await admin
      .from('payments')
      .select('reference')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) {
      throw new HttpError(503, 'PAYMENT_RECONCILIATION_UNAVAILABLE', 'Could not load pending payments.');
    }
    let checked = 0;
    for (const payment of pending ?? []) {
      try {
        const verified = await this.paystack.verifyTransaction(payment.reference);
        const eventId = `reconcile:${payment.reference}:${this.now().getTime()}:${randomUUID()}`;
        const { error: applyError } = await admin.rpc('apply_paystack_event', {
          p_event_id: eventId,
          p_event_type: 'reconciliation',
          p_reference: payment.reference,
          p_verified_status: verified.status,
          p_verified_amount_kobo: verified.amount,
          p_verified_currency: verified.currency,
          p_channel: verified.channel ?? null,
          p_payload: { source: 'daily_reconciliation', reference: payment.reference },
          p_grace_days: this.config.membershipGraceDays,
        });
        if (applyError) {
          throw applyError;
        }
        checked += 1;
      } catch (error) {
        console.error('[Membership] A pending payment could not be reconciled.', {
          reference: payment.reference,
          code: error instanceof PaystackServiceError ? error.code : 'RECONCILIATION_FAILED',
        });
      }
    }
    const { data: reminders, error: reminderError } = await admin.rpc('create_membership_renewal_reminders', {
      p_days_before: 3,
    });
    if (reminderError) {
      throw new HttpError(503, 'MEMBERSHIP_REMINDERS_UNAVAILABLE', 'Could not create renewal reminders.');
    }
    return { checked, remindersCreated: Number(reminders ?? 0) };
  }

  private getAdminClient() {
    if (this.options.adminClient) {
      return this.options.adminClient;
    }
    if (!this.config.supabaseUrl || !this.config.supabaseServiceRoleKey) {
      throw new HttpError(503, 'MEMBERSHIP_BACKEND_NOT_CONFIGURED', 'Membership payments are not configured.');
    }
    return createClient(
      this.config.supabaseUrl,
      this.config.supabaseServiceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    );
  }

  private requireTestPaystack() {
    if (!this.paystack.isTestModeConfigured) {
      throw new HttpError(503, 'PAYSTACK_TEST_NOT_CONFIGURED', 'Paystack TEST mode is not configured.');
    }
  }

  private mapPaystackError(error: unknown) {
    if (error instanceof PaystackServiceError && error.code === 'NOT_CONFIGURED') {
      return new HttpError(503, 'PAYSTACK_TEST_NOT_CONFIGURED', 'Paystack TEST mode is not configured.');
    }
    return new HttpError(502, 'PAYSTACK_UNAVAILABLE', 'The payment provider could not complete this request.');
  }

  private getProviderReference(value: unknown, fallback: string) {
    if (typeof value === 'object' && value !== null && 'reference' in value && typeof value.reference === 'string') {
      return value.reference;
    }
    if (typeof value === 'object' && value !== null && 'id' in value) {
      return String(value.id);
    }
    return fallback;
  }
}
