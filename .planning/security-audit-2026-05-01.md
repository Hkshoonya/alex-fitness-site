# Pre-Launch Security Audit — Alex Davis Fitness

Auditor: Asclepius
Date: 2026-05-01
Scope: gh-pages frontend, Cloudflare Worker, Square + Trainerize + Resend integrations.

## Headline

**No direct money-extraction vector found.** The C-02-class amount/coupon/credit manipulation paths are closed at every checkpoint (server-resolved catalog, Square-verified amounts, replay guards, payment-bound email claims). The launch-blocking risks below are *indirect* money loss: someone fills Alex's calendar with bogus consults so paying clients can't book, or burns the Resend quota so legitimate emails (magic-links, signed agreements) silently stop landing.

---

## Critical (fix before launch)

### C-1. `/book-consultation` calendar-squat → blocked paying clients
- **Vector**: Free, no-payment, public endpoint at `worker/webhook-handler.js:2658-2697`. Only guard is per-IP rate limit at 20/min (line 2660). No email regex, no per-email cap, no team-member validation, no CAPTCHA, no per-day limit per anything.
- **Impact**: An attacker with residential proxy IP rotation can submit ~12,000 consult bookings/day with random fake emails. Square will reject overlap conflicts but every empty slot on Alex's calendar fills first. **Estimated cost: $2-4K of revenue per blocked week** at $80-120/session, plus operational chaos cleaning out hundreds of fake Square Customer records (each unique email creates one — line 7470).
- **Reproducer** (prereq: harvest a valid `serviceVariationId` from `GET /api/square/catalog/list` — that proxy path is allowlisted):
  ```
  curl -X POST https://alex-fitness-webhook.sense-fbf.workers.dev/book-consultation \
    -H 'Origin: https://hkshoonya.github.io' -H 'Content-Type: application/json' \
    -d '{"email":"a1@x.x","name":"a","phone":"5555555555","startAt":"2026-05-15T14:00:00Z",
         "duration":30,"teamMemberId":"TMr0PTR22KYH_0QK","serviceVariationId":"<from-catalog>"}'
  ```
  Repeat with `a2@x.x`, `a3@x.x`, ... — each is a distinct booking + customer record.
- **Fix** (in priority order, smallest patch first):
  1. `webhook-handler.js:2667` — add same email regex used at 1927: `if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 400`.
  2. `webhook-handler.js:2670` — per-email day cap (pick a value Alex is comfortable with — 2-5/day; legitimate users very rarely re-book a consult same day): ``const capKey = `consult-cap:${email}:${new Date().toISOString().slice(0,10)}`; const c = parseInt(await kvGet(capKey, env) || '0'); if (c >= 3) return 429; await kvPut(capKey, String(c+1), { expirationTtl: 86400 }, env);``
  3. Reduce per-IP from 20/min to ~3/hour. Current `checkRateLimit` bucket is keyed by `Math.floor(Date.now()/60000)` (line 523, per-minute) — add an hour-window variant or simply lower max to 3 (3/min still produces 4320/day, which is far better than 28800/day).
  4. Validate `teamMemberId` against an allowlist. The hardcoded `'TMr0PTR22KYH_0QK'` constant inside `handleSubscriptionPayment` (line 6605) is *function-scoped* — promote it to a module-level `ALLOWED_TEAM_MEMBERS = new Set([...])` near `STUDIO_ADDRESS` (line 93), or back it with `env.TEAM_MEMBER_IDS` JSON, then check `if (!ALLOWED_TEAM_MEMBERS.has(teamMemberId)) return 400`.
  5. Long-term: Cloudflare Turnstile widget on the consult form (P0 only if abuse appears in week 1).

### C-2. `/portal/request-magic-link` Resend quota burn → legitimate emails silently fail
- **Vector**: `webhook-handler.js:2877-3009`. Rate limit is `portal-request` 5/min/IP (line 2883). The bucket is keyed by IP, not email — so an attacker with proxy rotation can hammer Resend with up to 7200 emails/day to **arbitrary** target addresses. Resend free tier = 3000 emails/month; an attacker exhausts it in <1 hour. After exhaustion, real customers' magic-link logins AND `/api/agreement/sign` confirmation emails (same Resend key, line 705/2978) silently 502.
- **Impact**: Brand-bound spam (links go from `Alex Davis Fitness <onboarding@resend.dev>` to any inbox), then a $20+/mo bill jump if you upgrade plans, then availability loss for paying customers when quota is gone.
- **Reproducer**:
  ```
  for i in $(seq 1 100); do
    curl -X POST https://alex-fitness-webhook.sense-fbf.workers.dev/portal/request-magic-link \
      -H 'Origin: https://hkshoonya.github.io' -H 'Content-Type: application/json' \
      -d "{\"email\":\"victim+$i@example.com\"}" &
  done
  ```
