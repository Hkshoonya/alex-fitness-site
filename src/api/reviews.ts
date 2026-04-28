// Google Reviews Data Flow
// Fetches reviews daily, caches locally, filters 5-star only for display

export interface GoogleReview {
  id: string;
  name: string;
  rating: number;
  date: string;
  relativeTime: string;
  text: string;
  profilePhoto?: string;
  source: 'google' | 'facebook' | 'website';
}

interface ReviewCache {
  reviews: GoogleReview[];
  fetchedAt: string;
  placeId: string;
}

// Configuration
// Live Google reviews come from the worker proxy at /api/google/places/reviews
// — Places API key + place ID stay server-side, and the worker caches the
// response in KV for 6 hours. Browser-origin requests to Places (New) are
// CORS-blocked, so this proxy is the only way to read them from the client.
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const CACHE_KEY = 'alex_fitness_reviews';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
// Live state — fetchFromGoogle() updates googleMapsUrl with the canonical
// short URL returned by Places API; otherwise the search-query fallback runs.
const REVIEW_LINKS = {
  googleMapsUrl: 'https://www.google.com/maps/place/Alex+Davis+Fitness/',
  haveLiveData: false,
};

// Fallback reviews — used when API is not configured
const FALLBACK_REVIEWS: GoogleReview[] = [
  {
    id: 'r1',
    name: 'Jordan M.',
    rating: 5,
    date: '2025-12-15',
    relativeTime: '3 months ago',
    text: 'Alex fixed my squat pain in two sessions. I\'m lifting heavier than I did in college — without the backache. His corrective exercise knowledge is top-notch. Best investment I\'ve made in my health.',
    source: 'google',
  },
  {
    id: 'r2',
    name: 'Priya K.',
    rating: 5,
    date: '2026-01-10',
    relativeTime: '2 months ago',
    text: 'I finally have a plan I can stick to. Down 18 lbs, but more importantly, my knees don\'t complain on stairs. Alex adapts every session to how I\'m feeling — it\'s truly personalized training.',
    source: 'google',
  },
  {
    id: 'r3',
    name: 'David R.',
    rating: 5,
    date: '2026-02-20',
    relativeTime: '1 month ago',
    text: 'The private studio means zero distractions. It\'s just work, progress, and a coach who actually pays attention. Six months in and I\'m in the best shape of my life at 45.',
    source: 'google',
  },
  {
    id: 'r4',
    name: 'Marcus T.',
    rating: 5,
    date: '2025-11-05',
    relativeTime: '4 months ago',
    text: 'Tried three different trainers before finding Alex. The difference is night and day. He actually explains why we do each exercise and how it connects to my goals. Real coaching, not just counting reps.',
    source: 'google',
  },
  {
    id: 'r5',
    name: 'Sarah L.',
    rating: 5,
    date: '2026-03-10',
    relativeTime: '2 weeks ago',
    text: 'As a busy mom of three, I needed something efficient. Alex designed a plan that gets results in 45 minutes. I\'m stronger than I was in my 20s. The private gym is a game changer — no judgment, just results.',
    source: 'facebook',
  },
  {
    id: 'r6',
    name: 'Carlos G.',
    rating: 5,
    date: '2026-03-05',
    relativeTime: '3 weeks ago',
    text: 'The boxing sessions are incredible. Great cardio, stress relief, and Alex really knows his technique. I started for fitness but now I genuinely love the sport. Can\'t recommend enough.',
    source: 'google',
  },
  {
    id: 'r7',
    name: 'Jen W.',
    rating: 5,
    date: '2025-10-20',
    relativeTime: '5 months ago',
    text: 'I was intimidated to start personal training but Alex made me feel comfortable from day one. He\'s patient, knowledgeable, and pushes you just the right amount. My back pain is completely gone.',
    source: 'facebook',
  },
  {
    id: 'r8',
    name: 'Anthony B.',
    rating: 5,
    date: '2025-09-15',
    relativeTime: '6 months ago',
    text: 'Former D1 athlete who let himself go. Alex understood my athletic background and built a plan that challenged me appropriately. 40 lbs down, deadlift PR at 42 years old. This man knows what he\'s doing.',
    source: 'google',
  },
];

/**
 * Check if the cached reviews are still fresh (< 24 hours old)
 */
