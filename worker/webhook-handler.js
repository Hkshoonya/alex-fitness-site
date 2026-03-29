/**
 * Square → Trainerize Webhook Sync Worker
 *
 * Deployed as a Cloudflare Worker (free tier).
 * Catches Square webhook events and syncs to Trainerize.
 *
 * WHAT IT DOES:
 * When Square auto-charges a recurring subscription payment:
 *   1. Square sends webhook → this worker
 *   2. Worker reads the payment/subscription details
 *   3. Calls Trainerize API to add session credits to the client
 *   4. Trainerize app shows updated credits for the client
 *
 * EVENTS HANDLED:
 *   subscription.updated  → subscription renewed, add credits
 *   payment.completed     → payment went through, confirm credits
 *   subscription.canceled → subscription ended, no more credits
 *
 * SETUP:
 *   1. Deploy this as a Cloudflare Worker
 *   2. Set environment variables in Cloudflare dashboard:
 *      - SQUARE_WEBHOOK_SIGNATURE_KEY (from Square Dashboard > Webhooks)
 *      - TRAINERIZE_API_KEY
 *      - TRAINERIZE_API_URL
 *      - TRAINERIZE_TRAINER_ID
 *   3. In Square Dashboard > Webhooks > Add endpoint:
 *      URL: https://your-worker.your-subdomain.workers.dev
 *      Events: subscription.updated, payment.completed
 *   4. Done — Square auto-pay → Trainerize credits, fully automatic
 */

