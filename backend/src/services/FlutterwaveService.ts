import { timingSafeEqual } from 'node:crypto';

export type FlutterwaveTransaction = {
  id: number;
  status: string;
  reference: string;
  amountKobo: number;
  currency: string;
  channel?: string;
};

export type FlutterwaveCheckout = {
  authorizationUrl: string;
  reference: string;
};

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class FlutterwaveServiceError extends Error {
  constructor(readonly code: 'NOT_CONFIGURED' | 'INVALID_RESPONSE' | 'UNAVAILABLE') {
    super(code);
    this.name = 'FlutterwaveServiceError';
  }
}

// Flutterwave v3 sends your own secret hash in the "verif-hash" header.
export function isValidFlutterwaveHash(received: string | undefined, secretHash: string | undefined) {
  if (!received || !secretHash) {
    return false;
  }
  const actual = Buffer.from(received);
  const expected = Buffer.from(secretHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class FlutterwaveService {
  constructor(
    private readonly secretKey: string | undefined,
    private readonly redirectUrl: string | undefined,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  get isTestModeConfigured() {
    return Boolean((this.secretKey?.startsWith('FLWSECK_TEST-') || this.secretKey?.startsWith('FLWSECK-')) && this.redirectUrl);
  }

  async initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
  }): Promise<FlutterwaveCheckout> {
    const data = await this.request<unknown>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: input.amountKobo / 100,
        currency: 'NGN',
        redirect_url: this.redirectUrl,
        customer: { email: input.email },
        customizations: { title: 'Geniuz+ Member' },
      }),
    });
    if (!isRecord(data) || typeof data.link !== 'string') {
      throw new FlutterwaveServiceError('INVALID_RESPONSE');
    }
    return { authorizationUrl: data.link, reference: input.reference };
  }

  async verifyTransaction(reference: string): Promise<FlutterwaveTransaction> {
    const data = await this.request<unknown>(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    if (
      !isRecord(data) ||
      typeof data.id !== 'number' ||
      typeof data.status !== 'string' ||
      typeof data.tx_ref !== 'string' ||
      typeof data.amount !== 'number' ||
      typeof data.currency !== 'string' ||
      data.tx_ref !== reference
    ) {
      throw new FlutterwaveServiceError('INVALID_RESPONSE');
    }
    return {
      id: data.id,
      status: data.status === 'successful' ? 'success' : data.status,
      reference: data.tx_ref,
      amountKobo: Math.round(data.amount * 100),
      currency: data.currency,
      ...(typeof data.payment_type === 'string' ? { channel: data.payment_type } : {}),
    };
  }

  async refundTransaction(reference: string) {
    const transaction = await this.verifyTransaction(reference);
    return this.request<unknown>(`/transactions/${transaction.id}/refund`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.isTestModeConfigured || !this.secretKey) {
      throw new FlutterwaveServiceError('NOT_CONFIGURED');
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(`https://api.flutterwave.com/v3${path}`, {
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
      throw new FlutterwaveServiceError('UNAVAILABLE');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FlutterwaveServiceError('INVALID_RESPONSE');
    }
    if (!response.ok || !isRecord(payload) || payload.status !== 'success' || !('data' in payload)) {
      throw new FlutterwaveServiceError('UNAVAILABLE');
    }
    return payload.data as T;
  }
}
