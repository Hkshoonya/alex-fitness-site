// Admin API Client
// Wraps the worker /admin/* endpoints with typed helpers + token expiry.
//
// Token storage uses the same localStorage key as challenges.ts so the admin
// token is shared across the app — entering it once unlocks both challenge
// CRUD and the admin panel features.

import { getAdminToken, setAdminToken } from '@/api/challenges';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const TOKEN_ISSUED_KEY = 'alex_fitness_admin_token_issued';
const TOKEN_TTL_DAYS = 30;

export { getAdminToken, setAdminToken };

/**
 * Returns true if a token is stored AND was issued within the last 30 days.
 * Forces a re-login on stolen-device timelines without nagging Alex daily.
 */
export function isAdminTokenFresh(): boolean {
  if (!getAdminToken()) return false;
  try {
    const issuedAt = parseInt(localStorage.getItem(TOKEN_ISSUED_KEY) || '0', 10);
    if (!issuedAt) return false;
    const ageMs = Date.now() - issuedAt;
    return ageMs < TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
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
