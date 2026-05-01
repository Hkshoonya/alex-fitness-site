// Client success photos — admin-curated stories displayed above the
// testimonials section. Each record carries an optional caption (≤140
// chars) since these are storytelling, not just decoration.
//
// Storage matches studio photos: single KV array, newest first. Public
// path is edge-cached 5 min; admin path can opt out via { noCache: true }
// for instant feedback after upload.

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const ADMIN_TOKEN_KEY = 'alex_fitness_admin_token';

export interface ClientPhoto {
  id: string;
  dataUrl: string;
  caption?: string;
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
export async function getClientPhotos(opts: { noCache?: boolean } = {}): Promise<ClientPhoto[]> {
  if (!WORKER_URL) return [];
  try {
    const url = opts.noCache
      ? `${WORKER_URL}/client-photos?_=${Date.now()}`
      : `${WORKER_URL}/client-photos`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    return Array.isArray(json) ? (json as ClientPhoto[]) : [];
  } catch {
    return [];
  }
}

/** Admin — uploads a new client success photo with optional caption. */
export async function uploadClientPhoto(
  dataUrl: string,
  caption?: string,
): Promise<{ ok: boolean; photo?: ClientPhoto; error?: string }> {
  if (!WORKER_URL) return { ok: false, error: 'Worker URL not configured' };
  try {
    const r = await fetch(`${WORKER_URL}/admin/client-photo`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ dataUrl, caption: caption || '' }),
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

/** Admin — removes a client success photo by id. */
export async function deleteClientPhoto(id: string): Promise<boolean> {
  if (!WORKER_URL) return false;
  try {
    const r = await fetch(`${WORKER_URL}/admin/client-photo/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}
