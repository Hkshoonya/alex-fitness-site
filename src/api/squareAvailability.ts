// Square Team & Calendar Availability Sync
// Fetches team members, their schedules, and real-time availability from Square Bookings API

import { asset } from '@/lib/assets';
import { getSquareConfig, getSquareHeaders, getServiceId, SQUARE_API_BASE } from '@/api/squareConfig';

const { locationId: SQUARE_LOCATION_ID } = getSquareConfig();
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// Bump the suffix when COACH_IMAGE_MAP changes so existing visitors with
// stale cached team data refresh and see new photos on next load instead
// of waiting 24h for natural expiry.
const TEAM_CACHE_KEY = 'alex_fitness_team_v2';
const AVAILABILITY_CACHE_KEY = 'alex_fitness_availability';
const TEAM_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24h for team members
const AVAILABILITY_CACHE_DURATION = 15 * 60 * 1000; // 15 min for availability

// ===== TYPES =====

export interface TeamMember {
  id: string;
  name: string;
  role: 'head-coach' | 'coach' | 'consultation';
  title: string;
  image: string;
  specialties: string[];
  squareTeamMemberId?: string;
}

export interface TimeSlot {
  time: string; // "9:00 AM"
  startAt: string; // ISO string
  available: boolean;
  requiresConfirmation?: boolean; // true if within 90-min buffer
  teamMemberId: string;
  duration: number; // minutes
}

// Booking policy constants (must match worker)
const BOOKING_BUFFER_MINUTES = 90;
export const CANCEL_NOTICE_HOURS = 24;

export interface DayAvailability {
  date: string; // "2026-03-28"
  teamMemberId: string;
  slots: TimeSlot[];
}

interface TeamCache {
  members: TeamMember[];
  fetchedAt: string;
}

interface AvailabilityCacheEntry {
  slots: DayAvailability[];
  fetchedAt: string;
}

interface AvailabilityCache {
  // Keyed by "date_teamMemberId". Each entry carries its own fetchedAt so
  // caching one date doesn't refresh staleness for ALL dates.
  data: Record<string, AvailabilityCacheEntry>;
}

// ===== FALLBACK DATA =====

const FALLBACK_TEAM: TeamMember[] = [
  {
    id: 'alex-davis',
    name: 'Alex Davis',
    role: 'head-coach',
    title: 'Head Coach & Founder',
    image: asset('/images/alex-portrait.jpg'),
    specialties: ['Strength Training', 'Body Transformation', 'Corrective Exercise'],
  },
  {
    id: 'consultation',
    name: 'Free Consultation',
    role: 'consultation',
    title: 'Free 30-min Assessment',
    image: asset('/images/logo-circle.png'),
    specialties: ['Goal Setting', 'Fitness Assessment', 'Program Planning'],
  },
  {
    id: 'alex-martinez',
    name: 'Alex Martinez',
    role: 'coach',
    title: 'Associate Trainer',
    image: asset('/images/coach-portrait.jpg'),
    specialties: ['HIIT', 'Boxing', 'Functional Fitness'],
  },
];

// Trainerize sync — imported lazily to avoid circular deps
import { syncNewClient, syncBooking } from '@/api/trainerize';

// ===== BOOKING BUFFER =====

/**
 * Apply 90-minute booking buffer: slots within 90 min of now require coach confirmation.
 * Past slots are marked unavailable.
 */
function applyBookingBuffer(slots: TimeSlot[]): TimeSlot[] {
  const now = Date.now();
  const bufferMs = BOOKING_BUFFER_MINUTES * 60 * 1000;

  return slots.map(slot => {
    const slotMs = new Date(slot.startAt).getTime();
    if (slotMs < now) {
      return { ...slot, available: false };
    }
    if (slotMs - now < bufferMs) {
      return { ...slot, requiresConfirmation: true };
    }
    return slot;
  });
}

// ===== API HELPERS =====

