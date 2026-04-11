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
 *   3. Calls Trainerize API to update tags, notes, and messages
 *   4. Trainerize app shows updated status for the client
 *
 * EVENTS HANDLED:
 *   subscription.updated  → subscription renewed, add credits
 *   payment.completed     → payment went through, confirm credits
 *   payment.failed        → payment failed, notify client
 *   subscription.canceled → subscription ended, no more credits
 *
 * TRAINERIZE API:
 *   Base URL: https://api.trainerize.com/v03/
 *   Auth: Basic base64(groupID:APIToken)
 *   All endpoints: POST with JSON body (RPC-style)
 *
 * SETUP:
 *   1. Deploy this as a Cloudflare Worker
 *   2. Set secrets via wrangler:
 *      wrangler secret put SQUARE_APPLICATION_ID
 *      wrangler secret put SQUARE_ACCESS_TOKEN
 *      wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
 *      wrangler secret put TRAINERIZE_GROUP_ID
 *      wrangler secret put TRAINERIZE_API_KEY
 *      wrangler secret put TRAINERIZE_TRAINER_ID
 *   3. In Square Dashboard > Webhooks > Add endpoint:
 *      URL: https://your-worker.your-subdomain.workers.dev
 *      Events: subscription.updated, payment.completed
 *   4. Done — Square auto-pay → Trainerize sync, fully automatic
 */

// Trainerize appointment type for synced bookings.
// In-person types require locationID which the API key can't access,
// so we use the virtual PT type for all synced bookings (works without location).
// The notes field contains the actual location for in-person sessions.
const TZ_SYNC_APPOINTMENT_TYPE = 2845440; // "30 min PT Session (virtual)" — duration set via start/end times
const STUDIO_ADDRESS = '13305 Sanctuary Cove Dr, Temple Terrace, FL 33637';

// Booking policy constants
const BOOKING_BUFFER_MINUTES = 90;     // Can't book within 90 min without coach confirmation
const CANCEL_NOTICE_HOURS = 24;        // 24-hr cancellation notice required
const TIMEZONE = 'America/New_York';

// Session credits per plan (map plan names to sessions per billing cycle)
const PLAN_CREDITS = {
  '4 Week Plan - 30 Min Sessions': { sessions: 4, duration: 30 },
  '4 Week Plan - 60 Min Sessions': { sessions: 4, duration: 60 },
  '4 Week Plan - 90 Min Sessions': { sessions: 4, duration: 90 },
  '8 Week Plan - 30 Min Sessions': { sessions: 8, duration: 30 },
  '8 Week Plan - 60 Min Sessions': { sessions: 8, duration: 60 },
  '8 Week Plan - 90 Min Sessions': { sessions: 8, duration: 90 },
  '8 Session - 30 Min': { sessions: 8, duration: 30 },
  '8 Session - 60 Min': { sessions: 8, duration: 60 },
  '8 Session - 90 Min': { sessions: 8, duration: 90 },
  '12 Week Plan - 30 Min Sessions': { sessions: 12, duration: 30 },
  '12 Week Plan - 60 Min Sessions': { sessions: 12, duration: 60 },
  '12 Week Plan - 90 Min Sessions': { sessions: 12, duration: 90 },
};

// ===== TRAINERIZE API HELPERS =====

const TRAINERIZE_API_BASE = 'https://api.trainerize.com/v03';

function getTrainerizeGroupId(env) {
  return env.TRAINERIZE_TRAINER_GROUP_ID || env.TRAINERIZE_GROUP_ID || env.TRAINERIZE_TRAINER_ID;
}

