import { supabase } from './supabase';

export type MemberPlan = {
  id: 'member';
  name: 'Member';
  currency: 'NGN';
  priceNgn: number;
  amountKobo: number;
  intervalMonths: 1;
};

export type MembershipStatus = {
  status: 'visitor' | 'active' | 'grace' | 'expired' | 'refunded';
  currentPeriodEnd?: string;
  graceUntil?: string;
  pendingPayment?: { reference: string; createdAt: string };
};

function getApiBaseUrl() {
  const value = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error('Membership service is not configured.');
  }
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password
  ) {
    throw new Error('Membership service URL must use HTTP or HTTPS and cannot contain credentials.');
  }
  return value;
}

async function request<T>(path: string, options: { method?: 'GET' | 'POST'; authenticated?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }
  if (options.authenticated) {
    if (!supabase) {
      throw new Error('Sign in to continue.');
    }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new Error('Your sign-in session could not be verified. Sign in again.');
    }
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.method === 'POST' ? { body: '{}' } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Could not reach the membership service. Check your connection and retry.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The membership service returned an invalid response.');
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'object' && payload.error !== null && 'message' in payload.error
      ? String(payload.error.message)
      : 'Membership request failed. Please retry.';
    throw new Error(message);
  }
  return payload as T;
}

export async function loadMemberPlan(): Promise<MemberPlan> {
  const response = await request<{ plans?: unknown[] }>('/api/membership/plan');
  const plan = response.plans?.find((value) =>
    typeof value === 'object' && value !== null && 'id' in value && value.id === 'member',
  );
  if (
    typeof plan !== 'object' || plan === null ||
    !('priceNgn' in plan) || typeof plan.priceNgn !== 'number' || plan.priceNgn <= 0 ||
    !('amountKobo' in plan) || typeof plan.amountKobo !== 'number' || plan.amountKobo !== plan.priceNgn * 100
  ) {
    throw new Error('Member pricing is unavailable. Please retry later.');
  }
  return plan as MemberPlan;
}

export function loadMembershipStatus() {
  return request<MembershipStatus>('/api/membership/status', { authenticated: true });
}

export function createMemberCheckout() {
  return request<{
    authorizationUrl: string;
    accessCode: string;
    reference: string;
    amountKobo: number;
    currency: 'NGN';
  }>('/api/membership/create-checkout', { method: 'POST', authenticated: true });
}
