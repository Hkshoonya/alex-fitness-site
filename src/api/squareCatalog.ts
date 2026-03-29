// Square Catalog — Fully Automatic Plan Discovery
// Fetches ALL plans from Square catalog, no hardcoded IDs needed
// Add/remove/reprice plans in Square Dashboard → website updates automatically

import type { TrainingPlan } from '@/data/trainingPlans';
import { fourWeekPlans, twelveWeekPlans, onlinePlans } from '@/data/trainingPlans';
import { getSquareConfig, getSquareHeaders, SQUARE_API_BASE } from '@/api/squareConfig';

const CACHE_KEY = 'alex_fitness_catalog';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CatalogCache {
  plans: TrainingPlan[];
  fetchedAt: string;
}

export function isSquareCatalogConfigured(): boolean {
  return getSquareConfig().isConfigured;
}

function isCacheFresh(): boolean {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return false;
  try {
    const cache: CatalogCache = JSON.parse(raw);
    return (Date.now() - new Date(cache.fetchedAt).getTime()) < CACHE_DURATION_MS;
  } catch { return false; }
}

function getCachedPlans(): TrainingPlan[] | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as CatalogCache).plans;
  } catch { return null; }
}

function cachePlans(plans: TrainingPlan[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ plans, fetchedAt: new Date().toISOString() }));
}

function getLocalPlans(): TrainingPlan[] {
  return [...fourWeekPlans, ...twelveWeekPlans, ...onlinePlans];
}

/**
 * Parse a Square catalog item into a TrainingPlan
 * Reads the item name, description, variations (frequency/pricing), and product type
 */
function parseSquareItem(item: any): TrainingPlan | null {
  const data = item.item_data;
  if (!data) return null;

  const name = data.name || '';
  const description = data.description_plaintext || data.description || '';
  const variations = data.variations || [];

  // Determine category from name/product_type
  const nameLower = name.toLowerCase();
  let category: TrainingPlan['category'] = 'personal-4week';
  let planWeeks = 4;
  let duration = 60;

  if (nameLower.includes('12 week') || nameLower.includes('12-week') || nameLower.includes('3 month')) {
    category = 'personal-12week';
    planWeeks = 12;
  }
  if (nameLower.includes('online') || nameLower.includes('custom online')) {
    category = 'online';
  }
  if (nameLower.includes('app') && nameLower.includes('no coaching')) {
    category = 'app';
  }

  // Parse duration from name
  if (nameLower.includes('30 min') || nameLower.includes('30-min')) duration = 30;
  else if (nameLower.includes('60 min') || nameLower.includes('60-min') || nameLower.includes('1 hour')) duration = 60;
  else if (nameLower.includes('90 min') || nameLower.includes('90-min')) duration = 90;

  // For online/app plans, duration is 0
  if (category === 'online' || category === 'app') duration = 0;

  // Parse variations into frequency options
  const frequency: TrainingPlan['frequency'] = [];
  let basePrice = 0;
  let pricePerSession = 0;
  let salePrice: number | undefined;
  let originalPrice: number | undefined;

  if (variations.length === 1) {
    // Single variation — fixed price (online/app/single session)
    const v = variations[0].item_variation_data || {};
    const priceMoney = v.price_money || {};
    basePrice = (priceMoney.amount || 0) / 100;

    // Check for sale pricing
    if (v.pricing_type === 'FIXED_PRICING' && basePrice > 0) {
      // Check if there's a strikethrough/compare price in the name
      const priceMatch = name.match(/\$(\d+)/);
      if (priceMatch && parseInt(priceMatch[1]) > basePrice) {
        originalPrice = parseInt(priceMatch[1]);
        salePrice = basePrice;
      }
    }
  } else if (variations.length > 1) {
    // Multiple variations — frequency options (1x/week, 2x/week, etc.)
    variations.forEach((v: any, idx: number) => {
      const vData = v.item_variation_data || {};
      const priceMoney = vData.price_money || {};
      const totalPrice = (priceMoney.amount || 0) / 100;
      const vName = (vData.name || '').toLowerCase();

      // Parse frequency from variation name
      let perWeek = idx + 1;
      const freqMatch = vName.match(/(\d+)x/);
      if (freqMatch) perWeek = parseInt(freqMatch[1]);

      const totalSessions = perWeek * planWeeks;

      frequency.push({ perWeek, totalSessions, totalPrice });
    });

    // Base price = first variation price
    if (frequency.length > 0) {
      basePrice = frequency[0].totalPrice;
      const baseSessions = frequency[0].totalSessions;
      pricePerSession = baseSessions > 0 ? Math.round(basePrice / baseSessions) : 0;
    }
  }

  // If no frequency and no price, skip
  if (basePrice === 0 && frequency.length === 0 && !salePrice) return null;

  // Build features from description
  const features: string[] = [];
  if (duration > 0) features.push(`${duration}-minute sessions`);
  if (planWeeks > 4) features.push(`Save per session vs ${4}-week plan`);
  if (frequency.length > 0) features.push('Flexible scheduling (1-5x/week)');
  features.push('Custom workout programming');
  features.push('Form correction & technique coaching');
  if (planWeeks >= 12) features.push('Progress tracking & check-ins');

  // Generate stable ID from Square item ID
  const id = `sq_${item.id}`;

  return {
    id,
    name,
    description,
    duration,
    planWeeks,
    pricePerSession,
    price: basePrice,
    frequency,
    category,
    features,
    squareItemId: item.id,
    salePrice,
    originalPrice,
    popular: nameLower.includes('60 min') && planWeeks >= 12,
  };
}

/**
 * Fetch ALL catalog items from Square and convert to TrainingPlans
 * No hardcoded IDs — discovers everything in the catalog
 */
async function fetchFromSquare(): Promise<TrainingPlan[]> {
  if (!isSquareCatalogConfigured()) return [];

  try {
    let allItems: any[] = [];
    let cursor: string | undefined;

    // Paginate through all catalog items
    do {
      const url = `${SQUARE_API_BASE}/catalog/list?types=ITEM${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await fetch(url, { headers: getSquareHeaders() });

      if (!response.ok) throw new Error(`Catalog API ${response.status}`);

      const data = await response.json();
      const items = data.objects || [];
      allItems = [...allItems, ...items];
      cursor = data.cursor;
    } while (cursor);

    // Parse each item into a TrainingPlan
    const plans: TrainingPlan[] = [];
    for (const item of allItems) {
      // Skip non-sellable items
      if (item.is_deleted) continue;

      const plan = parseSquareItem(item);
      if (plan) plans.push(plan);
    }

    // Sort: personal plans first (by weeks then duration), then online, then app
    const categoryOrder: Record<string, number> = {
      'personal-4week': 1,
      'personal-12week': 2,
      'online': 3,
      'app': 4,
    };

    plans.sort((a, b) => {
      const catDiff = (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99);
      if (catDiff !== 0) return catDiff;
      return a.duration - b.duration;
    });

    return plans;
  } catch (error) {
    console.error('Square catalog fetch failed:', error);
    return [];
  }
}

/**
 * Get training plans — auto-discovers from Square catalog
 * Falls back to local hardcoded plans if API unavailable
 */
export async function getTrainingPlans(): Promise<TrainingPlan[]> {
  if (isCacheFresh()) {
    const cached = getCachedPlans();
    if (cached && cached.length > 0) return cached;
  }

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
    return { lastFetched: cache.fetchedAt, isStale: age >= CACHE_DURATION_MS, isLive: isSquareCatalogConfigured() };
  } catch {
    return { lastFetched: null, isStale: true, isLive: isSquareCatalogConfigured() };
  }
}
