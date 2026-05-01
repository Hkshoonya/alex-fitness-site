// Admin API Client
// Wraps the worker /admin/* endpoints with typed helpers + token expiry.
//
// Token storage uses the same localStorage key as challenges.ts so the admin
// token is shared across the app — entering it once unlocks both challenge
// CRUD and the admin panel features.

import { getAdminToken, setAdminToken } from '@/api/challenges';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const TOKEN_ISSUED_KEY = 'alex_fitness_admin_token_issued';
// No auto-expiry on the admin token. Alex is a single-coach small business
// owner — daily/weekly forced re-logins create more friction than they
// prevent, and he can't manage rotation himself. Instead we surface a
// "consider rotating" banner after 180 days that tells him to contact the
// site builder (Kimi) to issue a new token. Manual rotation flow:
//   1. wrangler secret put ADMIN_LOG_TOKEN  (new value)
//   2. Alex enters the new token in the admin login
// Worker also accepts the new token immediately on next request.
const TOKEN_AGE_WARNING_DAYS = 180;

export { getAdminToken, setAdminToken };

/**
 * Returns true if an admin token is stored. Does NOT enforce TTL anymore —
 * see TOKEN_AGE_WARNING_DAYS comment above. Use {@link getAdminTokenAgeWarning}
 * for the soft-rotation nudge.
 */
export function isAdminTokenFresh(): boolean {
  return !!getAdminToken();
}

/**
 * Soft rotation reminder. Returns `null` when the token is fresh enough or
 * we can't read the issue timestamp (privacy mode). Returns a structured
 * warning when the token has been around longer than TOKEN_AGE_WARNING_DAYS.
 *
 * The intent is to render a banner in the admin panel that tells Alex to
 * contact the site builder for a fresh token — the worker secret rotates
 * server-side, then he enters the new value.
 */
export function getAdminTokenAgeWarning(): { daysOld: number; shouldWarn: boolean } | null {
  if (!getAdminToken()) return null;
  try {
    const issuedAt = parseInt(localStorage.getItem(TOKEN_ISSUED_KEY) || '0', 10);
    if (!issuedAt) return null;
    const daysOld = Math.floor((Date.now() - issuedAt) / (24 * 60 * 60 * 1000));
    return { daysOld, shouldWarn: daysOld >= TOKEN_AGE_WARNING_DAYS };
  } catch {
    return null;
  }
}

export function clearAdminSession() {
  setAdminToken('');
  try { localStorage.removeItem(TOKEN_ISSUED_KEY); } catch { /* private mode */ }
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Admin-Token'] = token;
  return headers;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'invalid-token' | 'not-configured' | 'network-error';
}

/**
 * Validate a candidate token against the worker BEFORE saving it. Avoids the
 * silent-fail pattern where a wrong token gets saved to localStorage and
 * every later admin action returns an opaque 401.
 */
export async function verifyAdminToken(candidate: string): Promise<VerifyResult> {
  if (!WORKER_URL) return { ok: false, reason: 'not-configured' };
  if (!candidate.trim()) return { ok: false, reason: 'invalid-token' };
  try {
    const resp = await fetch(`${WORKER_URL}/admin/verify`, {
      headers: { 'X-Admin-Token': candidate.trim() },
    });
    if (resp.ok) return { ok: true };
    const data = await resp.json().catch(() => ({}));
    return { ok: false, reason: data.reason || 'invalid-token' };
  } catch {
    return { ok: false, reason: 'network-error' };
  }
}

/**
 * Save token + record issue timestamp for the freshness check.
 */
export function saveAdminSession(token: string) {
  setAdminToken(token);
  try { localStorage.setItem(TOKEN_ISSUED_KEY, String(Date.now())); } catch { /* private mode */ }
}

export interface ChallengeSignup {
  name: string;
  email: string;
  phone: string;
  joinedAt: string;
  paid: boolean;
  paymentId: string | null;
  squareCustomerId: string | null;
  trainerizeUserId: number | null;
  clientStatus: 'non-client' | 'current-client' | 'past-client';
}

export async function getChallengeSignups(challengeId: string): Promise<{ signups: ChallengeSignup[]; count: number }> {
  if (!WORKER_URL) throw new Error('Worker not configured');
  const resp = await fetch(`${WORKER_URL}/admin/challenge-signups?challengeId=${encodeURIComponent(challengeId)}`, {
    headers: adminHeaders(),
  });
  if (resp.status === 401) throw new Error('Admin token expired or invalid — please log in again.');
  if (!resp.ok) throw new Error(`Failed to load signups (${resp.status})`);
  const data = await resp.json();
  return { signups: data.signups || [], count: data.count || 0 };
}

