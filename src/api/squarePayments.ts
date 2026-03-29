// Square Payment Processing API
// Supports: Card, Apple Pay, Google Pay, Cash App Pay
// Auto-detects device and shows available payment methods

import type { TrainingPlan } from '@/data/trainingPlans';
import { getSquareConfig, getSquareHeaders, SQUARE_API_BASE, SQUARE_WEB_SDK_URL } from '@/api/squareConfig';

const { applicationId: SQUARE_APPLICATION_ID, locationId: SQUARE_LOCATION_ID } = getSquareConfig();

let squarePayments: any = null;

export interface PaymentMethods {
  card: any;
  applePay: any | null;
  googlePay: any | null;
  cashAppPay: any | null;
}

export const loadSquareSdk = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.Square) { resolve(); return; }
    const script = document.createElement('script');
    script.src = SQUARE_WEB_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Square SDK'));
    document.body.appendChild(script);
  });
};

export const initializeSquarePayments = async () => {
  if (!window.Square) await loadSquareSdk();

  if (!SQUARE_APPLICATION_ID) {
    console.warn('Square Application ID not configured');
    return null;
  }

  try {
    squarePayments = window.Square.payments(SQUARE_APPLICATION_ID, SQUARE_LOCATION_ID);
    return squarePayments;
  } catch (error) {
    console.error('Failed to initialize Square payments:', error);
    return null;
  }
};

/**
 * Initialize all available payment methods
 * Auto-detects device capabilities:
 * - Card: always available
 * - Apple Pay: Safari on iOS/macOS with configured wallet
 * - Google Pay: Chrome/Android with configured wallet
 * - Cash App Pay: always available
 */
export const initializeAllPaymentMethods = async (
  amountCents: number
): Promise<PaymentMethods | null> => {
  const payments = await initializeSquarePayments();
  if (!payments) return null;

  const methods: PaymentMethods = {
    card: null,
    applePay: null,
    googlePay: null,
    cashAppPay: null,
  };

  // Card — always available
  try {
    methods.card = await payments.card();
  } catch (e) {
    console.error('Card init failed:', e);
  }

  // Apple Pay — only on supported devices
  try {
    const paymentRequest = payments.paymentRequest({
      countryCode: 'US',
      currencyCode: 'USD',
      total: { amount: String(amountCents), label: 'Alex Davis Fitness' },
    });
    methods.applePay = await payments.applePay(paymentRequest);
  } catch {
    // Apple Pay not available on this device — that's fine
  }

  // Google Pay — only on supported devices
  try {
    const paymentRequest = payments.paymentRequest({
      countryCode: 'US',
      currencyCode: 'USD',
      total: { amount: String(amountCents), label: 'Alex Davis Fitness' },
    });
    methods.googlePay = await payments.googlePay(paymentRequest);
  } catch {
    // Google Pay not available on this device — that's fine
  }

  // Cash App Pay — available everywhere
  try {
    const paymentRequest = payments.paymentRequest({
      countryCode: 'US',
      currencyCode: 'USD',
      total: { amount: String(amountCents), label: 'Alex Davis Fitness' },
    });
    methods.cashAppPay = await payments.cashAppPay(paymentRequest, {
      redirectURL: window.location.href,
      referenceId: `cashapp_${Date.now()}`,
    });
  } catch {
    // Cash App not available — that's fine
  }

  return methods;
};

export const createCardPayment = async (
  plan: TrainingPlan,
  trainerId: 'alex1' | 'alex2',
  cardToken: string
): Promise<{ success: boolean; paymentId?: string; error?: string }> => {
  if (!SQUARE_APPLICATION_ID) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { success: true, paymentId: `mock_payment_${Date.now()}` };
  }

  try {
    const response = await fetch(`${SQUARE_API_BASE}/payments`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        source_id: cardToken,
        idempotency_key: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        amount_money: {
          amount: Math.round(plan.price * 100),
          currency: 'USD',
        },
        location_id: SQUARE_LOCATION_ID,
        reference_id: plan.id,
        note: `${plan.name} - ${trainerId}`,
        autocomplete: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.errors?.[0]?.detail || 'Payment failed');
    }

    return { success: true, paymentId: data.payment.id };
  } catch (error) {
    console.error('Payment error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Payment failed' };
  }
};

// Store purchase in localStorage
export const storePurchase = (purchase: {
  planId: string;
  trainerId: 'alex1' | 'alex2';
  paymentId: string;
  amount: number;
  purchaseDate: string;
  sessionsRemaining: number;
  validUntil: string;
}) => {
  const purchases = JSON.parse(localStorage.getItem('purchases') || '[]');
  purchases.push({ ...purchase, id: `purchase_${Date.now()}` });
  localStorage.setItem('purchases', JSON.stringify(purchases));
  return purchase;
};

export const getPurchases = () => JSON.parse(localStorage.getItem('purchases') || '[]');

export const getAvailableSessions = (trainerId?: 'alex1' | 'alex2') => {
  const now = new Date();
  return getPurchases().filter((p: any) => {
    if (trainerId && p.trainerId !== trainerId) return false;
    if (new Date(p.validUntil) < now) return false;
    return p.sessionsRemaining > 0;
  });
};

export const useSession = (purchaseId: string) => {
  const purchases = getPurchases();
  const purchase = purchases.find((p: any) => p.id === purchaseId);
  if (purchase && purchase.sessionsRemaining > 0) {
    purchase.sessionsRemaining--;
    localStorage.setItem('purchases', JSON.stringify(purchases));
    return true;
  }
  return false;
};

declare global {
  interface Window { Square: any; }
}
