// Announcements — site-wide banner + inline-card content driven by admin.
//
// Source of truth: worker KV (key 'announcements'). Public GET is cached
// for 60s by the worker. Admin endpoints require x-admin-token.

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const ADMIN_TOKEN_KEY = 'alex_fitness_admin_token';

export interface Announcement {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaTarget: string;
  // 'banner' = sticky top, 'card' = inline above plans/etc
  style: 'banner' | 'card';
  priority: 'high' | 'normal';
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
  discountCode: string;
  createdAt: string;
}

export type AnnouncementInput = Partial<Omit<Announcement, 'id' | 'createdAt'>> & { title: string };

function getAdminToken(): string {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Admin-Token'] = token;
  return headers;
}

/** Public — returns active (enabled + within date window) announcements. */
export async function getActiveAnnouncements(): Promise<Announcement[]> {
  if (!WORKER_URL) return [];
  try {
    const r = await fetch(`${WORKER_URL}/announcements`);
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

/** Admin — returns all (incl. scheduled, ended, disabled) for editing. */
export async function getAllAnnouncements(): Promise<Announcement[]> {
  if (!WORKER_URL) return [];
  try {
    const r = await fetch(`${WORKER_URL}/admin/announcements/all`, { headers: adminHeaders() });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

export async function createAnnouncement(input: AnnouncementInput): Promise<Announcement | null> {
  if (!WORKER_URL) return null;
  try {
    const r = await fetch(`${WORKER_URL}/admin/announcements`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function updateAnnouncement(id: string, updates: Partial<Announcement>): Promise<Announcement | null> {
  if (!WORKER_URL) return null;
  try {
    const r = await fetch(`${WORKER_URL}/admin/announcements/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(updates),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  if (!WORKER_URL) return false;
  try {
    const r = await fetch(`${WORKER_URL}/admin/announcements/${id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Status helper for admin UI to show 'scheduled' / 'live' / 'ended'. */
export function getAnnouncementStatus(a: Announcement, now: Date = new Date()): 'scheduled' | 'live' | 'ended' | 'disabled' {
  if (!a.enabled) return 'disabled';
  const t = now.getTime();
  if (a.startsAt && new Date(a.startsAt).getTime() > t) return 'scheduled';
  if (a.endsAt && new Date(a.endsAt).getTime() < t) return 'ended';
  return 'live';
}

// ============================================================
// Dismiss persistence — separate banners and cards have separate
// dismiss memory so dismissing one doesn't hide the other.
// ============================================================

const DISMISS_KEY = 'alex_fitness_announcement_dismissals';
const DISMISS_TTL_DAYS = 7;

interface DismissRecord {
  id: string;
  dismissedAt: number; // unix ms
}

function loadDismissals(): DismissRecord[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    const parsed: DismissRecord[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop entries older than TTL so the user re-sees announcements that
    // get re-enabled or re-deployed under the same id.
    const cutoff = Date.now() - DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
    return parsed.filter(d => d.dismissedAt > cutoff);
  } catch {
    return [];
  }
}

export function isAnnouncementDismissed(id: string): boolean {
  return loadDismissals().some(d => d.id === id);
}

export function dismissAnnouncement(id: string) {
  try {
    const all = loadDismissals().filter(d => d.id !== id);
    all.push({ id, dismissedAt: Date.now() });
    localStorage.setItem(DISMISS_KEY, JSON.stringify(all));
  } catch { /* private mode — fail silent */ }
}