function isConfigured(): boolean {
  return getSquareConfig().isConfigured;
}

function headers() {
  return getSquareHeaders();
}

function formatTime(hours: number, minutes: number): string {
  const h24 = ((hours % 24) + 24) % 24; // handle negative hours
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}

/** Convert UTC Date to Eastern time string (handles EST/EDT). Fallback path only — worker handles this in production. */
function formatTimeFromUTC(utcDate: Date): string {
  const month = utcDate.getUTCMonth();
  const isDST = month >= 3 && month <= 9; // Approximate: Apr-Oct = EDT
  const offset = isDST ? -4 : -5;
  return formatTime(utcDate.getUTCHours() + offset, utcDate.getUTCMinutes());
}

// ===== TEAM MEMBERS =====

function isTeamCacheFresh(): boolean {
  const raw = localStorage.getItem(TEAM_CACHE_KEY);
  if (!raw) return false;
  try {
    const cache: TeamCache = JSON.parse(raw);
    return (Date.now() - new Date(cache.fetchedAt).getTime()) < TEAM_CACHE_DURATION;
  } catch { return false; }
}

async function fetchTeamFromSquare(): Promise<TeamMember[]> {
  if (!isConfigured()) return [];

  try {
    const response = await fetch(`${SQUARE_API_BASE}/team-members/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: {
          filter: {
            location_ids: [SQUARE_LOCATION_ID],
            status: 'ACTIVE',
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Team API ${response.status}`);

    const data = await response.json();
    const members = data.team_members || [];

    // First-name → photo map. Square Team API doesn't store custom photos,
    // so we override here. Add a coach by dropping their photo at
    // `public/images/<firstname>.jpg` and adding the lowercase first name
    // to this map.
    const COACH_IMAGE_MAP: Record<string, string> = {
      eun: '/images/eun.jpg',
    };

    return members.map((m: any) => {
      const name = `${m.given_name || ''} ${m.family_name || ''}`.trim();
      const firstName = name.toLowerCase().split(' ')[0];
      return {
        id: m.id,
        name,
        role: m.is_owner ? 'head-coach' as const : 'coach' as const,
        title: m.is_owner ? 'Head Coach & Founder' : 'Trainer',
        image: asset(COACH_IMAGE_MAP[firstName] || '/images/coach-portrait.jpg'),
        specialties: [],
        squareTeamMemberId: m.id,
      };
    });
  } catch (error) {
    console.error('Team fetch failed:', error);
    return [];
  }
}

/**
 * Get team members (cached daily)
 *
 * How coach sync works:
 * - Square Team Members API is the source of truth
 * - Alex Davis (owner) is ALWAYS shown even if API fails
 * - New coaches added in Square auto-appear on next cache refresh (24h)
 * - Coaches removed in Square auto-disappear on next refresh
 * - Each coach's squareTeamMemberId is used for:
 *   - Searching their calendar availability
 *   - Creating bookings on their specific calendar
 *   - The same service IDs (consultation/30min/60min) work for all coaches
 *   - Square routes the booking to the correct coach's calendar via team_member_id
 *
 * To force refresh: call refreshTeamMembers()
 */