function isCacheFresh(): boolean {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return false;

  try {
    const cache: ReviewCache = JSON.parse(raw);
    const age = Date.now() - new Date(cache.fetchedAt).getTime();
    return age < CACHE_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * Get cached reviews
 */
function getCachedReviews(): GoogleReview[] | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;

  try {
    const cache: ReviewCache = JSON.parse(raw);
    return cache.reviews;
  } catch {
    return null;
  }
}

/**
 * Save reviews to cache
 */
function cacheReviews(reviews: GoogleReview[]): void {
  const cache: ReviewCache = {
    reviews,
    fetchedAt: new Date().toISOString(),
    placeId: 'worker-proxy',
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/**
 * Fetch live reviews via the worker's Places (New) proxy. The worker
 * handles the API key, the field mask, and 6-hour KV caching. Returns []
 * on any error so getReviews() can fall back to FALLBACK_REVIEWS.
 */
async function fetchFromGoogle(): Promise<GoogleReview[]> {
  if (!WORKER_URL) return [];
  try {
    const resp = await fetch(`${WORKER_URL}/api/google/places/reviews`);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (data.googleMapsUri && typeof data.googleMapsUri === 'string') {
      REVIEW_LINKS.googleMapsUrl = data.googleMapsUri;
    }
    if (Array.isArray(data.reviews) && data.reviews.length > 0) {
      REVIEW_LINKS.haveLiveData = true;
      return data.reviews;
    }
    return [];
  } catch (e) {
    console.error('Places proxy fetch failed:', e);
    return [];
  }
}

/**
 * Main entry point: Get reviews for display
 * - Checks cache first (24h TTL)
 * - Fetches fresh from Google if stale
 * - Falls back to hardcoded reviews if API not configured
 * - Returns ONLY 5-star reviews
 */
export async function getReviews(): Promise<GoogleReview[]> {
  // If cache is fresh, use it
  if (isCacheFresh()) {
    const cached = getCachedReviews();
    if (cached && cached.length > 0) {
      return filterFiveStars(cached);
    }
  }

  // Try fetching from Google
  const googleReviews = await fetchFromGoogle();

  if (googleReviews.length > 0) {
    // Merge with any existing fallback/manual reviews
    const merged = mergeReviews(googleReviews, FALLBACK_REVIEWS);
    cacheReviews(merged);
    return filterFiveStars(merged);
  }

  // Fall back to hardcoded reviews
  cacheReviews(FALLBACK_REVIEWS);
  return filterFiveStars(FALLBACK_REVIEWS);
}

/**
 * Force refresh reviews (bypass cache)
 */
export async function refreshReviews(): Promise<GoogleReview[]> {
  localStorage.removeItem(CACHE_KEY);
  return getReviews();
}

/**
 * Filter to only 5-star reviews
 */
function filterFiveStars(reviews: GoogleReview[]): GoogleReview[] {
  return reviews.filter((r) => r.rating === 5);
}

/**
 * Merge Google reviews with manual/fallback reviews, dedup by name+text
 */
function mergeReviews(google: GoogleReview[], fallback: GoogleReview[]): GoogleReview[] {
  const seen = new Set<string>();
  const merged: GoogleReview[] = [];

  // Google reviews take priority
  for (const r of google) {
    const key = `${r.name.toLowerCase()}_${r.text.slice(0, 50).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  // Add fallbacks that don't duplicate
  for (const r of fallback) {
    const key = `${r.name.toLowerCase()}_${r.text.slice(0, 50).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return merged;
}

/**
 * Get the cache status for display
 */
export function getReviewCacheStatus(): { lastFetched: string | null; reviewCount: number; isStale: boolean } {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return { lastFetched: null, reviewCount: 0, isStale: true };

  try {
    const cache: ReviewCache = JSON.parse(raw);
    const age = Date.now() - new Date(cache.fetchedAt).getTime();
    return {
      lastFetched: cache.fetchedAt,
      reviewCount: cache.reviews.length,
      isStale: age >= CACHE_DURATION_MS,
    };
  } catch {
    return { lastFetched: null, reviewCount: 0, isStale: true };
  }
}

/**
 * Google Maps review URL — for "See all reviews" link.
 * After a successful Places fetch this is replaced with the canonical
 * googleMapsUri from the API response; before that, it's a search query.
 */
export function getGoogleReviewsUrl(): string {
  return REVIEW_LINKS.googleMapsUrl;
}

/**
 * True only when the last Places fetch returned at least one live review —
 * GoogleReviews.tsx uses this to decide whether the Google "G" branding +
 * "See all on Google Maps" CTA are honest to display.
 */
export function hasLiveGoogleReviews(): boolean {
  return REVIEW_LINKS.haveLiveData;
}

/**
 * Check if Google API is configured (worker proxy URL is set).
 */
export function isGoogleApiConfigured(): boolean {
  return !!WORKER_URL;
}