// Session credits per plan (map plan names to sessions per billing cycle)
const PLAN_CREDITS = {
  '4 Week Plan - 30 Min Sessions': { sessions: 4, duration: 30 },
  '4 Week Plan - 60 Min Sessions': { sessions: 4, duration: 60 },
  '4 Week Plan - 90 Min Sessions': { sessions: 4, duration: 90 },
  '12 Week Plan - 30 Min Sessions': { sessions: 12, duration: 30 },
  '12 Week Plan - 60 Min Sessions': { sessions: 12, duration: 60 },
  '12 Week Plan - 90 Min Sessions': { sessions: 12, duration: 90 },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ===== CHALLENGES API =====
    // GET /challenges — list active challenges (website fetches this)
    // POST /challenges — add a challenge (from admin or Zapier/Trainerize webhook)
    // DELETE /challenges/:id — remove a challenge

    if (url.pathname === '/challenges' && request.method === 'GET') {
      const challenges = await getChallenges(env);
      const now = new Date();
      const active = challenges.filter(c => new Date(c.endDate) > now);
      return new Response(JSON.stringify(active), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/challenges' && request.method === 'POST') {
      const data = await request.json();
      const challenge = {
        id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: data.title || '',
        description: data.description || '',
        startDate: data.startDate || data.start_date || '',
        endDate: data.endDate || data.end_date || '',
        duration: data.duration || '4 Weeks',
        prize: data.prize || null,
        spots: data.spots || null,
        spotsLeft: data.spots || null,
        price: data.price || 0,
        tags: data.tags || [],
        trainerizeId: data.trainerizeId || data.trainerize_id || null,
        createdAt: new Date().toISOString(),
      };

      await saveChallenge(challenge, env);
      return new Response(JSON.stringify(challenge), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (url.pathname.startsWith('/challenges/') && request.method === 'DELETE') {
      const id = url.pathname.split('/challenges/')[1];
      await deleteChallenge(id, env);
      return new Response(JSON.stringify({ deleted: id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== SQUARE WEBHOOK =====
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const body = await request.text();

      // Verify Square webhook signature
      if (env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
        const signature = request.headers.get('x-square-hmacsha256-signature');
        const isValid = await verifySignature(body, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY);
        if (!isValid) {
          return new Response('Invalid signature', { status: 401 });
        }
      }

      const event = JSON.parse(body);
      const eventType = event.type;

      console.log(`Webhook received: ${eventType}`);

      // ---- SUBSCRIPTION EVENTS ----
      if (eventType === 'subscription.updated') {
        const subscription = event.data?.object?.subscription;
        if (!subscription) return new Response('OK', { status: 200 });

        const status = subscription.status;

        if (status === 'ACTIVE') {
          await handleSubscriptionRenewal(subscription, env);
          await syncPaymentStatusToTrainerize(subscription.customer_id, 'paid', subscription, env);
        } else if (status === 'CANCELED' || status === 'DEACTIVATED') {
          await syncPaymentStatusToTrainerize(subscription.customer_id, 'canceled', subscription, env);
        } else if (status === 'PAUSED') {
          await syncPaymentStatusToTrainerize(subscription.customer_id, 'paused', subscription, env);
        } else if (status === 'PENDING') {
          await syncPaymentStatusToTrainerize(subscription.customer_id, 'due', subscription, env);
        }
      }

      // ---- PAYMENT COMPLETED ----
      if (eventType === 'payment.completed') {
        const payment = event.data?.object?.payment;
        if (!payment) return new Response('OK', { status: 200 });

        if (payment.subscription_id) {
          await handleSubscriptionPayment(payment, env);
        }
        // Mark client as paid in Trainerize
        if (payment.customer_id) {
          await syncPaymentStatusToTrainerize(payment.customer_id, 'paid', payment, env);
        }
      }

      // ---- PAYMENT FAILED ----
      if (eventType === 'payment.failed') {
        const payment = event.data?.object?.payment;
        if (payment?.customer_id) {
          await syncPaymentStatusToTrainerize(payment.customer_id, 'unpaid', payment, env);
        }
      }

      // ---- INVOICE EVENTS ----
      if (eventType === 'invoice.payment_made') {
        const invoice = event.data?.object?.invoice;
        if (invoice?.primary_recipient?.customer_id) {
          await syncPaymentStatusToTrainerize(invoice.primary_recipient.customer_id, 'paid', invoice, env);
        }
      }

      if (eventType === 'invoice.payment_failed' || eventType === 'invoice.updated') {
        const invoice = event.data?.object?.invoice;
        if (invoice?.primary_recipient?.customer_id) {
          const invStatus = invoice.status;
          if (invStatus === 'UNPAID' || invStatus === 'PAYMENT_PENDING') {
            await syncPaymentStatusToTrainerize(invoice.primary_recipient.customer_id, 'unpaid', invoice, env);
          } else if (invStatus === 'OVERDUE') {
            await syncPaymentStatusToTrainerize(invoice.primary_recipient.customer_id, 'overdue', invoice, env);
          }
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Webhook error:', error);
      return new Response('Error', { status: 500 });
    }
  },
};

/**
 * When a subscription renews, add session credits in Trainerize
 */
async function handleSubscriptionRenewal(subscription, env) {
  const customerId = subscription.customer_id;
  const planName = subscription.plan_variation_data?.name || '';

  // Find matching plan credits
  const credits = findPlanCredits(planName);
  if (!credits) {
    console.log(`No credit mapping for plan: ${planName}`);
    return;
  }

  // Get customer email from Square
  const customerEmail = await getCustomerEmail(customerId, env);
  if (!customerEmail) {
    console.log(`No email found for customer: ${customerId}`);
    return;
  }

  // Update credits in Trainerize
  await updateTrainerizeCredits(customerEmail, planName, credits, env);

  console.log(`Credits added: ${customerEmail} → ${credits.sessions} sessions (${planName})`);
}

/**
 * When a subscription payment completes, confirm credits in Trainerize
 */
async function handleSubscriptionPayment(payment, env) {
  const customerId = payment.customer_id;

  const customerEmail = await getCustomerEmail(customerId, env);
  if (!customerEmail) return;

  // Send a message to Trainerize that payment was confirmed
  await sendTrainerizeMessage(customerEmail, `Payment confirmed: $${(payment.amount_money?.amount || 0) / 100}`, env);
}

/**
 * Get customer email from Square Customers API
 */
async function getCustomerEmail(customerId, env) {
  try {
    const response = await fetch(
      `${getSquareApiBase(env)}/customers/${customerId}`,
      { headers: getSquareHeaders(env) }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.customer?.email_address || null;
  } catch {
    return null;
  }
}

/**
 * Update session credits in Trainerize
 */
async function updateTrainerizeCredits(email, planName, credits, env) {
  const apiBase = env.TRAINERIZE_API_URL || 'https://api.trainerize.com/v2';
  const apiKey = env.TRAINERIZE_API_KEY;

  if (!apiKey) {
    console.log('Trainerize API key not configured — skipping credit update');
    return;
  }

  try {
    // First, find or create client
    await fetch(`${apiBase}/clients`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        trainer_id: env.TRAINERIZE_TRAINER_ID || undefined,
        send_invite: false, // Don't re-send invite on renewal
        tags: ['subscription-active'],
      }),
    });

    // Update credits
    await fetch(`${apiBase}/clients/credits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_email: email,
        plan_name: planName,
        total_sessions: credits.sessions,
        sessions_used: 0,
        sessions_remaining: credits.sessions,
        valid_until: getNextBillingDate(),
      }),
    });
  } catch (error) {
    console.error('Trainerize credit update failed:', error);
  }
}

/**
 * Send a message to client in Trainerize
 */
async function sendTrainerizeMessage(email, message, env) {
  const apiBase = env.TRAINERIZE_API_URL || 'https://api.trainerize.com/v2';
  const apiKey = env.TRAINERIZE_API_KEY;

  if (!apiKey) return;

  try {
    await fetch(`${apiBase}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_email: email,
        message,
      }),
    });
  } catch (error) {
    console.error('Trainerize message failed:', error);
  }
}

/**
 * Sync payment status to Trainerize
 * Updates client's profile so both Alex and the client see the status:
 *
 * 1. TAGS — Alex sees at a glance in client list:
 *    payment-paid, payment-due, payment-unpaid, payment-overdue, payment-canceled
 *
 * 2. NOTES — detailed payment history on client profile
 *
 * 3. MESSAGE — client gets notified in Trainerize app
 */
async function syncPaymentStatusToTrainerize(squareCustomerId, status, eventData, env) {
  const apiBase = env.TRAINERIZE_API_URL || 'https://api.trainerize.com/v2';
  const apiKey = env.TRAINERIZE_API_KEY;

  if (!apiKey) {
    console.log('Trainerize API key not set — skipping payment status sync');
    return;
  }

  const email = await getCustomerEmail(squareCustomerId, env);
  if (!email) return;

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const amount = eventData?.amount_money?.amount
    ? `$${(eventData.amount_money.amount / 100).toFixed(2)}`
    : eventData?.payment_requests?.[0]?.computed_amount_money?.amount
      ? `$${(eventData.payment_requests[0].computed_amount_money.amount / 100).toFixed(2)}`
      : '';

  // Calculate next due date from subscription
  let nextDueDate = '';
  if (eventData?.charged_through_date) {
    nextDueDate = eventData.charged_through_date;
  } else if (eventData?.next_payment_date) {
    nextDueDate = eventData.next_payment_date;
  }

  // Tag definitions
  const allPaymentTags = ['payment-paid', 'payment-due', 'payment-unpaid', 'payment-overdue', 'payment-canceled', 'payment-paused'];
  const newTag = `payment-${status}`;

  // 1. Remove old payment tags, add new one
  try {
    // Remove all old payment tags
    for (const tag of allPaymentTags) {
      await fetch(`${apiBase}/clients/tags/remove`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_email: email, tag }),
      });
    }

    // Add current status tag
    await fetch(`${apiBase}/clients/tags`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_email: email, tag: newTag }),
    });

    // Add next-due-date tag if available
    if (nextDueDate) {
      await fetch(`${apiBase}/clients/tags`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_email: email, tag: `next-due:${nextDueDate}` }),
      });
    }
  } catch (e) {
    console.error('Trainerize tag update failed:', e);
  }

  // 2. Update client notes with payment history
  const noteLines = {
    paid: `✅ Payment received ${amount} on ${now}${nextDueDate ? `. Next due: ${nextDueDate}` : ''}`,
    due: `📅 Payment due ${amount}${nextDueDate ? ` on ${nextDueDate}` : ''}`,
    unpaid: `❌ Payment failed ${amount} on ${now}. Card on file was declined.`,
    overdue: `🚨 Payment overdue ${amount} as of ${now}. Please update payment method.`,
    canceled: `⛔ Subscription canceled on ${now}.`,
    paused: `⏸️ Subscription paused on ${now}.`,
  };

  try {
    // Get existing notes
    const clientRes = await fetch(`${apiBase}/clients?email=${encodeURIComponent(email)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    let existingNotes = '';
    if (clientRes.ok) {
      const clientData = await clientRes.json();
      existingNotes = clientData.clients?.[0]?.notes || '';
    }

    // Append new payment note (keep last 10 entries)
    const noteHistory = existingNotes.split('\n---\n').filter(Boolean).slice(-9);
    noteHistory.push(noteLines[status] || `Payment status: ${status}`);
    const updatedNotes = noteHistory.join('\n---\n');

    await fetch(`${apiBase}/clients`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        notes: updatedNotes,
        trainer_id: env.TRAINERIZE_TRAINER_ID || undefined,
        send_invite: false,
      }),
    });
  } catch (e) {
    console.error('Trainerize note update failed:', e);
  }

  // 3. Send message to client (they see it in Trainerize app)
  const clientMessages = {
    paid: `Your payment of ${amount} has been received. Thank you! 💪${nextDueDate ? `\n\nNext payment: ${nextDueDate}` : ''}`,
    due: `Reminder: Your payment of ${amount} is coming up${nextDueDate ? ` on ${nextDueDate}` : ''}. Make sure your payment method is up to date!`,
    unpaid: `Your payment of ${amount} could not be processed. Please update your payment method to continue your training plan.`,
    overdue: `Your payment of ${amount} is overdue. Please update your payment method as soon as possible to avoid interruption to your training.`,
    canceled: `Your subscription has been canceled. If you'd like to resume training, book a session anytime!`,
    paused: `Your subscription has been paused. When you're ready to resume, just let us know!`,
  };

  if (clientMessages[status]) {
    await sendTrainerizeMessage(email, clientMessages[status], env);
  }

  console.log(`Payment status synced to Trainerize: ${email} → ${status} ${amount}`);
}