function getTrainerizeHeaders(env) {
  const token = btoa(`${getTrainerizeGroupId(env)}:${env.TRAINERIZE_API_KEY}`);
  return {
    'Authorization': `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

function getTrainerizeTrainerId(env) {
  // Coach Alex's user ID in Trainerize (10860818), NOT the group ID (359489) used for auth
  return parseInt(env.TRAINERIZE_COACH_USER_ID || '10860818');
}

function isTrainerizeConfigured(env) {
  return !!(getTrainerizeGroupId(env) && env.TRAINERIZE_API_KEY);
}

/** All Trainerize v03 endpoints use POST with JSON body */
async function trainerizePost(path, body, env) {
  return fetch(`${TRAINERIZE_API_BASE}${path}`, {
    method: 'POST',
    headers: getTrainerizeHeaders(env),
    body: JSON.stringify(body),
  });
}

/**
 * Find a Trainerize user by email → returns integer userID or null
 * Required because tags, messages, and notes all need userID (not email)
 */
async function findTrainerizeUserByEmail(email, env) {
  try {
    const response = await trainerizePost('/user/find', {
      searchTerm: email,
      view: 'allClient',
      start: 0,
      count: 10,
      verbose: false,
    }, env);

    if (!response.ok) return null;

    const data = await response.json();
    const users = data.users || data.result || [];
    if (!Array.isArray(users)) return null;

    const match = users.find(u =>
      (u.email || '').toLowerCase() === email.toLowerCase()
    );
    return match ? (match.userID ?? match.id ?? null) : null;
  } catch {
    return null;
  }
}

// ===== MAIN HANDLER =====

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Square-Version',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ===== SQUARE API PROXY =====
    // ANY /api/square/* → forwards to Square Connect API with server-side auth
    if (url.pathname.startsWith('/api/square/')) {
      try {
        const subpath = url.pathname.replace('/api/square/', '');
        const squareBase = getSquareApiBase(env);
        const targetUrl = `${squareBase}/${subpath}${url.search}`;

        const proxyHeaders = {
          ...getSquareHeaders(env),
        };

        const fetchOptions = {
          method: request.method,
          headers: proxyHeaders,
        };

        // Forward request body for methods that have one
        if (request.method === 'POST' || request.method === 'PUT') {
          fetchOptions.body = await request.text();
        }

        const upstream = await fetch(targetUrl, fetchOptions);
        const responseBody = await upstream.text();

        return new Response(responseBody, {
          status: upstream.status,
          headers: {
            ...corsHeaders,
            'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          },
        });
      } catch (error) {
        console.error('Square proxy error:', error);
        return new Response(JSON.stringify({ error: 'Square API proxy error', detail: error.message }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ===== TRAINERIZE API PROXY =====
    // ANY /api/trainerize/* → forwards to Trainerize v03 API with server-side Basic Auth
    if (url.pathname.startsWith('/api/trainerize/')) {
      try {
        const subpath = url.pathname.replace('/api/trainerize/', '');
        const targetUrl = `${TRAINERIZE_API_BASE}/${subpath}${url.search}`;

        const fetchOptions = {
          method: 'POST', // All Trainerize v03 endpoints are POST
          headers: getTrainerizeHeaders(env),
        };

        // Forward request body
        if (request.method === 'POST' || request.method === 'PUT') {
          fetchOptions.body = await request.text();
        }

        const upstream = await fetch(targetUrl, fetchOptions);
        const responseBody = await upstream.text();

        return new Response(responseBody, {
          status: upstream.status,
          headers: {
            ...corsHeaders,
            'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          },
        });
      } catch (error) {
        console.error('Trainerize proxy error:', error);
        return new Response(JSON.stringify({ error: 'Trainerize API proxy error', detail: error.message }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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

    // ===== AVAILABILITY API =====
    // GET /availability?date=2026-04-15&duration=60
    // Returns coach's real-time availability merging Square bookings + Trainerize appointments
    if (url.pathname === '/availability' && request.method === 'GET') {
      const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
      const duration = parseInt(url.searchParams.get('duration') || '60');

      try {
        const availability = await getCoachAvailability(date, duration, env);
        return new Response(JSON.stringify(availability), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Availability error:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch availability' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ===== BOOKING VALIDATION =====
    // POST /bookings/validate — checks 90-min buffer + policy rules
    if (url.pathname === '/bookings/validate' && request.method === 'POST') {
      const data = await request.json();
      const result = validateBooking(data.startAt, data.duration || 60);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /bookings/cancel-check — warns if within 24hrs
    if (url.pathname === '/bookings/cancel-check' && request.method === 'POST') {
      const data = await request.json();
      const result = checkCancellationPolicy(data.startAt);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== SQUARE WEBHOOK =====
    // Accepts webhooks at root (/) or /webhook path
    if (request.method === 'GET' && (url.pathname === '/webhook' || url.pathname === '/')) {
      return new Response('Webhook endpoint active', { status: 200, headers: corsHeaders });
    }

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

      // ---- BOOKING EVENTS → Trainerize calendar sync ----
      if (eventType === 'booking.created' || eventType === 'booking.updated') {
        const booking = event.data?.object?.booking;
        if (booking) {
          // Skip bookings that were synced FROM Trainerize (prevent loop)
          const isFromTrainerize = (booking.customer_note || '').includes('Synced from Trainerize');
          if (!isFromTrainerize) {
            await syncBookingToTrainerize(booking, env);
          }
        }
      }

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

  // ===== CRON: periodic sync tasks =====
  // Runs every 15 minutes:
  //   1. Sync Trainerize appointments → Square (reverse sync)
  //   2. Deduct credits for completed sessions (past appointment dates)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      syncTrainerizeAppointmentsToSquare(env),
      deductCreditsForCompletedSessions(env),
    ]));
  },
};

/**
 * When a subscription renews, add session credits in Trainerize (via notes + tags)
 */
async function handleSubscriptionRenewal(subscription, env) {
  const customerId = subscription.customer_id;
  const subscriptionId = subscription.id;
  const planName = subscription.plan_variation_data?.name || '';

  // Idempotency: skip if this exact subscription event was already processed
  const idempotencyKey = `sub-renewal:${subscriptionId}:${subscription.version || subscription.updated_at || ''}`;
  if (await env.CHALLENGES_KV.get(idempotencyKey)) {
    console.log(`Subscription renewal already processed: ${subscriptionId}`);
    return;
  }

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

  // Mark as processed (60-day TTL)
  await env.CHALLENGES_KV.put(idempotencyKey, new Date().toISOString(), {
    expirationTtl: 60 * 24 * 3600,
  });

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
  const customer = await getSquareCustomer(customerId, env);
  return customer?.email_address || null;
}

/**
 * Get full customer details from Square Customers API
 * Returns { email_address, given_name, family_name, phone_number, ... } or null
 */
async function getSquareCustomer(customerId, env) {
  if (!customerId) return null;
  try {
    const response = await fetch(
      `${getSquareApiBase(env)}/customers/${customerId}`,
      { headers: getSquareHeaders(env) }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.customer || null;
  } catch {
    return null;
  }
}

/**
 * Update session credits in Trainerize via trainer notes + tags + KV.
 * KV stores the authoritative credit balance; tags are kept in sync for display.
 */
async function updateTrainerizeCredits(email, planName, credits, env) {
  if (!isTrainerizeConfigured(env)) {
    console.log('Trainerize not configured — skipping credit update');
    return;
  }

  try {
    const userId = await findTrainerizeUserByEmail(email, env);
    if (!userId) {
      console.log(`Trainerize user not found for ${email} — skipping credit update`);
      return;
    }

    const validUntil = getNextBillingDate();

    // Store credits in KV (source of truth)
    const creditData = {
      userId,
      email,
      total: credits.sessions,
      remaining: credits.sessions,
      duration: credits.duration,
      planName,
      validUntil,
      updatedAt: new Date().toISOString(),
      deductions: [],
    };
    await env.CHALLENGES_KV.put(`credits:${userId}`, JSON.stringify(creditData));

    // Remove old credit tags, set new one
    await clearCreditTags(userId, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: 'subscription-active' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: `credits:${credits.sessions}` }, env);

    // Add credit note
    await trainerizePost('/trainerNote/add', {
      userID: userId,
      content: `Session credits renewed: ${credits.sessions}x ${credits.duration}min sessions (${planName}). Valid until ${new Date(validUntil).toLocaleDateString('en-US', { timeZone: TIMEZONE })}`,
      type: 'general',
    }, env);

  } catch (error) {
    console.error('Trainerize credit update failed:', error);
  }
}

/**
 * Deduct a session credit for a client.
 * Called on: session completion (date passed) or late cancellation.
 * Updates KV balance + Trainerize tag.
 */
async function deductSessionCredit(userId, reason, env) {
  try {
    const raw = await env.CHALLENGES_KV.get(`credits:${userId}`);
    if (!raw) return;

    const creditData = JSON.parse(raw);
    if (creditData.remaining <= 0) {
      console.log(`No credits remaining for user ${userId}`);
      return;
    }

    // Deduct
    creditData.remaining -= 1;
    creditData.deductions.push({
      date: new Date().toISOString(),
      reason,
    });
    creditData.updatedAt = new Date().toISOString();
    await env.CHALLENGES_KV.put(`credits:${userId}`, JSON.stringify(creditData));

    // Update Trainerize tag
    await clearCreditTags(userId, env);
    await trainerizePost('/user/addTag', {
      userID: userId,
      userTag: `credits:${creditData.remaining}`,
    }, env);

    // Add note
    await trainerizePost('/trainerNote/add', {
      userID: userId,
      content: `Credit deducted (${reason}). ${creditData.remaining}/${creditData.total} sessions remaining.`,
      type: 'general',
    }, env);

    console.log(`Credit deducted for user ${userId}: ${creditData.remaining}/${creditData.total} remaining (${reason})`);
  } catch (e) {
    console.error('Credit deduction failed:', e);
  }
}

/**
 * Remove all credits:X tags from a user.
 */
async function clearCreditTags(userId, env) {
  for (let i = 0; i <= 24; i++) {
    try {
      await trainerizePost('/user/deleteTag', { userID: userId, userTag: `credits:${i}` }, env);
    } catch { /* ignore */ }
  }
}

/**
 * Send a message to client in Trainerize
 */
async function sendTrainerizeMessage(email, message, env) {
  if (!isTrainerizeConfigured(env)) return;

  try {
    const userId = await findTrainerizeUserByEmail(email, env);
    if (!userId) return;

    const trainerId = getTrainerizeTrainerId(env) || undefined;

    await trainerizePost('/message/send', {
      userID: trainerId,
      recipients: [userId],
      subject: 'Payment Update',
      body: message,
      threadType: 'mainThread',
      conversationType: 'single',
      type: 'text',
    }, env);
  } catch (error) {
    console.error('Trainerize message failed:', error);
  }
}

/**
 * Create a new client in Trainerize from Square customer data.
 * Returns the new Trainerize userID or null.
 */
async function createTrainerizeClient(squareCustomer, env) {
  try {
    const resp = await trainerizePost('/user/add', {
      user: {
        firstName: squareCustomer.given_name || '',
        lastName: squareCustomer.family_name || '',
        fullName: `${squareCustomer.given_name || ''} ${squareCustomer.family_name || ''}`.trim(),
        email: squareCustomer.email_address,
        type: 'client',
        trainerID: getTrainerizeTrainerId(env),
        phone: squareCustomer.phone_number || '',
      },
      userTag: 'square-client',
      sendMail: true,
      isSetup: false,
    }, env);

    if (!resp.ok) return null;
    const data = await resp.json();
    return data.userID || data.user?.userID || null;
  } catch (e) {
    console.error('Failed to create Trainerize client:', e);
    return null;
  }
}

/**
 * Update an existing Trainerize client's profile with latest Square data.
 * Syncs name, phone, and address changes.
 */
async function updateTrainerizeClientProfile(userId, squareCustomer, env) {
  try {
    const updates = {};
    if (squareCustomer.given_name) updates.firstName = squareCustomer.given_name;
    if (squareCustomer.family_name) updates.lastName = squareCustomer.family_name;
    if (squareCustomer.phone_number) updates.phone = squareCustomer.phone_number;

    if (Object.keys(updates).length > 0) {
      await trainerizePost('/user/setProfile', {
        user: { userID: userId, ...updates },
      }, env);
    }
  } catch (e) {
    console.error('Failed to update Trainerize client profile:', e);
  }
}

/**
 * Sync payment status to Trainerize
 * Updates client's profile so both Alex and the client see the status:
 *
 * 1. TAGS — Alex sees at a glance in client list:
 *    payment-paid, payment-due, payment-unpaid, payment-overdue, payment-canceled
 *
 * 2. NOTES — detailed payment history via trainer notes
 *
 * 3. MESSAGE — client gets notified in Trainerize app
 *
 * 4. NUDGE TAGS — triggers push notifications via Trainerize Automations
 */
async function syncPaymentStatusToTrainerize(squareCustomerId, status, eventData, env) {
  if (!isTrainerizeConfigured(env)) {
    console.log('Trainerize not configured — skipping payment status sync');
    return;
  }

  const email = await getCustomerEmail(squareCustomerId, env);
  if (!email) return;

  // Look up Trainerize userID (required for all v03 endpoints)
  const userId = await findTrainerizeUserByEmail(email, env);
  if (!userId) {
    console.log(`Trainerize user not found for ${email} — skipping payment sync`);
    return;
  }

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
    for (const tag of allPaymentTags) {
      await trainerizePost('/user/deleteTag', { userID: userId, userTag: tag }, env);
    }

    // Add current status tag
    await trainerizePost('/user/addTag', { userID: userId, userTag: newTag }, env);

    // Add next-due-date tag if available
    if (nextDueDate) {
      await trainerizePost('/user/addTag', { userID: userId, userTag: `next-due:${nextDueDate}` }, env);
    }
  } catch (e) {
    console.error('Trainerize tag update failed:', e);
  }

  // 2. Add payment history as trainer note
  const noteLines = {
    paid: `Payment received ${amount} on ${now}${nextDueDate ? `. Next due: ${nextDueDate}` : ''}`,
    due: `Payment due ${amount}${nextDueDate ? ` on ${nextDueDate}` : ''}`,
    unpaid: `Payment failed ${amount} on ${now}. Card on file was declined.`,
    overdue: `Payment overdue ${amount} as of ${now}. Please update payment method.`,
    canceled: `Subscription canceled on ${now}.`,
    paused: `Subscription paused on ${now}.`,
  };

  try {
    await trainerizePost('/trainerNote/add', {
      userID: userId,
      content: noteLines[status] || `Payment status: ${status}`,
      type: 'general',
    }, env);
  } catch (e) {
    console.error('Trainerize note update failed:', e);
  }

  // 3. Nudge tags — triggers Trainerize push notification, non-persistent
  //
  // How this works:
  // - We add a "nudge:payment-paid" tag → Trainerize fires a push notification
  //   (set up in Trainerize > Automations > When tag added → Send notification)
  // - We remove the nudge tag after so it doesn't accumulate
  // - Next event adds a fresh nudge tag → fires notification again
  //
  // Trainerize Automation setup (one-time):
  //   Trigger: Tag "nudge:payment-due" added
  //   Action: Send push notification "Your payment is coming up!"

  const nudgeTag = `nudge:${newTag}`;

  try {
    // Remove old nudge tags first so the new one fires fresh
    await removeOldNudgeTags(userId, nudgeTag, env);

    // Add nudge tag → triggers push notification via Trainerize Automation
    await trainerizePost('/user/addTag', { userID: userId, userTag: nudgeTag }, env);
  } catch (e) {
    console.error('Trainerize nudge failed:', e);
  }

  console.log(`Payment status synced to Trainerize: ${email} → ${status} ${amount}`);
}

/**
 * Remove all old nudge tags so the next nudge fires fresh
 */
async function removeOldNudgeTags(userId, keepTag, env) {
  const allNudgeTags = [
    'nudge:payment-paid',
    'nudge:payment-due',
    'nudge:payment-unpaid',
    'nudge:payment-overdue',
    'nudge:payment-canceled',
    'nudge:payment-paused',
  ];

  for (const tag of allNudgeTags) {
    if (tag === keepTag) continue;
    try {
      await trainerizePost('/user/deleteTag', { userID: userId, userTag: tag }, env);
    } catch { /* ignore */ }
  }
}

// ===== BOOKING → TRAINERIZE CALENDAR SYNC =====

/**
 * Sync a Square booking to Trainerize calendar.
 * Called from booking.created and booking.updated webhooks.
 */
async function syncBookingToTrainerize(booking, env) {
  if (!isTrainerizeConfigured(env)) return;

  const status = booking.status;
  const customerId = booking.customer_id;
  const startAt = booking.start_at;
  const segments = booking.appointment_segments || [];
  const duration = segments[0]?.duration_minutes || 60;

  // Get full customer details from Square
  const customer = await getSquareCustomer(customerId, env);
  const email = customer?.email_address;
  if (!email) {
    console.log(`Booking sync: no email for customer ${customerId}`);
    return;
  }

  // Find or create Trainerize user
  let userId = await findTrainerizeUserByEmail(email, env);

  if (!userId) {
    // Client not in Trainerize — create them with full Square details
    userId = await createTrainerizeClient(customer, env);
    if (userId) {
      console.log(`Created Trainerize client: ${email} (userID: ${userId})`);
    }
  } else {
    // Client exists — update profile with latest Square details
    await updateTrainerizeClientProfile(userId, customer, env);
  }

  if (status === 'ACCEPTED' || status === 'PENDING') {
    // Create/update appointment in Trainerize
    const endMs = new Date(startAt).getTime() + duration * 60000;
    const endAt = new Date(endMs).toISOString();

    const isVirtual = booking.location_type === 'CUSTOMER_LOCATION' ||
      (booking.customer_note || '').toLowerCase().includes('virtual');

    try {
      // Convert ISO dates to Trainerize format (space separator, no Z)
      const tzStart = startAt.replace('T', ' ').replace('Z', '');
      const tzEnd = endAt.replace('T', ' ').replace('Z', '');

      await trainerizePost('/appointment/add', {
        userID: getTrainerizeTrainerId(env),
        startDate: tzStart,
        endDate: tzEnd,
        appointmentTypeID: TZ_SYNC_APPOINTMENT_TYPE,
        notes: `${duration}min ${isVirtual ? 'virtual' : 'in-person'} session (Square #${booking.id.slice(0, 8)})${isVirtual ? '' : ' | ' + STUDIO_ADDRESS}`,
        attendents: userId ? [{ userID: userId }] : [],
      }, env);

      console.log(`Booking synced to Trainerize: ${email} → ${startAt} (${duration}min)`);
    } catch (e) {
      console.error('Trainerize booking sync failed:', e);
    }

    // Also notify client via message if new booking
    if (userId && status === 'ACCEPTED') {
      const dateStr = new Date(startAt).toLocaleDateString('en-US', {
        timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric',
      });
      const timeStr = new Date(startAt).toLocaleTimeString('en-US', {
        timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit',
      });

      try {
        await trainerizePost('/message/send', {
          userID: getTrainerizeTrainerId(env),
          recipients: [userId],
          subject: 'Session Booked',
          body: `Your ${duration}-min ${isVirtual ? 'virtual' : 'in-studio'} session is confirmed for ${dateStr} at ${timeStr}. See you there!\n\nReminder: 24-hour cancellation notice is required to avoid losing session credits.`,
          threadType: 'mainThread',
          conversationType: 'single',
          type: 'text',
        }, env);
      } catch (e) {
        console.error('Trainerize booking message failed:', e);
      }
    }
  } else if (status === 'CANCELLED_BY_CUSTOMER' || status === 'CANCELLED_BY_SELLER') {
    // Notify client of cancellation
    if (userId) {
      const cancelledBy = status === 'CANCELLED_BY_CUSTOMER' ? 'you' : 'Coach Alex';
      const dateStr = new Date(startAt).toLocaleDateString('en-US', { timeZone: TIMEZONE, month: 'long', day: 'numeric' });

      // Check if within 24 hours — deduct credit for late cancellation
      const hoursUntil = (new Date(startAt).getTime() - Date.now()) / 3600000;
      const isLateCancel = hoursUntil < CANCEL_NOTICE_HOURS && status === 'CANCELLED_BY_CUSTOMER';

      if (isLateCancel) {
        await deductSessionCredit(userId, `Late cancellation (${dateStr}, <24hrs notice)`, env);
        // Mark this time slot as credit-handled so the cron doesn't deduct again
        await env.CHALLENGES_KV.put(
          `credit-handled:${userId}:${startAt}`,
          'late-cancel',
          { expirationTtl: 90 * 24 * 3600 }
        );
      }

      const creditWarning = isLateCancel
        ? '\n\nNote: This session was cancelled with less than 24 hours notice. A session credit has been deducted per our cancellation policy.'
        : '';

      try {
        await trainerizePost('/message/send', {
          userID: getTrainerizeTrainerId(env),
          recipients: [userId],
          subject: 'Session Cancelled',
          body: `Your session on ${dateStr} has been cancelled by ${cancelledBy}.${creditWarning}`,
          threadType: 'mainThread',
          conversationType: 'single',
          type: 'text',
        }, env);

        // Log cancellation note
        await trainerizePost('/trainerNote/add', {
          userID: userId,
          content: `Session cancelled (${dateStr}). Cancelled by: ${cancelledBy}. ${isLateCancel ? 'LATE CANCEL — credit deducted.' : ''}`,
          type: 'general',
        }, env);
      } catch (e) {
        console.error('Trainerize cancellation message failed:', e);
      }
    }
  }
}

