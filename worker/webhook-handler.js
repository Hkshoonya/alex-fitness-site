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

// Trainerize appointment type IDs for synced bookings. These get picked per
// booking based on whether Square flagged it virtual (CUSTOMER_LOCATION or
// "virtual" in the note) vs in-person. Both can be overridden via env var;
// see /admin/trainerize-appointment-types endpoint to list available IDs.
const TZ_SYNC_VIRTUAL_DEFAULT = 2845440;   // "30 min PT Session (virtual)"
const TZ_SYNC_INPERSON_DEFAULT = null;      // No default — must be set via env

function getVirtualApptType(env) {
  const v = parseInt(env.TZ_VIRTUAL_APPOINTMENT_TYPE_ID || '', 10);
  return Number.isFinite(v) && v > 0 ? v : TZ_SYNC_VIRTUAL_DEFAULT;
}
function getInPersonApptType(env) {
  const v = parseInt(env.TZ_INPERSON_APPOINTMENT_TYPE_ID || '', 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}
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

// ===== AUTHORITATIVE PLAN CATALOG =====
// Server-side source of truth for plan pricing and session counts. The browser
// sends only { planId, frequencyIndex, trainerId } at checkout — the worker
// derives amountCents and session count from this catalog. NEVER trust
// client-supplied amounts or session counts; that was the C-02 exploit fixed
// here (browser could display $2880 but charge $720 base).
//
// Mirror of src/data/trainingPlans.ts. If you change one, change both.
const PLAN_CATALOG = {
  '4week-30min': {
    name: '4 Week Plan - 30 Min Sessions', duration: 30, planWeeks: 4,
    frequency: [
      { perWeek: 1, totalSessions: 4,  totalPrice: 160 },
      { perWeek: 2, totalSessions: 8,  totalPrice: 320 },
      { perWeek: 3, totalSessions: 12, totalPrice: 480 },
      { perWeek: 4, totalSessions: 16, totalPrice: 640 },
      { perWeek: 5, totalSessions: 20, totalPrice: 800 },
    ],
  },
  '4week-60min': {
    name: '4 Week Plan - 60 Min Sessions', duration: 60, planWeeks: 4,
    frequency: [
      { perWeek: 1, totalSessions: 4,  totalPrice: 280 },
      { perWeek: 2, totalSessions: 8,  totalPrice: 560 },
      { perWeek: 3, totalSessions: 12, totalPrice: 840 },
      { perWeek: 4, totalSessions: 16, totalPrice: 1120 },
      { perWeek: 5, totalSessions: 20, totalPrice: 1400 },
    ],
  },
  '4week-90min': {
    name: '4 Week Plan - 90 Min Sessions', duration: 90, planWeeks: 4,
    frequency: [
      { perWeek: 1, totalSessions: 4,  totalPrice: 400 },
      { perWeek: 2, totalSessions: 8,  totalPrice: 800 },
      { perWeek: 3, totalSessions: 12, totalPrice: 1200 },
      { perWeek: 4, totalSessions: 16, totalPrice: 1600 },
      { perWeek: 5, totalSessions: 20, totalPrice: 2000 },
    ],
  },
  '12week-30min': {
    name: '12 Week Plan - 30 Min Sessions', duration: 30, planWeeks: 12,
    frequency: [
      { perWeek: 1, totalSessions: 12, totalPrice: 420 },
      { perWeek: 2, totalSessions: 24, totalPrice: 840 },
      { perWeek: 3, totalSessions: 36, totalPrice: 1260 },
      { perWeek: 4, totalSessions: 48, totalPrice: 1680 },
      { perWeek: 5, totalSessions: 60, totalPrice: 2100 },
    ],
  },
  '12week-60min': {
    name: '12 Week Plan - 60 Min Sessions', duration: 60, planWeeks: 12,
    frequency: [
      { perWeek: 1, totalSessions: 12, totalPrice: 720 },
      { perWeek: 2, totalSessions: 24, totalPrice: 1440 },
      { perWeek: 3, totalSessions: 36, totalPrice: 2160 },
      { perWeek: 4, totalSessions: 48, totalPrice: 2880 },
      { perWeek: 5, totalSessions: 60, totalPrice: 3600 },
    ],
  },
  '12week-90min': {
    name: '12 Week Plan - 90 Min Sessions', duration: 90, planWeeks: 12,
    frequency: [
      { perWeek: 1, totalSessions: 12, totalPrice: 1080 },
      { perWeek: 2, totalSessions: 24, totalPrice: 2160 },
      { perWeek: 3, totalSessions: 36, totalPrice: 3240 },
      { perWeek: 4, totalSessions: 48, totalPrice: 4320 },
      { perWeek: 5, totalSessions: 60, totalPrice: 5400 },
    ],
  },
  // Flat-price plans — no frequency variants, no trainer multiplier (no
  // in-person sessions granted). The frontend may still POST these through
  // /checkout/charge for the card-on-file save, but no Trainerize credits flow.
  'app-only': {
    name: 'Fitness App (No Coaching)', duration: 0, planWeeks: 4,
    flatPrice: 10, sessionsGranted: 0,
  },
  'online-monthly': {
    name: 'Custom Online Training - Monthly', duration: 0, planWeeks: 4,
    flatPrice: 100, sessionsGranted: 0,
  },
  'online-3month': {
    name: 'Custom Online Training - 3 Months', duration: 0, planWeeks: 12,
    flatPrice: 250, sessionsGranted: 0,
  },
};

const TRAINER_MULTIPLIERS = { alex1: 1.0, alex2: 0.8 };

/**
 * Resolve a {planId, frequencyIndex, trainerId} tuple to the authoritative
 * amount, session count, and metadata. Returns { ok: false, error } for any
 * unknown ID or out-of-range frequency. Used by /checkout/charge and
 * /credit-grant — both endpoints derive money/credits from the same source so
 * they cannot disagree.
 */
function resolvePurchase({ planId, frequencyIndex, trainerId }) {
  const plan = PLAN_CATALOG[planId];
  if (!plan) return { ok: false, error: `Unknown planId: ${planId}` };
  const multiplier = TRAINER_MULTIPLIERS[trainerId];
  if (multiplier === undefined) {
    return { ok: false, error: `Unknown trainerId: ${trainerId}` };
  }

  // Flat-price plans (app-only, online-*) ignore frequencyIndex and trainer.
  if (plan.flatPrice !== undefined) {
    return {
      ok: true,
      planName: plan.name,
      duration: plan.duration,
      planWeeks: plan.planWeeks,
      sessions: plan.sessionsGranted,
      amountCents: plan.flatPrice * 100,
      isFlat: true,
    };
  }

  // Frequency-based plans require a valid index into the frequency array.
  const idx = Number(frequencyIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= plan.frequency.length) {
    return {
      ok: false,
      error: `Invalid frequencyIndex ${frequencyIndex} for plan ${planId}`,
    };
  }
  const freq = plan.frequency[idx];
  return {
    ok: true,
    planName: plan.name,
    duration: plan.duration,
    planWeeks: plan.planWeeks,
    sessions: freq.totalSessions,
    amountCents: Math.round(freq.totalPrice * multiplier * 100),
    isFlat: false,
  };
}

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
/**
 * Per-IP rate limit backed by KV. Uses a coarse per-minute bucket so the worst
 * a caller can do is `max` requests per minute. Returns true when the caller
 * is under the limit (and the counter has been incremented); false when they
 * should be rejected. KV eventual consistency means a determined attacker
 * might get a few extra per minute — good enough to prevent abuse-scale
 * quota burn, not a hard ceiling.
 */
async function checkRateLimit(request, bucket, max, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'anon';
  const minute = Math.floor(Date.now() / 60000);
  const key = `ratelimit:${bucket}:${ip}:${minute}`;
  const raw = await kvGet(key, env);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= max) return false;
  // 120s TTL keeps the prior-minute bucket around briefly for race cleanup
  await kvPut(key, String(count + 1), { expirationTtl: 120 }, env);
  return true;
}

/**
 * Short-lived KV lock. Holds `lockKey` for up to `ttlSec`, runs `fn`, then
 * best-effort deletes the key. Returns { ok:true, value } on success, or
 * { ok:false, busy:true } when the lock is already held (caller should 409).
 * Throws whatever `fn` throws AFTER unlocking.
 */
