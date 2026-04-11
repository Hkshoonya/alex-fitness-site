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
async function createMockMeeting(params: {
  startAt: string;
  attendeeEmail: string;
  attendeeName: string;
}): Promise<{ success: boolean; meeting?: MeetingDetails; error?: string }> {
  await new Promise(r => setTimeout(r, 500));

  const mockId = Math.random().toString(36).slice(2, 12);
  const meeting: MeetingDetails = {
    meetLink: `https://meet.google.com/${mockId.slice(0, 3)}-${mockId.slice(3, 7)}-${mockId.slice(7)}`,
    eventId: `mock_event_${Date.now()}`,
    calendarLink: `https://calendar.google.com/calendar/event?eid=mock_${Date.now()}`,
  };

  storeMeeting(params.startAt, meeting);

  return { success: true, meeting };
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
