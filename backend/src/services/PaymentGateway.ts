import { PaystackServiceError } from './PaystackService';
import type { PaystackCheckout, PaystackTransaction } from './PaystackService';
import { FlutterwaveService, FlutterwaveServiceError } from './FlutterwaveService';

export interface PaymentGateway {
  readonly isTestModeConfigured: boolean;
  initializeTransaction(input: { email: string; amountKobo: number; reference: string }): Promise<PaystackCheckout>;
  verifyTransaction(reference: string): Promise<PaystackTransaction>;
  refundTransaction(reference: string): Promise<unknown>;
}

function translate(error: unknown): never {
  if (error instanceof FlutterwaveServiceError) {
    throw new PaystackServiceError(error.code);
  }
  throw error;
}

export class FlutterwaveGateway implements PaymentGateway {
  constructor(private readonly flutterwave: FlutterwaveService) {}

  get isTestModeConfigured() {
    return this.flutterwave.isTestModeConfigured;
  }

  async initializeTransaction(input: { email: string; amountKobo: number; reference: string }) {
    try {
      const checkout = await this.flutterwave.initializeTransaction(input);
      return { authorizationUrl: checkout.authorizationUrl, accessCode: '', reference: checkout.reference };
    } catch (error) {
      return translate(error);
    }
  }

  async verifyTransaction(reference: string) {
    try {
      const verified = await this.flutterwave.verifyTransaction(reference);
      return {
        status: verified.status,
        reference: verified.reference,
        amount: verified.amountKobo,
        currency: verified.currency,
        ...(verified.channel ? { channel: verified.channel } : {}),
      };
    } catch (error) {
      return translate(error);
    }
  }

  async refundTransaction(reference: string) {
    try {
      return await this.flutterwave.refundTransaction(reference);
    } catch (error) {
      return translate(error);
    }
  }
}
