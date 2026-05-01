// Coach photos — admin-uploaded headshots, keyed by Square Team Member ID.
//
// Public read path is intentionally tiny: a single GET that returns the
// whole map of teamId → dataUrl. Worker edge-caches it for 5 minutes so
// the ~1MB response only crosses the wire once per CDN region per cache
// window.

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const ADMIN_TOKEN_KEY = 'alex_fitness_admin_token';

export type CoachPhotoMap = Record<string, string>;

function getAdminToken(): string {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Admin-Token'] = token;
  return headers;
}

/** Public — returns map of Square teamId → base64 data URL. */
export async function getCoachPhotos(): Promise<CoachPhotoMap> {
  if (!WORKER_URL) return {};
  try {
    const r = await fetch(`${WORKER_URL}/coach-photos`);
    if (!r.ok) return {};
    const json = await r.json();
    return (json && typeof json === 'object' && !Array.isArray(json)) ? json : {};
  } catch {
    return {};
  }
}

/** Admin — uploads or replaces a coach's photo. */
export async function uploadCoachPhoto(teamId: string, dataUrl: string): Promise<{ ok: boolean; error?: string }> {
  if (!WORKER_URL) return { ok: false, error: 'Worker URL not configured' };
  try {
    const r = await fetch(`${WORKER_URL}/admin/coach-photo`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ teamId, dataUrl }),
    });
    if (r.ok) return { ok: true };
    const text = await r.text();
    return { ok: false, error: text || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** Admin — removes a coach's uploaded photo (reverts to fallback chain). */
export async function deleteCoachPhoto(teamId: string): Promise<boolean> {
  if (!WORKER_URL) return false;
  try {
    const r = await fetch(`${WORKER_URL}/admin/coach-photo/${encodeURIComponent(teamId)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}
