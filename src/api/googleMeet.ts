// Google Meet Integration for Virtual Consultations
// Routes through the worker to keep OAuth secrets server-side

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

export interface MeetingDetails {
  meetLink: string;
  eventId: string;
  calendarLink: string;
}

/**
 * Check if Google Meet is available (worker must be configured)
 */
export function isGoogleMeetConfigured(): boolean {
  return !!WORKER_URL;
}

/**
 * Create a Google Calendar event with Google Meet link.
 * Calls the worker endpoint — OAuth secrets never touch the browser.
 */
export async function createMeetEvent(params: {
  title: string;
  startAt: string;
  durationMinutes: number;
  attendeeEmail: string;
  attendeeName: string;
  description?: string;
  // Optional phone — when supplied, the worker enriches the calendar
  // description with a phone-backup block (Alex's phone + this one)
  // so either side can call if video isn't working.
  attendeePhone?: string;
}): Promise<{ success: boolean; meeting?: MeetingDetails; error?: string }> {

  if (!WORKER_URL) {
    return createMockMeeting(params);
  }

  try {
    const response = await fetch(`${WORKER_URL}/api/google/meet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (data.success && data.meeting) {
      storeMeeting(params.startAt, data.meeting);
      return { success: true, meeting: data.meeting };
    }

    // Worker returned error — fall back to mock
    console.warn('Google Meet via worker failed:', data.error);
    return createMockMeeting(params);
  } catch (error) {
    console.error('Google Meet creation failed:', error);
    return createMockMeeting(params);
  }
}

/**
 * Mock meeting for demo mode
 */
async function createMockMeeting(_params: {
  startAt: string;
  attendeeEmail: string;
  attendeeName: string;
}): Promise<{ success: boolean; meeting?: MeetingDetails; error?: string }> {
  // No real Meet link available — return success:false so the UI knows
  console.warn('Google Meet not available — coach will send link manually.');
  return {
    success: false,
    error: 'Google Meet not configured. Coach will send the meeting link directly.',
  };
}

/**
 * Store meeting details locally for reference
 */
function storeMeeting(startAt: string, meeting: MeetingDetails) {
  const meetings = JSON.parse(localStorage.getItem('virtual_meetings') || '[]');
  meetings.push({
    ...meeting,
    startAt,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem('virtual_meetings', JSON.stringify(meetings));
}

/**
 * Get meeting link for a booking
 */
export function getMeetingForBooking(bookingDate: string): MeetingDetails | null {
  const meetings = JSON.parse(localStorage.getItem('virtual_meetings') || '[]');
  return meetings.find((m: any) => {
    const d = new Date(m.startAt);
    const date = d.toISOString().split('T')[0];
    return date === bookingDate;
  }) || null;
}