export interface RefundCreditResult {
  ok: boolean;
  userId?: number;
  refunded?: number;
  requested?: number;
  remaining?: number;
  total?: number;
  bumpTotal?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Refund a session credit to a client. Wraps POST /admin/refund-credit.
 * Either email or userId must be provided. Reason is required for the
 * audit log + Trainerize note.
 */
export async function refundCredit(params: {
  email?: string;
  userId?: number;
  sessions?: number;
  bumpTotal?: boolean;
  reason: string;
}): Promise<RefundCreditResult> {
  if (!WORKER_URL) return { ok: false, error: 'Worker not configured' };
  try {
    const resp = await fetch(`${WORKER_URL}/admin/refund-credit`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(params),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      return { ok: false, error: 'Admin token expired or invalid — please log in again.' };
    }
    if (!resp.ok) {
      return { ok: false, error: data.error || `Refund failed (${resp.status})` };
    }
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// =============================================================================
// Credit catalog map (M-1 self-learning admin)
// =============================================================================

export interface CreditMapEntry {
  credits: number;
  duration?: number;
  source?: 'session-credits' | 'training-plan' | string;
  name?: string;
  firstSeen?: string;
  lastSeen?: string;
  count?: number;
}

export interface CreditMapResponse {
  ok: boolean;
  error?: string;
  env?: Record<string, CreditMapEntry>;
  learned?: Record<string, CreditMapEntry>;
  effective?: Record<string, CreditMapEntry>;
  counts?: { env: number; learned: number; effective: number };
}

/**
 * Fetch the current credit catalog map. Returns three views:
 *   - env: manual overrides set via wrangler secret CREDIT_CATALOG_MAP
 *   - learned: auto-populated from prior orders (variation_id → credits/duration)
 *   - effective: env wins on conflict; this is what the worker actually uses
 */
export async function getCreditMap(): Promise<CreditMapResponse> {
  if (!WORKER_URL) return { ok: false, error: 'Worker not configured' };
  try {
    const resp = await fetch(`${WORKER_URL}/admin/credit-map`, { headers: adminHeaders() });
    if (resp.status === 401) return { ok: false, error: 'Admin token expired — please log in again.' };
    if (resp.status === 429) return { ok: false, error: 'Too many requests — try again in a moment.' };
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: data.error || `Failed (${resp.status})` };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Wipe the auto-learned credit map. Env overrides are unaffected. Use this
 * if a previously-misfired learning needs to be re-learned from scratch.
 * Worker logs the snapshot of what was cleared for audit recovery.
 */
export async function clearCreditMap(): Promise<{ ok: boolean; cleared?: number; error?: string }> {
  if (!WORKER_URL) return { ok: false, error: 'Worker not configured' };
  try {
    const resp = await fetch(`${WORKER_URL}/admin/credit-map/clear`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    if (resp.status === 401) return { ok: false, error: 'Admin token expired — please log in again.' };
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: data.error || `Failed (${resp.status})` };
    return { ok: true, cleared: data.cleared };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export interface TrainerizeProgram {
  id: number;
  name: string;
  durationDays: number | null;
  type: string | null;
}

export interface TrainerizeProgramsResult {
  configured: boolean;
  reason?: string;
  programs: TrainerizeProgram[];
}

/**
 * Returns master programs Alex can assign. When Trainerize auth is unavailable
 * (e.g. waiting on API key activation), returns {configured:false} with an
 * empty programs list so the UI can show a friendly fallback instead of a
 * hard error.
 */
export async function getTrainerizePrograms(): Promise<TrainerizeProgramsResult> {
  if (!WORKER_URL) return { configured: false, reason: 'worker-not-configured', programs: [] };
  try {
    const resp = await fetch(`${WORKER_URL}/admin/trainerize-programs`, { headers: adminHeaders() });
    if (resp.status === 401) throw new Error('Admin token expired — please log in again.');
    const data = await resp.json().catch(() => ({}));
    return {
      configured: !!data.configured,
      reason: data.reason,
      programs: data.programs || [],
    };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Admin token')) throw e;
    return { configured: false, reason: 'network-error', programs: [] };
  }
}

export interface AssignProgramResult {
  success: boolean;
  reason?: string;
  status?: number;
}

export async function assignTrainerizeProgram(params: {
  trainerizeUserId: number;
  programId: number;
  startDate?: string;
}): Promise<AssignProgramResult> {
  if (!WORKER_URL) return { success: false, reason: 'worker-not-configured' };
  try {
    const resp = await fetch(`${WORKER_URL}/admin/trainerize-assign-program`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(params),
    });
    if (resp.status === 401) throw new Error('Admin token expired — please log in again.');
    const data = await resp.json().catch(() => ({}));
    return { success: !!data.success, reason: data.reason, status: resp.status };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Admin token')) throw e;
    return { success: false, reason: 'network-error' };
  }
}

/**
 * Human-readable label for a Trainerize "not configured" reason code.
 * Lets the UI show one consistent message regardless of which endpoint
 * surfaced the issue.
 */
export function describeTrainerizeReason(reason?: string): string {
  switch (reason) {
    case 'trainerize-not-configured': return 'Trainerize API key not yet set in Cloudflare.';
    case 'trainerize-auth-denied':    return 'Trainerize rejected the API key — waiting on key activation.';
    case 'fetch-failed':               return 'Could not reach Trainerize. Try again in a moment.';
    case 'network-error':              return 'Network error reaching the worker.';
    case 'worker-not-configured':      return 'Worker URL is not set in this build.';
    default:                            return reason ? `Trainerize unavailable (${reason}).` : 'Trainerize unavailable.';
  }
}