export async function getTeamMembers(): Promise<TeamMember[]> {
  if (isTeamCacheFresh()) {
    const raw = localStorage.getItem(TEAM_CACHE_KEY);
    if (raw) {
      const cache: TeamCache = JSON.parse(raw);
      if (cache.members.length > 0) return cache.members;
    }
  }

  const squareTeam = await fetchTeamFromSquare();

  if (squareTeam.length > 0) {
    // Square is source of truth — only show coaches active in Square.
    // Enrich with fallback data (images, specialties) only on a FULL-name match.
    // First-name substring matching caused wrong-coach enrichment: e.g.
    // "Alex Thompson" would inherit "Alex Davis" image/role.
    const enriched = squareTeam.map(sq => {
      const fallback = FALLBACK_TEAM.find(f =>
        f.name.toLowerCase().trim() === sq.name.toLowerCase().trim()
      );
      if (fallback) {
        return { ...sq, image: fallback.image, specialties: fallback.specialties, role: fallback.role, title: fallback.title };
      }
      // New coach from Square with no local fallback — uses defaults
      return sq;
    });

    // Always include consultation entry (not a real coach)
    const hasConsult = enriched.some(m => m.role === 'consultation');
    if (!hasConsult) enriched.push(FALLBACK_TEAM.find(f => f.role === 'consultation')!);

    const cache: TeamCache = { members: enriched, fetchedAt: new Date().toISOString() };
    localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify(cache));
    return enriched;
  }

  // API not configured or failed — use fallback (Alex is always present)
  const cache: TeamCache = { members: FALLBACK_TEAM, fetchedAt: new Date().toISOString() };
  localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify(cache));
  return FALLBACK_TEAM;
}

/**
 * Force refresh team members (bypasses 24h cache)
 * Call this from an admin action or after knowing coaches changed
 */
export async function refreshTeamMembers(): Promise<TeamMember[]> {
  localStorage.removeItem(TEAM_CACHE_KEY);
  return getTeamMembers();
}

// ===== AVAILABILITY =====

function readCache(): AvailabilityCache | null {
  const raw = localStorage.getItem(AVAILABILITY_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Legacy shape (pre-per-key fetchedAt) — discard so it refetches fresh.
    if (!parsed?.data || typeof parsed.data !== 'object') return null;
    const first = Object.values(parsed.data)[0] as unknown;
    if (first && Array.isArray(first)) return null;
    return parsed as AvailabilityCache;
  } catch { return null; }
}

function isAvailabilityCacheFresh(key: string): boolean {
  const cache = readCache();
  const entry = cache?.data[key];
  if (!entry) return false;
  return (Date.now() - new Date(entry.fetchedAt).getTime()) < AVAILABILITY_CACHE_DURATION;
}

function getCachedAvailability(key: string): DayAvailability[] | null {
  const cache = readCache();
  return cache?.data[key]?.slots || null;
}

function cacheAvailability(key: string, data: DayAvailability[]) {
  const cache: AvailabilityCache = readCache() || { data: {} };
  cache.data[key] = { slots: data, fetchedAt: new Date().toISOString() };
  localStorage.setItem(AVAILABILITY_CACHE_KEY, JSON.stringify(cache));
}

/**
 * Fetch availability from Square Bookings API for a specific date range and team member
 */
