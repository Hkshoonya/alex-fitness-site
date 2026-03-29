// Trainerize Integration
// Full sync: clients, bookings, session credits, payments, auto-provisioning
//
// When a new client buys a plan:
// 1. Client created in Trainerize under your account
// 2. Auto-generated login credentials (ID + temp password)
// 3. Activation invite emailed to client
// 4. Purchased plan assigned as program
// 5. Booking synced to Trainerize calendar
//
// API docs: https://help.trainerize.com/hc/en-us/articles/37082084919060
// Requires: Studio or Enterprise plan for direct API
// Fallback: Zapier webhook (any plan)

const TRAINERIZE_API_KEY = import.meta.env.VITE_TRAINERIZE_API_KEY || '';
const TRAINERIZE_API_BASE = import.meta.env.VITE_TRAINERIZE_API_URL || 'https://api.trainerize.com/v2';
const TRAINERIZE_WEBHOOK_URL = import.meta.env.VITE_TRAINERIZE_WEBHOOK_URL || '';
const TRAINERIZE_TRAINER_ID = import.meta.env.VITE_TRAINERIZE_TRAINER_ID || '';

// ===== TYPES =====

export interface TrainerizeClient {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  tags?: string[];
  notes?: string;
}

export interface TrainerizeBooking {
  clientEmail: string;
  date: string;
  time: string;
  duration: number;
  type: 'in-studio' | 'virtual';
  coachName: string;
  service: string;
  meetLink?: string;
}

export interface TrainerizeSessionCredit {
  clientEmail: string;
  planName: string;
  totalSessions: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  validUntil: string;
}

export interface TrainerizePayment {
  clientEmail: string;
  amount: number;
  currency: string;
  planName: string;
  paymentId: string;
  date: string;
}

export interface TrainerizeProvisionResult {
  success: boolean;
  clientId?: string;
  inviteSent?: boolean;
  programAssigned?: boolean;
  error?: string;
}

type TrainerizeEvent =
  | { type: 'new_client'; data: TrainerizeClient }
  | { type: 'booking_created'; data: TrainerizeBooking }
  | { type: 'session_used'; data: TrainerizeSessionCredit }
  | { type: 'payment_confirmed'; data: TrainerizePayment }
  | { type: 'client_provisioned'; data: TrainerizeClient & { planName: string; paymentId: string } };

// ===== CONFIG =====

export function isTrainerizeConfigured(): boolean {
  return !!(TRAINERIZE_API_KEY || TRAINERIZE_WEBHOOK_URL);
}

function isDirectApiConfigured(): boolean {
  return !!TRAINERIZE_API_KEY;
}

