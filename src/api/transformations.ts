// Transformations — admin-managed gallery of client before/after
// composite photos. Single image per record (Alex composites externally
// in his existing workflow); the homepage TransformationGallery
// renders them as a fullscreen crossfade carousel.

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const ADMIN_TOKEN_KEY = 'alex_fitness_admin_token';

export interface Transformation {
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
export async function getTransformations(opts: { noCache?: boolean } = {}): Promise<Transformation[]> {
  if (!WORKER_URL) return [];
  try {
    const url = opts.noCache
      ? `${WORKER_URL}/transformations?_=${Date.now()}`
      : `${WORKER_URL}/transformations`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    return Array.isArray(json) ? (json as Transformation[]) : [];
  } catch {
    return [];
  }
}

/** Admin — uploads a new transformation composite. */
export async function uploadTransformation(dataUrl: string): Promise<{ ok: boolean; transformation?: Transformation; error?: string }> {
  if (!WORKER_URL) return { ok: false, error: 'Worker URL not configured' };
  try {
    const r = await fetch(`${WORKER_URL}/admin/transformation`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ dataUrl }),
    });
    if (r.ok) {
      const transformation = await r.json();
      return { ok: true, transformation };
    }
    const text = await r.text();
    let parsed: { error?: string } | null = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: false, error: parsed?.error || text || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** Admin — removes a transformation by id. */
export async function deleteTransformation(id: string): Promise<boolean> {
  if (!WORKER_URL) return false;
  try {
    const r = await fetch(`${WORKER_URL}/admin/transformation/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    return r.ok;
  } catch {
    return false;
  }
}