/**
 * Match plan name to session credits
 */
function findPlanCredits(planName) {
  for (const [name, credits] of Object.entries(PLAN_CREDITS)) {
    if (planName.toLowerCase().includes(name.toLowerCase().split(' - ')[0])) {
      return credits;
    }
  }
  // Default: 4 sessions per billing cycle
  return { sessions: 4, duration: 60 };
}

/**
 * Calculate next billing date (4 weeks from now)
 */
function getNextBillingDate() {
  const date = new Date();
  date.setDate(date.getDate() + 28);
  return date.toISOString();
}

/**
 * Get Square API base URL
 */
function getSquareApiBase(env) {
  const appId = env.SQUARE_APPLICATION_ID || '';
  return appId.startsWith('sandbox-')
    ? 'https://connect.squareupsandbox.com/v2'
    : 'https://connect.squareup.com/v2';
}

/**
 * Get Square API headers
 */
function getSquareHeaders(env) {
  return {
    'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    'Square-Version': '2024-01-18',
    'Content-Type': 'application/json',
  };
}

/**
 * Verify Square webhook signature
 */
async function verifySignature(body, signature, key) {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(body);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return computed === signature;
}

// ===== CHALLENGES KV STORAGE =====

async function getChallenges(env) {
  if (!env.CHALLENGES_KV) return [];
  const raw = await env.CHALLENGES_KV.get('challenges');
  return raw ? JSON.parse(raw) : [];
}

async function saveChallenge(challenge, env) {
  if (!env.CHALLENGES_KV) return;
  const all = await getChallenges(env);
  all.push(challenge);
  await env.CHALLENGES_KV.put('challenges', JSON.stringify(all));
}

async function deleteChallenge(id, env) {
  if (!env.CHALLENGES_KV) return;
  const all = await getChallenges(env);
  const filtered = all.filter(c => c.id !== id);
  await env.CHALLENGES_KV.put('challenges', JSON.stringify(filtered));
}