function apiHeaders() {
  return {
    'Authorization': `Bearer ${TRAINERIZE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ===== DIRECT API METHODS =====

/**
 * Create client in Trainerize with auto-provisioning
 * - Creates account under your trainer ID
 * - send_invite: true → Trainerize emails the client their login credentials
 * - Client gets a unique ID and temporary password to activate the app
 */
async function apiCreateClient(client: TrainerizeClient): Promise<{ success: boolean; clientId?: string }> {
  try {
    // Check if client already exists
    const searchResponse = await fetch(`${TRAINERIZE_API_BASE}/clients?email=${encodeURIComponent(client.email)}`, {
      headers: apiHeaders(),
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const existing = searchData.clients?.find((c: any) => c.email === client.email);
      if (existing) {
        // Client exists — update their info
        await fetch(`${TRAINERIZE_API_BASE}/clients/${existing.id}`, {
          method: 'PUT',
          headers: apiHeaders(),
          body: JSON.stringify({
            first_name: client.firstName,
            last_name: client.lastName,
            phone: client.phone,
            tags: client.tags,
            notes: client.notes,
          }),
        });
        return { success: true, clientId: existing.id };
      }
    }

    // Create new client
    const response = await fetch(`${TRAINERIZE_API_BASE}/clients`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        email: client.email,
        first_name: client.firstName,
        last_name: client.lastName,
        phone: client.phone,
        tags: client.tags,
        notes: client.notes,
        trainer_id: TRAINERIZE_TRAINER_ID || undefined,
        // This triggers Trainerize to:
        // 1. Generate a unique client ID
        // 2. Create temporary password
        // 3. Send activation email with login credentials
        send_invite: true,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `API error ${response.status}`);
    }

    const data = await response.json();
    return { success: true, clientId: data.id || data.client_id };
  } catch (error) {
    console.error('Trainerize create client failed:', error);
    return { success: false };
  }
}

/**
 * Assign a training program/plan to a client
 * Maps the purchased plan name to a Trainerize master program
 */
async function apiAssignProgram(clientId: string, planName: string): Promise<{ success: boolean }> {
  try {
    // First, find matching master program by name
    const programsResponse = await fetch(`${TRAINERIZE_API_BASE}/programs?search=${encodeURIComponent(planName)}`, {
      headers: apiHeaders(),
    });

    let programId: string | null = null;

    if (programsResponse.ok) {
      const programsData = await programsResponse.json();
      const match = programsData.programs?.find((p: any) =>
        p.name.toLowerCase().includes(planName.toLowerCase().split(' - ')[0])
      );
      if (match) programId = match.id;
    }

    if (!programId) {
      console.log(`No matching Trainerize program for "${planName}" — skipping assignment`);
      return { success: true }; // Not a failure, just no matching program
    }

    // Copy master program to client
    const response = await fetch(`${TRAINERIZE_API_BASE}/clients/${clientId}/programs`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        program_id: programId,
        start_date: new Date().toISOString().split('T')[0],
      }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Trainerize assign program failed:', error);
    return { success: false };
  }
}

/**
 * Log an appointment/booking in Trainerize
 */
async function apiCreateBooking(booking: TrainerizeBooking): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${TRAINERIZE_API_BASE}/appointments`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        client_email: booking.clientEmail,
        date: booking.date,
        time: booking.time,
        duration_minutes: booking.duration,
        type: booking.type,
        trainer_id: TRAINERIZE_TRAINER_ID || undefined,
        service_name: booking.service,
        notes: booking.meetLink ? `Virtual session — Meet: ${booking.meetLink}` : 'In-studio session',
      }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Trainerize create booking failed:', error);
    return { success: false };
  }
}

/**
 * Update session credits for a client
 */
async function apiUpdateSessionCredits(credit: TrainerizeSessionCredit): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${TRAINERIZE_API_BASE}/clients/credits`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        client_email: credit.clientEmail,
        plan_name: credit.planName,
        total_sessions: credit.totalSessions,
        sessions_used: credit.sessionsUsed,
        sessions_remaining: credit.sessionsRemaining,
        valid_until: credit.validUntil,
      }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Trainerize update credits failed:', error);
    return { success: false };
  }
}

/**
 * Log a payment in Trainerize
 */
async function apiLogPayment(payment: TrainerizePayment): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${TRAINERIZE_API_BASE}/payments`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        client_email: payment.clientEmail,
        amount: payment.amount,
        currency: payment.currency,
        plan_name: payment.planName,
        payment_id: payment.paymentId,
        date: payment.date,
      }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Trainerize log payment failed:', error);
    return { success: false };
  }
}

// ===== WEBHOOK METHOD (Zapier — any plan) =====

async function sendWebhook(event: TrainerizeEvent): Promise<{ success: boolean }> {
  if (!TRAINERIZE_WEBHOOK_URL) return { success: false };

  try {
    const response = await fetch(TRAINERIZE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: event.type,
        timestamp: new Date().toISOString(),
        ...event.data,
      }),
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Trainerize webhook failed:', error);
    return { success: false };
  }
}

// ===== PUBLIC API =====

/**
 * Sync a new client to Trainerize
 */
export async function syncNewClient(client: TrainerizeClient): Promise<{ success: boolean; clientId?: string }> {
  if (!isTrainerizeConfigured()) {
    logLocally({ type: 'new_client', data: client });
    return { success: true };
  }

  if (isDirectApiConfigured()) {
    return apiCreateClient(client);
  }

  return sendWebhook({ type: 'new_client', data: client });
}

