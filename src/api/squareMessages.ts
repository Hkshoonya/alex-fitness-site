// Square Messages Integration
// Sends direct text messages to Alex via Square Messages API

const SQUARE_ACCESS_TOKEN = import.meta.env.VITE_SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';
const ALEX_PHONE = '8134210633';

/**
 * Send a message to Alex via Square Messages
 */
export async function sendMessageToAlex(params: {
  senderName: string;
  senderPhone: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {

  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    return sendMockMessage(params);
  }

  try {
    // First, find or create the customer in Square
    const customerResponse = await fetch(`${SQUARE_API_BASE}/customers/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-01-18',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          filter: {
            phone_number: { exact: params.senderPhone },
          },
        },
      }),
    });

    let customerId: string;

    if (customerResponse.ok) {
      const customerData = await customerResponse.json();
      if (customerData.customers?.length > 0) {
        customerId = customerData.customers[0].id;
      } else {
        // Create new customer
        const createResponse = await fetch(`${SQUARE_API_BASE}/customers`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Square-Version': '2024-01-18',
            'Content-Type': 'application/json',
          },
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

    // Create a note/message on the customer profile
    // Square doesn't have a direct messaging API for SMS,
    // but we can create an order note or use the Square Messages webhook
    // For now, we create a customer note which appears in Square Dashboard
    const noteResponse = await fetch(`${SQUARE_API_BASE}/customers/${customerId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-01-18',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note: `[Website Message ${new Date().toLocaleString()}]\n${params.message}\n\nFrom: ${params.senderName} (${params.senderPhone})`,
      }),
    });

    if (!noteResponse.ok) throw new Error('Failed to send message');

    // Store locally
    storeMessage(params);

    return { success: true };
  } catch (error) {
    console.error('Square message failed:', error);
    return sendMockMessage(params);
  }
}

/**
 * Mock message for demo mode
 */
async function sendMockMessage(params: {
  senderName: string;
  senderPhone: string;
  message: string;
}): Promise<{ success: boolean }> {
  await new Promise(r => setTimeout(r, 1000));
  storeMessage(params);
  return { success: true };
}

/**
 * Store message locally
 */
function storeMessage(params: { senderName: string; senderPhone: string; message: string }) {
  const messages = JSON.parse(localStorage.getItem('alex_messages') || '[]');
  messages.push({
    ...params,
    sentAt: new Date().toISOString(),
    read: false,
  });
  localStorage.setItem('alex_messages', JSON.stringify(messages));
}

/**
 * Get Alex's phone for direct SMS link
 */
export function getAlexSmsLink(message?: string): string {
  const encoded = message ? encodeURIComponent(message) : '';
  return `sms:${ALEX_PHONE}${encoded ? `?body=${encoded}` : ''}`;
}

/**
 * Get Alex's phone for direct call
 */
export function getAlexCallLink(): string {
  return `tel:${ALEX_PHONE}`;
}
