// Square API Configuration
// Auto-detects sandbox vs production based on Application ID
// When WORKER_URL is set, routes REST API calls through Cloudflare Worker proxy
// to avoid CORS errors (worker adds auth headers server-side)

const SQUARE_APPLICATION_ID = import.meta.env.VITE_SQUARE_APPLICATION_ID || '';
const SQUARE_ACCESS_TOKEN = import.meta.env.VITE_SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// Service variation IDs — one per session type
const SERVICE_IDS = {
  consultation: import.meta.env.VITE_SQUARE_SERVICE_CONSULTATION || '',
  session30: import.meta.env.VITE_SQUARE_SERVICE_30MIN || '',
  session60: import.meta.env.VITE_SQUARE_SERVICE_60MIN || '',
};

export const IS_SANDBOX = SQUARE_APPLICATION_ID.startsWith('sandbox-');

const SQUARE_API_DIRECT = IS_SANDBOX
  ? 'https://connect.squareupsandbox.com/v2'
  : 'https://connect.squareup.com/v2';

// When worker proxy is configured, route REST calls through it (avoids CORS)
// Worker maps /api/square/... → connect.squareup.com/v2/...
export const SQUARE_API_BASE = WORKER_URL
  ? `${WORKER_URL}/api/square`
  : SQUARE_API_DIRECT;

// Web Payments SDK always loads directly from Square CDN (not proxied)
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
    accessToken: SQUARE_ACCESS_TOKEN,
    locationId: SQUARE_LOCATION_ID,
    serviceIds: SERVICE_IDS,
    apiBase: SQUARE_API_BASE,
    isSandbox: IS_SANDBOX,
    isConfigured: !!(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID),
  };
}

export function getSquareHeaders(): Record<string, string> {
  // When using the worker proxy, don't send Authorization — the worker adds it server-side.
  // This avoids exposing the access token to the browser and prevents CORS preflight issues.
  if (WORKER_URL) {
    // Only send Content-Type through proxy — worker adds Authorization + Square-Version server-side
    return {
      'Content-Type': 'application/json',
    };
  }

  return {
    'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
    'Square-Version': '2025-01-23',
    'Content-Type': 'application/json',
  };
}