/**
 * Full client provisioning after a plan purchase:
 * 1. Create client in Trainerize (or update if exists)
 * 2. Trainerize auto-generates ID + temp password
 * 3. Activation email sent to client (send_invite: true)
 * 4. Purchased plan assigned as training program
 * 5. Payment logged
 * 6. Session credits set
 *
 * The client receives an email from Trainerize with:
 * - Their unique login ID
 * - Temporary password
 * - Link to download the Trainerize app
 * - Instructions to activate their account
 */
export async function provisionNewClientWithPlan(
  client: TrainerizeClient,
  planName: string,
  payment: TrainerizePayment,
  sessions: TrainerizeSessionCredit
): Promise<TrainerizeProvisionResult> {
  if (!isTrainerizeConfigured()) {
    logLocally({
      type: 'client_provisioned',
      data: { ...client, planName, paymentId: payment.paymentId },
    });
    return { success: true, inviteSent: false, programAssigned: false };
  }

  if (isDirectApiConfigured()) {
    // Step 1: Create client → auto-generates credentials, sends invite email
    const clientResult = await apiCreateClient(client);
    if (!clientResult.success) {
      return { success: false, error: 'Failed to create client in Trainerize' };
    }

    // Step 2: Assign the purchased plan as a training program
    let programAssigned = false;
    if (clientResult.clientId) {
      const programResult = await apiAssignProgram(clientResult.clientId, planName);
      programAssigned = programResult.success;
    }

    // Step 3: Log the payment
    await apiLogPayment(payment);

    // Step 4: Set session credits
    await apiUpdateSessionCredits(sessions);

    return {
      success: true,
      clientId: clientResult.clientId,
      inviteSent: true,
      programAssigned,
    };
  }

  // Webhook fallback — send all data in one event for Zapier to handle
  await sendWebhook({
    type: 'client_provisioned',
    data: { ...client, planName, paymentId: payment.paymentId },
  });

  return { success: true, inviteSent: false, programAssigned: false };
}

/**
 * Sync a booking to Trainerize
 */
export async function syncBooking(booking: TrainerizeBooking): Promise<{ success: boolean }> {
  if (!isTrainerizeConfigured()) {
    logLocally({ type: 'booking_created', data: booking });
    return { success: true };
  }

  if (isDirectApiConfigured()) {
    return apiCreateBooking(booking);
  }

  return sendWebhook({ type: 'booking_created', data: booking });
}

/**
 * Sync session credit usage
 */
export async function syncSessionUsed(credit: TrainerizeSessionCredit): Promise<{ success: boolean }> {
  if (!isTrainerizeConfigured()) {
    logLocally({ type: 'session_used', data: credit });
    return { success: true };
  }

  if (isDirectApiConfigured()) {
    return apiUpdateSessionCredits(credit);
  }

  return sendWebhook({ type: 'session_used', data: credit });
}

/**
 * Sync a payment confirmation
 */
export async function syncPayment(payment: TrainerizePayment): Promise<{ success: boolean }> {
  if (!isTrainerizeConfigured()) {
    logLocally({ type: 'payment_confirmed', data: payment });
    return { success: true };
  }

  if (isDirectApiConfigured()) {
    return apiLogPayment(payment);
  }

  return sendWebhook({ type: 'payment_confirmed', data: payment });
}

// ===== LOCAL LOG (demo mode) =====

function logLocally(event: TrainerizeEvent) {
  const log = JSON.parse(localStorage.getItem('trainerize_sync_log') || '[]');
  log.push({ ...event, timestamp: new Date().toISOString(), synced: false });
  localStorage.setItem('trainerize_sync_log', JSON.stringify(log));
}

export function getPendingSyncItems(): TrainerizeEvent[] {
  return JSON.parse(localStorage.getItem('trainerize_sync_log') || '[]');
}
