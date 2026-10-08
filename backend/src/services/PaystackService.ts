import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaystackTransaction = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
};

export type PaystackCheckout = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

type FetchImplementation = typeof fetch;

type PaystackEnvelope<T> = {
  status?: boolean;
  message?: string;
  data?: T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PaystackServiceError extends Error {
  constructor(readonly code: 'NOT_CONFIGURED' | 'INVALID_RESPONSE' | 'UNAVAILABLE') {
    super(code);
    this.name = 'PaystackServiceError';
  }
}

export function isValidPaystackSignature(rawBody: Buffer, signature: string | undefined, testSecret: string | undefined) {
  if (!signature || !testSecret?.startsWith('sk_test_') || !/^[a-f0-9]{128}$/i.test(signature)) {
    return false;
  }
  const actual = Buffer.from(signature, 'hex');
  const expected = createHmac('sha512', testSecret).update(rawBody).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class PaystackService {
  constructor(
    private readonly secretKey: string | undefined,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  get isTestModeConfigured() {
    return Boolean(this.secretKey?.startsWith('sk_test_'));
  }

  async initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
  }): Promise<PaystackCheckout> {
    const data = await this.request<unknown>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        currency: 'NGN',
        reference: input.reference,
        channels: ['card', 'bank_transfer'],
      }),
    });
    if (
      !isRecord(data) ||
      typeof data.authorization_url !== 'string' ||
      typeof data.access_code !== 'string' ||
      typeof data.reference !== 'string' ||
      data.reference !== input.reference
    ) {
      throw new PaystackServiceError('INVALID_RESPONSE');
    }
    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<PaystackTransaction> {
    const data = await this.request<unknown>(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (
      !isRecord(data) ||
      typeof data.status !== 'string' ||
      typeof data.reference !== 'string' ||
      typeof data.amount !== 'number' ||
      typeof data.currency !== 'string' ||
      data.reference !== reference
    ) {
      throw new PaystackServiceError('INVALID_RESPONSE');
    }
    return {
      status: data.status,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      ...(typeof data.channel === 'string' ? { channel: data.channel } : {}),
    };
  }

  async refundTransaction(reference: string) {
    return this.request<unknown>('/refund', {
      method: 'POST',
      body: JSON.stringify({ transaction: reference }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.isTestModeConfigured || !this.secretKey) {
      throw new PaystackServiceError('NOT_CONFIGURED');
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(`https://api.paystack.co${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new PaystackServiceError('UNAVAILABLE');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PaystackServiceError('INVALID_RESPONSE');
    }
    if (!response.ok || !isRecord(payload) || payload.status !== true || !('data' in payload)) {
      throw new PaystackServiceError('UNAVAILABLE');
    }
    return (payload as PaystackEnvelope<T>).data as T;
  }
}