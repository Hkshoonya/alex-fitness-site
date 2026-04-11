// Square Team & Calendar Availability Sync
// Fetches team members, their schedules, and real-time availability from Square Bookings API

import { asset } from '@/lib/assets';
import { getSquareConfig, getSquareHeaders, getServiceId, SQUARE_API_BASE } from '@/api/squareConfig';

const { locationId: SQUARE_LOCATION_ID } = getSquareConfig();
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

const TEAM_CACHE_KEY = 'alex_fitness_team';
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

interface AvailabilityCache {
  data: Record<string, DayAvailability[]>; // keyed by "date_teamMemberId"
  fetchedAt: string;
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

// Business hours for fallback
const BUSINESS_HOURS: Record<number, { open: string; close: string } | null> = {
  0: { open: '09:00', close: '18:00' }, // Sunday
  1: { open: '07:30', close: '20:00' },
  2: { open: '07:30', close: '20:00' },
  3: { open: '07:30', close: '20:00' },
  4: { open: '07:30', close: '20:00' },
  5: { open: '07:30', close: '20:00' },
  6: { open: '09:00', close: '18:00' }, // Saturday
};

const DEFAULT_SLOT_INTERVAL = 30; // generate slots every 30 min

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
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
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

    return members.map((m: any) => ({
      id: m.id,
      name: `${m.given_name || ''} ${m.family_name || ''}`.trim(),
      role: m.is_owner ? 'head-coach' as const : 'coach' as const,
      title: m.is_owner ? 'Head Coach & Founder' : 'Trainer',
      image: asset('/images/coach-portrait.jpg'),
      specialties: [],
      squareTeamMemberId: m.id,
    }));
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
    // Square is source of truth — only show coaches active in Square
    // Enrich with fallback data (images, specialties) where names match
    const enriched = squareTeam.map(sq => {
      const fallback = FALLBACK_TEAM.find(f =>
        f.name.toLowerCase().includes(sq.name.split(' ')[0].toLowerCase())
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

function isAvailabilityCacheFresh(key: string): boolean {
  const raw = localStorage.getItem(AVAILABILITY_CACHE_KEY);
  if (!raw) return false;
  try {
    const cache: AvailabilityCache = JSON.parse(raw);
    if (!cache.data[key]) return false;
    return (Date.now() - new Date(cache.fetchedAt).getTime()) < AVAILABILITY_CACHE_DURATION;
  } catch { return false; }
}

function getCachedAvailability(key: string): DayAvailability[] | null {
  const raw = localStorage.getItem(AVAILABILITY_CACHE_KEY);
  if (!raw) return null;
  try {
    const cache: AvailabilityCache = JSON.parse(raw);
    return cache.data[key] || null;
  } catch { return null; }
}

function cacheAvailability(key: string, data: DayAvailability[]) {
  let cache: AvailabilityCache;
  const raw = localStorage.getItem(AVAILABILITY_CACHE_KEY);
  if (raw) {
    cache = JSON.parse(raw);
    cache.data[key] = data;
    cache.fetchedAt = new Date().toISOString();
  } else {
    cache = { data: { [key]: data }, fetchedAt: new Date().toISOString() };
  }
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
        time: formatTime(startAt.getHours(), startAt.getMinutes()),
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
function generateFallbackAvailability(date: string, teamMemberId: string, duration: number = 60): DayAvailability {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  const hours = BUSINESS_HOURS[dayOfWeek];

  if (!hours) return { date, teamMemberId, slots: [] };

  const [openH, openM] = hours.open.split(':').map(Number);
  const [closeH, closeM] = hours.close.split(':').map(Number);

  const slots: TimeSlot[] = [];
  let h = openH;
  let m = openM;

  while (h < closeH || (h === closeH && m + duration <= closeM * 60)) {
    // Randomly mark some slots as unavailable for realism
    const isAvailable = Math.random() > 0.25;

    const startAt = new Date(date);
    startAt.setHours(h, m, 0, 0);

    slots.push({
      time: formatTime(h, m),
      startAt: startAt.toISOString(),
      available: isAvailable,
      teamMemberId,
      duration,
    });

    m += DEFAULT_SLOT_INTERVAL;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }

  // Load existing bookings from localStorage to mark as unavailable
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  for (const slot of slots) {
    const isBooked = bookings.some((b: any) =>
      b.date === date && b.time === slot.time && b.trainerId === teamMemberId && b.status !== 'cancelled'
    );
    if (isBooked) slot.available = false;
  }

  return { date, teamMemberId, slots: applyBookingBuffer(slots) };
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
 * Create a booking via Square Bookings API
 */
export async function createBooking(
  teamMemberId: string,
  startAt: string,
  duration: number,
  customerInfo: { name: string; email: string; phone: string; goals?: string }
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

  try {
    const response = await fetch(`${SQUARE_API_BASE}/bookings`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        booking: {
          location_id: SQUARE_LOCATION_ID,
          start_at: startAt,
          appointment_segments: [{
            duration_minutes: duration,
            team_member_id: teamMemberId,
            service_variation_id: getServiceId(duration) || undefined,
          }],
          customer_note: `Name: ${customerInfo.name}\nGoals: ${customerInfo.goals || 'Not specified'}`,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.errors?.[0]?.detail || 'Booking failed');
    }

    const data = await response.json();

    // Also store locally
    const startDate = new Date(startAt);
    const booking = {
      id: data.booking.id,
      date: startDate.toISOString().split('T')[0],
      time: formatTime(startDate.getHours(), startDate.getMinutes()),
      name: customerInfo.name,
      email: customerInfo.email,
      phone: customerInfo.phone,
      service: 'Training Session',
      duration,
      trainerId: teamMemberId,
      status: 'confirmed',
      squareAppointmentId: data.booking.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existing = JSON.parse(localStorage.getItem('bookings') || '[]');
    existing.push(booking);
    localStorage.setItem('bookings', JSON.stringify(existing));
    localStorage.removeItem(AVAILABILITY_CACHE_KEY);

    // Sync to Trainerize — only when worker is NOT configured.
    // When worker is active, the Square booking.created webhook handles the sync,
    // so we skip here to avoid creating duplicate Trainerize appointments.
    if (!WORKER_URL) {
      syncToTrainerize(customerInfo, startAt, duration, teamMemberId);
    }

    return { success: true, bookingId: data.booking.id };
  } catch (error) {
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

  // Sync booking
  syncBooking({
    clientEmail: customerInfo.email,
    date: startDate.toISOString().split('T')[0],
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
  if (teamMemberId === 'alex-davis' || teamMemberId === DEFAULT_COACH) return 'Alex Davis';
  return 'Coach';
}

/**
 * Check if Square calendar is live
 */
export function isCalendarLive(): boolean {
  return isConfigured();
}
