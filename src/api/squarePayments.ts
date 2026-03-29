// Square Payment Processing API
import type { TrainingPlan } from '@/data/trainingPlans';

const SQUARE_APPLICATION_ID = import.meta.env.VITE_SQUARE_APPLICATION_ID || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';

// Load Square Web Payments SDK
let squarePayments: any = null;

export const loadSquareSdk = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.Square) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://web.squarecdn.com/v1/square.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Square SDK'));
    document.body.appendChild(script);
  });
};

export const initializeSquarePayments = async () => {
  if (!window.Square) {
    await loadSquareSdk();
  }

  if (!SQUARE_APPLICATION_ID) {
    console.warn('Square Application ID not configured - using mock mode');
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

export const createCardPayment = async (
  plan: TrainingPlan,
  trainerId: 'alex1' | 'alex2',
  cardToken: string
): Promise<{ success: boolean; paymentId?: string; error?: string }> => {
  // Mock mode for development
  if (!SQUARE_APPLICATION_ID) {
    console.log('Mock payment processing...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    return {
      success: true,
      paymentId: `mock_payment_${Date.now()}`,
    };
  }

  try {
    const response = await fetch('/api/square/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId: cardToken,
        amount: Math.round(plan.price * 100), // Convert to cents
        currency: 'USD',
        referenceId: plan.id,
        note: `${plan.name} - ${trainerId}`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Payment failed');
    }

    return {
      success: true,
      paymentId: data.payment.id,
    };
  } catch (error) {
    console.error('Payment error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Payment failed',
    };
  }
};

// Store purchase in localStorage for demo
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
  purchases.push({
    ...purchase,
    id: `purchase_${Date.now()}`,
  });
  localStorage.setItem('purchases', JSON.stringify(purchases));
  return purchase;
};

// Get user's purchases
export const getPurchases = () => {
  return JSON.parse(localStorage.getItem('purchases') || '[]');
};

// Get available sessions from purchases
export const getAvailableSessions = (trainerId?: 'alex1' | 'alex2') => {
  const purchases = getPurchases();
  const now = new Date();

  return purchases.filter((p: any) => {
    if (trainerId && p.trainerId !== trainerId) return false;
    if (new Date(p.validUntil) < now) return false;
    if (p.sessionsRemaining <= 0) return false;
    return true;
  });
};

// Decrement sessions after booking
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

// Declare global Square type
declare global {
  interface Window {
    Square: any;
  }
}
