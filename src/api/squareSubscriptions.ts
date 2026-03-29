// Square Subscriptions API — Recurring Auto-Pay
//
// Flow:
// 1. First purchase: customer pays, card stored on file
// 2. Square creates subscription tied to that card
// 3. Auto-charges every billing cycle (weekly/monthly) — no new payment needed
// 4. Customer stays on same page, no redirect
//
// How it works with Square:
// - Catalog API: create subscription plan + variation (cadence, price)
// - Subscriptions API: subscribe customer to plan with card on file
// - Square handles all recurring billing automatically
// - Customer gets invoice emails from Square
// - You can pause/cancel/resume from Square Dashboard or API

import { getSquareConfig, getSquareHeaders, SQUARE_API_BASE } from '@/api/squareConfig';

interface CreateSubscriptionParams {
  customerId: string;
  cardId: string;
  planVariationId: string;
  locationId?: string;
}

// ===== CATALOG: Create Subscription Plans =====

/**
 * Create a subscription plan in Square Catalog
 * Call once per plan type — Square stores it, then customers subscribe to it
 */
export async function createSubscriptionPlan(
  name: string,
  cadence: 'WEEKLY' | 'MONTHLY',
  priceAmountCents: number
): Promise<{ success: boolean; planId?: string; variationId?: string }> {
  const config = getSquareConfig();
  if (!config.isConfigured) return { success: false };

  try {
    const response = await fetch(`${SQUARE_API_BASE}/catalog/object`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        idempotency_key: `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: `#plan_${Date.now()}`,
          subscription_plan_data: {
            name,
            subscription_plan_variations: [
              {
                type: 'SUBSCRIPTION_PLAN_VARIATION',
                id: `#var_${Date.now()}`,
                subscription_plan_variation_data: {
                  name: `${name} — ${cadence.toLowerCase()}`,
                  phases: [
                    {
                      cadence,
                      pricing: {
                        type: 'STATIC',
                        price_money: {
                          amount: priceAmountCents,
                          currency: 'USD',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.errors?.[0]?.detail || `API error ${response.status}`);
    }

    const data = await response.json();
    const obj = data.catalog_object;
    const variation = obj?.subscription_plan_data?.subscription_plan_variations?.[0];

    return {
      success: true,
      planId: obj?.id,
      variationId: variation?.id,
    };
  } catch (error) {
    console.error('Create subscription plan failed:', error);
    return { success: false };
  }
}

// ===== CUSTOMERS: Store Card on File =====

/**
 * Store a customer's card for recurring charges
 * Called after first payment — card token from Web Payments SDK
 */
export async function storeCardOnFile(
  customerId: string,
  cardToken: string
): Promise<{ success: boolean; cardId?: string }> {
  const config = getSquareConfig();
  if (!config.isConfigured) {
    // Mock
    return { success: true, cardId: `mock_card_${Date.now()}` };
  }

  try {
    const response = await fetch(`${SQUARE_API_BASE}/cards`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        idempotency_key: `card_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        source_id: cardToken,
        card: {
          customer_id: customerId,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.errors?.[0]?.detail || 'Failed to store card');
    }

    const data = await response.json();
    return { success: true, cardId: data.card?.id };
  } catch (error) {
    console.error('Store card failed:', error);
    return { success: false };
  }
}

// ===== SUBSCRIPTIONS: Create & Manage =====

/**
 * Subscribe a customer to a recurring plan
 * The card on file gets auto-charged every billing cycle
 */
export async function createSubscription(
  params: CreateSubscriptionParams
): Promise<{ success: boolean; subscriptionId?: string }> {
  const config = getSquareConfig();
  if (!config.isConfigured) {
    // Mock
    const subId = `mock_sub_${Date.now()}`;
    storeSubscriptionLocally(subId, params);
    return { success: true, subscriptionId: subId };
  }

  try {
    const response = await fetch(`${SQUARE_API_BASE}/subscriptions`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        idempotency_key: `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        location_id: params.locationId || config.locationId,
        plan_variation_id: params.planVariationId,
        customer_id: params.customerId,
        card_id: params.cardId,
        start_date: new Date().toISOString().split('T')[0],
        timezone: 'America/New_York',
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.errors?.[0]?.detail || 'Failed to create subscription');
    }

    const data = await response.json();
    const subId = data.subscription?.id;
    storeSubscriptionLocally(subId, params);

    return { success: true, subscriptionId: subId };
  } catch (error) {
    console.error('Create subscription failed:', error);
    return { success: false };
  }
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(subscriptionId: string): Promise<{ success: boolean }> {
  const config = getSquareConfig();
  if (!config.isConfigured) return { success: true };

  try {
    const response = await fetch(`${SQUARE_API_BASE}/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: getSquareHeaders(),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Cancel subscription failed:', error);
    return { success: false };
  }
}

/**
 * Pause a subscription
 */
export async function pauseSubscription(subscriptionId: string): Promise<{ success: boolean }> {
  const config = getSquareConfig();
  if (!config.isConfigured) return { success: true };

  try {
    const response = await fetch(`${SQUARE_API_BASE}/subscriptions/${subscriptionId}/pause`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({ pause_reason: 'Customer requested pause' }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Pause subscription failed:', error);
    return { success: false };
  }
}

/**
 * Resume a paused subscription
 */
export async function resumeSubscription(subscriptionId: string): Promise<{ success: boolean }> {
  const config = getSquareConfig();
  if (!config.isConfigured) return { success: true };

  try {
    const response = await fetch(`${SQUARE_API_BASE}/subscriptions/${subscriptionId}/resume`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({ resume_effective_date: new Date().toISOString().split('T')[0] }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Resume subscription failed:', error);
    return { success: false };
  }
}

// ===== FULL PURCHASE-TO-SUBSCRIPTION FLOW =====

/**
 * Complete purchase and set up auto-pay in one call
 *
 * 1. First payment charged via card token
 * 2. Card stored on customer's file
 * 3. Subscription created — auto-charges on cadence
 * 4. Customer stays on same page, no redirect
 */
export async function purchaseAndSubscribe(params: {
  customerId: string;
  cardToken: string;
  planVariationId: string;
  firstPaymentAmountCents: number;
}): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
  const config = getSquareConfig();

  if (!config.isConfigured) {
    // Mock the full flow
    await new Promise(r => setTimeout(r, 2000));
    const subId = `mock_sub_${Date.now()}`;
    storeSubscriptionLocally(subId, {
      customerId: params.customerId,
      cardId: `mock_card_${Date.now()}`,
      planVariationId: params.planVariationId,
    });
    return { success: true, subscriptionId: subId };
  }

  try {
    // Step 1: Process first payment
    const paymentResponse = await fetch(`${SQUARE_API_BASE}/payments`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        idempotency_key: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        source_id: params.cardToken,
        amount_money: {
          amount: params.firstPaymentAmountCents,
          currency: 'USD',
        },
        customer_id: params.customerId,
        location_id: config.locationId,
        autocomplete: true,
      }),
    });

    if (!paymentResponse.ok) {
      const err = await paymentResponse.json().catch(() => ({}));
      throw new Error(err.errors?.[0]?.detail || 'Payment failed');
    }

    // Step 2: Store card on file for future auto-charges
    const cardResult = await storeCardOnFile(params.customerId, params.cardToken);
    if (!cardResult.success || !cardResult.cardId) {
      throw new Error('Failed to store card for recurring billing');
    }

    // Step 3: Create subscription — auto-pay starts from next billing cycle
    const subResult = await createSubscription({
      customerId: params.customerId,
      cardId: cardResult.cardId,
      planVariationId: params.planVariationId,
    });

    if (!subResult.success) {
      throw new Error('Failed to create subscription');
    }

    return { success: true, subscriptionId: subResult.subscriptionId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Subscription setup failed',
    };
  }
}

// ===== LOCAL STORAGE =====

function storeSubscriptionLocally(subscriptionId: string, params: Partial<CreateSubscriptionParams>) {
  const subs = JSON.parse(localStorage.getItem('subscriptions') || '[]');
  subs.push({
    subscriptionId,
    ...params,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem('subscriptions', JSON.stringify(subs));
}

export function getActiveSubscriptions(): any[] {
  return JSON.parse(localStorage.getItem('subscriptions') || '[]')
    .filter((s: any) => s.status === 'active');
}
