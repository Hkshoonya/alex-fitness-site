// Square API Configuration
//
// All Square REST calls route through the Cloudflare Worker proxy. The worker
// holds the access token as a server-side secret; the browser never sees it.
// Direct-to-Square calls are not supported (browser lacks CORS access to
// connect.squareup.com and putting the access token in the bundle would
// expose it to anyone visiting the site).

const SQUARE_APPLICATION_ID = import.meta.env.VITE_SQUARE_APPLICATION_ID || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// Service variation IDs — one per session type. Non-secret — these are
// visible in any Square booking URL. Hardcoded fallbacks so the booking
// flow works without build-time env vars; can still be overridden via
// VITE_SQUARE_SERVICE_* if the Square catalog gets re-keyed.
const SERVICE_IDS = {
  consultation: import.meta.env.VITE_SQUARE_SERVICE_CONSULTATION || 'UTPNPXXQA2R3WTKRQWXE6CBG', // Fitness Consultation Call (30min)
  session30: import.meta.env.VITE_SQUARE_SERVICE_30MIN || '66QDZG33XW3F62HR63P6VF5G',           // PT - 30 Minute Session
  session60: import.meta.env.VITE_SQUARE_SERVICE_60MIN || 'DFDGPQ56NTEWU4TX2WQBU7TR',           // PT - 60 Minute Session
  session90: import.meta.env.VITE_SQUARE_SERVICE_90MIN || 'EFAXK3SOJJPNK2G3XK3MHXZI',           // PT - 90 Minute
};

// Default team member (Alex). Used when the consultation flow doesn't let
// the user pick a coach. Square Team Member ID — from /team-members/search.
export const DEFAULT_TEAM_MEMBER_ID = 'TMr0PTR22KYH_0QK';

export const IS_SANDBOX = SQUARE_APPLICATION_ID.startsWith('sandbox-');

// The worker is the only way the frontend talks to Square.
// Worker maps /api/square/... → connect.squareup.com/v2/...
export const SQUARE_API_BASE = WORKER_URL ? `${WORKER_URL}/api/square` : '';

// Web Payments SDK loads directly from Square's CDN — this is a client-side
// script bundle, not an API call with credentials.
export const SQUARE_WEB_SDK_URL = IS_SANDBOX
  ? 'https://sandbox.web.squarecdn.com/v1/square.js'
  : 'https://web.squarecdn.com/v1/square.js';

/**
 * Get the right service ID based on session duration. For consultation
 * bookings, use getConsultationServiceId() instead — this function picks
 * a paid PT service variation, not the free consultation.
 */
export function getServiceId(duration: number): string {
  if (duration <= 30) return SERVICE_IDS.session30 || SERVICE_IDS.consultation;
  if (duration <= 60) return SERVICE_IDS.session60;
  return SERVICE_IDS.session90 || SERVICE_IDS.session60;
}

/**
 * Get the consultation service ID specifically
 */
export function getConsultationServiceId(): string {
  return SERVICE_IDS.consultation;
}

export function getSquareConfig() {
  return {
    applicationId: SQUARE_APPLICATION_ID,
    locationId: SQUARE_LOCATION_ID,
    serviceIds: SERVICE_IDS,
    apiBase: SQUARE_API_BASE,
    isSandbox: IS_SANDBOX,
    // "Configured" now means the worker proxy is reachable AND we have a
    // location. Without WORKER_URL there's no server-side path to Square.
    isConfigured: !!(WORKER_URL && SQUARE_LOCATION_ID),
  };
}

export function getSquareHeaders(): Record<string, string> {
  // The worker adds Authorization + Square-Version server-side. Browser only
  // sends Content-Type. Any call that reaches here without WORKER_URL set
  // will 401 from Square — that's the desired fail-closed behavior.
  return {
    'Content-Type': 'application/json',
  };
}