// ===== AVAILABILITY =====

/**
 * Get coach's real-time availability for a date.
 * Uses Square's availability search as the SOURCE OF TRUTH — it reflects the
 * coach's actual schedule (custom hours, personal blocks, breaks, time off).
 * Then ALSO checks Trainerize appointments to block any additional conflicts.
 *
 * This means all three systems show the same thing:
 *   - Coach blocks time in Square → blocked on website
 *   - Coach books in Trainerize → blocked on website
 *   - Client books on website → creates in Square → webhook syncs to Trainerize
 *   - Coach changes hours in Square → website auto-updates
 */
async function getCoachAvailability(date, duration, env) {
  // Dynamic Eastern Time offset (EST = UTC-5, EDT = UTC-4)
  // Use the requested date to determine if DST is in effect
  const dateObj = new Date(`${date}T12:00:00Z`);
  const jan = new Date(dateObj.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(dateObj.getFullYear(), 6, 1).getTimezoneOffset();
  // Cloudflare Workers run in UTC, so we calculate DST manually for US Eastern:
  // DST starts 2nd Sunday of March, ends 1st Sunday of November
  const month = dateObj.getUTCMonth(); // 0-indexed
  const day = dateObj.getUTCDate();
  const dow = dateObj.getUTCDay(); // 0=Sun
  const isDST = (month > 2 && month < 10) || // Apr-Oct always DST
    (month === 2 && (day - dow) >= 8) ||       // March: after 2nd Sunday
    (month === 10 && (day - dow) < 1);         // November: before 1st Sunday
  const TZ_OFFSET_HOURS = isDST ? -4 : -5;
  const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 3600000;

  // Map duration to Square service variation ID
  const SERVICE_IDS = {
    30: 'AP6SY2YY6DHCTMOCGORX4WFS',  // 30 Min Training
    45: 'GXOISXWZ6NREZ3J5VHZNSUIT',  // 45 Minute Training
    60: 'KBRH7JNDZMU2K5JQUTERXBU4',  // 60 Min Training
    90: 'B56W2433G6HFLVMWQGLUREUN',  // 90 Min Training
  };
  const serviceId = SERVICE_IDS[duration] || SERVICE_IDS[60];
  const locationId = 'LD0SGZXT6ZSSD';

  // Helper: UTC ms → Eastern hours/minutes for display
  function utcToEastern(utcMs) {
    const estMs = utcMs + TZ_OFFSET_MS;
    const d = new Date(estMs);
    return { h: d.getUTCHours(), m: d.getUTCMinutes() };
  }

  // ===== STEP 1: Get Square's ACTUAL availability (coach's real schedule) =====
  // This is the source of truth — includes custom hours, blocks, breaks, existing bookings
  const squareAvailableUtc = new Set(); // UTC ISO strings of available slot starts
  const dayStartUtc = new Date(`${date}T00:00:00Z`).getTime() + (-TZ_OFFSET_MS); // 6 AM EST in UTC = 11 AM UTC
  const dayEndUtc = dayStartUtc + 18 * 3600000; // ~18 hours window

  try {
    const resp = await fetch(`${getSquareApiBase(env)}/bookings/availability/search`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        query: {
          filter: {
            start_at_range: {
              start_at: new Date(dayStartUtc - 2 * 3600000).toISOString(),
              end_at: new Date(dayEndUtc + 2 * 3600000).toISOString(),
            },
            location_id: locationId,
            segment_filters: [{
              service_variation_id: serviceId,
              team_member_id_filter: { any: ['TMr0PTR22KYH_0QK'] },
            }],
          },
        },
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      for (const avail of (data.availabilities || [])) {
        squareAvailableUtc.add(avail.start_at);
      }
    }
  } catch (e) {
    console.error('Square availability search failed:', e);
  }

  // ===== STEP 2: Get Trainerize appointments (additional blocks) =====
  const tzBlockedUtc = new Set();
  if (isTrainerizeConfigured(env)) {
    try {
      const tzStart = new Date(dayStartUtc - 2 * 3600000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      const tzEnd = new Date(dayEndUtc + 2 * 3600000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

      const resp = await trainerizePost('/appointment/getList', {
        userID: getTrainerizeTrainerId(env),
        startDate: tzStart,
        endDate: tzEnd,
        start: 0,
        count: 50,
      }, env);
      if (resp.ok) {
        const data = await resp.json();
        for (const apt of (data.appointments || [])) {
          const startStr = apt.startDate || apt.startDateTime;
          if (!startStr) continue;
          const startMs = new Date(startStr.replace(' ', 'T') + 'Z').getTime();
          const endStr = apt.endDate || apt.endDateTime;
          const endMs = endStr
            ? new Date(endStr.replace(' ', 'T') + 'Z').getTime()
            : startMs + (apt.duration || 60) * 60000;
          // Block in 15-min increments to match Square's granularity
          for (let t = startMs; t < endMs; t += 15 * 60000) {
            tzBlockedUtc.add(new Date(t).toISOString().replace('.000', ''));
          }
        }
      }
    } catch (e) {
      console.error('Trainerize appointments fetch failed:', e);
    }
  }

  // ===== STEP 3: Build unified slots =====
  // Only show slots that Square says are available AND Trainerize doesn't block
  const now = Date.now();
  const bufferMs = BOOKING_BUFFER_MINUTES * 60000;
  const slots = [];
  const seenTimes = new Set();

  // Convert Square available slots to our 30-min grid
  for (const isoStr of squareAvailableUtc) {
    const utcMs = new Date(isoStr).getTime();
    const { h, m } = utcToEastern(utcMs);

    // Round to 30-min slots for display
    const roundedM = m < 15 ? 0 : m < 45 ? 30 : 0;
    const roundedH = m >= 45 ? h + 1 : h;
    const slotKey = `${roundedH}:${String(roundedM).padStart(2, '0')}`;
    if (seenTimes.has(slotKey)) continue;
    seenTimes.add(slotKey);

    // Check if Trainerize blocks this slot
    const blockedByTz = tzBlockedUtc.has(isoStr) ||
      tzBlockedUtc.has(new Date(utcMs).toISOString().replace('.000', ''));

    const isPast = utcMs < now;
    const withinBuffer = !isPast && (utcMs - now) < bufferMs;
    const ampm = roundedH >= 12 ? 'PM' : 'AM';
    const displayH = roundedH % 12 || 12;
    const displayM = String(roundedM).padStart(2, '0');

    slots.push({
      time: `${displayH}:${displayM} ${ampm}`,
      startAt: isoStr,
      available: !blockedByTz && !isPast,
      requiresConfirmation: withinBuffer && !blockedByTz && !isPast,
      blocked: blockedByTz,
      duration,
    });
  }

  // Sort by time
  slots.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  return {
    date,
    timezone: TIMEZONE,
    businessHours: { open: '06:00', close: '20:30' },
    bufferMinutes: BOOKING_BUFFER_MINUTES,
    cancelNoticeHours: CANCEL_NOTICE_HOURS,
    slots,
    source: squareAvailableUtc.size > 0 ? 'square' : 'fallback',
  };
}

// ===== BOOKING RULES =====

/**
 * Validate a booking request.
 * Returns { allowed, requiresConfirmation, message }
 */
function validateBooking(startAt, duration) {
  const startMs = new Date(startAt).getTime();
  const now = Date.now();
  const bufferMs = BOOKING_BUFFER_MINUTES * 60000;

  if (startMs < now) {
    return { allowed: false, requiresConfirmation: false, message: 'Cannot book in the past.' };
  }

  if ((startMs - now) < bufferMs) {
    return {
      allowed: true,
      requiresConfirmation: true,
      message: `This session starts in less than ${BOOKING_BUFFER_MINUTES} minutes. Coach confirmation is required before your booking is finalized.`,
    };
  }

  return { allowed: true, requiresConfirmation: false, message: 'Booking is allowed.' };
}

/**
 * Check cancellation policy.
 * Returns { canCancel, creditAtRisk, message }
 */
function checkCancellationPolicy(startAt) {
  const startMs = new Date(startAt).getTime();
  const now = Date.now();
  const hoursUntil = (startMs - now) / 3600000;

  if (startMs < now) {
    return { canCancel: false, creditAtRisk: true, message: 'This session has already started or passed.' };
  }

  if (hoursUntil < CANCEL_NOTICE_HOURS) {
    return {
      canCancel: true,
      creditAtRisk: true,
      message: `Cancelling with less than ${CANCEL_NOTICE_HOURS} hours notice will result in a session credit being deducted. Are you sure you want to cancel?`,
      hoursUntil: Math.round(hoursUntil * 10) / 10,
    };
  }

  return {
    canCancel: true,
    creditAtRisk: false,
    message: 'You can cancel this session without penalty.',
    hoursUntil: Math.round(hoursUntil * 10) / 10,
  };
}

// ===== PLAN CREDITS =====

/**
 * Match plan name to session credits
 */
function findPlanCredits(planName) {
  const lower = planName.toLowerCase();

  // Exact match first
  for (const [name, credits] of Object.entries(PLAN_CREDITS)) {
    if (lower.includes(name.toLowerCase())) return credits;
  }

  // Fuzzy match: extract session count and duration from plan name
  // Handles: "8 Session - 60 Min", "12 Week Plan", "4x 30min sessions", etc.
  const sessionMatch = lower.match(/(\d+)\s*(?:session|week|pack)/);
  const durationMatch = lower.match(/(\d+)\s*min/);
  if (sessionMatch) {
    return {
      sessions: parseInt(sessionMatch[1]),
      duration: durationMatch ? parseInt(durationMatch[1]) : 60,
    };
  }

  // Default: 4 sessions of 60 min
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

// ===== TRAINERIZE → SQUARE REVERSE SYNC =====

/**
 * Sync Trainerize-only appointments to Square.
 * Called by the cron trigger every 15 minutes.
 *
 * Logic:
 *   1. Fetch Trainerize appointments for the next 7 days
 *   2. Skip ones that originated from Square (notes contain "Square #")
 *   3. Skip ones already synced to Square (tracked in KV)
 *   4. Create a Square booking for each new Trainerize appointment
 *   5. Track the sync in KV to prevent duplicates
 */
async function syncTrainerizeAppointmentsToSquare(env) {
  if (!isTrainerizeConfigured(env)) return;

  const SERVICE_IDS = {
    30: 'AP6SY2YY6DHCTMOCGORX4WFS',
    45: 'GXOISXWZ6NREZ3J5VHZNSUIT',
    60: 'KBRH7JNDZMU2K5JQUTERXBU4',
    90: 'B56W2433G6HFLVMWQGLUREUN',
  };
  const LOCATION_ID = 'LD0SGZXT6ZSSD';
  const TEAM_MEMBER_ID = 'TMr0PTR22KYH_0QK';

  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 3600000);

  const tzStart = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const tzEnd = weekLater.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  try {
    const resp = await trainerizePost('/appointment/getList', {
      userID: getTrainerizeTrainerId(env),
      startDate: tzStart,
      endDate: tzEnd,
      start: 0,
      count: 100,
    }, env);

    if (!resp.ok) {
      console.error('Trainerize→Square sync: failed to fetch appointments');
      return;
    }

    const data = await resp.json();
    const appointments = data.appointments || [];
    let synced = 0;

    for (const apt of appointments) {
      // Skip appointments that came FROM Square (avoid loop)
      // Catches all note patterns: "Square #abc", "synced from Square", "Square sync"
      if ((apt.notes || '').toLowerCase().includes('square')) continue;

      // Skip if already synced to Square
      const syncKey = `tz-sq-sync:${apt.id}`;
      const existing = await env.CHALLENGES_KV.get(syncKey);
      if (existing) continue;

      // Parse times — startDate is UTC in Trainerize response
      const startStr = apt.startDate || apt.startDateTime;
      const endStr = apt.endDate || apt.endDateTime;
      if (!startStr || !endStr) continue;

      const startAt = startStr.replace(' ', 'T') + 'Z';
      const endAt = endStr.replace(' ', 'T') + 'Z';
      const startMs = new Date(startAt).getTime();
      const endMs = new Date(endAt).getTime();

      // Skip past appointments
      if (startMs < now.getTime()) continue;

      const durationMin = Math.round((endMs - startMs) / 60000);
      const serviceId = SERVICE_IDS[durationMin] || SERVICE_IDS[60];

      // Find client's Square customer ID if possible
      let squareCustomerId = null;
      const attendee = apt.attendents?.[0];
      if (attendee) {
        // Look up by name in Square (attendee has firstName/lastName but not email)
        squareCustomerId = await findSquareCustomerByName(
          attendee.firstName, attendee.lastName, env
        );
      }

      // Create Square booking to block the time
      try {
        const bookingResp = await fetch(`${getSquareApiBase(env)}/bookings`, {
          method: 'POST',
          headers: getSquareHeaders(env),
          body: JSON.stringify({
            idempotency_key: `tz-sync-${apt.id}`,
            booking: {
              start_at: startAt,
              location_id: LOCATION_ID,
              customer_id: squareCustomerId || undefined,
              customer_note: `Synced from Trainerize (apt #${apt.id})`,
              appointment_segments: [{
                team_member_id: TEAM_MEMBER_ID,
                service_variation_id: serviceId,
                duration_minutes: durationMin || 60,
              }],
            },
          }),
        });

        if (bookingResp.ok) {
          const bookingData = await bookingResp.json();
          const squareBookingId = bookingData.booking?.id || 'unknown';

          // Track in KV (30-day TTL)
          await env.CHALLENGES_KV.put(syncKey, JSON.stringify({
            trainerizeId: apt.id,
            squareBookingId,
            syncedAt: new Date().toISOString(),
          }), { expirationTtl: 30 * 24 * 3600 });

          synced++;
          console.log(`Trainerize→Square: synced apt #${apt.id} → booking ${squareBookingId}`);
        } else {
          const err = await bookingResp.text();
          console.error(`Trainerize→Square: failed to create booking for apt #${apt.id}: ${err}`);
        }
      } catch (e) {
        console.error(`Trainerize→Square: error syncing apt #${apt.id}:`, e);
      }
    }

    if (synced > 0) {
      console.log(`Trainerize→Square sync complete: ${synced} new bookings created`);
    }
  } catch (e) {
    console.error('Trainerize→Square sync error:', e);
  }
}

/**
 * Find a Square customer by first + last name.
 * Returns customer ID or null.
 */
async function findSquareCustomerByName(firstName, lastName, env) {
  if (!firstName || !lastName) return null;
  try {
    const resp = await fetch(`${getSquareApiBase(env)}/customers/search`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        query: {
          filter: {
            fuzzy: { display_name: `${firstName} ${lastName}` },
          },
        },
        limit: 1,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.customers?.[0]?.id || null;
  } catch {
    return null;
  }
}

// ===== SESSION CREDIT DEDUCTION (CRON) =====

/**
 * Check for past Trainerize appointments and deduct credits for completed sessions.
 * Runs on the 15-min cron. Uses KV to track which sessions have been counted.
 */
async function deductCreditsForCompletedSessions(env) {
  if (!isTrainerizeConfigured(env)) return;

  const now = new Date();
  // Check appointments from the past 24 hours (catch any we missed)
  const dayAgo = new Date(now.getTime() - 24 * 3600000);

  const tzStart = dayAgo.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const tzEnd = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  try {
    const resp = await trainerizePost('/appointment/getList', {
      userID: getTrainerizeTrainerId(env),
      startDate: tzStart,
      endDate: tzEnd,
      start: 0,
      count: 100,
    }, env);

    if (!resp.ok) return;
    const data = await resp.json();

    for (const apt of (data.appointments || [])) {
      // Only process appointments that have already ended
      const endStr = apt.endDate || apt.endDateTime;
      if (!endStr) continue;
      const endMs = new Date(endStr.replace(' ', 'T') + 'Z').getTime();
      if (endMs > now.getTime()) continue;

      // Check if already counted by a previous cron run
      const countedKey = `session-counted:${apt.id}`;
      if (await env.CHALLENGES_KV.get(countedKey)) continue;

      // Find the client attendee
      const attendee = apt.attendents?.[0];
      if (!attendee?.userID) continue;

      // Only deduct if the client actually has credits in KV (from a real subscription)
      const creditRaw = await env.CHALLENGES_KV.get(`credits:${attendee.userID}`);
      if (!creditRaw) continue;

      // Check if this slot was already handled by a late-cancel deduction
      const startStr = apt.startDate || apt.startDateTime;
      if (startStr) {
        const startAtIso = startStr.replace(' ', 'T') + 'Z';
        const cancelKey = `credit-handled:${attendee.userID}:${startAtIso}`;
        if (await env.CHALLENGES_KV.get(cancelKey)) {
          // Already deducted via late cancel — just mark as counted and skip
          await env.CHALLENGES_KV.put(countedKey, 'cancel-deducted', {
            expirationTtl: 90 * 24 * 3600,
          });
          continue;
        }
      }

      // Deduct credit for completed session
      const dateStr = (apt.startDateTime || apt.startDate || '').split(' ')[0];
      await deductSessionCredit(attendee.userID, `Session completed (${dateStr})`, env);

      // Mark as counted (90-day TTL)
      await env.CHALLENGES_KV.put(countedKey, new Date().toISOString(), {
        expirationTtl: 90 * 24 * 3600,
      });

      // Also mark by user+time to prevent any future double-counting
      if (startStr) {
        const startAtIso = startStr.replace(' ', 'T') + 'Z';
        await env.CHALLENGES_KV.put(
          `credit-handled:${attendee.userID}:${startAtIso}`,
          'session-completed',
          { expirationTtl: 90 * 24 * 3600 }
        );
      }
    }
  } catch (e) {
    console.error('Session credit deduction cron failed:', e);
  }
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
