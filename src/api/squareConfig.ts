// Square API Configuration
// Auto-detects sandbox vs production based on Application ID

const SQUARE_APPLICATION_ID = import.meta.env.VITE_SQUARE_APPLICATION_ID || '';
const SQUARE_ACCESS_TOKEN = import.meta.env.VITE_SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
const SQUARE_SERVICE_ID = import.meta.env.VITE_SQUARE_SERVICE_ID || '';

// Sandbox if Application ID starts with "sandbox-"
export const IS_SANDBOX = SQUARE_APPLICATION_ID.startsWith('sandbox-');

export const SQUARE_API_BASE = IS_SANDBOX
  ? 'https://connect.squareupsandbox.com/v2'
  : 'https://connect.squareup.com/v2';

export const SQUARE_WEB_SDK_URL = IS_SANDBOX
  ? 'https://sandbox.web.squarecdn.com/v1/square.js'
  : 'https://web.squarecdn.com/v1/square.js';

export function getSquareConfig() {
  return {
    applicationId: SQUARE_APPLICATION_ID,
    accessToken: SQUARE_ACCESS_TOKEN,
    locationId: SQUARE_LOCATION_ID,
    serviceId: SQUARE_SERVICE_ID,
    apiBase: SQUARE_API_BASE,
    isSandbox: IS_SANDBOX,
    isConfigured: !!(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID),
  };
}

export function getSquareHeaders() {
  return {
    'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
    'Square-Version': '2024-01-18',
    'Content-Type': 'application/json',
  };
}