- **Fix**: Add per-target-email bucket independent of IP. After email validation at `webhook-handler.js:2899`:
  ```js
  const emailCapKey = `portal-mlink:${email}:${Math.floor(Date.now()/600000)}`;
  if (await kvGet(emailCapKey, env)) return new Response(JSON.stringify({ success: true }), {...}); // pretend OK
  await kvPut(emailCapKey, '1', { expirationTtl: 600 }, env);
  ```
  One link per email per 10 min. Return success-shaped body so attacker can't enumerate.

---

## High (fix before launch if time permits)

### H-1. Admin token has no server-side TTL or rotation; `/admin/verify` has no rate limit
- **Vector**: `webhook-handler.js:4149-4163` admin token check is plain string-equality with `env.ADMIN_LOG_TOKEN`. The frontend's 30-day localStorage cleanup (`src/api/admin.ts:20-26`) is cosmetic — the worker honors a token forever once leaked. There's also no rate limit on `/admin/verify`, so any browser exfil (XSS, malicious extension, shared device) hands an attacker permanent access.
- **Impact**: Compromised admin token = unlimited `/admin/refund-credit` (no per-token rate limit, sessions cap is 100/call but no calls/hour cap), unlimited `/admin/trainerize-assign-program` (free programs to attacker accounts), unlimited photo deletion. Money cost depends on detection lag — could be weeks of free-credit refunds.
- **Fix**:
  1. `webhook-handler.js:4149` — add rate limit on `/admin/verify`: `if (!await checkRateLimit(request, 'admin-verify', 10, env)) return 429;` blocks brute force entirely.
  2. `webhook-handler.js:4184` (`/admin/refund-credit`) — add `checkRateLimit(request, 'admin-refund', 20, env)` to cap at 20 refunds/min/IP. Stops a stolen-token credit-printing spree.
  3. Post-launch: switch `ADMIN_LOG_TOKEN` to a signed JWT with 24-hr exp. localStorage is fine for storage if the token can't outlive its window.

### H-2. `/admin/refund-credit` accepts arbitrary `bumpTotal: true` with no value cap
- **Vector**: `webhook-handler.js:4184-4300`. Once admin-authed, `bumpTotal: true` raises `total` by `sessions` (capped at 100/call). With no per-day cap and 30-day token life, a leaked token = printable credits.
- **Impact**: Stolen-token amplifier for H-1. 100 credits × $80/session ≈ $8K worth per minute, until rate-limited at the network level.
- **Fix**: After H-1 rate limit, also add a per-userId daily cap: track `admin-refund-day:{userId}:{date}` and reject when cumulative refunds for one user exceed e.g. 20/day. Real workflow rarely refunds more than 1-2 sessions per client.

---

## Medium (post-launch follow-up)

### M-1. `handleCreditPurchaseOrder` does name-string heuristics, not catalog-ID match
- **Where**: `webhook-handler.js:6234-6250`. Square Online order line items matched on `.includes('Training Session Credits')` etc. Future catalog rename → silent zero-credit grants. Future POS sale named "Training Plan" → unintended credit grants.
- **Risk**: Accidental misgrant when Alex edits a catalog item title. Not exploitable externally (POS access required).
- **Fix**: Match by `catalog_object_id` against an explicit allowlist of credit-granting variation IDs.

### M-2. No CAPTCHA on `/challenges/:id/join`
- **Where**: `webhook-handler.js:3274-3454`. Free challenges (price=0) only require email + name. Per-email dedup at 3320 stops same-email spam, but unique-email spam fills join records (KV writes) and burns rate at 10/IP/min.
- **Risk**: Low — free challenges aren't a money item. Worth a per-day-per-IP cap if free challenges become common.

### M-3. `/portal/cancel-booking` only checks `session.customerId`, ignores `customerIds[]`
- **Where**: `webhook-handler.js:3097-3104` stores `customerIds` (plural) so a portal user with duplicate Square records can see all their bookings. The cancel ownership check at line 3230 only compares the single `session.customerId`.
- **Risk**: Functional bug, not security/money. A user sees their booking but the cancel returns "not-your-booking" when the booking belongs to a *secondary* duplicate customer record. Real (see comment at 3107). User-facing annoyance.
- **Fix**: `webhook-handler.js:3230` — replace `ownedBy !== session.customerId` with `!session.customerIds?.includes(ownedBy) && ownedBy !== session.customerId` (preserves back-compat with sessions issued before the array was added).

