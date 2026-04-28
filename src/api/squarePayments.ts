// Square Payment Processing API
// Supports: Card, Apple Pay, Google Pay, Cash App Pay
// Auto-detects device and shows available payment methods

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

/**
 * Generic card payment — used by flows that aren't tied to a training plan
 * (e.g. challenge entry fees). Returns the Square payment ID so the caller
 * can pass it to worker-side flows that need to verify a real charge
 * happened.
 */
export const createGenericCardPayment = async (params: {
  cardToken: string;
  amountCents: number;
  referenceId: string;
  note: string;
}): Promise<{ success: boolean; paymentId?: string; error?: string }> => {
  if (!SQUARE_APPLICATION_ID) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { success: true, paymentId: `mock_payment_${Date.now()}` };
  }
  if (params.amountCents <= 0) {
    return { success: false, error: 'Amount must be greater than zero' };
  }

  try {
    const response = await fetch(`${SQUARE_API_BASE}/payments`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        source_id: params.cardToken,
        idempotency_key: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        amount_money: { amount: params.amountCents, currency: 'USD' },
        location_id: SQUARE_LOCATION_ID,
        reference_id: params.referenceId.slice(0, 40),
        note: params.note.slice(0, 500),
        autocomplete: true,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.detail || 'Payment failed');
    }
    return { success: true, paymentId: data.payment.id };
  } catch (error) {
    console.error('Generic payment error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Payment failed' };
  }
};

// Plan purchases route through the worker's /checkout/charge endpoint. We
// send only IDENTIFIERS (planId, frequencyIndex, trainerId) — never the
// amount. The worker derives amountCents from its server-side PLAN_CATALOG.
// This is the C-02 fix: previously the browser sent amountCents and the
// worker trusted it, so a user who selected the 5x/week + alex2 trainer
// option saw $2880 in the UI but only got charged $720 (the base plan.price).
//
// Saving the card on the same round-trip is what enables auto-invoice
// CARD_ON_FILE at credit exhaustion to actually charge — without a saved
// card, published invoices required manual client payment.
export const createCardPayment = async (params: {
  planId: string;
  // null for flat-price plans (app-only, online-monthly, online-3month)
  frequencyIndex: number | null;
  trainerId: 'alex1' | 'alex2';
  cardToken: string;
  client: { email: string; name: string; phone?: string };
}): Promise<{
  success: boolean;
  paymentId?: string;
  customerId?: string;
  cardId?: string;
  // Server-resolved values — use these for the localStorage purchase record
  // so it agrees with what was actually charged + granted.
  amountCents?: number;
  sessions?: number;
  duration?: number;
  planName?: string;
  validUntil?: string;
  error?: string;
}> => {
  if (!SQUARE_APPLICATION_ID) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { success: true, paymentId: `mock_payment_${Date.now()}` };
  }
  const workerUrl = import.meta.env.VITE_WORKER_URL || '';
  if (!workerUrl) return { success: false, error: 'Worker URL not configured' };

  const nameParts = params.client.name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');

  try {
    const response = await fetch(`${workerUrl}/checkout/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardToken: params.cardToken,
        email: params.client.email,
        firstName, lastName,
        phone: params.client.phone || '',
        planId: params.planId,
        frequencyIndex: params.frequencyIndex,
        trainerId: params.trainerId,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || data.detail || 'Payment failed');
    }
    return {
      success: true,
      paymentId: data.paymentId,
      customerId: data.customerId,
      cardId: data.cardId,
      amountCents: data.amountCents,
      sessions: data.sessions,
      duration: data.duration,
      planName: data.planName,
      validUntil: data.validUntil,
    };
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
  // Optional client details captured during checkout — used by the
  // post-purchase booking flow so the stored booking records carry real
  // contact info instead of the old "Client Name" / "client@example.com"
  // placeholders.
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
}) => {
  let purchases: unknown[] = [];
  try {
    const raw = localStorage.getItem('purchases');
    if (raw) purchases = JSON.parse(raw);
    if (!Array.isArray(purchases)) purchases = [];
  } catch { purchases = []; }
  purchases.push({ ...purchase, id: `purchase_${Date.now()}` });
  try { localStorage.setItem('purchases', JSON.stringify(purchases)); } catch { /* quota */ }
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
