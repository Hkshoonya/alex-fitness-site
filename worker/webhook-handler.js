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
  return parseInt(getTrainerizeGroupId(env) || '0');
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
          await syncBookingToTrainerize(booking, env);
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
};

/**
 * When a subscription renews, add session credits in Trainerize (via notes + tags)
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
 * Update session credits in Trainerize via trainer notes + tags
 * (No direct credits endpoint in v03 API)
 */
async function updateTrainerizeCredits(email, planName, credits, env) {
  if (!isTrainerizeConfigured(env)) {
    console.log('Trainerize not configured — skipping credit update');
    return;
  }

  try {
    // Look up client userID by email
    const userId = await findTrainerizeUserByEmail(email, env);
    if (!userId) {
      console.log(`Trainerize user not found for ${email} — skipping credit update`);
      return;
    }

    // Add credit note via trainerNote
    await trainerizePost('/trainerNote/add', {
      userID: userId,
      content: `Session credits renewed: ${credits.sessions} sessions (${planName}, ${credits.duration}min each). Valid until ${getNextBillingDate()}`,
      type: 'general',
    }, env);

    // Tag with subscription status and credit count
    await trainerizePost('/user/addTag', { userID: userId, userTag: 'subscription-active' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: `credits:${credits.sessions}` }, env);

  } catch (error) {
    console.error('Trainerize credit update failed:', error);
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

  // Get customer email from Square
  const email = await getCustomerEmail(customerId, env);
  if (!email) {
    console.log(`Booking sync: no email for customer ${customerId}`);
    return;
  }

  // Find Trainerize userID
  const userId = await findTrainerizeUserByEmail(email, env);

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

      // Check if within 24 hours — potential credit loss
      const hoursUntil = (new Date(startAt).getTime() - Date.now()) / 3600000;
      const creditWarning = (hoursUntil < CANCEL_NOTICE_HOURS && status === 'CANCELLED_BY_CUSTOMER')
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
          content: `Session cancelled (${dateStr}). Cancelled by: ${cancelledBy}. ${hoursUntil < CANCEL_NOTICE_HOURS ? 'LATE CANCEL — within 24hrs.' : ''}`,
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
 * Merges Square bookings + Trainerize appointments into ONE unified calendar.
 * All times are Eastern (America/New_York). Enforces 90-minute booking buffer.
 *
 * Both Square and Trainerize are checked — a booking in EITHER system blocks the slot.
 * This means:
 *   - Client books on Square → blocked on website + Trainerize
 *   - Coach blocks time in Trainerize → blocked on website + Square availability
 *   - Client books on website → creates in Square → webhook syncs to Trainerize
 */
async function getCoachAvailability(date, duration, env) {
  // Business hours: 6:00 AM – 8:30 PM Eastern, every day
  const OPEN_H = 6, OPEN_M = 0;
  const CLOSE_H = 20, CLOSE_M = 30;

  // EST = UTC-5 (Florida, no daylight saving adjustment)
  const TZ_OFFSET_HOURS = -5;
  const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 3600000;

  // Helper: create a UTC timestamp for a given Eastern time on this date
  function easternToUtcMs(h, m) {
    // Eastern time → UTC: subtract the offset (add because offset is negative)
    return new Date(`${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`).getTime() - TZ_OFFSET_MS;
  }

  // Helper: convert UTC ms to a slot key for comparison (rounded to 30-min blocks)
  function toSlotKey(utcMs) {
    return new Date(utcMs).toISOString().slice(0, 16);
  }

  // Collect ALL blocked UTC time ranges from both systems
  const bookedSlotKeys = new Set();

  // ===== SQUARE BOOKINGS =====
  // Square times are always UTC
  const dayStartUtc = easternToUtcMs(OPEN_H, OPEN_M);
  const dayEndUtc = easternToUtcMs(CLOSE_H, CLOSE_M);
  try {
    const resp = await fetch(
      `${getSquareApiBase(env)}/bookings?start_at_min=${new Date(dayStartUtc).toISOString()}&start_at_max=${new Date(dayEndUtc).toISOString()}&limit=100`,
      { headers: getSquareHeaders(env) }
    );
    if (resp.ok) {
      const data = await resp.json();
      for (const b of (data.bookings || [])) {
        if (b.status === 'ACCEPTED' || b.status === 'PENDING') {
          const startMs = new Date(b.start_at).getTime();
          const dur = b.appointment_segments?.[0]?.duration_minutes || 60;
          for (let t = startMs; t < startMs + dur * 60000; t += 30 * 60000) {
            bookedSlotKeys.add(toSlotKey(t));
          }
        }
      }
    }
  } catch (e) {
    console.error('Square bookings fetch failed:', e);
  }

  // ===== TRAINERIZE APPOINTMENTS =====
  // Trainerize returns startDate in UTC (space-separated format)
  if (isTrainerizeConfigured(env)) {
    try {
      // Fetch wider range to catch timezone edge cases
      const tzDayStart = new Date(dayStartUtc).toISOString().replace('T', ' ').replace('Z', '');
      const tzDayEnd = new Date(dayEndUtc).toISOString().replace('T', ' ').replace('Z', '');

      const resp = await trainerizePost('/appointment/getList', {
        userID: getTrainerizeTrainerId(env),
        startDate: tzDayStart,
        endDate: tzDayEnd,
        start: 0,
        count: 50,
      }, env);
      if (resp.ok) {
        const data = await resp.json();
        for (const apt of (data.appointments || [])) {
          // startDate is UTC in Trainerize response
          const startStr = apt.startDate || apt.startDateTime;
          if (!startStr) continue;
          const startMs = new Date(startStr.replace(' ', 'T') + 'Z').getTime();
          const endStr = apt.endDate || apt.endDateTime;
          const endMs = endStr
            ? new Date(endStr.replace(' ', 'T') + 'Z').getTime()
            : startMs + (apt.duration || 60) * 60000;
          for (let t = startMs; t < endMs; t += 30 * 60000) {
            bookedSlotKeys.add(toSlotKey(t));
          }
        }
      }
    } catch (e) {
      console.error('Trainerize appointments fetch failed:', e);
    }
  }

  // ===== GENERATE SLOTS (in Eastern time, stored as UTC) =====
  const now = Date.now();
  const bufferMs = BOOKING_BUFFER_MINUTES * 60000;
  const slots = [];
  let h = OPEN_H;
  let m = OPEN_M;

  while (h < CLOSE_H || (h === CLOSE_H && m + duration <= CLOSE_M)) {
    const slotUtcMs = easternToUtcMs(h, m);

    // Check all 30-min sub-blocks for this duration
    let blocked = false;
    for (let t = slotUtcMs; t < slotUtcMs + duration * 60000; t += 30 * 60000) {
      if (bookedSlotKeys.has(toSlotKey(t))) {
        blocked = true;
        break;
      }
    }

    const isPast = slotUtcMs < now;
    const withinBuffer = !isPast && (slotUtcMs - now) < bufferMs;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    const displayM = String(m).padStart(2, '0');

    slots.push({
      time: `${displayH}:${displayM} ${ampm}`,
      startAt: new Date(slotUtcMs).toISOString(),
      available: !blocked && !isPast,
      requiresConfirmation: withinBuffer && !blocked && !isPast,
      blocked,
      duration,
    });

    m += 30;
    if (m >= 60) { h++; m = 0; }
  }

  return {
    date,
    timezone: TIMEZONE,
    businessHours: { open: `${String(OPEN_H).padStart(2,'0')}:${String(OPEN_M).padStart(2,'0')}`, close: `${String(CLOSE_H).padStart(2,'0')}:${String(CLOSE_M).padStart(2,'0')}` },
    bufferMinutes: BOOKING_BUFFER_MINUTES,
    cancelNoticeHours: CANCEL_NOTICE_HOURS,
    slots,
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
