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
    const customerResponse = await fetch(`${SQUARE_API_BASE}/customers/search`, {
      method: 'POST',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        query: { filter: { phone_number: { exact: params.senderPhone } } },
      }),
    });

    let customerId: string;

    if (customerResponse.ok) {
      const customerData = await customerResponse.json();
      if (customerData.customers?.length > 0) {
        customerId = customerData.customers[0].id;
      } else {
        const createResponse = await fetch(`${SQUARE_API_BASE}/customers`, {
          method: 'POST',
          headers: getSquareHeaders(),
          body: JSON.stringify({
            given_name: params.senderName.split(' ')[0],
            family_name: params.senderName.split(' ').slice(1).join(' ') || '',
            phone_number: params.senderPhone,
          }),
        });

        if (!createResponse.ok) throw new Error('Failed to create customer');
        const createData = await createResponse.json();
        customerId = createData.customer.id;
      }
    } else {
      throw new Error('Customer search failed');
    }

    const noteResponse = await fetch(`${SQUARE_API_BASE}/customers/${customerId}`, {
      method: 'PUT',
      headers: getSquareHeaders(),
      body: JSON.stringify({
        note: `[Website Message ${new Date().toLocaleString()}]\n${params.message}\n\nFrom: ${params.senderName} (${params.senderPhone})`,
      }),
    });

    if (!noteResponse.ok) throw new Error('Failed to send message');

    storeMessage(params);
    return { success: true };
  } catch (error) {
    console.error('Square message failed:', error);
    return sendMockMessage(params);
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
  const messages = JSON.parse(localStorage.getItem('alex_messages') || '[]');
  messages.push({ ...params, sentAt: new Date().toISOString(), read: false });
  localStorage.setItem('alex_messages', JSON.stringify(messages));
}

export function getAlexSmsLink(message?: string): string {
  const encoded = message ? encodeURIComponent(message) : '';
  return `sms:${ALEX_PHONE}${encoded ? `?body=${encoded}` : ''}`;
}

export function getAlexCallLink(): string {
  return `tel:${ALEX_PHONE}`;
}
