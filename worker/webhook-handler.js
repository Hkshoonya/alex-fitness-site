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
 * Safe KV read — returns null on error instead of crashing.
 */
async function kvGet(key, env) {
  try {
    return await env.CHALLENGES_KV.get(key);
  } catch (e) {
    console.error(`KV read failed for ${key}:`, e);
    return null;
  }
}

/**
 * Safe KV write — logs error instead of crashing.
 */
async function kvPut(key, value, options, env) {
  try {
    await env.CHALLENGES_KV.put(key, value, options || {});
    return true;
  } catch (e) {
    console.error(`KV write failed for ${key}:`, e);
    return false;
  }
}

/**
 * Log a critical event to KV for queryable history.
 * Events persist for 30 days. GET /logs returns recent events.
 * Categories: credit, payment, sync, error, invoice
 */
async function logEvent(category, message, data, env) {
  try {
    const entry = {
      category,
      message,
      data: typeof data === 'object' ? JSON.stringify(data) : data,
      timestamp: new Date().toISOString(),
    };
    const key = `log:${entry.timestamp}:${category}`;
    await kvPut(key, JSON.stringify(entry), { expirationTtl: 30 * 24 * 3600 }, env);
    console.log(`[${category}] ${message}`);
  } catch {
    // Logging should never break the main flow
    console.error(`Failed to log event: ${category} ${message}`);
  }
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const referer = request.headers.get('Referer') || '';

    // Allowed origins for API proxy access
    const ALLOWED_ORIGINS = [
      'https://hkshoonya.github.io',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
    ];
    const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));

    const corsHeaders = {
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Square-Version',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ===== API PROXY ORIGIN CHECK =====
    // Block proxy requests from unknown origins (public endpoints like /health, /availability, webhooks are exempt)
    const isProxyRoute = url.pathname.startsWith('/api/square/') || url.pathname.startsWith('/api/trainerize/');
    if (isProxyRoute && !isAllowedOrigin) {
      return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== GOOGLE MEET API (server-side — secrets never exposed to frontend) =====
    if (url.pathname === '/api/google/meet' && request.method === 'POST') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: corsHeaders });
      }
      try {
        const params = await request.json();
        const meeting = await createGoogleMeetEvent(params, env);
        return new Response(JSON.stringify(meeting), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
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
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
      const id = url.pathname.split('/challenges/')[1];
      await deleteChallenge(id, env);
      return new Response(JSON.stringify({ deleted: id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== EVENT LOGS =====
    // GET /logs?category=credit&limit=20 — query recent events
    if (url.pathname === '/logs' && request.method === 'GET') {
      const category = url.searchParams.get('category') || '';
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const prefix = category ? `log:` : 'log:';

      try {
        const keys = await env.CHALLENGES_KV.list({ prefix, limit: limit * 3 });
        const entries = [];
        for (const key of keys.keys) {
          if (category && !key.name.endsWith(`:${category}`)) continue;
          if (entries.length >= limit) break;
          const val = await env.CHALLENGES_KV.get(key.name);
          if (val) { try { entries.push(JSON.parse(val)); } catch { /* skip corrupt */ } }
        }
        entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return new Response(JSON.stringify(entries.slice(0, limit)), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ===== HEALTH CHECK =====
    // GET /health — verify connectivity to Square, Trainerize, and KV
    if (url.pathname === '/health' && request.method === 'GET') {
      const checks = { square: false, trainerize: false, kv: false, timestamp: new Date().toISOString() };

      // Square API
      try {
        const sq = await fetch(`${getSquareApiBase(env)}/locations`, { headers: getSquareHeaders(env) });
        checks.square = sq.ok;
      } catch { checks.square = false; }

      // Trainerize API
      try {
        if (isTrainerizeConfigured(env)) {
          const tz = await trainerizePost('/userTag/getList', { start: 0, count: 1 }, env);
          checks.trainerize = tz.ok;
        }
      } catch { checks.trainerize = false; }

      // KV
      try {
        await env.CHALLENGES_KV.put('health-check', Date.now().toString());
        const val = await env.CHALLENGES_KV.get('health-check');
        checks.kv = !!val;
      } catch { checks.kv = false; }

      const allHealthy = checks.square && checks.trainerize && checks.kv;
      return new Response(JSON.stringify(checks), {
        status: allHealthy ? 200 : 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

      // Verify Square webhook signature (HMAC-SHA256 of URL + body)
      if (env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
        const signature = request.headers.get('x-square-hmacsha256-signature');
        const webhookUrl = request.url;
        const isValid = await verifySignature(webhookUrl, body, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY);
        if (!isValid) {
          return new Response('Invalid signature', { status: 401 });
        }
      }

      const event = JSON.parse(body);
      const eventType = event.type;
      const eventId = event.event_id || '';

      console.log(`Webhook received: ${eventType} (${eventId})`);

      // Return 200 immediately so Square doesn't retry, then process in background
      const processingPromise = (async () => {
        // Two-phase idempotency:
        //  1) At entry, check for a "done" marker (skip if prior success) or a
        //     "processing" marker (skip if another invocation is in flight).
        //     Write a short-lived "processing" marker so concurrent duplicates
        //     collapse to a single run but a failed run expires quickly.
        //  2) After all handlers complete WITHOUT throwing, promote to "done"
        //     with a long TTL. On throw we leave the processing marker to
        //     expire, letting Square retry the event.
        const processedKey = eventId ? `webhook-event:${eventId}` : null;
        if (processedKey) {
          const state = await kvGet(processedKey, env);
          if (state === 'done') {
            console.log(`Skipping duplicate event: ${eventId}`);
            return;
          }
          if (state === 'processing') {
            console.log(`Skipping in-flight duplicate event: ${eventId}`);
            return;
          }
          await kvPut(processedKey, 'processing', { expirationTtl: 5 * 60 }, env);
        }

        try {
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
            if (subscription) {
              const status = subscription.status;
              if (status === 'ACTIVE') {
                await handleSubscriptionRenewal(subscription, env);
                await syncPaymentStatusToTrainerize(subscription.customer_id, 'paid', subscription, env);
              } else if (status === 'CANCELED' || status === 'DEACTIVATED') {
                await syncPaymentStatusToTrainerize(subscription.customer_id, 'canceled', subscription, env);
              } else if (status === 'PAUSED' || status === 'SUSPENDED') {
                await syncPaymentStatusToTrainerize(subscription.customer_id, 'paused', subscription, env);
              } else if (status === 'PENDING') {
                await syncPaymentStatusToTrainerize(subscription.customer_id, 'due', subscription, env);
              }
            }
          }

          // ---- PAYMENT COMPLETED ----
          if (eventType === 'payment.completed') {
            const payment = event.data?.object?.payment;
            if (payment) {
              if (payment.subscription_id) {
                await handleSubscriptionPayment(payment, env);
              }
              // Mark client as paid in Trainerize
              if (payment.customer_id) {
                await syncPaymentStatusToTrainerize(payment.customer_id, 'paid', payment, env);
              }
            }
          }

          // ---- PAYMENT FAILED ----
          if (eventType === 'payment.failed') {
            const payment = event.data?.object?.payment;
            if (payment?.customer_id) {
              await syncPaymentStatusToTrainerize(payment.customer_id, 'unpaid', payment, env);
            }
          }

          // ---- ORDER COMPLETED → credit assignment for session credit purchases ----
          if (eventType === 'order.fulfilled' || eventType === 'order.updated') {
            const order = event.data?.object?.order;
            if (order?.state === 'COMPLETED' && order?.customer_id) {
              await handleCreditPurchaseOrder(order, env);
            }
          }

          // ---- CUSTOMER EVENTS → sync profile changes to Trainerize ----
          if (eventType === 'customer.updated') {
            const customer = event.data?.object?.customer;
            if (customer?.email_address) {
              await handleCustomerUpdated(customer, env);
            }
          }

          // ---- CATALOG EVENTS → refresh cached IDs/prices ----
          if (eventType === 'catalog.version.updated') {
            await handleCatalogUpdated(env);
          }

          // ---- INVOICE EVENTS ----
          // Only propagate invoice status to Trainerize when the invoice is
          // actually for training. Any other paid invoice (merch, retail,
          // misc) shouldn't flip the client's training-payment status.
          const isTrainingInvoice = (invoice) => {
            const desc = invoice?.description || '';
            const title = invoice?.title || '';
            return desc.includes('Auto-invoice for session') ||
              /session|training/i.test(desc) ||
              /session|training/i.test(title);
          };

          if (eventType === 'invoice.payment_made') {
            const invoice = event.data?.object?.invoice;
            if (invoice?.primary_recipient?.customer_id && isTrainingInvoice(invoice)) {
              await syncPaymentStatusToTrainerize(invoice.primary_recipient.customer_id, 'paid', invoice, env);

              // If this is a session invoice we auto-created, update Trainerize note
              if ((invoice.description || '').includes('Auto-invoice for session')) {
                await handleSessionInvoicePaid(invoice, env);
              }
            }
          }

          if (eventType === 'invoice.payment_failed' || eventType === 'invoice.updated') {
            const invoice = event.data?.object?.invoice;
            if (invoice?.primary_recipient?.customer_id && isTrainingInvoice(invoice)) {
              const invStatus = invoice.status;
              if (invStatus === 'UNPAID' || invStatus === 'PAYMENT_PENDING') {
                await syncPaymentStatusToTrainerize(invoice.primary_recipient.customer_id, 'unpaid', invoice, env);
              } else if (invStatus === 'OVERDUE') {
                await syncPaymentStatusToTrainerize(invoice.primary_recipient.customer_id, 'overdue', invoice, env);
              }
            }
          }

          // Promote to "done" only after every handler above finished without
          // throwing. If any threw, the catch below logs and we let the
          // short-lived "processing" marker expire so Square retries.
          if (processedKey) {
            await kvPut(processedKey, 'done', { expirationTtl: 7 * 24 * 3600 }, env);
          }
        } catch (error) {
          console.error('Webhook processing error:', error);
        }
      })();

      ctx.waitUntil(processingPromise);
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
  // Square subscription has plan_variation_id, not plan_variation_data.
  // Fetch the plan name from the catalog using the ID.
  let planName = '';
  if (subscription.plan_variation_id) {
    try {
      const catResp = await fetch(
        `${getSquareApiBase(env)}/catalog/object/${subscription.plan_variation_id}`,
        { headers: getSquareHeaders(env) }
      );
      if (catResp.ok) {
        const catData = await catResp.json();
        planName = catData.object?.subscription_plan_variation_data?.name || '';
      }
    } catch { /* catalog fetch failed */ }
  }

  // Idempotency: skip if this exact subscription event was already processed
  const idempotencyKey = `sub-renewal:${subscriptionId}:${subscription.version || subscription.updated_at || ''}`;
  if (await kvGet(idempotencyKey, env)) {
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
  await kvPut(idempotencyKey, new Date().toISOString(), {
    expirationTtl: 60 * 24 * 3600,
  }, env);

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
    await kvPut(`credits:${userId}`, JSON.stringify(creditData), {}, env);

    // Remove old credit tags, set new one
    await clearCreditTags(userId, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: '🟢 Subscription Active' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: creditTagName(credits.sessions) }, env);

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
  const lockKey = `lock:credits:${userId}`;
  try {
    // Simple KV lock to prevent concurrent read-modify-write race
    const locked = await kvGet(lockKey, env);
    if (locked) {
      console.log(`Credit deduction skipped (locked) for user ${userId} — will retry next cron`);
      return;
    }
    await kvPut(lockKey, Date.now().toString(), { expirationTtl: 15 }, env);

    const raw = await kvGet(`credits:${userId}`, env);
    if (!raw) { await env.CHALLENGES_KV.delete(lockKey); return; }

    let creditData;
    try { creditData = JSON.parse(raw); } catch { await env.CHALLENGES_KV.delete(lockKey); return; }

    if (creditData.remaining <= 0) {
      console.log(`No credits remaining for user ${userId}`);
      await env.CHALLENGES_KV.delete(lockKey);
      return;
    }

    // Deduct
    creditData.remaining -= 1;
    creditData.deductions.push({ date: new Date().toISOString(), reason });
    creditData.updatedAt = new Date().toISOString();
    await kvPut(`credits:${userId}`, JSON.stringify(creditData), {}, env);

    // Release lock before slow tag operations
    await env.CHALLENGES_KV.delete(lockKey);

    // Update Trainerize tag
    await clearCreditTags(userId, env);
    await trainerizePost('/user/addTag', {
      userID: userId,
      userTag: creditTagName(creditData.remaining),
    }, env);

    // Add note
    await trainerizePost('/trainerNote/add', {
      userID: userId,
      content: `Credit deducted (${reason}). ${creditData.remaining}/${creditData.total} sessions remaining.`,
      type: 'general',
    }, env);

    await logEvent('credit', `Deducted: ${userId} ${creditData.remaining}/${creditData.total} (${reason})`, { userId, remaining: creditData.remaining }, env);
  } catch (e) {
    console.error('Credit deduction failed:', e);
    try { await env.CHALLENGES_KV.delete(lockKey); } catch { /* cleanup */ }
  }
}

/**
 * Get the visual tag name for a credit count.
 * 0 = "❌ 0 Sessions Left", 1-2 = "🔴 X Sessions Left", 3-5 = "🟡 X Sessions Left", 6+ = "🟢 X Sessions Left"
 */
function creditTagName(count) {
  const n = Math.max(0, Math.min(count, 24));
  if (n === 0) return '❌ 0 Sessions Left';
  if (n <= 2) return `🔴 ${n} Sessions Left`;
  if (n <= 5) return `🟡 ${n} Sessions Left`;
  return `🟢 ${n} Sessions Left`;
}

/**
 * Remove all session credit tags from a user.
 */
async function clearCreditTags(userId, env) {
  // Fire all delete calls in parallel instead of sequential (25→~5 seconds instead of ~12)
  const deletes = [];
  for (let i = 0; i <= 24; i++) {
    deletes.push(
      trainerizePost('/user/deleteTag', { userID: userId, userTag: creditTagName(i) }, env).catch(() => {}),
    );
  }
  await Promise.all(deletes);
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
    if (squareCustomer.email_address) updates.email = squareCustomer.email_address;

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
 * Handle customer.updated webhook — sync Square profile changes to Trainerize.
 * Fires when customer name, email, phone, or address changes in Square.
 */
async function handleCustomerUpdated(customer, env) {
  if (!isTrainerizeConfigured(env)) return;

  const email = customer.email_address;
  if (!email) return;

  const userId = await findTrainerizeUserByEmail(email, env);
  if (!userId) {
    // Customer might have changed their email — try finding by old email via reference_id
    // or by name. For now, log and skip.
    console.log(`customer.updated: Trainerize user not found for ${email}`);
    return;
  }

  await updateTrainerizeClientProfile(userId, customer, env);
  console.log(`customer.updated: synced ${email} to Trainerize (userId: ${userId})`);
}

/**
 * Handle catalog.version.updated webhook — refresh cached catalog data.
 * Fires when prices, service IDs, or products change in Square catalog.
 * Stores latest service variation IDs and session prices in KV for reference.
 */
async function handleCatalogUpdated(env) {
  try {
    // Fetch current session pricing from catalog
    const resp = await fetch(`${getSquareApiBase(env)}/catalog/search`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({ object_types: ['ITEM'], limit: 100 }),
    });

    if (!resp.ok) return;
    const data = await resp.json();

    const sessionPricing = {};
    for (const item of (data.objects || [])) {
      const name = item.item_data?.name || '';
      if (!name.includes('Single Session') && !name.includes('Training Session')) continue;

      for (const variation of (item.item_data?.variations || [])) {
        const vData = variation.item_variation_data || {};
        const price = vData.price_money?.amount || 0;
        const vName = vData.name || '';
        const vId = variation.id;

        // Extract duration from variation name
        let duration = 60;
        if (vName.includes('30')) duration = 30;
        else if (vName.includes('90')) duration = 90;
        else if (vName.includes('45')) duration = 45;

        sessionPricing[duration] = { variationId: vId, price, name: vName };
      }
    }

    if (Object.keys(sessionPricing).length > 0) {
      await kvPut('catalog:session-pricing', JSON.stringify({
        ...sessionPricing,
        updatedAt: new Date().toISOString(),
      }), {}, env);
      console.log(`catalog.version.updated: refreshed session pricing — ${Object.keys(sessionPricing).length} durations`);
    }
  } catch (e) {
    console.error('catalog.version.updated handler failed:', e);
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

  // Determine if client is ACTIVE (has credits or active subscription) vs INACTIVE
  const creditRaw = await kvGet(`credits:${userId}`, env);
  let hasCredits = false;
  try { hasCredits = creditRaw && JSON.parse(creditRaw).remaining > 0; } catch { /* corrupted JSON */ }
  const isActiveClient = hasCredits || status === 'paid';
  const isLeavingClient = status === 'canceled' || status === 'paused';

  // Tag definitions — both old plain tags and new visual tags
  const allStatusTags = [
    'payment-paid', 'payment-due', 'payment-unpaid', 'payment-overdue', 'payment-canceled', 'payment-paused',
    '✅ Paid', '⚠️ Payment Due', '🔴 Payment Overdue', '❌ Payment Failed',
    '⏸️ Paused', '💤 Cancelled', '💤 Inactive',
    '🟢 Active Client',
    '🟢 Subscription Active', 'subscription-active',
  ];
  const visualTags = {
    paid: '✅ Paid',
    due: '⚠️ Payment Due',
    unpaid: '❌ Payment Failed',
    overdue: '🔴 Payment Overdue',
    canceled: '💤 Cancelled',
    paused: '⏸️ Paused',
  };
  const newTag = visualTags[status] || `payment-${status}`;

  // 1. Remove old tags, set new ones
  try {
    await Promise.all(allStatusTags.map(tag =>
      trainerizePost('/user/deleteTag', { userID: userId, userTag: tag }, env).catch(() => {})
    ));

    // Add status tag
    await trainerizePost('/user/addTag', { userID: userId, userTag: newTag }, env);

    // Add active/inactive tag
    if (isActiveClient) {
      await trainerizePost('/user/addTag', { userID: userId, userTag: '🟢 Active Client' }, env);
    } else if (isLeavingClient) {
      await trainerizePost('/user/addTag', { userID: userId, userTag: '💤 Inactive' }, env);
    }

    // Add next-due-date tag if available and client is active
    if (nextDueDate && isActiveClient) {
      await trainerizePost('/user/addTag', { userID: userId, userTag: `next-due:${nextDueDate}` }, env);
    }
  } catch (e) {
    console.error('Trainerize tag update failed:', e);
  }

  // 2. Add trainer note (internal, always logged)
  const noteLines = {
    paid: `Payment received ${amount} on ${now}${nextDueDate ? `. Next due: ${nextDueDate}` : ''}`,
    due: `Payment due ${amount}${nextDueDate ? ` on ${nextDueDate}` : ''}`,
    unpaid: `Payment failed ${amount} on ${now}. Card on file was declined.`,
    overdue: `Payment overdue ${amount} as of ${now}. Please update payment method.`,
    canceled: `Subscription canceled on ${now}. Client marked inactive.`,
    paused: `Subscription paused on ${now}. Client marked inactive.`,
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

  // 3. Client-facing messages — different for active vs inactive clients
  try {
    if (isLeavingClient) {
      // ---- INACTIVE: Send warm "we miss you" re-engagement message ----
      const reEngageMessages = [
        `Hey! Just wanted to check in and see how you're doing. We miss seeing you at the studio! Remember, every workout counts — even a short one. Whenever you're ready to jump back in, we're here for you. No pressure, just support! 💪`,
        `Hi there! It's been a minute since your last session and I just wanted to say — your progress was awesome and I'd love to help you keep that momentum going. Feel free to reach out whenever you're ready to get back at it!`,
        `Hey! Hope you're doing well! Just a friendly note — your spot is always open here. Whether it's a fresh start or picking up where you left off, I'm ready when you are. Let's crush some goals together! 🔥`,
      ];
      const msg = reEngageMessages[Math.floor(Math.random() * reEngageMessages.length)];

      await trainerizePost('/message/send', {
        userID: getTrainerizeTrainerId(env),
        recipients: [userId],
        subject: 'We Miss You!',
        body: msg,
        threadType: 'mainThread',
        conversationType: 'single',
        type: 'text',
      }, env);
    } else if (isActiveClient && (status === 'due' || status === 'unpaid' || status === 'overdue')) {
      // ---- ACTIVE: Send payment reminder only to active clients ----
      const clientMessages = {
        due: `Hi! Just a reminder that your training session payment ${amount ? `of ${amount} ` : ''}is coming up${nextDueDate ? ` on ${nextDueDate}` : ''}. Please make sure your payment method is up to date. Thanks!`,
        unpaid: `Hi! We noticed your recent payment ${amount ? `of ${amount} ` : ''}didn't go through. Please update your payment method to continue your training sessions. Let me know if you have any questions!`,
        overdue: `Hi! Your payment ${amount ? `of ${amount} ` : ''}is currently overdue. Please update your payment method as soon as possible to avoid any interruption to your training. Thank you!`,
      };

      await trainerizePost('/message/send', {
        userID: getTrainerizeTrainerId(env),
        recipients: [userId],
        subject: status === 'due' ? 'Payment Reminder' : status === 'overdue' ? 'Payment Overdue' : 'Payment Issue',
        body: clientMessages[status],
        threadType: 'mainThread',
        conversationType: 'single',
        type: 'text',
      }, env);
    }
    // Note: inactive clients with due/overdue do NOT get payment nag messages
  } catch (e) {
    console.error('Client message failed:', e);
  }

  // 4. Nudge tags — triggers Trainerize push notification, non-persistent
  //    Only for ACTIVE clients — don't push-notify inactive clients about payments
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

  if (isActiveClient) {
    const nudgeTag = `nudge:${newTag}`;
    try {
      await removeOldNudgeTags(userId, nudgeTag, env);
      await trainerizePost('/user/addTag', { userID: userId, userTag: nudgeTag }, env);
    } catch (e) {
      console.error('Trainerize nudge failed:', e);
    }
  }

  console.log(`Payment status synced: ${email} → ${status} (${isActiveClient ? 'active' : 'inactive'})`);
}

/**
 * Remove all old nudge tags so the next nudge fires fresh
 */
async function removeOldNudgeTags(userId, keepTag, env) {
  const allNudgeTags = [
    // Old format
    'nudge:payment-paid', 'nudge:payment-due', 'nudge:payment-unpaid',
    'nudge:payment-overdue', 'nudge:payment-canceled', 'nudge:payment-paused',
    // New emoji format (matches all visualTags values + inactive)
    'nudge:✅ Paid', 'nudge:⚠️ Payment Due', 'nudge:❌ Payment Failed',
    'nudge:🔴 Payment Overdue', 'nudge:💤 Cancelled', 'nudge:💤 Inactive', 'nudge:⏸️ Paused',
  ];

  await Promise.all(allNudgeTags
    .filter(tag => tag !== keepTag)
    .map(tag => trainerizePost('/user/deleteTag', { userID: userId, userTag: tag }, env).catch(() => {}))
  );
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
    } else {
      // Client creation failed — log it so the appointment notes explain who it's for
      await logEvent('error', `Failed to create Trainerize client for ${email}`, { email, customerId }, env);
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
      const tzStart = startAt.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
      const tzEnd = endAt.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');

      await trainerizePost('/appointment/add', {
        userID: getTrainerizeTrainerId(env),
        startDate: tzStart,
        endDate: tzEnd,
        appointmentTypeID: TZ_SYNC_APPOINTMENT_TYPE,
        notes: `${duration}min ${isVirtual ? 'virtual' : 'in-person'} session (Square #${booking.id.slice(0, 8)})${!userId ? ` | Client: ${customer.given_name || ''} ${customer.family_name || ''} <${email}>` : ''}${isVirtual ? '' : ' | ' + STUDIO_ADDRESS}`,
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
  } else if (status === 'CANCELLED_BY_CUSTOMER' || status === 'CANCELLED_BY_SELLER' || status === 'DECLINED') {
    // Notify client of cancellation or decline
    if (userId) {
      const cancelledBy = status === 'CANCELLED_BY_CUSTOMER' ? 'you'
        : status === 'DECLINED' ? 'Coach Alex (declined)' : 'Coach Alex';
      const dateStr = new Date(startAt).toLocaleDateString('en-US', { timeZone: TIMEZONE, month: 'long', day: 'numeric' });

      // Check if within 24 hours — deduct credit for late cancellation (not for declined)
      const hoursUntil = (new Date(startAt).getTime() - Date.now()) / 3600000;
      const isLateCancel = hoursUntil < CANCEL_NOTICE_HOURS && status === 'CANCELLED_BY_CUSTOMER';

      if (isLateCancel) {
        await deductSessionCredit(userId, `Late cancellation (${dateStr}, <24hrs notice)`, env);
        // Normalize startAt — strip milliseconds so key matches cron's Trainerize-derived format
        const normalizedStart = startAt.replace(/\.\d+Z$/, 'Z');
        await kvPut(
          `credit-handled:${userId}:${normalizedStart}`,
          'late-cancel',
          { expirationTtl: 90 * 24 * 3600 },
          env
        );
      }

      const creditWarning = isLateCancel
        ? '\n\nNote: This session was cancelled with less than 24 hours notice. A session credit has been deducted per our cancellation policy.'
        : '';

      try {
        await trainerizePost('/message/send', {
          userID: getTrainerizeTrainerId(env),
          recipients: [userId],
          subject: status === 'DECLINED' ? 'Booking Declined' : 'Session Cancelled',
          body: `Your session on ${dateStr} has been cancelled by ${cancelledBy}.${creditWarning}`,
          threadType: 'mainThread',
          conversationType: 'single',
          type: 'text',
        }, env);

        await trainerizePost('/trainerNote/add', {
          userID: userId,
          content: `Session ${status === 'DECLINED' ? 'declined' : 'cancelled'} (${dateStr}). By: ${cancelledBy}. ${isLateCancel ? 'LATE CANCEL — credit deducted.' : ''}`,
          type: 'general',
        }, env);
      } catch (e) {
        console.error('Trainerize cancellation message failed:', e);
      }
    }
  } else if (status === 'NO_SHOW') {
    // No-show — deduct credit (same as late cancel)
    if (userId) {
      const dateStr = new Date(startAt).toLocaleDateString('en-US', { timeZone: TIMEZONE, month: 'long', day: 'numeric' });

      await deductSessionCredit(userId, `No-show (${dateStr})`, env);
      const normalizedStart = startAt.replace(/\.\d+Z$/, 'Z');
      await kvPut(
        `credit-handled:${userId}:${normalizedStart}`,
        'no-show',
        { expirationTtl: 90 * 24 * 3600 },
        env
      );

      try {
        await trainerizePost('/message/send', {
          userID: getTrainerizeTrainerId(env),
          recipients: [userId],
          subject: 'Missed Session',
          body: `We noticed you missed your session on ${dateStr}. A session credit has been deducted. If this was an error, please reach out and we'll sort it out!`,
          threadType: 'mainThread',
          conversationType: 'single',
          type: 'text',
        }, env);

        await trainerizePost('/trainerNote/add', {
          userID: userId,
          content: `NO-SHOW (${dateStr}) — credit deducted.`,
          type: 'general',
        }, env);
      } catch (e) {
        console.error('No-show message failed:', e);
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
  // DST for US Eastern: starts 2nd Sunday of March at 2AM EST (7AM UTC),
  // ends 1st Sunday of November at 2AM EDT (6AM UTC).
  // Formula verified against real calendars 2024-2030.
  const month = dateObj.getUTCMonth(); // 0-indexed
  const day = dateObj.getUTCDate();
  const hour = dateObj.getUTCHours();

  let isDST;
  if (month > 2 && month < 10) {
    isDST = true; // Apr-Oct always DST
  } else if (month === 2) {
    // March: find 2nd Sunday. Formula: firstSun = 1 + (7 - DOW_of_Mar1) % 7; secondSun = firstSun + 7
    const mar1dow = new Date(dateObj.getUTCFullYear(), 2, 1).getUTCDay();
    const secondSunday = 1 + (7 - mar1dow) % 7 + 7;
    isDST = day > secondSunday || (day === secondSunday && hour >= 7);
  } else if (month === 10) {
    // November: find 1st Sunday. Formula: firstSun = 1 + (7 - DOW_of_Nov1) % 7
    const nov1dow = new Date(dateObj.getUTCFullYear(), 10, 1).getUTCDay();
    const firstSunday = 1 + (7 - nov1dow) % 7;
    isDST = day < firstSunday || (day === firstSunday && hour < 6);
  } else {
    isDST = false; // Dec-Feb always EST
  }
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
  const dayEndUtc = dayStartUtc + 19 * 3600000; // 19h covers to 7PM + 2h buffer = 9PM, includes 8:30PM

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

  // Unrecognized plan — return null to prevent wrong credit assignment
  console.log(`findPlanCredits: no match for "${planName}"`);
  return null;
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
    'Square-Version': '2025-01-23',
    'Content-Type': 'application/json',
  };
}

// ===== ORDER-BASED CREDIT PURCHASES =====

/**
 * Handle a completed Square order that contains session credits.
 * Called when order.fulfilled or order.updated fires with state=COMPLETED.
 */
async function handleCreditPurchaseOrder(order, env) {
  if (!isTrainerizeConfigured(env)) return;

  // Idempotency: skip if already processed
  const orderKey = `order-processed:${order.id}`;
  if (await kvGet(orderKey, env)) return;

  let totalCredits = 0;
  let duration = 60;

  for (const li of (order.line_items || [])) {
    const name = li.name || '';
    const qty = parseInt(li.quantity || '1');
    const varName = li.variation_name || '';

    if (name.includes('Training Session Credits') || name.includes('Single Session')) {
      totalCredits += qty;
      if (varName.includes('30') || name.includes('30')) duration = 30;
      else if (varName.includes('90') || name.includes('90')) duration = 90;
    } else if (name.includes('Training Plan') || name.includes('Training plan')) {
      if (name.includes('12 Week') || name.includes('13 Week')) totalCredits += 12;
      else if (varName.includes('2x/week')) totalCredits += qty * 4;
      else if (varName.includes('1x/week')) totalCredits += qty * 2;
      else totalCredits += qty * 4;
      if (name.includes('90')) duration = 90;
    }
  }

  if (totalCredits === 0) return;

  // Get customer email
  const email = await getCustomerEmail(order.customer_id, env);
  if (!email) return;

  const userId = await findTrainerizeUserByEmail(email, env);
  if (!userId) {
    console.log(`Order credit sync: Trainerize user not found for ${email}`);
    return;
  }

  // Add credits (stack on top of existing)
  const existing = await kvGet(`credits:${userId}`, env);
  let creditData;
  if (existing) {
    try {
      creditData = JSON.parse(existing);
    } catch (err) {
      // Corrupted credit record — bail rather than overwrite and erase the
      // user's prior balance. Surface loudly so it can be repaired manually.
      await logEvent('error', 'credit-data-corrupt', {
        userId, email, kvKey: `credits:${userId}`, rawLength: existing.length,
      }, env);
      console.error(`Credit JSON corrupt for user ${userId} — skipping to preserve balance`, err);
      return;
    }
    creditData.remaining += totalCredits;
    creditData.total += totalCredits;
  } else {
    creditData = {
      userId, email, total: totalCredits, remaining: totalCredits,
      duration, planName: 'Square order',
      validUntil: new Date(Date.now() + 90 * 24 * 3600000).toISOString(),
      updatedAt: new Date().toISOString(), deductions: [],
    };
  }
  creditData.updatedAt = new Date().toISOString();
  await kvPut(`credits:${userId}`, JSON.stringify(creditData), {}, env);

  // Update Trainerize tag
  await clearCreditTags(userId, env);
  const tagCredits = Math.min(creditData.remaining, 24);
  await trainerizePost('/user/addTag', { userID: userId, userTag: creditTagName(tagCredits) }, env);

  // Add note
  const totalPaid = (order.total_money?.amount || 0) / 100;
  await trainerizePost('/trainerNote/add', {
    userID: userId,
    content: `${totalCredits} session credits added (Square order $${totalPaid.toFixed(0)}). Balance: ${creditData.remaining}/${creditData.total}.`,
    type: 'general',
  }, env);

  // Set Active Client tag
  try {
    await trainerizePost('/user/deleteTag', { userID: userId, userTag: '💤 Inactive' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: '🟢 Active Client' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: '✅ Paid' }, env);
  } catch { /* tags are best-effort */ }

  // Mark order as processed
  await kvPut(orderKey, new Date().toISOString(), { expirationTtl: 90 * 24 * 3600 }, env);
  console.log(`Order credit sync: ${email} +${totalCredits} credits (order ${order.id.slice(0, 8)})`);
}

// ===== PAY-PER-SESSION AUTO-INVOICE =====

// Square catalog variation IDs for single sessions
const SESSION_CATALOG = {
  30: { variationId: '66QDZG33XW3F62HR63P6VF5G', price: 5000, name: 'PT - 30 Minute Session' },
  60: { variationId: 'DFDGPQ56NTEWU4TX2WQBU7TR', price: 8000, name: 'PT - 60 Minute Session' },
  90: { variationId: 'EFAXK3SOJJPNK2G3XK3MHXZI', price: 11000, name: 'PT - 90 Minute' },
};

/**
 * Create and send a Square invoice for a completed session.
 * Called by the cron when a past session has no credit balance.
 */
async function createSessionInvoice(attendeeUserId, attendeeName, sessionDate, durationMin, env, aptId) {
  const catalog = SESSION_CATALOG[durationMin] || SESSION_CATALOG[60];
  const locationId = 'LD0SGZXT6ZSSD';

  // Find Square customer by name
  const firstName = attendeeName.split(' ')[0];
  const lastName = attendeeName.split(' ').slice(1).join(' ');
  const squareCustomerId = await findSquareCustomerByName(firstName, lastName, env);

  if (!squareCustomerId) {
    console.log(`Auto-invoice: Square customer not found for ${attendeeName}`);
    return false;
  }

  // Idempotency suffix must include the appointment ID so two sessions on the
  // same day don't collide and share a single invoice.
  const idemSuffix = aptId ? `${sessionDate}-${aptId}` : sessionDate;

  try {
    // 1. Create Square order
    const orderResp = await fetch(`${getSquareApiBase(env)}/orders`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        idempotency_key: `auto-invoice-${attendeeUserId}-${idemSuffix}`,
        order: {
          location_id: locationId,
          customer_id: squareCustomerId,
          line_items: [{
            catalog_object_id: catalog.variationId,
            quantity: '1',
          }],
        },
      }),
    });
    if (!orderResp.ok) {
      console.error('Auto-invoice: order creation failed:', await orderResp.text());
      return false;
    }
    const orderData = await orderResp.json();
    const orderId = orderData.order?.id;
    if (!orderId) return false;

    // 2. Create invoice from order
    const dueDate = new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0];
    const invoiceResp = await fetch(`${getSquareApiBase(env)}/invoices`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        idempotency_key: `inv-${attendeeUserId}-${idemSuffix}`,
        invoice: {
          location_id: locationId,
          order_id: orderId,
          primary_recipient: { customer_id: squareCustomerId },
          payment_requests: [{
            request_type: 'BALANCE',
            due_date: dueDate,
            automatic_payment_source: 'CARD_ON_FILE',
          }],
          delivery_method: 'EMAIL',
          title: `Training Session - ${sessionDate}`,
          description: `Auto-invoice for session on ${sessionDate} (${durationMin} min)`,
          accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false },
        },
      }),
    });
    if (!invoiceResp.ok) {
      console.error('Auto-invoice: invoice creation failed:', await invoiceResp.text());
      return false;
    }
    const invoiceData = await invoiceResp.json();
    const invoiceId = invoiceData.invoice?.id;
    const invoiceVersion = invoiceData.invoice?.version;
    if (!invoiceId) return false;

    // 3. Publish (send) the invoice
    const publishResp = await fetch(`${getSquareApiBase(env)}/invoices/${invoiceId}/publish`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        idempotency_key: `pub-${invoiceId}`,
        version: invoiceVersion,
      }),
    });
    if (!publishResp.ok) {
      console.error('Auto-invoice: publish failed:', await publishResp.text());
      return false;
    }

    // 4. Add note in Trainerize
    await trainerizePost('/trainerNote/add', {
      userID: attendeeUserId,
      content: `Invoice sent for ${durationMin}min session on ${sessionDate} — $${(catalog.price / 100).toFixed(0)} (due ${dueDate}). Invoice #${invoiceId.slice(0, 8)}`,
      type: 'general',
    }, env);

    console.log(`Auto-invoice sent: ${attendeeName} → $${catalog.price / 100} for ${sessionDate}`);
    return true;
  } catch (e) {
    console.error('Auto-invoice error:', e);
    return false;
  }
}

/**
 * Handle payment of a session invoice we auto-created.
 * Updates Trainerize with payment confirmation.
 */
async function handleSessionInvoicePaid(invoice, env) {
  const customerId = invoice.primary_recipient?.customer_id;
  if (!customerId) return;

  const email = await getCustomerEmail(customerId, env);
  if (!email) return;

  const userId = await findTrainerizeUserByEmail(email, env);
  if (!userId) return;

  const amount = (invoice.payment_requests?.[0]?.computed_amount_money?.amount || 0) / 100;
  await trainerizePost('/trainerNote/add', {
    userID: userId,
    content: `Session payment received: $${amount.toFixed(0)} (Invoice #${(invoice.id || '').slice(0, 8)})`,
    type: 'general',
  }, env);

  await trainerizePost('/user/addTag', { userID: userId, userTag: '✅ Paid' }, env);
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
      // Skip appointments synced FROM Square (check for Square booking ID pattern)
      if ((apt.notes || '').includes('Square #') || (apt.notes || '').includes('synced from Square') || (apt.notes || '').includes('Square sync')) continue;

      // Skip if already synced to Square
      const syncKey = `tz-sq-sync:${apt.id}`;
      const existing = await kvGet(syncKey, env);
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
            // Include start time so a rescheduled appointment gets a fresh
            // idempotency key — otherwise Square would return the original
            // (stale) booking after the KV sync marker expires (30d TTL).
            idempotency_key: `tz-sync-${apt.id}-${startAt.replace(/[:.]/g, '')}`,
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
          await kvPut(syncKey, JSON.stringify({
            trainerizeId: apt.id,
            squareBookingId,
            syncedAt: new Date().toISOString(),
          }), { expirationTtl: 30 * 24 * 3600 }, env);

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
  if (!firstName) return null;
  try {
    // Square doesn't support display_name filter.
    // Strategy: search by email if we can find it from Trainerize, else fuzzy email/phone search.
    // Fallback: fetch recent customers and match by name locally.
    const resp = await fetch(`${getSquareApiBase(env)}/customers/search`, {
      method: 'POST',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        query: {
          filter: {
            email_address: { fuzzy: firstName.toLowerCase() },
          },
        },
        limit: 10,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const searchName = (lastName ? `${firstName} ${lastName}` : firstName).toLowerCase();
    // Match by name from the results. No fallback to the first result —
    // the search is a fuzzy email match on firstName, so an unrelated customer
    // whose email contains the name would be returned and invoiced.
    const match = (data.customers || []).find(c =>
      `${c.given_name || ''} ${c.family_name || ''}`.toLowerCase().trim() === searchName
    );
    return match?.id || null;
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
  // Check appointments from the past 48 hours (covers downtime/deploy gaps)
  const lookback = new Date(now.getTime() - 48 * 3600000);

  const tzStart = lookback.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
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
      if (await kvGet(countedKey, env)) continue;

      // Process ALL attendees (handles group sessions, not just first)
      const attendees = apt.attendents || [];
      if (attendees.length === 0) continue;

      const startStr = apt.startDate || apt.startDateTime;
      if (!startStr) continue; // Guard: skip if no start date
      const sessionDate = (apt.startDateTime || apt.startDate || '').split(' ')[0];
      const startMs = new Date(startStr.replace(' ', 'T') + 'Z').getTime();
      const durationMin = Math.round((endMs - startMs) / 60000) || 60;

      for (const attendee of attendees) {
        if (!attendee?.userID) continue;

        // Per-attendee dedup key
        const attCountedKey = `session-counted:${apt.id}:${attendee.userID}`;
        if (await kvGet(attCountedKey, env)) continue;

        // Check if client has credits (safe JSON parse)
        let creditRaw;
        try { creditRaw = await kvGet(`credits:${attendee.userID}`, env); } catch { /* KV error */ }
        let hasCredits = false;
        if (creditRaw) {
          try { hasCredits = JSON.parse(creditRaw).remaining > 0; } catch { /* corrupted JSON */ }
        }

        if (!hasCredits) {
          // No credits → auto-invoice this session
          const attName = `${attendee.firstName || ''} ${attendee.lastName || ''}`.trim();
          const invoiced = await createSessionInvoice(attendee.userID, attName, sessionDate, durationMin, env, apt.id);
          if (invoiced) {
            await kvPut(attCountedKey, 'invoiced', { expirationTtl: 90 * 24 * 3600 }, env);
          }
          continue;
        }

        // Check if already handled by late-cancel
        if (startStr) {
          const startAtIso = startStr.replace(' ', 'T') + 'Z';
          const cancelKey = `credit-handled:${attendee.userID}:${startAtIso}`;
          if (await kvGet(cancelKey, env)) {
            await kvPut(attCountedKey, 'cancel-deducted', { expirationTtl: 90 * 24 * 3600 }, env);
            continue;
          }
        }

        // Deduct credit
        await deductSessionCredit(attendee.userID, `Session completed (${sessionDate})`, env);
        await kvPut(attCountedKey, new Date().toISOString(), { expirationTtl: 90 * 24 * 3600 }, env);

        if (startStr) {
          const startAtIso = startStr.replace(' ', 'T') + 'Z';
          await kvPut(
            `credit-handled:${attendee.userID}:${startAtIso}`,
            'session-completed',
            { expirationTtl: 90 * 24 * 3600 },
            env
          );
        }
      }

      // Mark appointment-level as counted
      await kvPut(countedKey, new Date().toISOString(), { expirationTtl: 90 * 24 * 3600 }, env);
    }
  } catch (e) {
    console.error('Session credit deduction cron failed:', e);
  }
}

/**
 * Verify Square webhook signature
 */
async function verifySignature(url, body, signature, key) {
  if (!signature) return false;

  // Square requires HMAC-SHA256 of the FULL webhook URL + request body
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(url + body);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return computed === signature;
}

// ===== GOOGLE MEET (server-side) =====

/**
 * Create a Google Calendar event with Meet link.
 * Secrets (client_secret, refresh_token) stay on the server.
 */
async function createGoogleMeetEvent(params, env) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const calendarId = env.GOOGLE_CALENDAR_ID || 'primary';

  if (!clientId || !clientSecret || !refreshToken) {
    return { success: false, error: 'Google Calendar not configured' };
  }

  // Refresh the access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenResp.ok) return { success: false, error: 'Token refresh failed' };
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;

  // Create calendar event with Meet
  const startTime = new Date(params.startAt);
  const endTime = new Date(startTime.getTime() + (params.durationMinutes || 60) * 60000);

  const eventResp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.title || 'Training Session',
        description: params.description || '',
        start: { dateTime: startTime.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: endTime.toISOString(), timeZone: TIMEZONE },
        attendees: params.attendeeEmail ? [{ email: params.attendeeEmail }] : [],
        conferenceData: {
          createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      }),
    }
  );

  if (!eventResp.ok) {
    const err = await eventResp.text();
    return { success: false, error: `Calendar API error: ${err.slice(0, 200)}` };
  }

  const event = await eventResp.json();
  const meetLink = event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';

  return {
    success: true,
    meeting: {
      meetLink,
      eventId: event.id,
      calendarLink: event.htmlLink,
    },
  };
}

// ===== CHALLENGES KV STORAGE =====

async function getChallenges(env) {
  if (!env.CHALLENGES_KV) return [];
  try {
    const raw = await kvGet('challenges', env);
    if (!raw) return [];
    const all = JSON.parse(raw);
    // Auto-expire old challenges
    const now = new Date().toISOString().split('T')[0];
    return all.filter(c => !c.endDate || c.endDate >= now);
  } catch {
    return [];
  }
}

const MAX_CHALLENGES = 50;

async function saveChallenge(challenge, env) {
  if (!env.CHALLENGES_KV) return;
  let all = await getChallenges(env); // already filtered for expired
  if (all.length >= MAX_CHALLENGES) {
    // Remove oldest entries to make room
    all = all.slice(all.length - MAX_CHALLENGES + 1);
  }
  all.push(challenge);
  await kvPut('challenges', JSON.stringify(all), {}, env);
}

async function deleteChallenge(id, env) {
  if (!env.CHALLENGES_KV) return;
  const all = await getChallenges(env);
  const filtered = all.filter(c => c.id !== id);
  await kvPut('challenges', JSON.stringify(filtered), {}, env);
}
