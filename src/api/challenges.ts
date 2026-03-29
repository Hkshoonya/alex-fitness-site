// Challenges System
// Shows active fitness challenges on the website
//
// Two ways challenges get here:
// 1. Manual: trainer adds via admin URL (?admin=challenges)
// 2. Webhook: Trainerize/Zapier POSTs to the webhook worker
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
 * Fetches from worker (KV store) if configured, otherwise localStorage
 */
export async function getActiveChallenges(): Promise<Challenge[]> {
  let all: Challenge[];

  // Try fetching from worker first (has challenges from Trainerize/Zapier + admin)
  if (WORKER_URL) {
    try {
      const response = await fetch(`${WORKER_URL}/challenges`);
      if (response.ok) {
        const remote = await response.json();
        // Merge remote + local, dedup by ID
        const local = getAllChallenges();
        const seen = new Set(remote.map((c: Challenge) => c.id));
        all = [...remote, ...local.filter(c => !seen.has(c.id))];
        return all.map(c => ({ ...c, status: getStatus(c, new Date()) }))
          .filter(c => c.status !== 'ended')
          .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      }
    } catch {
      // Worker unavailable, fall back to local
    }
  }

  all = getAllChallenges();
  const now = new Date();

  return all
    .map(c => ({ ...c, status: getStatus(c, now) }))
    .filter(c => c.status !== 'ended')
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
}

/**
 * Get all challenges including ended
 */
export function getAllChallenges(): Challenge[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

/**
 * Add a new challenge
 */
export function addChallenge(challenge: Omit<Challenge, 'id' | 'status' | 'createdAt'>): Challenge {
  const newChallenge: Challenge = {
    ...challenge,
    id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: 'upcoming',
    createdAt: new Date().toISOString(),
  };

  const all = getAllChallenges();
  all.push(newChallenge);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  return newChallenge;
}

/**
 * Remove a challenge
 */
export function removeChallenge(id: string): void {
  const all = getAllChallenges().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Update spots left (when someone joins)
 */
export function joinChallenge(id: string): boolean {
  const all = getAllChallenges();
  const challenge = all.find(c => c.id === id);
  if (!challenge) return false;

  if (challenge.spotsLeft !== undefined && challenge.spotsLeft <= 0) return false;
  if (challenge.spotsLeft !== undefined) challenge.spotsLeft--;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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
export function seedDemoChallenges(): void {
  const existing = getAllChallenges();
  if (existing.length > 0) return; // Don't overwrite

  const now = new Date();
  const in3Days = new Date(now); in3Days.setDate(in3Days.getDate() + 3);
  const in30Days = new Date(now); in30Days.setDate(in30Days.getDate() + 30);
  const in7Days = new Date(now); in7Days.setDate(in7Days.getDate() + 7);
  const in42Days = new Date(now); in42Days.setDate(in42Days.getDate() + 42);

  addChallenge({
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

  addChallenge({
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