### M-4. `Access-Control-Allow-Origin` reflects to a default origin on disallowed requests
- **Where**: `webhook-handler.js:1494` — fallback is harmless (the request is 403'd) but produces confusing cross-origin error signals.
- **Fix** (cosmetic): Drop the header entirely when origin isn't allowed.

---

## Low / informational

- **L-1** — Webhook replay guard at `webhook-handler.js:4730-4738` only blocks future-skewed events; past replays rely solely on event-id KV idempotency. Negligible risk.
- **L-2** — Admin token uses non-constant-time `!==` compare (line 4155). On Cloudflare isolates not timing-attackable.

---

## Verified safe — areas explicitly checked and clean

- **`/checkout/charge` amount + coupon**: server-side `PLAN_CATALOG` + Square live-price fallback at `resolvePurchase` (407); coupon re-derived from Square Discounts at `resolveCoupon` (322); product_set restriction enforced (297). Browser-supplied amount/discount never read.
- **`/credit-grant`**: replay-deduped by `credit-grant:{paymentId}` (2207); claim.email-vs-request.email binding (2265); Square amount re-verified against catalog including coupon (2306). Credits ≤ paid is a hard invariant.
- **Webhook signature**: fail-closed when key unset (4703); HMAC-SHA256(URL+body) verified (4712); event-id two-phase idempotency (4752).
- **Order-completed credit-assign**: per-userId lock + order-id idempotency (6222, 6267); done-marker written before best-effort Trainerize work to prevent retry double-grant.
- **Challenge `/join` paid path**: paymentId required + Square-verified status + amount-≥-price + payment-id burn (3346-3432); spot decrement under `withLock`; per-email dedup.
- **Frontend bundle**: only public Square Application ID `sq0idp-…` present in `dist/assets/index-B904vZlB.js`. No EAAAl access tokens, no `re_` Resend keys, no Trainerize Basic creds.
- **C-01 proxy allowlist** (`webhook-handler.js:1538-1586`): tight per-pattern+per-method regex; `/locations` removed; no wildcard escape.
- **Agreement-sign**: per task brief — origin-gated, 5/2min, mock-id rejected, write-once-per-paymentId.
- **Origin allowlist** (1489): exact equality on parsed Origin; `*.allowed.com.evil.com` cannot bypass.
- **Photo POSTs**: admin-only; per-photo bytes capped (500-800KB); per-collection count capped (20-30).

---

## Recommended pre-launch test

After applying C-1 + C-2 patches, run this end-to-end gauntlet:

```bash
WORKER=https://alex-fitness-webhook.sense-fbf.workers.dev

# 1. Confirm consult cap blocks at attempt #3 same-day-same-email
for i in 1 2 3 4; do
  curl -s -X POST $WORKER/book-consultation \
    -H 'Origin: https://hkshoonya.github.io' -H 'Content-Type: application/json' \
    -d "{\"email\":\"audit@test.com\",\"name\":\"audit\",\"phone\":\"5555550100\",
         \"startAt\":\"2027-01-0${i}T15:00:00Z\",\"duration\":30,
         \"teamMemberId\":\"TMr0PTR22KYH_0QK\"}" | head -c 100; echo
done
# Expect: first 2 succeed/Square-error, 3rd+ returns {"reason":"daily-cap-reached"}

# 2. Confirm magic-link cap blocks 2nd send within 10 min same-email
curl -s -X POST $WORKER/portal/request-magic-link \
  -H 'Origin: https://hkshoonya.github.io' -H 'Content-Type: application/json' \
  -d '{"email":"audit@test.com"}'
curl -s -X POST $WORKER/portal/request-magic-link \
  -H 'Origin: https://hkshoonya.github.io' -H 'Content-Type: application/json' \
  -d '{"email":"audit@test.com"}'
# Expect: both return 200 success-shape, but only 1 actual Resend send (check Resend dashboard).

# 3. Confirm /admin/verify rate limit
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" $WORKER/admin/verify \
    -H "X-Admin-Token: wrong-$i"
done
# Expect: first 10 return 401, 11th+ return 429.
```

If all three behave as expected, launch is safe from the identified high-priority abuse vectors.
