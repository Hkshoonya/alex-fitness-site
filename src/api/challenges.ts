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
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

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

  // Save to worker KV (source of truth)
  if (WORKER_URL) {
    try {
      await fetch(`${WORKER_URL}/challenges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newChallenge),
      });
    } catch (e) {
      console.error('Failed to save challenge to worker:', e);
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
  // Delete from worker KV
  if (WORKER_URL) {
    try {
      await fetch(`${WORKER_URL}/challenges/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete challenge from worker:', e);
    }
  }

  // Remove from localStorage
  const all = getLocalChallenges().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Join a challenge — decrements spots in worker KV AND localStorage
 */
export async function joinChallenge(id: string): Promise<boolean> {
  const all = getLocalChallenges();
  const challenge = all.find(c => c.id === id);
  if (!challenge) return false;

  if (challenge.spotsLeft !== undefined && challenge.spotsLeft <= 0) return false;
  if (challenge.spotsLeft !== undefined) challenge.spotsLeft--;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  // Update worker KV — delete old, re-save with decremented spots
  if (WORKER_URL) {
    try {
      await fetch(`${WORKER_URL}/challenges/${id}`, { method: 'DELETE' });
      await fetch(`${WORKER_URL}/challenges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(challenge),
      });
    } catch (e) {
      console.error('Failed to update challenge spots on worker:', e);
    }
  }

  return true;
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
 * Seed demo challenges (for testing)
 */
export async function seedDemoChallenges(): Promise<void> {
  const existing = getLocalChallenges();
  if (existing.length > 0) return;

  const now = new Date();
  const in3Days = new Date(now); in3Days.setDate(in3Days.getDate() + 3);
  const in30Days = new Date(now); in30Days.setDate(in30Days.getDate() + 30);
  const in7Days = new Date(now); in7Days.setDate(in7Days.getDate() + 7);
  const in42Days = new Date(now); in42Days.setDate(in42Days.getDate() + 42);

  await addChallenge({
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
  });

  await addChallenge({
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
  });
}