async function fetchAvailabilityFromSquare(
  startDate: string,
  endDate: string,
  teamMemberId?: string,
  duration: number = 60
): Promise<DayAvailability[]> {
  if (!isConfigured()) return [];

  try {
    const body: any = {
      query: {
        filter: {
          start_at_range: {
            start_at: `${startDate}T00:00:00Z`,
            end_at: `${endDate}T23:59:59Z`,
          },
          location_id: SQUARE_LOCATION_ID,
          segment_filters: [{
            service_variation_id: getServiceId(duration) || undefined,
            team_member_id_filter: teamMemberId ? {
              any: [teamMemberId],
            } : undefined,
          }],
        },
      },
    };

    const response = await fetch(`${SQUARE_API_BASE}/bookings/availability/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`Availability API ${response.status}`);

    const data = await response.json();
    const availabilities = data.availabilities || [];

    // Group by date
    const byDate: Record<string, TimeSlot[]> = {};

    for (const avail of availabilities) {
      const startAt = new Date(avail.start_at);
      const dateKey = startAt.toISOString().split('T')[0];

      if (!byDate[dateKey]) byDate[dateKey] = [];

      byDate[dateKey].push({
        time: formatTimeFromUTC(startAt), // Convert UTC to Eastern (fallback path only)
        startAt: avail.start_at,
        available: true,
        teamMemberId: avail.appointment_segments?.[0]?.team_member_id || teamMemberId || '',
        duration: avail.appointment_segments?.[0]?.duration_minutes || duration,
      });
    }

    return Object.entries(byDate).map(([date, slots]) => ({
      date,
      teamMemberId: teamMemberId || '',
      slots: applyBookingBuffer(slots.sort((a, b) => a.startAt.localeCompare(b.startAt))),
    }));
  } catch (error) {
    console.error('Availability fetch failed:', error);
    return [];
  }
}

/**
 * Generate fallback availability (mock) for when Square isn't configured
 */
function generateFallbackAvailability(date: string, teamMemberId: string, _duration: number = 60): DayAvailability {
  // Fallback when both worker and Square API are unavailable.
  // Returns empty slots — never show fake/random availability in production.
  // The UI will display "No availability — try another date" for empty slots.
  console.warn('Using fallback availability — Square API unavailable');
  return { date, teamMemberId, slots: [] };
}

/**
 * Fetch availability from the worker endpoint.
 * The worker merges Square bookings + Trainerize appointments for true availability,
 * applies the 90-min buffer, and returns slots with requiresConfirmation flags.
 */
async function fetchAvailabilityFromWorker(
  date: string,
  teamMemberId: string,
  duration: number
): Promise<DayAvailability | null> {
  if (!WORKER_URL) return null;

  try {
    const response = await fetch(`${WORKER_URL}/availability?date=${date}&duration=${duration}`);
    if (!response.ok) return null;

    const data = await response.json();
    const slots: TimeSlot[] = (data.slots || []).map((s: any) => ({
      time: s.time,
      startAt: s.startAt,
      available: s.available,
      requiresConfirmation: s.requiresConfirmation || false,
      teamMemberId,
      duration: s.duration || duration,
    }));

    return { date, teamMemberId, slots };
  } catch (error) {
    console.error('Worker availability fetch failed:', error);
    return null;
  }
}

/**
 * Main entry: Get availability for a date and team member.
 * Priority: Worker endpoint (real data) → Square API → Fallback (generated).
 * Always shows the calendar with available slots — never hides it.
 */
export async function getAvailability(
  date: string,
  teamMemberId: string,
  duration: number = 60
): Promise<DayAvailability> {
  const cacheKey = `${date}_${teamMemberId}_${duration}`;

  // Check 15-min cache
  if (isAvailabilityCacheFresh(cacheKey)) {
    const cached = getCachedAvailability(cacheKey);
    if (cached && cached.length > 0) return cached[0];
  }

  // Priority 1: Worker endpoint (merges Square + Trainerize calendars)
  if (WORKER_URL) {
    const workerData = await fetchAvailabilityFromWorker(date, teamMemberId, duration);
    if (workerData && workerData.slots.length > 0) {
      cacheAvailability(cacheKey, [workerData]);
      return workerData;
    }
  }

  // Priority 2: Square Bookings Availability API
  if (isConfigured()) {
    const squareData = await fetchAvailabilityFromSquare(date, date, teamMemberId, duration);
    if (squareData.length > 0) {
      cacheAvailability(cacheKey, squareData);
      return squareData[0];
    }
  }

  // Priority 3: Fallback (generated from business hours)
  const fallback = generateFallbackAvailability(date, teamMemberId, duration);
  cacheAvailability(cacheKey, [fallback]);
  return fallback;
}

/**
 * Get availability for a week range
 */
export async function getWeekAvailability(
  startDate: string,
  teamMemberId: string,
  duration: number = 60
): Promise<DayAvailability[]> {
  const start = new Date(startDate);
  const days: DayAvailability[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const avail = await getAvailability(dateStr, teamMemberId, duration);
    days.push(avail);
  }

  return days;
}

/**
 * Upsert a Square Customer by email.
/**
 * Create a booking — routes through the worker which handles customer
 * upsert, catalog version lookup, and credit gating. Frontend never touches
 * Square's /v2/bookings directly anymore (Phase B).
 */
export async function createBooking(
  teamMemberId: string,
  startAt: string,
  duration: number,
  customerInfo: { name: string; email: string; phone: string; goals?: string },
  // Optional explicit service variation ID. When set (e.g. for the free
  // consultation flow), overrides the duration-based getServiceId() lookup
  // — needed because a 30-min consultation maps to a different catalog
  // service than a paid 30-min PT session.
  serviceVariationId?: string,
  // Phase B: paymentId from a prior /credit-grant. When provided, the call
  // routes to /book-session (credit-gated). When omitted (or empty) it
  // routes to /book-consultation (free, rate-limited only). The frontend
  // never creates Square bookings directly anymore — the worker is the
  // only path that touches Square's /v2/bookings.
  purchaseToken?: string,
): Promise<{ success: boolean; bookingId?: string; error?: string }> {

  if (!isConfigured()) {
    // Mock booking
    await new Promise(r => setTimeout(r, 1500));
    const bookingId = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const startDate = new Date(startAt);
    const booking = {
      id: bookingId,
      date: startDate.toISOString().split('T')[0],
      time: formatTime(startDate.getHours(), startDate.getMinutes()),
      name: customerInfo.name,
      email: customerInfo.email,
      phone: customerInfo.phone,
      service: 'Training Session',
      duration,
      trainerId: teamMemberId,
      goals: customerInfo.goals,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existing = JSON.parse(localStorage.getItem('bookings') || '[]');
    existing.push(booking);
    localStorage.setItem('bookings', JSON.stringify(existing));
    localStorage.removeItem(AVAILABILITY_CACHE_KEY);

    // Sync to Trainerize (fire-and-forget)
    syncToTrainerize(customerInfo, startAt, duration, teamMemberId);

    return { success: true, bookingId };
  }

  // Phase B: bookings always go through the worker. Direct calls to Square's
  // /v2/bookings POST are no longer permitted via the proxy — the worker
  // gates paid bookings on a verified credit-grant record before forwarding
  // to Square. Two endpoints:
  //   purchaseToken set → /book-session (verifies credits, atomically
  //                                       decrements, creates booking)
  //   purchaseToken unset → /book-consultation (free, rate-limited only)
  if (!WORKER_URL) {
    return {
      success: false,
      error: 'Booking is not configured (worker URL missing). Please contact support.',
    };
  }

  const endpoint = purchaseToken ? '/book-session' : '/book-consultation';
  const finalServiceVariationId = serviceVariationId || getServiceId(duration);

  try {
    const response = await fetch(`${WORKER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: customerInfo.name,
        email: customerInfo.email,
        phone: customerInfo.phone,
        goals: customerInfo.goals || '',
        startAt,
        duration,
        teamMemberId,
        serviceVariationId: finalServiceVariationId,
        ...(purchaseToken ? { purchaseToken } : {}),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      // Map worker reason codes to user-friendly messages so the UI
      // doesn't surface raw "no-credits" / "invalid-purchase" tags.
      const reasonMessages: Record<string, string> = {
        'missing-fields': 'Some required information is missing — please refresh and try again.',
        'invalid-purchase': 'We could not verify your purchase. If you just bought a plan, give it 30 seconds and retry.',
        'email-mismatch':  'This payment is registered under a different email address.',
        'no-credits':       'You have no remaining sessions on this plan. Buy more sessions to continue.',
        'flat-plan-no-sessions': 'Your plan does not include in-person sessions.',
        'locked-retry':     'Another booking is being processed for this account — retry in a moment.',
        'square-error':     data.detail ? `Booking failed: ${String(data.detail).slice(0, 200)}` : 'Could not create the booking. Please try again or contact us.',
        'fetch-failed':     'Could not reach the booking service. Please try again in a moment.',
        'corrupt-grant':    'Your purchase record is corrupted — please contact support.',
        'invalid-json':     'Bad request format.',
      };
      const reason = data.reason || (response.ok ? 'unknown' : `http-${response.status}`);
      try { localStorage.removeItem(AVAILABILITY_CACHE_KEY); } catch { /* private mode */ }
      return { success: false, error: reasonMessages[reason] || `Booking failed (${reason}).` };
    }

    // Update the local cache so a coach refresh sees the new booking even
    // before the next Square availability fetch lands.
    const startDate = new Date(startAt);
    const booking = {
      id: data.bookingId,
      date: startDate.toISOString().split('T')[0],
      time: formatTime(startDate.getHours(), startDate.getMinutes()),
      name: customerInfo.name,
      email: customerInfo.email,
      phone: customerInfo.phone,
      service: 'Training Session',
      duration,
      trainerId: teamMemberId,
      status: 'confirmed',
      squareAppointmentId: data.bookingId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const existing = JSON.parse(localStorage.getItem('bookings') || '[]');
      existing.push(booking);
      localStorage.setItem('bookings', JSON.stringify(existing));
      localStorage.removeItem(AVAILABILITY_CACHE_KEY);
    } catch { /* quota / private mode */ }

    // Trainerize sync still happens server-side via the Square
    // booking.created webhook — no need to fire from the browser.

    return { success: true, bookingId: data.bookingId };
  } catch (error) {
    try { localStorage.removeItem(AVAILABILITY_CACHE_KEY); } catch { /* private mode */ }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Booking failed',
    };
  }
}

