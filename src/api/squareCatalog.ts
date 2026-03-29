// Square Catalog Sync
// Fetches training plans from Square catalog, caches daily, falls back to local data

import type { TrainingPlan } from '@/data/trainingPlans';
import { fourWeekPlans, twelveWeekPlans, onlinePlans } from '@/data/trainingPlans';

const SQUARE_ACCESS_TOKEN = import.meta.env.VITE_SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';

const CACHE_KEY = 'alex_fitness_catalog';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CatalogCache {
  plans: TrainingPlan[];
  fetchedAt: string;
}

// Known Square catalog item IDs mapped to our plan IDs
const SQUARE_ID_MAP: Record<string, string> = {
  '4LBY7LMMLFNTQ7JBT5JB77UB': '4week-30min',
  '89': '4week-60min',
  '90': '4week-90min',
  'JDIHBQ3BBI3GIAQXP7CA7CPL': '12week-30min',
  '85': '12week-60min',
  'Q2E6JC7H4QDUO6AKOBKOR2AJ': '12week-90min',
  'LGZJ2MDG22SJNBDBTCI66ASJ': 'app-only',
  '82': 'online-monthly',
  '84': 'online-3month',
};

/**
 * Check if Square API is configured
 */
export function isSquareCatalogConfigured(): boolean {
  return !!(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID);
}

/**
 * Check if cache is fresh
 */
function isCacheFresh(): boolean {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return false;
  try {
    const cache: CatalogCache = JSON.parse(raw);
    return (Date.now() - new Date(cache.fetchedAt).getTime()) < CACHE_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * Get cached plans
 */
function getCachedPlans(): TrainingPlan[] | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const cache: CatalogCache = JSON.parse(raw);
    return cache.plans;
  } catch {
    return null;
  }
}

/**
 * Save plans to cache
 */
function cachePlans(plans: TrainingPlan[]): void {
  const cache: CatalogCache = {
    plans,
    fetchedAt: new Date().toISOString(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/**
 * Get the local fallback plans
 */
function getLocalPlans(): TrainingPlan[] {
  return [...fourWeekPlans, ...twelveWeekPlans, ...onlinePlans];
}

/**
 * Fetch catalog from Square API and merge with local plan metadata
 */
async function fetchFromSquare(): Promise<TrainingPlan[]> {
  if (!isSquareCatalogConfigured()) return [];

  try {
    const response = await fetch(`${SQUARE_API_BASE}/catalog/list?types=ITEM`, {
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-01-18',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error(`Square API ${response.status}`);

    const data = await response.json();
    const items = data.objects || [];
    const localPlans = getLocalPlans();

    // Map Square items to our plan structure
    const updatedPlans = localPlans.map(plan => {
      // Find matching Square item
      const squareEntry = Object.entries(SQUARE_ID_MAP).find(([, localId]) => localId === plan.id);
      if (!squareEntry) return plan;

      const [squareId] = squareEntry;
      const squareItem = items.find((item: any) => item.id === squareId);
      if (!squareItem) return plan;

      // Extract variations (frequency options) with prices
      const variations = squareItem.item_data?.variations || [];
      if (variations.length === 0) return plan;

      // Update frequency pricing from Square
      const updatedFrequency = plan.frequency.map((freq, idx) => {
        const variation = variations[idx];
        if (variation?.item_variation_data?.price_money?.amount) {
          return {
            ...freq,
            totalPrice: variation.item_variation_data.price_money.amount / 100,
          };
        }
        return freq;
      });

      // For plans without frequency (online/app), update base price
      if (plan.frequency.length === 0 && variations[0]?.item_variation_data?.price_money?.amount) {
        const newPrice = variations[0].item_variation_data.price_money.amount / 100;
        return {
          ...plan,
          price: newPrice,
          salePrice: newPrice,
        };
      }

      // Update per-session price if base price changed
      const basePrice = updatedFrequency[0]?.totalPrice || plan.price;
      const baseSessions = updatedFrequency[0]?.totalSessions || 1;
      const newPerSession = Math.round(basePrice / baseSessions);

      return {
        ...plan,
        price: basePrice,
        pricePerSession: newPerSession > 0 ? newPerSession : plan.pricePerSession,
        frequency: updatedFrequency,
      };
    });

    return updatedPlans;
  } catch (error) {
    console.error('Square catalog fetch failed:', error);
    return [];
  }
}

/**
 * Main entry: Get training plans with daily sync
 */
export async function getTrainingPlans(): Promise<TrainingPlan[]> {
  // Fresh cache? Use it
  if (isCacheFresh()) {
    const cached = getCachedPlans();
    if (cached && cached.length > 0) return cached;
  }

  // Try Square API
  const squarePlans = await fetchFromSquare();
  if (squarePlans.length > 0) {
    cachePlans(squarePlans);
    return squarePlans;
  }

  // Fallback to local
  const local = getLocalPlans();
  cachePlans(local);
  return local;
}

/**
 * Force refresh (bypass cache)
 */
export async function refreshCatalog(): Promise<TrainingPlan[]> {
  localStorage.removeItem(CACHE_KEY);
  return getTrainingPlans();
}

/**
 * Get cache status
 */
export function getCatalogCacheStatus(): { lastFetched: string | null; isStale: boolean; isLive: boolean } {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return { lastFetched: null, isStale: true, isLive: isSquareCatalogConfigured() };
  try {
    const cache: CatalogCache = JSON.parse(raw);
    const age = Date.now() - new Date(cache.fetchedAt).getTime();
    return {
      lastFetched: cache.fetchedAt,
      isStale: age >= CACHE_DURATION_MS,
      isLive: isSquareCatalogConfigured(),
    };
  } catch {
    return { lastFetched: null, isStale: true, isLive: isSquareCatalogConfigured() };
  }
}
