// Trainerize Integration — v03 API
// Full sync: clients, bookings, session credits, payments, auto-provisioning
//
// When a new client buys a plan:
// 1. Client created in Trainerize under your account
// 2. Auto-generated login credentials (ID + temp password)
// 3. Activation invite emailed to client
// 4. Purchased plan assigned as program
// 5. Booking synced to Trainerize calendar
//
// API docs: https://developers.trainerize.com (password: tzAPI)
// Auth: Basic base64(groupID:APIToken)
// All endpoints: POST with JSON body (RPC-style, not REST)
// Requires: Studio or Enterprise plan for direct API
// Fallback: Zapier webhook (any plan)

const TRAINERIZE_API_TOKEN = import.meta.env.VITE_TRAINERIZE_API_KEY || '';
const TRAINERIZE_API_DIRECT = import.meta.env.VITE_TRAINERIZE_API_URL || 'https://api.trainerize.com/v03';
const TRAINERIZE_WEBHOOK_URL = import.meta.env.VITE_TRAINERIZE_WEBHOOK_URL || '';
const TRAINERIZE_TRAINER_GROUP_ID = import.meta.env.VITE_TRAINERIZE_TRAINER_GROUP_ID || '';
const TRAINERIZE_COACH_USER_ID = import.meta.env.VITE_TRAINERIZE_COACH_USER_ID || '10860818';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// When worker proxy is configured, route REST calls through it (avoids CORS)
// Worker maps /api/trainerize/... → api.trainerize.com/v03/...
const TRAINERIZE_API_BASE = WORKER_URL
  ? `${WORKER_URL}/api/trainerize`
  : TRAINERIZE_API_DIRECT;

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
  return !!((TRAINERIZE_TRAINER_GROUP_ID && TRAINERIZE_API_TOKEN) || WORKER_URL || TRAINERIZE_WEBHOOK_URL);
}

function isDirectApiConfigured(): boolean {
  return !!(WORKER_URL || (TRAINERIZE_TRAINER_GROUP_ID && TRAINERIZE_API_TOKEN));
}

