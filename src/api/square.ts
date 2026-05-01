// Square calendar sync — admin-only.
//
// Pre-launch hardening (Phase 4 audit, 2026-05-01): the prior version of
// this module hit Square's /v2/bookings directly through the worker proxy
// (Origin-gated only). Forged-Origin curl read every booking + pivoted into
// customer PII. Now: the only export is a thin wrapper that POSTs to the
// admin-token-gated worker endpoint /admin/bookings. Old direct-Square
// functions (createSquareBooking, getAvailableSlots, cancelSquareBooking,
// mocks) were dead code and have been removed.

import { getSquareConfig } from '@/api/squareConfig';
import { getAdminToken } from '@/api/challenges';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

export const isSquareConfigured = (): boolean => {
  return getSquareConfig().isConfigured;
};

interface SquareBookingShape {
  id: string;
  start_at: string;
  appointment_segments?: { duration_minutes?: number }[];
  customer_note?: string;
}

/**
 * Pull bookings from Square via /admin/bookings (admin-token gated) and
 * cache the trimmed shape in localStorage so the calendar renders instantly
 * on the next render.
 *
 * Returns counts of synced rows + errors. Returns {0,0} silently when the
 * admin isn't logged in — the calendar already shows an "Admin only" state
 * for non-admin viewers.
 */
export const syncBookingsWithSquare = async (): Promise<{ synced: number; errors: number }> => {
  if (!WORKER_URL) return { synced: 0, errors: 0 };
  const token = getAdminToken();
  if (!token) return { synced: 0, errors: 0 };

  try {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const qs = new URLSearchParams({
      start_at_min: startDate.toISOString(),
      start_at_max: endDate.toISOString(),
      limit: '200',
    });
    const response = await fetch(`${WORKER_URL}/admin/bookings?${qs}`, {
      headers: { 'X-Admin-Token': token },
    });

    if (!response.ok) {
      console.error('Bookings sync failed:', response.status);
      return { synced: 0, errors: 1 };
    }

    const data = await response.json();
    const bookings = (data.bookings as SquareBookingShape[] | undefined)?.map(b => ({
      id: b.id,
      date: b.start_at.split('T')[0],
      time: formatTime(
        new Date(b.start_at).getHours(),
        new Date(b.start_at).getMinutes()
      ),
      duration: b.appointment_segments?.[0]?.duration_minutes || 30,
      notes: b.customer_note,
    })) || [];

    localStorage.setItem('square_bookings', JSON.stringify(bookings));
    return { synced: bookings.length, errors: 0 };
  } catch (error) {
    console.error('Sync error:', error);
    return { synced: 0, errors: 1 };
  }
};

function formatTime(hours: number, minutes: number): string {
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}