/**
 * Sync booking to Trainerize — called automatically from createBooking
 * Sends client + booking data so Trainerize calendar and client list stay in sync
 */
function syncToTrainerize(
  customerInfo: { name: string; email: string; phone: string; goals?: string },
  startAt: string,
  duration: number,
  teamMemberId: string
) {
  const nameParts = customerInfo.name.trim().split(' ');
  const startDate = new Date(startAt);
  const isVirtual = (customerInfo.goals || '').includes('[Virtual]');
  const meetMatch = (customerInfo.goals || '').match(/Meet: (https:\/\/[^\s]+)/);

  // Sync client
  syncNewClient({
    email: customerInfo.email,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    phone: customerInfo.phone,
    tags: ['website-booking'],
    notes: customerInfo.goals?.replace(/\[.*?\]/g, '').trim(),
  });

  // Sync booking.
  // startAt is the full Square UTC ISO — apiCreateBooking uses it directly so
  // there's no local→UTC drift. date/time are kept for Zapier webhook consumers
  // (filled from the user's local clock so "time" reads naturally for humans).
  syncBooking({
    clientEmail: customerInfo.email,
    startAt,
    date: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
    time: formatTime(startDate.getHours(), startDate.getMinutes()),
    duration,
    type: isVirtual ? 'virtual' : 'in-studio',
    coachName: resolveCoachName(teamMemberId),
    service: `${duration} Min ${isVirtual ? 'Virtual' : 'In-Studio'} Session`,
    meetLink: meetMatch?.[1],
  });
}

/**
 * Resolve team member ID to a human-readable coach name.
 * Checks cached team members first, falls back to known names.
 */
function resolveCoachName(teamMemberId: string): string {
  // Check cached team members
  const raw = localStorage.getItem(TEAM_CACHE_KEY);
  if (raw) {
    try {
      const cache: TeamCache = JSON.parse(raw);
      const match = cache.members.find(m => m.id === teamMemberId);
      if (match) return match.name;
    } catch { /* ignore */ }
  }
  // Known fallbacks
  if (teamMemberId === 'alex-davis' || teamMemberId === 'TMr0PTR22KYH_0QK') return 'Alex Davis';
  return 'Coach';
}

/**
 * Check if Square calendar is live
 */
export function isCalendarLive(): boolean {
  return isConfigured();
}
