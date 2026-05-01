// Studio photos — admin-managed gallery for the About page Studio
// section. Stored as a single KV array on the worker (newest first),
// rendered as the cycling crossfade gallery.
//
// Public read returns the same array everyone sees; admin path
// supports `noCache: true` to bypass Cloudflare's 5-min edge cache so
// uploads appear immediately in the admin preview.

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const ADMIN_TOKEN_KEY = 'alex_fitness_admin_token';

export interface StudioPhoto {
  id: string;
  dataUrl: string;
  createdAt: string;
}

function getAdminToken(): string {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Admin-Token'] = token;
  return headers;
}

/** Public — returns ordered array, newest first.
 *  Pass `noCache: true` in admin contexts immediately after a write. */
export async function getStudioPhotos(opts: { noCache?: boolean } = {}): Promise<StudioPhoto[]> {
  if (!WORKER_URL) return [];
  try {
    const url = opts.noCache
      ? `${WORKER_URL}/studio-photos?_=${Date.now()}`
      : `${WORKER_URL}/studio-photos`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    return Array.isArray(json) ? (json as StudioPhoto[]) : [];
  } catch {
    return [];
  }
}

/** Admin — uploads a new studio photo. Returns the saved record on success. */
export async function uploadStudioPhoto(dataUrl: string): Promise<{ ok: boolean; photo?: StudioPhoto; error?: string }> {
  if (!WORKER_URL) return { ok: false, error: 'Worker URL not configured' };
  try {
    const r = await fetch(`${WORKER_URL}/admin/studio-photo`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ dataUrl }),
    });
    if (r.ok) {
      const photo = await r.json();
      return { ok: true, photo };
    }
    const text = await r.text();
    let parsed: { error?: string } | null = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: false, error: parsed?.error || text || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** Admin — removes a studio photo by id. */
export async function deleteStudioPhoto(id: string): Promise<boolean> {
  if (!WORKER_URL) return false;
  try {
    const r = await fetch(`${WORKER_URL}/admin/studio-photo/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}
