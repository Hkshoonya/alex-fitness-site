// Challenges System
// Shows active fitness challenges on the website
//
// Data flows:
// 1. Admin adds via (?admin=challenges) → POST to worker KV + localStorage
// 2. Trainerize/Zapier POSTs to worker → stored in KV
// 3. Website fetches from worker KV (source of truth)
//
// Challenges auto-hide when end date passes

export interface Challenge {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  duration: string; // "4 Weeks", "6 Weeks", "30 Days"
  prize?: string;
  image?: string;
  spots?: number; // total spots
  spotsLeft?: number;
  price?: number; // 0 = free
  tags: string[];
  status: 'upcoming' | 'active' | 'ended';
  trainerizeId?: string; // link back to Trainerize
  createdAt: string;
}

const STORAGE_KEY = 'alex_fitness_challenges';
const ADMIN_TOKEN_KEY = 'alex_fitness_admin_token';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

export function getAdminToken(): string {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}

export function setAdminToken(token: string) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch { /* private mode */ }
}

/**
 * Parse a 'YYYY-MM-DD' date string as local midnight instead of UTC midnight.
 * `new Date('2026-04-15')` parses as UTC which renders as April 14 in US
 * timezones — the date shown in the UI would be one day off from what the
 * admin typed. This helper forces local interpretation.
 */
export function parseChallengeDate(iso: string): Date {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return new Date(iso);
  return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Admin-Token'] = token;
  return headers;
}

/**
 * Get all active + upcoming challenges
 * Source of truth: worker KV. Falls back to localStorage.
 */
export async function getActiveChallenges(): Promise<Challenge[]> {
  let all: Challenge[];

  if (WORKER_URL) {
    try {
      const response = await fetch(`${WORKER_URL}/challenges`);
      if (response.ok) {
        const remote: Challenge[] = await response.json();
        all = remote;
        // Cache in localStorage for offline fallback
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        return all.map(c => ({ ...c, status: getStatus(c, new Date()) }))
          .filter(c => c.status !== 'ended')
          .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      }
    } catch {
      // Worker unavailable, fall back to local cache
    }
  }

  all = getLocalChallenges();
  const now = new Date();

  return all
    .map(c => ({ ...c, status: getStatus(c, now) }))
    .filter(c => c.status !== 'ended')
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
}

/**
 * Get challenges from localStorage (cache/fallback)
 */
export function getLocalChallenges(): Challenge[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

// Keep old name as alias for backward compat
export const getAllChallenges = getLocalChallenges;

/**
 * Add a new challenge — persists to worker KV AND localStorage
 */
export async function addChallenge(challenge: Omit<Challenge, 'id' | 'status' | 'createdAt'>): Promise<Challenge> {
  const newChallenge: Challenge = {
    ...challenge,
    id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: 'upcoming',
    createdAt: new Date().toISOString(),
  };

  // Save to worker KV (source of truth) — requires admin token. If the
  // worker rejects (missing/wrong token, network), surface the error so
  // the admin UI can prompt for the token instead of silently writing
  // to localStorage and thinking it saved.
  if (WORKER_URL) {
    const resp = await fetch(`${WORKER_URL}/challenges`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(newChallenge),
    }).catch(e => { console.error('Failed to save challenge to worker:', e); return null; });

    if (!resp || !resp.ok) {
      const status = resp?.status;
      const body = resp ? await resp.text().catch(() => '') : '';
      throw new Error(
        status === 401 || status === 503
          ? 'Admin token required. Click the admin lock to enter yours.'
          : `Failed to save challenge (${status || 'network'}): ${body || 'no response'}`
      );
    }
  }

  // Also save to localStorage as cache
  const all = getLocalChallenges();
  all.push(newChallenge);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  return newChallenge;
}

/**
 * Remove a challenge — deletes from worker KV AND localStorage
 */