async function withLock(lockKey, ttlSec, env, fn) {
  if (await kvGet(lockKey, env)) return { ok: false, busy: true };
  await kvPut(lockKey, Date.now().toString(), { expirationTtl: ttlSec }, env);
  try {
    const value = await fn();
    return { ok: true, value };
  } finally {
    try { await env.CHALLENGES_KV.delete(lockKey); } catch { /* best-effort */ }
  }
}

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
  // Guard empty/whitespace: /user/find with an empty searchTerm returns a
  // broad list, and the downstream email equality would match any user with
  // a blank email field — returning the wrong user.
  if (!email || !String(email).trim()) return null;
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

    // Allowed origins for API proxy access. When we cut over to the custom
    // domain, add it here (see .planning / WORKER_SECRETS note).
    const ALLOWED_ORIGINS = [
      'https://hkshoonya.github.io',
      'https://alexsfitness.com',
      'https://www.alexsfitness.com',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
    ];
    // Extract the origin from Referer (if present) so we're comparing full
    // origins, not string prefixes. startsWith() would've matched a spoofed
    // Origin: `https://hkshoonya.github.io.evil.com` — exact equality on the
    // parsed origin kills that bypass.
    let refererOrigin = '';
    if (referer) {
      try { refererOrigin = new URL(referer).origin; } catch { /* ignore */ }
    }
    const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes(refererOrigin);

    const corsHeaders = {
      // Reflect the client's origin ONLY if it's in the allowlist — never
      // echo an attacker-controlled origin.
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Square-Version, X-Admin-Token',
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

    // ===== PROXY PATH ALLOWLIST (C-01 FIX) =====
    // Origin checks are bypassable from non-browser clients (curl can forge
    // any Origin header). The previous defense was a blocklist of "obviously
    // destructive" paths — but it left wide-open routes for PII enumeration:
    //   - GET /api/square/customers (list ALL customers)
    //   - POST /api/trainerize/user/list (full client roster)
    //   - GET /api/square/payments (all payment history)
    // C-01 fix: replace blocklist with allowlist. Only the exact (path,method)
    // combinations the frontend legitimately uses pass through. Square IDs
    // are alphanumeric uppercase (with optional hyphens) — the [A-Z0-9_-]+
    // pattern keeps them tight.
    if (isProxyRoute) {
      // Match {service: 'square'|'trainerize', subpath: '...'} from the URL.
      const m = url.pathname.match(/^\/api\/(square|trainerize)\/(.+)$/);
      if (!m) {
        return new Response(JSON.stringify({ error: 'Bad proxy path' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const service = m[1];
      const subpath = m[2];
      const method = request.method.toUpperCase();

      // Allowlist entries: [pattern, allowedMethods...].
      // ANYTHING that doesn't match exactly here will 403.
      const SQUARE_ALLOW = [
        // Bookings
        [/^bookings$/,                              ['GET', 'POST']],
        [/^bookings\/[A-Za-z0-9_-]+$/,              ['GET', 'PUT', 'DELETE']],
        [/^bookings\/availability\/search$/,        ['POST']],
        // Cards (save card to customer)
        [/^cards$/,                                 ['POST']],
        // Catalog (read-only — list + single object)
        [/^catalog\/list$/,                         ['GET']],
        [/^catalog\/object\/[A-Za-z0-9_-]+$/,       ['GET']],
        // Customers — POST only on /customers (create), no GET (would enumerate)
        [/^customers$/,                             ['POST']],
        [/^customers\/[A-Za-z0-9_-]+$/,             ['GET', 'PUT']],
        [/^customers\/search$/,                     ['POST']],
        // Locations — GET only (gym info display)
        [/^locations$/,                             ['GET']],
        [/^locations\/[A-Za-z0-9_-]+$/,             ['GET']],
        // Payments — POST one-off; GET single by ID for receipt verification
        [/^payments$/,                              ['POST']],
        [/^payments\/[A-Za-z0-9_-]+$/,              ['GET']],
        // Subscriptions
        [/^subscriptions$/,                         ['POST']],
        [/^subscriptions\/[A-Za-z0-9_-]+$/,         ['GET', 'POST']],
        // Team members (coach picker uses search; never list everyone)
        [/^team-members\/search$/,                  ['POST']],
      ];
      const TRAINERIZE_ALLOW = [
        [/^appointment\/add$/,         ['POST']],
        [/^appointment\/getAppointmentTypeList$/, ['POST']], // admin-only via /admin/* but allow for diagnostics
        [/^program\/copyToUser$/,      ['POST']],
        [/^program\/getList$/,         ['POST']],
        [/^trainerNote\/add$/,         ['POST']],
        [/^user\/add$/,                ['POST']],
        [/^user\/addTag$/,             ['POST']],
        [/^user\/find$/,               ['POST']],
        [/^user\/setProfile$/,         ['POST']],
      ];
      const allowlist = service === 'square' ? SQUARE_ALLOW : TRAINERIZE_ALLOW;

      // OPTIONS preflights are always allowed (handled by CORS earlier).
      const allowed = method === 'OPTIONS' || allowlist.some(
        ([re, methods]) => re.test(subpath) && methods.includes(method)
      );
      if (!allowed) {
        await logEvent('error', 'proxy-path-not-allowed', {
          service, subpath, method,
        }, env);
        return new Response(JSON.stringify({
          error: 'Endpoint not permitted via proxy',
          hint: 'Only specific frontend-required paths are exposed. Server-to-server work uses dedicated worker endpoints.',
        }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ===== GOOGLE MEET API (server-side — secrets never exposed to frontend) =====
    if (url.pathname === '/api/google/meet' && request.method === 'POST') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: corsHeaders });
      }
      // Origin is spoofable from non-browser clients. Rate-limit per IP so a
      // script can't burn Google Calendar API quota even with a forged Origin.
      if (!await checkRateLimit(request, 'google-meet', 20, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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

    // ===== GOOGLE PLACES (NEW) REVIEWS — server-side proxy =====
    // Live reviews from Google Places API. Browser-origin requests to Places
    // are CORS-blocked anyway, so this endpoint exists. Cached in KV for 6h
    // because Places quota is metered per request and reviews change slowly.
    // Fixes H-03 from the launch audit (page no longer presents hardcoded
    // testimonials as live Google reviews).
    if (url.pathname === '/api/google/places/reviews' && request.method === 'GET') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 403, headers: corsHeaders,
        });
      }
      if (!await checkRateLimit(request, 'google-places', 60, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Cache hit — serve immediately. KV TTL handles staleness.
      const cacheKey = 'places:reviews:v1';
      try {
        const cached = await kvGet(cacheKey, env);
        if (cached) {
          return new Response(cached, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'X-Cache': 'HIT',
            },
          });
        }
      } catch { /* fall through to fresh fetch */ }

      const result = await fetchGooglePlaceReviews(env);
      if (!result.ok) {
        await logEvent('error', 'google-places-fetch-failed', { error: result.error }, env);
        // Return 200 with empty reviews so the frontend can fall back gracefully
        // without surfacing a CORS-style failure.
        return new Response(JSON.stringify({ reviews: [], error: result.error }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
        });
      }
      const body = JSON.stringify(result);
      await kvPut(cacheKey, body, { expirationTtl: 6 * 60 * 60 }, env);
      return new Response(body, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
      });
    }

    // ===== SQUARE API PROXY =====
    // ANY /api/square/* → forwards to Square Connect API with server-side auth
    if (url.pathname.startsWith('/api/square/')) {
      // Origin is spoofable; rate-limit per IP so a scripted attacker can't
      // enumerate /customers/search or burn Alex's 100k/day Square quota.
      // Legitimate browser usage rarely exceeds a few req/sec.
      if (!await checkRateLimit(request, 'square-proxy', 60, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
      // Origin is spoofable; rate-limit to protect Trainerize v03's 1000 req/min
      // group-token cap and to stop PII exfiltration via /user/list enumeration.
      if (!await checkRateLimit(request, 'trainerize-proxy', 60, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
      if (!await checkRateLimit(request, 'challenges-get', 120, env)) {
        return new Response('Too many requests', { status: 429, headers: corsHeaders });
      }
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
      // Creating challenges is an admin action — require the admin token.
      if (!env.ADMIN_LOG_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_LOG_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
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
        // Distinguish "zero spots" from "no spot limit" — `|| null` coerced
        // a user-entered `0` into unlimited-mode, letting anyone join forever.
        spots: typeof data.spots === 'number' ? data.spots : null,
        spotsLeft: typeof data.spots === 'number' ? data.spots : null,
        price: data.price || 0,
        tags: data.tags || [],
        trainerizeId: data.trainerizeId || data.trainerize_id || null,
        createdAt: new Date().toISOString(),
      };

      const lock = await withLock('lock:challenges-write', 15, env, () => saveChallenge(challenge, env));
      if (!lock.ok) {
        return new Response(JSON.stringify({ error: 'Challenge list is being updated — retry' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(challenge), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // POST /checkout/charge — single atomic operation at checkout:
    //   1. Resolve plan price server-side via PLAN_CATALOG (browser CANNOT
    //      supply amountCents — fixes C-02 pricing-trust exploit)
    //   2. Upsert Square Customer by email (create if missing)
    //   3. Save the tokenized card to that customer as a Card entity
    //   4. Charge the saved card via /v2/payments — note field carries the
    //      JSON-encoded plan claim so /credit-grant can verify the claim
    //      server-side (closes the secondary "claim a different plan after
    //      paying" attack at price-collision points like $800).
    // Returns { paymentId, customerId, cardId, amountCents, sessions,
    //           planName, validUntil } — frontend uses server-resolved values
    //           for the localStorage purchase record.
    if (url.pathname === '/checkout/charge' && request.method === 'POST') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!await checkRateLimit(request, 'checkout-charge', 10, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      let body;
      try { body = await request.json(); }
      catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

      const cardToken = typeof body.cardToken === 'string' ? body.cardToken.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const firstName = typeof body.firstName === 'string' ? body.firstName.trim().slice(0, 80) : '';
      const lastName = typeof body.lastName === 'string' ? body.lastName.trim().slice(0, 80) : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : '';
      const planId = typeof body.planId === 'string' ? body.planId.trim().slice(0, 40) : '';
      const trainerId = typeof body.trainerId === 'string' ? body.trainerId.trim().slice(0, 40) : '';
      // frequencyIndex is null for flat-price plans (app/online); a number for
      // frequency-variant plans (4-week / 12-week trainer plans).
      const frequencyIndex = body.frequencyIndex;

      if (!cardToken || !email || !planId || !trainerId) {
        return new Response(JSON.stringify({
          error: 'cardToken, email, planId, and trainerId are required',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'Invalid email format' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Resolve price + sessions from the authoritative catalog. NEVER trust
      // a client-supplied amount.
      const purchase = resolvePurchase({ planId, frequencyIndex, trainerId });
      if (!purchase.ok) {
        await logEvent('error', 'checkout-resolve-failed', {
          email, planId, frequencyIndex, trainerId, err: purchase.error,
        }, env);
        return new Response(JSON.stringify({ error: purchase.error }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { amountCents, planName, sessions, duration, planWeeks } = purchase;
      const validUntil = new Date(
        Date.now() + (planWeeks || 12) * 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      // Plan claim baked into Square payment.note as JSON. /credit-grant
      // re-fetches the payment and parses this back to authorize the credit
      // grant — the client never gets to retell the plan story after paying.
      const planClaim = JSON.stringify({
        planId, frequencyIndex: frequencyIndex ?? null, trainerId, email,
      });

      try {
        // 1. Upsert Square Customer by email
        let customerId = null;
        try {
          const searchResp = await fetch(`${getSquareApiBase(env)}/customers/search`, {
            method: 'POST', headers: getSquareHeaders(env),
            body: JSON.stringify({
              query: { filter: { email_address: { exact: email } } }, limit: 1,
            }),
          });
          if (searchResp.ok) {
            const sd = await searchResp.json();
            customerId = sd.customers?.[0]?.id || null;
          }
        } catch { /* fall through to create */ }

        if (!customerId) {
          const createResp = await fetch(`${getSquareApiBase(env)}/customers`, {
            method: 'POST', headers: getSquareHeaders(env),
            body: JSON.stringify({
              idempotency_key: `cust-${email.slice(0, 40)}-${Date.now()}`,
              given_name: firstName || undefined,
              family_name: lastName || undefined,
              email_address: email,
              phone_number: phone || undefined,
            }),
          });
          if (!createResp.ok) {
            const errText = await createResp.text();
            await logEvent('error', 'checkout-customer-create-failed', { email, err: errText }, env);
            return new Response(JSON.stringify({ error: 'Could not create customer' }), {
              status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          const cd = await createResp.json();
          customerId = cd.customer?.id;
          if (!customerId) {
            return new Response(JSON.stringify({ error: 'Customer created but no id returned' }), {
              status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        // 2. Save the card to the customer. /v2/cards consumes the token
        // and returns a persistent card.id we can reuse indefinitely.
        const cardResp = await fetch(`${getSquareApiBase(env)}/cards`, {
          method: 'POST', headers: getSquareHeaders(env),
          body: JSON.stringify({
            idempotency_key: `card-${cardToken.slice(0, 16)}-${Date.now()}`,
            source_id: cardToken,
            card: { customer_id: customerId },
          }),
        });
        if (!cardResp.ok) {
          const errText = await cardResp.text();
          await logEvent('error', 'checkout-card-save-failed', { email, customerId, err: errText }, env);
          return new Response(JSON.stringify({ error: 'Could not save card on file' }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const cardData = await cardResp.json();
        const cardId = cardData.card?.id;
        if (!cardId) {
          return new Response(JSON.stringify({ error: 'Card saved but no id returned' }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // 3. Charge the saved card. note=planClaim is what /credit-grant uses
        // to verify the plan claim later. reference_id is human-readable for
        // the Square dashboard.
        const payResp = await fetch(`${getSquareApiBase(env)}/payments`, {
          method: 'POST', headers: getSquareHeaders(env),
          body: JSON.stringify({
            idempotency_key: `pay-${cardId}-${Date.now()}`,
            source_id: cardId,
            customer_id: customerId,
            amount_money: { amount: amountCents, currency: 'USD' },
            location_id: env.SQUARE_LOCATION_ID,
            reference_id: `${planId}|${trainerId}`.slice(0, 40),
            note: planClaim,
            autocomplete: true,
          }),
        });
        if (!payResp.ok) {
          const errText = await payResp.text();
          await logEvent('error', 'checkout-payment-failed', { email, customerId, cardId, err: errText }, env);
          return new Response(JSON.stringify({ error: 'Payment declined', detail: errText.slice(0, 500) }), {
            status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const pd = await payResp.json();
        const paymentId = pd.payment?.id;

        await logEvent('payment', `Checkout success: ${email} → $${amountCents / 100} (${planName})`, {
          paymentId, customerId, cardId, amountCents, email, planId, trainerId, frequencyIndex,
        }, env);

        return new Response(JSON.stringify({
          success: true,
          paymentId, customerId, cardId,
          // Server-resolved values — frontend uses these for storePurchase()
          // so localStorage agrees with what was actually charged.
          amountCents, sessions, duration, planName, validUntil,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e) {
        await logEvent('error', 'checkout-charge-unexpected', { email, err: e?.message }, env);
        return new Response(JSON.stringify({ error: 'Checkout failed', detail: e?.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // POST /credit-grant — frontend calls this after a successful
    // /checkout/charge to register the purchase's sessions in worker KV.
    // Body shape: { paymentId, email, [squareCustomerId], [squareCardId] }.
    // The plan claim (planId, frequencyIndex, trainerId) is read from the
    // Square payment's note field — it was baked in at /checkout/charge time
    // and the client cannot edit it after the fact. The amount paid is also
    // re-verified against the catalog so a doctored client can't claim a
    // bigger session count than they actually paid for.
    if (url.pathname === '/credit-grant' && request.method === 'POST') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!await checkRateLimit(request, 'credit-grant', 10, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let body;
      try { body = await request.json(); }
      catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

      const paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      // Optional — when the caller used /checkout/charge these let the
      // auto-invoice path auto-charge the saved card instead of fuzzy-matching
      // the customer at invoice time.
      const squareCustomerId = typeof body.squareCustomerId === 'string' ? body.squareCustomerId.trim().slice(0, 80) : '';
      const squareCardId = typeof body.squareCardId === 'string' ? body.squareCardId.trim().slice(0, 80) : '';

      if (!paymentId || !email) {
        return new Response(JSON.stringify({ error: 'paymentId and email are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'Invalid email format' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Dedup: one grant per paymentId. Without this, a malicious script
      // could hammer /credit-grant 100x with the same paymentId and rack up
      // session credits.
      const grantKey = `credit-grant:${paymentId}`;
      if (await kvGet(grantKey, env)) {
        return new Response(JSON.stringify({ alreadyGranted: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch the payment from Square. We need three things from it:
      //   1. Status COMPLETED/APPROVED — proves they paid
      //   2. amount_money.amount — the authoritative paid amount
      //   3. note — JSON-encoded plan claim baked in at /checkout/charge
      let paymentData;
      try {
        const verifyResp = await fetch(`${getSquareApiBase(env)}/payments/${encodeURIComponent(paymentId)}`, {
          headers: getSquareHeaders(env),
        });
        if (!verifyResp.ok) {
          await logEvent('error', 'credit-grant-payment-not-found', {
            paymentId, email, status: verifyResp.status,
          }, env);
          return new Response(JSON.stringify({ error: 'Payment not found or not authorized' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        paymentData = await verifyResp.json();
        const paymentStatus = paymentData.payment?.status;
        if (paymentStatus !== 'COMPLETED' && paymentStatus !== 'APPROVED') {
          return new Response(JSON.stringify({ error: `Payment status is ${paymentStatus}, must be COMPLETED` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        await logEvent('error', 'credit-grant-verify-failed', {
          paymentId, email, err: e?.message,
        }, env);
        return new Response(JSON.stringify({ error: 'Could not verify payment with Square' }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Parse the plan claim out of payment.note. /checkout/charge embeds
      // { planId, frequencyIndex, trainerId, email } as JSON here. If the
      // payment didn't come through /checkout/charge (legacy or manual)
      // there's no way to authoritatively credit it — reject and let support
      // handle it manually.
      const noteRaw = paymentData.payment?.note || '';
      let claim;
      try { claim = JSON.parse(noteRaw); }
      catch {
        await logEvent('error', 'credit-grant-no-plan-claim', { paymentId, email, noteRaw: noteRaw.slice(0, 200) }, env);
        return new Response(JSON.stringify({
          error: 'Payment is missing plan metadata — contact support to apply credits manually',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // The email in the claim must match the requesting email — prevents
      // user A from harvesting credits attached to user B's payment.
      const claimEmail = typeof claim.email === 'string' ? claim.email.toLowerCase() : '';
      if (claimEmail && claimEmail !== email) {
        await logEvent('error', 'credit-grant-email-mismatch', { paymentId, requestEmail: email, claimEmail }, env);
        return new Response(JSON.stringify({ error: 'Payment belongs to a different account' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Re-derive the authoritative amount + sessions from the catalog using
      // the planId baked into the payment note. This is the C-02 fix: the
      // session count comes from server-side data, NOT from the request body.
      const purchase = resolvePurchase({
        planId: claim.planId,
        frequencyIndex: claim.frequencyIndex,
        trainerId: claim.trainerId,
      });
      if (!purchase.ok) {
        await logEvent('error', 'credit-grant-resolve-failed', { paymentId, email, claim, err: purchase.error }, env);
        return new Response(JSON.stringify({ error: `Could not resolve plan: ${purchase.error}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verify the actual amount paid matches the catalog amount. This catches
      // any case where the catalog or Square data has drifted between the two
      // endpoints — a hard guarantee that "credits granted" can never exceed
      // "money paid". Currency is also pinned to USD.
      const paidAmount = Number(paymentData.payment?.amount_money?.amount);
      const paidCurrency = paymentData.payment?.amount_money?.currency;
      if (paidCurrency !== 'USD' || paidAmount !== purchase.amountCents) {
        await logEvent('error', 'credit-grant-amount-mismatch', {
          paymentId, email, claim,
          expectedCents: purchase.amountCents, paidCents: paidAmount, paidCurrency,
        }, env);
        return new Response(JSON.stringify({
          error: 'Payment amount does not match plan price — credits not granted',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const sessions = purchase.sessions;
      const duration = purchase.duration || 60;
      const planName = purchase.planName;
      const validUntilInput = new Date(
        Date.now() + (purchase.planWeeks || 12) * 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      // Flat-price plans (app-only / online) don't grant trainer-session
      // credits. Mark the payment as granted (so retries short-circuit) and
      // return early — no Trainerize lookup, no KV credit record.
      if (purchase.isFlat || sessions === 0) {
        await kvPut(grantKey, JSON.stringify({
          paymentId, email, planName, flat: true,
          grantedAt: new Date().toISOString(),
        }), { expirationTtl: 90 * 24 * 3600 }, env);
        await logEvent('credit', `Flat-price purchase recorded for ${email}: ${planName}`, {
          paymentId, email, planName,
        }, env);
        return new Response(JSON.stringify({
          ok: true, flat: true, message: 'Flat-price plan recorded (no session credits)',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Find Trainerize user ID — the credits KV key is keyed by it.
      if (!isTrainerizeConfigured(env)) {
        return new Response(JSON.stringify({ error: 'Trainerize not configured' }), {
          status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      let userId = await findTrainerizeUserByEmail(email, env);
      if (!userId) {
        // Client isn't in Trainerize yet (first-time purchaser). Log and
        // return accepted — when they next book via Square, the booking
        // webhook will create their Trainerize user and the next cron
        // pass can reconcile.
        await logEvent('credit', 'credit-grant-deferred-no-tz-user', {
          paymentId, email, sessions, planName,
        }, env);
        await kvPut(grantKey, JSON.stringify({
          paymentId, email, sessions, duration, planName,
          deferred: true, grantedAt: new Date().toISOString(),
        }), { expirationTtl: 90 * 24 * 3600 }, env);
        return new Response(JSON.stringify({
          ok: true, deferred: true,
          message: 'Credits will be applied once the client account syncs',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Take the credits lock (same key deductSessionCredit uses) so a
      // concurrent cron deduction doesn't race with our credit add.
      const lockKey = `lock:credits:${userId}`;
      const locked = await kvGet(lockKey, env);
      if (locked) {
        return new Response(JSON.stringify({ error: 'User credits are being updated — try again in a moment' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await kvPut(lockKey, Date.now().toString(), { expirationTtl: 60 }, env);

      try {
        const existing = await kvGet(`credits:${userId}`, env);
        let creditData;
        if (existing) {
          try { creditData = JSON.parse(existing); }
          catch {
            await logEvent('error', 'credit-grant-corrupt-existing', {
              paymentId, email, userId,
            }, env);
            return new Response(JSON.stringify({ error: 'Existing credit record is corrupt — contact support' }), {
              status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          creditData.remaining = (creditData.remaining || 0) + sessions;
          creditData.total = (creditData.total || 0) + sessions;
          if (validUntilInput) creditData.validUntil = validUntilInput;
          creditData.planName = planName;
          // Preserve existing IDs; only overwrite when caller provides new
          // values (shouldn't happen for a returning client, but be safe).
          if (squareCustomerId) creditData.squareCustomerId = squareCustomerId;
          if (squareCardId) creditData.squareCardId = squareCardId;
        } else {
          creditData = {
            userId, email,
            total: sessions, remaining: sessions,
            duration, planName,
            validUntil: validUntilInput || new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
            deductions: [],
            ...(squareCustomerId ? { squareCustomerId } : {}),
            ...(squareCardId ? { squareCardId } : {}),
          };
        }
        creditData.updatedAt = new Date().toISOString();
        await kvPut(`credits:${userId}`, JSON.stringify(creditData), {}, env);

        // Mark this payment as granted so replayed calls short-circuit.
        await kvPut(grantKey, JSON.stringify({
          paymentId, email, userId, sessions, duration, planName,
          grantedAt: new Date().toISOString(),
        }), { expirationTtl: 90 * 24 * 3600 }, env);

        await logEvent('credit', `Granted ${sessions} sessions to ${email}`, {
          paymentId, userId, planName, sessions,
        }, env);

        // Best-effort Trainerize tag so the coach sees the updated balance.
        try {
          await clearCreditTags(userId, env);
          const tagCredits = Math.min(creditData.remaining, 24);
          await trainerizePost('/user/addTag', {
            userID: userId, userTag: creditTagName(tagCredits),
          }, env);
          await trainerizePost('/trainerNote/add', {
            userID: userId,
            content: `${sessions} session credits added via ${planName} (payment ${paymentId.slice(0, 8)}). Balance: ${creditData.remaining}/${creditData.total}.`,
            type: 'general',
          }, env);
        } catch (e) {
          console.error('credit-grant Trainerize tag best-effort failed:', e);
        }

        return new Response(JSON.stringify({
          ok: true, userId, remaining: creditData.remaining, total: creditData.total,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } finally {
        try { await env.CHALLENGES_KV.delete(lockKey); } catch { /* best-effort */ }
      }
    }

    // POST /challenges/:id/join — public, non-admin endpoint. Atomically
    // decrements spotsLeft, records the join per email so the same person
    // can't double-claim a spot. Returns the updated challenge.
    if (url.pathname.startsWith('/challenges/') && url.pathname.endsWith('/join') && request.method === 'POST') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!await checkRateLimit(request, 'challenge-join', 10, env)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const id = url.pathname.split('/challenges/')[1].replace('/join', '');
      let body;
      try { body = await request.json(); }
      catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

      // Coerce to string — attackers can POST `{"email": {}}` or arrays;
      // `.trim()` on a non-string would throw uncaught inside the handler.
      const rawEmail = typeof body.email === 'string' ? body.email : '';
      const rawName = typeof body.name === 'string' ? body.name : '';
      const rawPhone = typeof body.phone === 'string' ? body.phone : '';
      const email = rawEmail.trim().toLowerCase();
      const name = rawName.trim();
      const phone = rawPhone.trim();

      // Length caps: email per RFC 5321 (~320 total), but KV keys have their
      // own limit and we prefix the email into the dedup key — so keep it
      // well under the 512-byte KV key cap. Name limited so nobody pastes a
      // novel into the deductions/join records.
      if (!email || !name || email.length > 254 || name.length > 200 || phone.length > 40) {
        return new Response(JSON.stringify({ error: 'Name and email are required (email ≤254 chars, name ≤200)' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Very loose email shape check — we're not doing full RFC validation,
      // just blocking obvious garbage that would pollute the dedup key.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'Invalid email format' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Per-email dedup: if this person already joined this challenge, return
      // the current challenge state (no extra decrement, no extra Trainerize
      // action). 365-day TTL covers the lifetime of any reasonable challenge.
      const joinKey = `challenge-join:${id}:${email}`;
      if (await kvGet(joinKey, env)) {
        const all = await getChallenges(env);
        const current = all.find(c => c.id === id);
        return new Response(JSON.stringify({
          alreadyJoined: true, challenge: current || null,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Read the challenge first — we need its price to decide whether a
      // payment is required before admitting the user.
      const all = await getChallenges(env);
      const idx = all.findIndex(c => c.id === id);
      if (idx < 0) {
        return new Response(JSON.stringify({ error: 'Challenge not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const challenge = all[idx];

      // Paid challenges: require a valid Square paymentId. Verify the
      // charge actually happened (amount + status) BEFORE decrementing the
      // spot. Without this, anyone could POST `/join` and claim a paid slot
      // for free.
      const challengePrice = typeof challenge.price === 'number' ? challenge.price : 0;
      const rawPaymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
      if (challengePrice > 0) {
        if (!rawPaymentId) {
          return new Response(JSON.stringify({
            error: `This challenge requires a $${challengePrice} entry fee. Payment is required.`,
          }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // Reject reused payment IDs — one payment, one join.
        if (await kvGet(`challenge-payment:${rawPaymentId}`, env)) {
          return new Response(JSON.stringify({ error: 'This payment has already been used for a challenge join' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Ask Square to confirm the payment exists, is completed, and is
        // for at least the challenge's price.
        try {
          const vr = await fetch(`${getSquareApiBase(env)}/payments/${encodeURIComponent(rawPaymentId)}`, {
            headers: getSquareHeaders(env),
          });
          if (!vr.ok) {
            return new Response(JSON.stringify({ error: 'Payment could not be verified with Square' }), {
              status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          const pd = await vr.json();
          const ps = pd.payment?.status;
          const paidCents = pd.payment?.amount_money?.amount || 0;
          if (ps !== 'COMPLETED' && ps !== 'APPROVED') {
            return new Response(JSON.stringify({ error: `Payment status is ${ps}, must be COMPLETED` }), {
              status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          if (paidCents < Math.round(challengePrice * 100)) {
            return new Response(JSON.stringify({ error: `Payment amount is too low for this challenge` }), {
              status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch (e) {
          await logEvent('error', 'challenge-join-verify-failed', {
            paymentId: rawPaymentId, challengeId: id, email, err: e?.message,
          }, env);
          return new Response(JSON.stringify({ error: 'Payment verification failed' }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Serialize the read-decrement-write of the shared `challenges` key
      // so two concurrent joins on a spotsLeft=1 challenge can't both pass
      // the check and over-subscribe. Re-read INSIDE the lock — another
      // writer may have decremented after our earlier read at line 689.
      const lockRes = await withLock('lock:challenges-write', 10, env, async () => {
        const fresh = await getChallenges(env);
        const fIdx = fresh.findIndex(c => c.id === id);
        if (fIdx < 0) return { err: 'Challenge not found', status: 404 };
        const freshChallenge = fresh[fIdx];
        if (freshChallenge.spotsLeft !== undefined && freshChallenge.spotsLeft !== null) {
          if (freshChallenge.spotsLeft <= 0) {
            return { err: 'Challenge is full', status: 409, challenge: freshChallenge };
          }
          freshChallenge.spotsLeft = Math.max(0, freshChallenge.spotsLeft - 1);
        }
        fresh[fIdx] = freshChallenge;
        await kvPut('challenges', JSON.stringify(fresh), {}, env);
        return { challenge: freshChallenge };
      });
      if (!lockRes.ok) {
        return new Response(JSON.stringify({ error: 'Challenge list is being updated — retry in a moment' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (lockRes.value.err) {
        return new Response(JSON.stringify({
          error: lockRes.value.err,
          ...(lockRes.value.challenge ? { challenge: lockRes.value.challenge } : {}),
        }), { status: lockRes.value.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const joinedChallenge = lockRes.value.challenge;
      await kvPut(joinKey, JSON.stringify({
        email, name, phone,
        paymentId: rawPaymentId || undefined,
        joinedAt: new Date().toISOString(),
      }), { expirationTtl: 365 * 24 * 3600 }, env);
      // Burn the payment ID so it can't be reused for another challenge.
      if (rawPaymentId) {
        await kvPut(`challenge-payment:${rawPaymentId}`, id, {
          expirationTtl: 365 * 24 * 3600,
        }, env);
      }

      // Best-effort: if the challenge has a Trainerize group link, tag the
      // user so the coach sees their participation.
      if (joinedChallenge.trainerizeId && isTrainerizeConfigured(env)) {
        try {
          const userId = await findTrainerizeUserByEmail(email, env);
          if (userId) {
            await trainerizePost('/user/addTag', {
              userID: userId, userTag: `🏆 Challenge: ${joinedChallenge.title}`,
            }, env);
          }
        } catch (e) { console.error('Challenge-join Trainerize tag failed:', e); }
      }

      await logEvent('challenge', `Joined: ${email} → ${joinedChallenge.title}`, {
        challengeId: id, email, name,
      }, env);

      return new Response(JSON.stringify({ ok: true, challenge: joinedChallenge }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.startsWith('/challenges/') && request.method === 'DELETE') {
      if (!isAllowedOrigin) {
        return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
      // Delete is also admin-only — IDs are guessable (timestamp + 5 chars of
      // base36), so origin alone is not sufficient protection.
      if (!env.ADMIN_LOG_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_LOG_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const id = url.pathname.split('/challenges/')[1];
      const delLock = await withLock('lock:challenges-write', 10, env, () => deleteChallenge(id, env));
      if (!delLock.ok) {
        return new Response(JSON.stringify({ error: 'Challenge list is being updated — retry' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ deleted: id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== ADMIN: list Trainerize appointment types =====
    // GET /admin/trainerize-appointment-types — returns types available to
    // this API key so Alex can pick the in-person ID and set
    // TZ_INPERSON_APPOINTMENT_TYPE_ID in Cloudflare env. Admin-gated.
    if (url.pathname === '/admin/trainerize-appointment-types' && request.method === 'GET') {
      if (!env.ADMIN_LOG_TOKEN) {
        return new Response('Not configured', { status: 503, headers: corsHeaders });
      }
      if ((request.headers.get('x-admin-token') || '') !== env.ADMIN_LOG_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      try {
        const resp = await trainerizePost('/appointment/getAppointmentTypeList', {}, env);
        const body = await resp.text();
        return new Response(body, {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ===== EVENT LOGS =====
    // GET /logs?category=credit&limit=20 — query recent events
    // Auth: requires X-Admin-Token header matching env.ADMIN_LOG_TOKEN.
    // Logs contain emails and Trainerize userIDs (from logEvent calls) —
    // without a gate any visitor can scrape client PII.
    if (url.pathname === '/logs' && request.method === 'GET') {
      if (!env.ADMIN_LOG_TOKEN) {
        return new Response('Logs endpoint not configured', {
          status: 503, headers: corsHeaders,
        });
      }
      const provided = request.headers.get('x-admin-token') || '';
      if (provided !== env.ADMIN_LOG_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const category = url.searchParams.get('category') || '';
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const prefix = 'log:';

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
      // Each request hits Square's bookings API — without a limit an attacker
      // can burn through Alex's Square quota (100k/day) for free.
      if (!await checkRateLimit(request, 'availability', 30, env)) {
        return new Response('Too many requests', { status: 429, headers: corsHeaders });
      }
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

      // Verify Square webhook signature (HMAC-SHA256 of URL + body).
      // Fail CLOSED if the signing secret isn't configured — silently accepting
      // unverified webhooks would let anyone with the URL forge payment/credit
      // events.
      if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
        console.error('SQUARE_WEBHOOK_SIGNATURE_KEY not set — rejecting webhook');
        await logEvent('error', 'webhook-sig-key-missing', {
          method: request.method, path: new URL(request.url).pathname,
        }, env);
        return new Response('Webhook verification not configured', { status: 503 });
      }
      const signature = request.headers.get('x-square-hmacsha256-signature');
      const webhookUrl = request.url;
      const isValid = await verifySignature(webhookUrl, body, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY);
      if (!isValid) {
        return new Response('Invalid signature', { status: 401 });
      }

      const event = JSON.parse(body);
      const eventType = event.type;
      const eventId = event.event_id || '';
      const createdAt = event.created_at;

      // Replay-attack guard — only reject events that ARE recent but with
      // a future timestamp (clock-skew attacks) or events from a 7-day-old
      // skew window (probable replay). Square's "Send test notification"
      // feature uses a hardcoded sample payload from 2020, so the previous
      // 10-minute strict window rejected legitimate test events. Drop the
      // upper-bound check entirely — event-id idempotency (below) catches
      // true replays in practice. Keep the future-skew check (5 min) as a
      // basic clock-sanity guard.
      if (createdAt) {
        const skew = Date.now() - new Date(createdAt).getTime();
        if (skew < -5 * 60 * 1000) {
          await logEvent('error', 'webhook-future-timestamp', {
            eventId, eventType, createdAt, skewMs: skew,
          }, env);
          return new Response('Future-dated webhook', { status: 400 });
        }
      }

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

          // ---- PAYMENT EVENTS ----
          // Modern Square API consolidates payment lifecycle into payment.created
          // (first emit) and payment.updated (status transitions). The legacy
          // payment.completed / payment.failed events were retired but the
          // handlers below cover both names defensively. Branch on
          // payment.status to decide whether it's a success or failure.
          if (
            eventType === 'payment.completed' ||
            eventType === 'payment.failed' ||
            eventType === 'payment.created' ||
            eventType === 'payment.updated'
          ) {
            const payment = event.data?.object?.payment;
            const status = payment?.status; // COMPLETED | APPROVED | FAILED | CANCELED | PENDING
            if (payment && (status === 'COMPLETED' || status === 'APPROVED')) {
              if (payment.subscription_id) {
                await handleSubscriptionPayment(payment, env);
              }
              if (payment.customer_id) {
                await syncPaymentStatusToTrainerize(payment.customer_id, 'paid', payment, env);
              }
            } else if (payment && (status === 'FAILED' || status === 'CANCELED')) {
              if (payment.customer_id) {
                await syncPaymentStatusToTrainerize(payment.customer_id, 'unpaid', payment, env);
              }
            }
          }

          // ---- ORDER COMPLETED → credit assignment for session credit purchases ----
          // Modern: order.fulfillment.updated fires when fulfillment state changes.
          // order.updated fires for general order changes (incl. state -> COMPLETED).
          // Legacy order.fulfilled is kept for back-compat if Square ever resurrects it.
          if (
            eventType === 'order.fulfilled' ||
            eventType === 'order.updated' ||
            eventType === 'order.fulfillment.updated'
          ) {
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
          // one WE auto-created. Any keyword regex on title/description would
          // false-positive on merch like "Training T-shirt" or "Session Tank
          // Top" and wrongly flip training-payment status. Manual training
          // payments come through the subscription + payment.completed webhooks
          // already, which have customer/subscription context we can trust.
          const isTrainingInvoice = (invoice) =>
            (invoice?.description || '').includes('Auto-invoice for session');

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

          // Modern Square uses `invoice.scheduled_charge_failed` for auto-charge
          // failures; legacy `invoice.payment_failed` was retired. invoice.updated
          // catches status transitions (UNPAID, PAYMENT_PENDING, OVERDUE).
          if (
            eventType === 'invoice.payment_failed' ||
            eventType === 'invoice.scheduled_charge_failed' ||
            eventType === 'invoice.updated'
          ) {
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
          // Surface permanent handler failures to /logs so they don't vanish
          // into wrangler tail. The "processing" marker expires in 5 min and
          // Square retries, but if the underlying issue is persistent the
          // event will eventually stop retrying — this record is the last
          // trace we'll have.
          console.error('Webhook processing error:', error);
          try {
            await logEvent('error', 'webhook-handler-failed', {
              eventId, eventType,
              message: error?.message || String(error),
              stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
            }, env);
          } catch { /* logEvent must never throw out of the catch */ }
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
  let catalogError = null;
  if (subscription.plan_variation_id) {
    try {
      const catResp = await fetch(
        `${getSquareApiBase(env)}/catalog/object/${subscription.plan_variation_id}`,
        { headers: getSquareHeaders(env) }
      );
      if (catResp.ok) {
        const catData = await catResp.json();
        planName = catData.object?.subscription_plan_variation_data?.name || '';
      } else {
        catalogError = `catalog fetch ${catResp.status}`;
      }
    } catch (e) {
      catalogError = e?.message || 'catalog fetch threw';
    }
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
    // Surface in /logs so unrecognized/missing plans are visible, not silent.
    await logEvent('error', 'no-credit-mapping', {
      subscriptionId,
      customerId,
      planVariationId: subscription.plan_variation_id,
      planName,
      catalogError,
    }, env);
    console.log(`No credit mapping for plan: "${planName}" (sub ${subscriptionId})`);
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

    // Take the credits lock so a concurrent cron deduction doesn't race
    // with this renewal write.
    const lockKey = `lock:credits:${userId}`;
    if (await kvGet(lockKey, env)) {
      console.log(`Credit renewal skipped (locked) for ${email} — will retry next renewal event`);
      return;
    }
    await kvPut(lockKey, Date.now().toString(), { expirationTtl: 60 }, env);

    try {
      // Preserve deduction history across renewals — old code reset
      // deductions: [] on every renewal, losing the audit trail AND
      // allowing the 10-min reason-idempotency in deductSessionCredit to
      // stop catching duplicates that straddled the renewal boundary.
      let priorDeductions = [];
      try {
        const existingRaw = await kvGet(`credits:${userId}`, env);
        if (existingRaw) {
          const existing = JSON.parse(existingRaw);
          if (Array.isArray(existing?.deductions)) {
            // Only keep the last 100 entries — unbounded history would
            // eventually blow past KV value size limits.
            priorDeductions = existing.deductions.slice(-100);
          }
        }
      } catch { /* best-effort history preservation */ }

      const creditData = {
        userId,
        email,
        total: credits.sessions,
        remaining: credits.sessions,
        duration: credits.duration,
        planName,
        validUntil,
        updatedAt: new Date().toISOString(),
        deductions: priorDeductions,
        lastRenewalAt: new Date().toISOString(),
      };
      await kvPut(`credits:${userId}`, JSON.stringify(creditData), {}, env);
    } finally {
      try { await env.CHALLENGES_KV.delete(lockKey); } catch { /* best-effort */ }
    }

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
    // Cloudflare KV has no atomic CAS, so we use a short-held lock plus an
    // idempotency check: if a deduction with THIS exact reason was already
    // recorded in the last 10 minutes, assume a concurrent caller handled it
    // and skip. This prevents double-decrement even if the lock races.
    const locked = await kvGet(lockKey, env);
    if (locked) {
      console.log(`Credit deduction skipped (locked) for user ${userId} — will retry next cron`);
      return;
    }
    // 60s TTL gives headroom for slow KV writes. Lock is released earlier (before
    // the Trainerize calls) so the hold time is short in practice.
    await kvPut(lockKey, Date.now().toString(), { expirationTtl: 60 }, env);

    const raw = await kvGet(`credits:${userId}`, env);
    if (!raw) { await env.CHALLENGES_KV.delete(lockKey); return; }

    let creditData;
    try { creditData = JSON.parse(raw); } catch { await env.CHALLENGES_KV.delete(lockKey); return; }

    // Idempotency: if this same reason was already recorded recently, skip.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const alreadyDeducted = (creditData.deductions || []).some(d =>
      d && d.reason === reason && d.date && new Date(d.date).getTime() > tenMinAgo
    );
    if (alreadyDeducted) {
      console.log(`Credit deduction skipped (already counted) for user ${userId}: ${reason}`);
      await env.CHALLENGES_KV.delete(lockKey);
      return;
    }

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
  if (!email) {
    await logEvent('error', 'payment-sync-no-email', {
      squareCustomerId, status,
    }, env);
    return;
  }

  // Look up Trainerize userID (required for all v03 endpoints)
  const userId = await findTrainerizeUserByEmail(email, env);
  if (!userId) {
    // Silent drop here used to mask real incidents (Trainerize 503 during
    // outage, or a client who paid but was never created in Trainerize).
    // Surface to /logs so we can reconcile.
    await logEvent('error', 'payment-sync-user-not-found', {
      squareCustomerId, email, status,
    }, env);
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

  // Key tracking the Square booking → Trainerize appointment link, so we
  // can delete the old Trainerize appt on reschedule/cancel instead of
  // leaving ghost appointments on the coach's calendar.
  const aptLinkKey = `tz-apt:${booking.id}`;

  if (status === 'ACCEPTED' || status === 'PENDING') {
    // If a cancel already fired for this booking (CANCEL-before-CREATE race,
    // or rapid book→cancel sequence), we wrote a 'deleted' sentinel. Respect
    // it — don't resurrect a cancelled booking into Trainerize.
    const existingAptId = await kvGet(aptLinkKey, env);
    if (existingAptId === 'deleted') {
      await logEvent('sync', 'booking-skip-resurrect', {
        bookingId: booking.id, email, status,
      }, env);
      console.log(`Booking ${booking.id} has 'deleted' sentinel — skipping Trainerize create to avoid ghost apt`);
      return;
    }
    // If a prior Trainerize appt already exists for this Square booking
    // (e.g., booking.updated fires with a new start_at after a reschedule),
    // delete it before creating the replacement.
    if (existingAptId && /^\d+$/.test(existingAptId)) {
      try {
        await trainerizePost('/appointment/delete', { id: Number(existingAptId) }, env);
        console.log(`Reschedule cleanup: deleted Trainerize apt ${existingAptId} for Square booking ${booking.id}`);
      } catch (e) {
        console.error(`Failed to delete prior Trainerize apt ${existingAptId}:`, e);
      }
    }

    // Create/update appointment in Trainerize
    const endMs = new Date(startAt).getTime() + duration * 60000;
    const endAt = new Date(endMs).toISOString();

    const isVirtual = booking.location_type === 'CUSTOMER_LOCATION' ||
      (booking.customer_note || '').toLowerCase().includes('virtual');

    try {
      // Convert ISO dates to Trainerize format (space separator, no Z)
      const tzStart = startAt.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
      const tzEnd = endAt.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');

      // Pick the right Trainerize appointment type. Previously ALL synced
      // bookings used the virtual type because we couldn't resolve a location
      // ID — which made Alex's calendar show "virtual" for every in-person
      // session. Now: honor TZ_INPERSON_APPOINTMENT_TYPE_ID when set, fall
      // back to virtual only when it's unset (with a log so the mis-config
      // is visible).
      const inPersonTypeId = getInPersonApptType(env);
      const virtualTypeId = getVirtualApptType(env);
      let chosenTypeId;
      if (isVirtual) {
        chosenTypeId = virtualTypeId;
      } else if (inPersonTypeId) {
        chosenTypeId = inPersonTypeId;
      } else {
        chosenTypeId = virtualTypeId;
        await logEvent('error', 'tz-inperson-type-missing', {
          bookingId: booking.id, squareLocationType: booking.location_type,
          hint: 'Set TZ_INPERSON_APPOINTMENT_TYPE_ID in Cloudflare env. List IDs via GET /admin/trainerize-appointment-types.',
        }, env);
      }

      const resp = await trainerizePost('/appointment/add', {
        userID: getTrainerizeTrainerId(env),
        startDate: tzStart,
        endDate: tzEnd,
        appointmentTypeID: chosenTypeId,
        notes: `${duration}min ${isVirtual ? 'virtual' : 'in-person'} session (Square #${booking.id.slice(0, 8)})${!userId ? ` | Client: ${customer.given_name || ''} ${customer.family_name || ''} <${email}>` : ''}${isVirtual ? '' : ' | ' + STUDIO_ADDRESS}`,
        attendents: userId ? [{ userID: userId }] : [],
      }, env);

      // Persist the Trainerize appt ID so reschedule/cancel can find it.
      // 90-day TTL matches our cron retention window.
      if (resp?.ok) {
        try {
          const data = await resp.json();
          const aptId = data.id ?? data.appointmentID ?? data.result?.id;
          if (aptId) {
            await kvPut(aptLinkKey, String(aptId), { expirationTtl: 90 * 24 * 3600 }, env);
          }
        } catch { /* response parse best-effort */ }
      }

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
    // Remove the appointment from Trainerize so the coach's calendar
    // reflects the cancellation (otherwise orphan appts accumulate).
    const linkedAptId = await kvGet(aptLinkKey, env);
    if (linkedAptId && linkedAptId !== 'deleted' && /^\d+$/.test(linkedAptId)) {
      try {
        await trainerizePost('/appointment/delete', { id: Number(linkedAptId) }, env);
        console.log(`Cancelled Trainerize apt ${linkedAptId} for Square booking ${booking.id}`);
      } catch (e) {
        console.error(`Failed to delete Trainerize apt ${linkedAptId} on cancel:`, e);
      }
    }
    // ALWAYS write the 'deleted' sentinel on cancel — even if no linked
    // apt existed yet. This handles the out-of-order case where CANCEL
    // arrives before CREATE: without the sentinel, a subsequent CREATE
    // would resurrect the cancelled booking as a ghost Trainerize appt.
    // Short TTL so we don't leave orphan sentinels forever.
    await kvPut(aptLinkKey, 'deleted', { expirationTtl: 7 * 24 * 3600 }, env);
    // Notify client of cancellation or decline
    if (userId) {
      const cancelledBy = status === 'CANCELLED_BY_CUSTOMER' ? 'you'
        : status === 'DECLINED' ? 'Coach Alex (declined)' : 'Coach Alex';
      const dateStr = new Date(startAt).toLocaleDateString('en-US', { timeZone: TIMEZONE, month: 'long', day: 'numeric' });

      // Check if within 24 hours — deduct credit for late cancellation (not for declined)
      const hoursUntil = (new Date(startAt).getTime() - Date.now()) / 3600000;
      const isLateCancel = hoursUntil < CANCEL_NOTICE_HOURS && status === 'CANCELLED_BY_CUSTOMER';

      if (isLateCancel) {
        // startAt included so the 10-min reason-idempotency can't collide
        // between two different same-day bookings for the same user.
        await deductSessionCredit(userId, `Late cancellation (${dateStr}, <24hrs notice) [${startAt}]`, env);
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

      await deductSessionCredit(userId, `No-show (${dateStr}) [${startAt}]`, env);
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
            // Regex strips any ms fraction (e.g. .000Z or .123Z) so keys
            // match Square's bookings format (which has no fractional seconds)
            // regardless of what millisecond value Date.toISOString emits.
            tzBlockedUtc.add(new Date(t).toISOString().replace(/\.\d+Z$/, 'Z'));
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
      tzBlockedUtc.has(new Date(utcMs).toISOString().replace(/\.\d+Z$/, 'Z'));

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

  // Two-phase idempotency. Square fires BOTH `order.fulfilled` and
  // `order.updated` for a single state change; the event-level marker in the
  // webhook dispatcher doesn't dedupe them because event_ids differ. Without
  // this, credits get added TWICE per order. Write a short-lived "processing"
  // marker immediately so concurrent siblings short-circuit, then promote to
  // a long-TTL "done" marker once credit application succeeds.
  const orderKey = `order-processed:${order.id}`;
  const state = await kvGet(orderKey, env);
  if (state === 'done') return;
  if (state === 'processing') {
    console.log(`Order ${order.id}: sibling event already processing — skipping`);
    return;
  }
  await kvPut(orderKey, 'processing', { expirationTtl: 5 * 60 }, env);

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

  // Take the same credits lock that deductSessionCredit uses — otherwise a
  // cron-driven deduction and an order.fulfilled purchase can interleave and
  // the last writer silently loses the other's change.
  const lockKey = `lock:credits:${userId}`;
  const locked = await kvGet(lockKey, env);
  if (locked) {
    // Another writer is mid-flight. Don't double-apply credits and don't
    // promote the order to done — Square's retry after 5 min will re-enter
    // once the lock has cleared.
    console.log(`Order credit sync: lock held for user ${userId}, deferring to retry`);
    return;
  }
  await kvPut(lockKey, Date.now().toString(), { expirationTtl: 60 }, env);

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
      try { await env.CHALLENGES_KV.delete(lockKey); } catch { /* best-effort */ }
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

  // Promote to "done" IMMEDIATELY after the credit KV write. The Trainerize
  // tag/note calls below are best-effort cosmetics; if any of them throws
  // and the done marker hasn't been written, Square's retry after our 5-min
  // processing TTL expires would re-enter this function, read the already-
  // incremented balance, and double-apply credits. Writing done-marker first
  // closes that window.
  await kvPut(orderKey, 'done', { expirationTtl: 90 * 24 * 3600 }, env);

  // Release the credits lock now — balance is persisted. Trainerize tag/note
  // calls below don't touch the balance so they don't need to hold it.
  try { await env.CHALLENGES_KV.delete(lockKey); } catch { /* best-effort */ }

  // Everything below is best-effort cosmetic — wrap it so a transient
  // Trainerize API blip doesn't leak an unhandled rejection.
  try {
    await clearCreditTags(userId, env);
    const tagCredits = Math.min(creditData.remaining, 24);
    await trainerizePost('/user/addTag', { userID: userId, userTag: creditTagName(tagCredits) }, env);

    const totalPaid = (order.total_money?.amount || 0) / 100;
    await trainerizePost('/trainerNote/add', {
      userID: userId,
      content: `${totalCredits} session credits added (Square order $${totalPaid.toFixed(0)}). Balance: ${creditData.remaining}/${creditData.total}.`,
      type: 'general',
    }, env);

    await trainerizePost('/user/deleteTag', { userID: userId, userTag: '💤 Inactive' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: '🟢 Active Client' }, env);
    await trainerizePost('/user/addTag', { userID: userId, userTag: '✅ Paid' }, env);
  } catch (e) {
    console.error(`Order credit sync: Trainerize tag/note best-effort failed for ${email}:`, e);
  }
  console.log(`Order credit sync: ${email} +${totalCredits} credits (order ${order.id.slice(0, 8)})`);
}

// ===== PAY-PER-SESSION AUTO-INVOICE =====

/**
 * Cancel a Square order by transitioning it to CANCELED state. Best-effort —
 * used to clean up orphaned orders when a later step in the auto-invoice flow
 * (invoice creation or publish) fails.
 */
async function cancelSquareOrder(orderId, orderVersion, env) {
  if (!orderId) return;
  try {
    const resp = await fetch(`${getSquareApiBase(env)}/orders/${orderId}`, {
      method: 'PUT',
      headers: getSquareHeaders(env),
      body: JSON.stringify({
        order: { version: orderVersion, state: 'CANCELED' },
        idempotency_key: `cancel-${orderId}`,
      }),
    });
    if (!resp.ok) {
      console.error(`Failed to cancel orphan order ${orderId}:`, await resp.text());
    }
  } catch (e) {
    console.error(`Failed to cancel orphan order ${orderId}:`, e);
  }
}

/**
 * Delete a DRAFT Square invoice. No-op for non-draft invoices — the caller
 * should only invoke this before /publish succeeds.
 */
async function deleteDraftInvoice(invoiceId, invoiceVersion, env) {
  if (!invoiceId) return;
  try {
    const resp = await fetch(`${getSquareApiBase(env)}/invoices/${invoiceId}?version=${invoiceVersion}`, {
      method: 'DELETE',
      headers: getSquareHeaders(env),
    });
    if (!resp.ok) {
      console.error(`Failed to delete draft invoice ${invoiceId}:`, await resp.text());
    }
  } catch (e) {
    console.error(`Failed to delete draft invoice ${invoiceId}:`, e);
  }
}

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

  // Prefer the squareCustomerId we stored at checkout (when the client paid
  // via /checkout/charge they got a Square Customer + saved card). That's
  // required for CARD_ON_FILE auto-charge; the legacy fuzzy-name lookup only
  // finds a customer record, not a saved payment method.
  let squareCustomerId = null;
  try {
    const creditRaw = await kvGet(`credits:${attendeeUserId}`, env);
    if (creditRaw) {
      const c = JSON.parse(creditRaw);
      if (c.squareCustomerId) squareCustomerId = c.squareCustomerId;
    }
  } catch { /* fall through to legacy lookup */ }

  if (!squareCustomerId) {
    // Legacy path for pre-card-on-file purchases — fuzzy name match. Invoice
    // will still PUBLISH but can't auto-charge (no saved card), so client
    // receives an email and pays manually.
    const firstName = attendeeName.split(' ')[0];
    const lastName = attendeeName.split(' ').slice(1).join(' ');
    squareCustomerId = await findSquareCustomerByName(firstName, lastName, env);
  }

  if (!squareCustomerId) {
    console.log(`Auto-invoice: Square customer not found for ${attendeeName}`);
    return false;
  }

  // Idempotency suffix must include the appointment ID so two sessions on the
  // same day don't collide and share a single invoice.
  const idemSuffix = aptId ? `${sessionDate}-${aptId}` : sessionDate;

  // Cooldown: if a previous publish failed we cleaned up the draft+order,
  // but Square's idempotency cache still remembers the order key for ~24h.
  // Don't retry inside that window — we'd just churn against the same cached
  // (now CANCELED) order. Caller leaves attCountedKey unset so we WILL retry
  // after the cooldown expires.
  const cooldownKey = `auto-invoice-cooldown:${attendeeUserId}:${idemSuffix}`;
  if (await kvGet(cooldownKey, env)) {
    console.log(`Auto-invoice: cooldown active for ${attendeeName} (${sessionDate}) — will retry later`);
    return false;
  }

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
    const orderVersion = orderData.order?.version;
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
      // Clean up the orphan order — without the invoice it would sit OPEN in
      // Square indefinitely and throw off reporting.
      await cancelSquareOrder(orderId, orderVersion, env);
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
      // Clean up: delete the draft invoice, cancel the order. Write a cooldown
      // marker so the next cron tick (15 min) doesn't immediately re-enter
      // while Square's idempotency cache still holds the now-canceled order.
      await deleteDraftInvoice(invoiceId, invoiceVersion, env);
      await cancelSquareOrder(orderId, orderVersion, env);
      await kvPut(cooldownKey, 'publish-failed', { expirationTtl: 24 * 3600 }, env);
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
      // Wrap each appointment in its own try/catch so a single bad record
      // (malformed date, API failure, unexpected shape) doesn't abort the
      // whole batch and leave later appointments unprocessed.
      try {
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

      // Track whether every attendee wound up with a per-attendee marker.
      // Only then do we write the appointment-level `countedKey` — otherwise
      // a skipped/failed attendee would never get retried because the outer
      // check at line 2161 would short-circuit the whole appointment.
      let allAttendeesHandled = true;

      for (const attendee of attendees) {
        if (!attendee?.userID) { allAttendeesHandled = false; continue; }

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
          } else {
            allAttendeesHandled = false; // retry this attendee next cron
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
        await deductSessionCredit(attendee.userID, `Session completed (${sessionDate}) [apt ${apt.id}]`, env);
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

      // Only mark appointment-level as counted if EVERY attendee got a marker.
      // Otherwise leave the outer key unset so the next cron tick retries
      // the outstanding attendees.
      if (allAttendeesHandled) {
        await kvPut(countedKey, new Date().toISOString(), { expirationTtl: 90 * 24 * 3600 }, env);
      }
      } catch (aptErr) {
        console.error(`Cron: failed processing appointment ${apt?.id || '?'}:`, aptErr);
        // Continue to next appointment — outer key intentionally not written
        // so this apt retries next tick.
      }
    }
  } catch (e) {
    console.error('Session credit deduction cron failed:', e);
  }
}

/**
 * Verify Square webhook signature.
 *
 * Square computes HMAC-SHA256 over (configuredNotificationUrl + body) using
 * the webhook signing key. The "configured notification URL" is whatever the
 * user typed into Square Dashboard — typically WITHOUT a trailing slash.
 * Cloudflare workers, however, see `request.url` WITH a trailing slash on
 * the root path. To bridge that gap, we try both variants and accept either.
 * This makes the worker robust to whether the dashboard URL has a trailing
 * slash or not (a single character difference would otherwise break HMAC
 * verification entirely).
 */
async function verifySignature(url, body, signature, key) {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  // Generate the two URL variants we want to try: the URL Cloudflare gave us,
  // and the same URL with any trailing slash stripped (in case Square has the
  // dashboard URL configured without one).
  const variants = new Set([url]);
  if (url.endsWith('/')) variants.add(url.slice(0, -1));
  else variants.add(url + '/');

  for (const variant of variants) {
    const sig = await crypto.subtle.sign(
      'HMAC', cryptoKey, encoder.encode(variant + body),
    );
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    if (await safeEqual(computed, signature)) return true;
  }
  return false;
}

/**
 * Constant-time string compare via SHA-256 digest comparison. A naive `===`
 * on the computed vs provided signature short-circuits on the first differing
 * byte, leaking timing information — an attacker with remote retries can
 * infer the signature byte-by-byte. Hashing both inputs and XOR-comparing
 * fixed-length digests removes that oracle.
 */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= va[i] ^ vb[i];
  // Also require the plaintext lengths to match — same-length guarantees
  // the digest compare was meaningful.
  return diff === 0 && a.length === b.length;
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

// ===== GOOGLE PLACES (NEW) — REVIEWS FETCH =====

/**
 * Fetch live reviews for the configured Google Place via Places API (New).
 * Returns at most 5 reviews per Google's standard response. The shape is
 * normalized to match the frontend's GoogleReview interface.
 *
 * Requires env.GOOGLE_PLACES_API_KEY and env.GOOGLE_PLACE_ID. The key needs
 * the "Places API (New)" scope enabled in the Google Cloud project.
 */
async function fetchGooglePlaceReviews(env) {
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  const placeId = env.GOOGLE_PLACE_ID;
  if (!apiKey || !placeId) {
    return { ok: false, error: 'Places API not configured' };
  }
  // Field mask is REQUIRED for Places API (New). Without it, you get a 400.
  // See: https://developers.google.com/maps/documentation/places/web-service/place-details#fieldmask
  const fieldMask = 'id,displayName,rating,userRatingCount,reviews,googleMapsUri';
  let resp;
  try {
    resp = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
      }
    );
  } catch (e) {
    return { ok: false, error: `Network error: ${e?.message}` };
  }
  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, error: `Places API ${resp.status}: ${errText.slice(0, 300)}` };
  }
  const data = await resp.json();
  const reviews = (data.reviews || []).map((r, idx) => {
    // Google's review IDs are unstable across fetches, so synthesize one from
    // publishTime + index. Stable enough for React keys.
    const stableId = `g_${idx}_${(r.publishTime || '').replace(/[^0-9]/g, '').slice(0, 14)}`;
    return {
      id: stableId,
      name: r.authorAttribution?.displayName || 'Anonymous',
      rating: typeof r.rating === 'number' ? r.rating : 5,
      date: r.publishTime ? r.publishTime.split('T')[0] : '',
      relativeTime: r.relativePublishTimeDescription || '',
      text: r.text?.text || r.originalText?.text || '',
      profilePhoto: r.authorAttribution?.photoUri || undefined,
      source: 'google',
    };
  });
  return {
    ok: true,
    reviews,
    rating: typeof data.rating === 'number' ? data.rating : null,
    totalRatings: data.userRatingCount || null,
    googleMapsUri: data.googleMapsUri || null,
    fetchedAt: new Date().toISOString(),
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
