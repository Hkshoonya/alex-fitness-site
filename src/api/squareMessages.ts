// Square Messages Integration
// Sends direct text messages to Alex via Square Messages API

import { getSquareConfig, getSquareHeaders, SQUARE_API_BASE } from '@/api/squareConfig';

const ALEX_PHONE = '8134210633';

/**
 * Send a message to Alex via Square
 */
export async function sendMessageToAlex(params: {
  senderName: string;
  senderPhone: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {

  if (!getSquareConfig().isConfigured) {
    return sendMockMessage(params);
  }

  try {
    // Square requires E.164 format (`+18134210633`) for phone-number search
    // — raw 10-digit strings get rejected with INVALID_VALUE. We strip
    // formatting first, take the last 10 digits (handles inputs that
    // include +1 / 1 / leading parens / dashes), then re-prefix with +1
    // for the US phone numbers this site collects.
    const tenDigits = params.senderPhone.replace(/\D/g, '').slice(-10);
    const e164 = tenDigits.length === 10 ? `+1${tenDigits}` : '';
    if (!e164) {
      // Square will reject anything else as INVALID_VALUE — fail fast with a
      // useful message instead of pretending to search.
      throw new Error('Phone number must be 10 digits (US)');
    }

    const customerResponse = await fetch(`${SQUARE_API_BASE}/customers/search`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        query: { filter: { phone_number: { exact: e164 } } },
      }),
    });

    let customerId: string;
    let existingNote = '';

    if (customerResponse.ok) {
      const customerData = await customerResponse.json();
      if (customerData.customers?.length > 0) {
        customerId = customerData.customers[0].id;
        existingNote = customerData.customers[0].note || '';
      } else {
        const createResponse = await fetch(`${SQUARE_API_BASE}/customers`, {
          method: 'POST',
          headers: getSquareHeaders(),
          body: JSON.stringify({
            given_name: params.senderName.split(' ')[0],
            family_name: params.senderName.split(' ').slice(1).join(' ') || '',
            phone_number: e164,
          }),
        });

        if (!createResponse.ok) {
          // Square does phone-realism validation (Twilio-style — 555 numbers
          // and obvious test patterns get rejected as INVALID_PHONE_NUMBER).
          // Surface the upstream detail so the user knows to enter a real
          // phone number, not a generic "failed to create".
          const errBody = await createResponse.json().catch(() => ({}));
          const detail = errBody.errors?.[0]?.detail || 'Failed to create customer';
          if (errBody.errors?.[0]?.code === 'INVALID_PHONE_NUMBER') {
            throw new Error('Please enter a valid US phone number');
          }
          throw new Error(detail);
        }
        const createData = await createResponse.json();
        customerId = createData.customer.id;
      }
    } else {
      const errBody = await customerResponse.json().catch(() => ({}));
      throw new Error(errBody.errors?.[0]?.detail || 'Customer search failed');
    }

    // APPEND to the existing note rather than overwrite — Square's PUT
    // /customers/{id} replaces the note field entirely, so prior messages
    // would be lost without this merge. Keep total under 4096 (Square limit)
    // by trimming oldest content.
    const entry = `[Website Message ${new Date().toLocaleString()}]\n${params.message}\n\nFrom: ${params.senderName} (${params.senderPhone})`;
    let combined = existingNote ? `${existingNote}\n\n---\n\n${entry}` : entry;
    if (combined.length > 4000) combined = combined.slice(combined.length - 4000);

    const noteResponse = await fetch(`${SQUARE_API_BASE}/customers/${customerId}`, {
      method: 'PUT',
      headers: getSquareHeaders(),
      body: JSON.stringify({ note: combined }),
    });

    if (!noteResponse.ok) throw new Error('Failed to send message');

    storeMessage(params);
    return { success: true };
  } catch (error) {
    console.error('Square message failed:', error);
    // Capture locally so the coach can still see it via the admin view, but
    // return failure so the UI shows an honest error instead of "Sent".
    storeMessage(params);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Could not deliver message: ${msg}. We've logged it locally — please try again or text ${ALEX_PHONE}.` };
  }
}

async function sendMockMessage(params: {
  senderName: string;
  senderPhone: string;
  message: string;
}): Promise<{ success: boolean }> {
  await new Promise(r => setTimeout(r, 1000));
  storeMessage(params);
  return { success: true };
}

function storeMessage(params: { senderName: string; senderPhone: string; message: string }) {
  let messages: unknown[] = [];
  try {
    const raw = localStorage.getItem('alex_messages');
    if (raw) messages = JSON.parse(raw);
    if (!Array.isArray(messages)) messages = [];
  } catch { messages = []; }
  messages.push({ ...params, sentAt: new Date().toISOString(), read: false });
  try { localStorage.setItem('alex_messages', JSON.stringify(messages)); } catch { /* quota / private mode */ }
}

export function getAlexSmsLink(message?: string): string {
  const encoded = message ? encodeURIComponent(message) : '';
  return `sms:${ALEX_PHONE}${encoded ? `?body=${encoded}` : ''}`;
}

export function getAlexCallLink(): string {
  return `tel:${ALEX_PHONE}`;
}
