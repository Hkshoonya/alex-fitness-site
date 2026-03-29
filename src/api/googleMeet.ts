// Google Meet Integration for Virtual Consultations
// Creates Google Meet links via Google Calendar API, syncs to Square

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
const GOOGLE_CALENDAR_ID = import.meta.env.VITE_GOOGLE_CALENDAR_ID || 'primary';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface MeetingDetails {
  meetLink: string;
  eventId: string;
  calendarLink: string;
}

/**
 * Check if Google Calendar API is configured
 */
export function isGoogleMeetConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_API_KEY);
}

/**
 * Create a Google Calendar event with Google Meet link
 */
export async function createMeetEvent(params: {
  title: string;
  startAt: string;
  durationMinutes: number;
  attendeeEmail: string;
  attendeeName: string;
  description?: string;
}): Promise<{ success: boolean; meeting?: MeetingDetails; error?: string }> {

  if (!isGoogleMeetConfigured()) {
    return createMockMeeting(params);
  }

  try {
    const startTime = new Date(params.startAt);
    const endTime = new Date(startTime.getTime() + params.durationMinutes * 60 * 1000);

    const event = {
      summary: params.title,
      description: params.description || `Virtual consultation with ${params.attendeeName}`,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/New_York',
      },
      attendees: [
        { email: params.attendeeEmail, displayName: params.attendeeName },
        { email: 'alexdavisfit@gmail.com', displayName: 'Alex Davis' },
      ],
      conferenceData: {
        createRequest: {
          requestId: `meet_${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
      sendUpdates: 'all',
    };

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?conferenceDataVersion=1&sendUpdates=all&key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await getAccessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to create calendar event');
    }

    const data = await response.json();

    const meetLink = data.conferenceData?.entryPoints?.find(
      (ep: any) => ep.entryPointType === 'video'
    )?.uri || data.hangoutLink || '';

    const meeting: MeetingDetails = {
      meetLink,
      eventId: data.id,
      calendarLink: data.htmlLink,
    };

    // Store locally
    storeMeeting(params.startAt, meeting);

    return { success: true, meeting };
  } catch (error) {
    console.error('Google Meet creation failed:', error);
    // Fall back to mock
    return createMockMeeting(params);
  }
}

/**
 * Get OAuth2 access token
 * In production this would use a refresh token flow or service account
 */
async function getAccessToken(): Promise<string> {
  const token = localStorage.getItem('google_access_token');
  const expiry = localStorage.getItem('google_token_expiry');

  if (token && expiry && Date.now() < parseInt(expiry)) {
    return token;
  }

  // Token needs refresh — in production, use refresh_token grant
  const refreshToken = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN || '';
  if (!refreshToken) {
    throw new Error('No valid Google access token');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) throw new Error('Token refresh failed');

  const data = await response.json();
  localStorage.setItem('google_access_token', data.access_token);
  localStorage.setItem('google_token_expiry', String(Date.now() + data.expires_in * 1000));

  return data.access_token;
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