function apiHeaders() {
  // When using the worker proxy, don't send Authorization — the worker adds it server-side.
  if (WORKER_URL) {
    return { 'Content-Type': 'application/json' };
  }

  // Direct mode: Basic Auth — base64(groupID:APIToken)
  const token = btoa(`${TRAINERIZE_TRAINER_GROUP_ID}:${TRAINERIZE_API_TOKEN}`);
  return {
    'Authorization': `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

// ===== API HELPERS =====

/** Convert ISO date to Trainerize format: "2026-04-11T14:00:00Z" → "2026-04-11 14:00:00" */
function toTzDate(iso: string): string {
  return iso.replace('T', ' ').replace('Z', '').replace(/\.\d+$/, '');
}

/** All Trainerize v03 endpoints use POST with JSON body */
async function apiPost(path: string, body: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${TRAINERIZE_API_BASE}${path}`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
}

/** Look up a Trainerize userID (integer) by email. Required for tags, messages, etc. */
async function findUserIdByEmail(email: string): Promise<number | null> {
  try {
    const response = await apiPost('/user/find', {
      searchTerm: email,
      view: 'allClient',
      start: 0,
      count: 10,
      verbose: false,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const users = data.users || data.result || [];
    if (!Array.isArray(users)) return null;

    const match = users.find((u: any) =>
      (u.email || '').toLowerCase() === email.toLowerCase()
    );
    return match ? (match.userID ?? match.id ?? null) : null;
  } catch {
    return null;
  }
}

// ===== DIRECT API METHODS =====

/**
 * Create client in Trainerize with auto-provisioning
 * - Creates account under your trainer ID
 * - sendMail: true → Trainerize emails the client their login credentials
 * - Client gets a unique ID and temporary password to activate the app
 */
async function apiCreateClient(client: TrainerizeClient): Promise<{ success: boolean; clientId?: string }> {
  try {
    // Check if client already exists
    const existingId = await findUserIdByEmail(client.email);

    if (existingId) {
      // Client exists — update their profile
      await apiPost('/user/setProfile', {
        user: {
          userID: existingId,
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
        },
      });

      // Update tags
      if (client.tags?.length) {
        for (const tag of client.tags) {
          await apiPost('/user/addTag', { userID: existingId, userTag: tag });
        }
      }

      return { success: true, clientId: String(existingId) };
    }

    // Create new client
    const response = await apiPost('/user/add', {
      user: {
        firstName: client.firstName,
        lastName: client.lastName,
        fullName: `${client.firstName} ${client.lastName}`,
        email: client.email,
        type: 'client',
        trainerID: parseInt(TRAINERIZE_COACH_USER_ID),
        phone: client.phone,
      },
      userTag: client.tags?.[0],
      sendMail: true,
      isSetup: false,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || err.statusMsg || `API error ${response.status}`);
    }

    const data = await response.json();
    const newId = data.userID ?? data.id ?? data.result?.userID;

    // Add additional tags beyond the first one (already set via userTag param)
    if (newId && client.tags && client.tags.length > 1) {
      for (const tag of client.tags.slice(1)) {
        await apiPost('/user/addTag', { userID: newId, userTag: tag });
      }
    }

    // Add notes via trainerNote if provided
    if (newId && client.notes) {
      await apiPost('/trainerNote/add', {
        userID: newId,
        content: client.notes,
        type: 'general',
      });
    }

    return { success: true, clientId: String(newId) };
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
    // List master programs
    const programsResponse = await apiPost('/program/getList', {});

    let programId: number | null = null;

    if (programsResponse.ok) {
      const programsData = await programsResponse.json();
      const programs = programsData.programs || programsData.result || [];
      if (Array.isArray(programs)) {
        const match = programs.find((p: any) =>
          (p.name || '').toLowerCase().includes(planName.toLowerCase().split(' - ')[0])
        );
        if (match) programId = match.id ?? match.programID;
      }
    }

    if (!programId) {
      console.log(`No matching Trainerize program for "${planName}" — skipping assignment`);
      return { success: true }; // Not a failure, just no matching program
    }

    // Copy master program to client
    const response = await apiPost('/program/copyToUser', {
      id: programId,
      userID: parseInt(clientId),
      startDate: new Date().toISOString().split('T')[0],
      forceMerge: false,
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
    // Look up client userID by email
    const clientUserId = await findUserIdByEmail(booking.clientEmail);

    // Build start/end datetime — Trainerize needs space-separated format
    const startIso = `${booking.date}T${booking.time}:00Z`;
    const endMs = new Date(startIso).getTime() + booking.duration * 60000;
    const startDate = toTzDate(startIso);
    const endDate = toTzDate(new Date(endMs).toISOString());

    const response = await apiPost('/appointment/add', {
      userID: parseInt(TRAINERIZE_COACH_USER_ID),
      startDate,
      endDate,
      notes: booking.meetLink
        ? `Virtual session — Meet: ${booking.meetLink}`
        : `In-studio ${booking.service} session`,
      attendents: clientUserId ? [{ userID: clientUserId }] : [],
    });

    return { success: response.ok };
  } catch (error) {
    console.error('Trainerize create booking failed:', error);
    return { success: false };
  }
}

/**
 * Update session credits for a client
 * No direct credits endpoint in v03 — logs via trainer note + tag
 */
async function apiUpdateSessionCredits(credit: TrainerizeSessionCredit): Promise<{ success: boolean }> {
  try {
    const userId = await findUserIdByEmail(credit.clientEmail);
    if (!userId) return { success: false };

    // Add a trainer note with credit details
    await apiPost('/trainerNote/add', {
      userID: userId,
      content: `Session credits: ${credit.sessionsRemaining}/${credit.totalSessions} remaining (${credit.planName}). Valid until ${credit.validUntil}`,
      type: 'general',
    });

    // Tag with credit count for quick reference
    await apiPost('/user/addTag', {
      userID: userId,
      userTag: `credits:${credit.sessionsRemaining}`,
    });

    return { success: true };
  } catch (error) {
    console.error('Trainerize update credits failed:', error);
    return { success: false };
  }
}

/**
 * Log a payment in Trainerize
 * No direct payment endpoint in v03 — logs via trainer note + tag
 */
async function apiLogPayment(payment: TrainerizePayment): Promise<{ success: boolean }> {
  try {
    const userId = await findUserIdByEmail(payment.clientEmail);
    if (!userId) return { success: false };

    // Add payment note
    await apiPost('/trainerNote/add', {
      userID: userId,
      content: `Payment received: $${payment.amount.toFixed(2)} ${payment.currency} for ${payment.planName} (${payment.paymentId}) on ${payment.date}`,
      type: 'general',
    });

    // Tag payment status
    await apiPost('/user/addTag', { userID: userId, userTag: 'payment-paid' });

    return { success: true };
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
 * 3. Activation email sent to client (sendMail: true)
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