export async function removeChallenge(id: string): Promise<void> {
  // Delete from worker KV (admin token required)
  if (WORKER_URL) {
    const resp = await fetch(`${WORKER_URL}/challenges/${id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    }).catch(e => { console.error('Failed to delete challenge from worker:', e); return null; });

    if (!resp || !resp.ok) {
      const status = resp?.status;
      throw new Error(
        status === 401 || status === 503
          ? 'Admin token required. Click the admin lock to enter yours.'
          : `Failed to delete challenge (${status || 'network'})`
      );
    }
  }

  // Remove from localStorage
  const all = getLocalChallenges().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export interface JoinChallengeResult {
  ok: boolean;
  alreadyJoined?: boolean;
  error?: string;
  challenge?: Challenge;
}

/**
 * Join a challenge — posts to the worker which atomically decrements spots
 * and dedup-checks by email. The worker is the source of truth; we update
 * the local cache from its response.
 */
export async function joinChallenge(
  id: string,
  participant: { name: string; email: string; phone?: string; paymentId?: string }
): Promise<JoinChallengeResult> {
  if (!WORKER_URL) {
    return { ok: false, error: 'Challenge sign-up is not configured right now — please contact the coach directly.' };
  }
  try {
    const response = await fetch(`${WORKER_URL}/challenges/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(participant),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: data.error || `Join failed (${response.status})`, challenge: data.challenge };
    }
    // Sync the local cache with the authoritative challenge list
    if (data.challenge) {
      const cached = getLocalChallenges();
      const idx = cached.findIndex(c => c.id === id);
      if (idx >= 0) {
        cached[idx] = data.challenge;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
      }
    }
    return { ok: true, alreadyJoined: !!data.alreadyJoined, challenge: data.challenge };
  } catch (e) {
    console.error('joinChallenge failed:', e);
    return { ok: false, error: 'Could not reach the sign-up service. Try again in a moment.' };
  }
}

/**
 * Determine challenge status based on dates
 */
function getStatus(c: Challenge, now: Date): Challenge['status'] {
  const start = new Date(c.startDate);
  const end = new Date(c.endDate);

  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'active';
}

/**
 * Seed demo challenges (for testing) — local cache only, not the worker.
 * Real challenges are added via the admin UI which requires the admin token.
 */
export async function seedDemoChallenges(): Promise<void> {
  const existing = getLocalChallenges();
  if (existing.length > 0) return;
  // If the worker has any real challenges, don't seed demos — the render
  // path will pull from there.
  if (WORKER_URL) {
    try {
      const resp = await fetch(`${WORKER_URL}/challenges`);
      if (resp.ok) {
        const remote = await resp.json();
        if (Array.isArray(remote) && remote.length > 0) return;
      }
    } catch { /* fall through to local seed */ }
  }

  const now = new Date();
  const in3Days = new Date(now); in3Days.setDate(in3Days.getDate() + 3);
  const in30Days = new Date(now); in30Days.setDate(in30Days.getDate() + 30);
  const in7Days = new Date(now); in7Days.setDate(in7Days.getDate() + 7);
  const in42Days = new Date(now); in42Days.setDate(in42Days.getDate() + 42);

  const demos: Challenge[] = [
    {
      id: `ch_demo_30day_${Date.now()}`,
      title: '30-Day Shred Challenge',
      description: 'Transform your body in 30 days with daily workouts, nutrition tracking, and weekly check-ins. Prizes for the top 3 transformations!',
      startDate: in3Days.toISOString().split('T')[0],
      endDate: in30Days.toISOString().split('T')[0],
      duration: '30 Days',
      prize: '$500 Cash Prize',
      spots: 20,
      spotsLeft: 12,
      price: 0,
      tags: ['fat-loss', 'transformation', 'beginners-welcome'],
      status: 'upcoming',
      createdAt: new Date().toISOString(),
    },
    {
      id: `ch_demo_6week_${Date.now()}`,
      title: '6-Week Strength Builder',
      description: 'Build real strength over 6 weeks. Progressive overload programming, form coaching, and a supportive community pushing you forward.',
      startDate: in7Days.toISOString().split('T')[0],
      endDate: in42Days.toISOString().split('T')[0],
      duration: '6 Weeks',
      prize: 'Free month of training',
      spots: 15,
      spotsLeft: 8,
      price: 49,
      tags: ['strength', 'muscle-building', 'intermediate'],
      status: 'upcoming',
      createdAt: new Date().toISOString(),
    },
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(demos));
}
