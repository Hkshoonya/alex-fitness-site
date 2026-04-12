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
// visible in any Square booking URL.
const SERVICE_IDS = {
  consultation: import.meta.env.VITE_SQUARE_SERVICE_CONSULTATION || '',
  session30: import.meta.env.VITE_SQUARE_SERVICE_30MIN || '',
  session60: import.meta.env.VITE_SQUARE_SERVICE_60MIN || '',
};

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
 * Get the right service ID based on session duration
 */
export function getServiceId(duration: number): string {
  if (duration <= 30) return SERVICE_IDS.session30 || SERVICE_IDS.consultation;
  if (duration <= 60) return SERVICE_IDS.session60;
  return SERVICE_IDS.session60; // 90 min uses 60 min service
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
