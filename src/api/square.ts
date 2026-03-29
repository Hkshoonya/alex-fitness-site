// Square API Integration Module
// This module handles all interactions with Square API for booking management

import type { Booking, BookingRequest, BookingResponse } from '@/types/booking';
import { getSquareConfig, getSquareHeaders, getConsultationServiceId, SQUARE_API_BASE } from '@/api/squareConfig';

const { locationId: SQUARE_LOCATION_ID } = getSquareConfig();
const SQUARE_SERVICE_ID = getConsultationServiceId();

// Business hours configuration
const BUSINESS_HOURS = {
  monday: { open: '07:30', close: '20:00' },
  tuesday: { open: '07:30', close: '20:00' },
  wednesday: { open: '07:30', close: '20:00' },
  thursday: { open: '07:30', close: '20:00' },
  friday: { open: '07:30', close: '20:00' },
  saturday: { open: '09:00', close: '18:00' },
  sunday: { open: '09:00', close: '18:00' },
};

// Consultation duration in minutes
const CONSULTATION_DURATION = 30;

/**
 * Check if Square API is configured
 */
export const isSquareConfigured = (): boolean => {
  return getSquareConfig().isConfigured;
};

const getHeaders = () => getSquareHeaders();

/**
 * Create a new booking in Square
 */
export const createSquareBooking = async (booking: BookingRequest): Promise<BookingResponse> => {
  // If Square is not configured, use mock mode
  if (!isSquareConfigured()) {
    console.log('Square not configured - using mock booking');
    return createMockBooking(booking);
  }

  try {
    // Calculate appointment time
    const [hours, minutes] = booking.time.split(':').map(Number);
    const startAt = new Date(booking.date);
    startAt.setHours(hours, minutes, 0, 0);

    // Create appointment in Square
    const response = await fetch(`${SQUARE_API_BASE}/bookings`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        booking: {
          location_id: SQUARE_LOCATION_ID,
          service_name: booking.service,
          appointment_segments: [{
            duration_minutes: booking.duration,
            service_variation: {
              scope: 'CATALOG',
              catalog_object_id: SQUARE_SERVICE_ID,
            },
            team_member_id: '', // Will be assigned automatically
          }],
          start_at: startAt.toISOString(),
          customer_note: `Goals: ${booking.goals || 'Not specified'}`,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.errors?.[0]?.detail || 'Failed to create booking');
    }

    const data = await response.json();

    return {
      success: true,
      booking: {
        id: generateBookingId(),
        ...booking,
        status: 'confirmed',
        squareAppointmentId: data.booking.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('Square booking error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create booking',
    };
  }
};

/**
 * Get available time slots for a specific date
 */
export const getAvailableSlots = async (date: string): Promise<string[]> => {
  if (!isSquareConfigured()) {
    return getMockAvailableSlots(date);
  }

  try {
    // Get bookings for the date from Square
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await fetch(
      `${SQUARE_API_BASE}/bookings?location_id=${SQUARE_LOCATION_ID}&start_at_min=${startOfDay.toISOString()}&start_at_max=${endOfDay.toISOString()}`,
      { headers: getHeaders() }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch bookings');
    }

    const data = await response.json();
    const bookedSlots = data.bookings?.map((b: { start_at: string }) => {
      const date = new Date(b.start_at);
      return formatTime(date.getHours(), date.getMinutes());
    }) || [];

    // Generate all possible slots and filter out booked ones
    const dayOfWeek = new Date(date).getDay();
    const hours = getBusinessHoursForDay(dayOfWeek);
    const allSlots = generateTimeSlots(hours.open, hours.close, CONSULTATION_DURATION);

    return allSlots.filter(slot => !bookedSlots.includes(slot));
  } catch (error) {
    console.error('Error fetching available slots:', error);
    return getMockAvailableSlots(date);
  }
};

/**
 * Cancel a booking in Square
 */
export const cancelSquareBooking = async (bookingId: string): Promise<boolean> => {
  if (!isSquareConfigured()) {
    return true; // Mock success
  }

  try {
    const response = await fetch(`${SQUARE_API_BASE}/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: getHeaders(),
    });

    return response.ok;
  } catch (error) {
    console.error('Error cancelling booking:', error);
    return false;
  }
};

/**
 * Sync bookings with Square
 */
export const syncBookingsWithSquare = async (): Promise<{ synced: number; errors: number }> => {
  if (!isSquareConfigured()) {
    return { synced: 0, errors: 0 };
  }

  try {
    // Get all bookings from Square for the next 30 days
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const response = await fetch(
      `${SQUARE_API_BASE}/bookings?location_id=${SQUARE_LOCATION_ID}&start_at_min=${startDate.toISOString()}&start_at_max=${endDate.toISOString()}`,
      { headers: getHeaders() }
    );

    if (!response.ok) {
      throw new Error('Failed to sync bookings');
    }

    const data = await response.json();
    
    // Process and store bookings locally
    const bookings = data.bookings?.map((squareBooking: {
      id: string;
      start_at: string;
      appointment_segments: { duration_minutes: number }[];
      customer_note?: string;
    }) => ({
      id: squareBooking.id,
      date: squareBooking.start_at.split('T')[0],
      time: formatTime(
        new Date(squareBooking.start_at).getHours(),
        new Date(squareBooking.start_at).getMinutes()
      ),
      duration: squareBooking.appointment_segments?.[0]?.duration_minutes || 30,
      notes: squareBooking.customer_note,
    })) || [];

    // Store in localStorage for the website calendar
    localStorage.setItem('square_bookings', JSON.stringify(bookings));

    return { synced: bookings.length, errors: 0 };
  } catch (error) {
    console.error('Sync error:', error);
    return { synced: 0, errors: 1 };
  }
};

// Helper functions

const generateBookingId = (): string => {
  return `bk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const formatTime = (hours: number, minutes: number): string => {
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
};

const getBusinessHoursForDay = (dayOfWeek: number): { open: string; close: string } => {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const day = days[dayOfWeek] as keyof typeof BUSINESS_HOURS;
  return BUSINESS_HOURS[day];
};

const generateTimeSlots = (open: string, close: string, duration: number): string[] => {
  const slots: string[] = [];
  const [openHour, openMin] = open.split(':').map(Number);
  const [closeHour, closeMin] = close.split(':').map(Number);
  
  let currentHour = openHour;
  let currentMin = openMin;
  
  while (currentHour < closeHour || (currentHour === closeHour && currentMin < closeMin)) {
    slots.push(formatTime(currentHour, currentMin));
    
    currentMin += duration;
    if (currentMin >= 60) {
      currentHour += Math.floor(currentMin / 60);
      currentMin = currentMin % 60;
    }
  }
  
  return slots;
};

// Mock functions for development/testing

const createMockBooking = async (booking: BookingRequest): Promise<BookingResponse> => {
  // Simulate API delay
  return new Promise((resolve) => {
    setTimeout(() => {
      const newBooking: Booking = {
        id: generateBookingId(),
        ...booking,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Store in localStorage for demo
      const existing = JSON.parse(localStorage.getItem('bookings') || '[]');
      existing.push(newBooking);
      localStorage.setItem('bookings', JSON.stringify(existing));

      resolve({
        success: true,
        booking: newBooking,
        message: 'Booking confirmed!',
      });
    }, 1500);
  });
};

const getMockAvailableSlots = (date: string): string[] => {
  const dayOfWeek = new Date(date).getDay();
  const hours = getBusinessHoursForDay(dayOfWeek);
  const allSlots = generateTimeSlots(hours.open, hours.close, CONSULTATION_DURATION);
  
  // Get booked slots from localStorage
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  const bookedSlots = bookings
    .filter((b: Booking) => b.date === date && b.status !== 'cancelled')
    .map((b: Booking) => b.time);
  
  // Also check Square bookings
  const squareBookings = JSON.parse(localStorage.getItem('square_bookings') || '[]');
  const squareBookedSlots = squareBookings
    .filter((b: { date: string }) => b.date === date)
    .map((b: { time: string }) => b.time);
  
  return allSlots.filter(slot => 
    !bookedSlots.includes(slot) && !squareBookedSlots.includes(slot)
  );
};

// Export business hours for calendar display
export const getBusinessHours = () => BUSINESS_HOURS;
export const getConsultationDuration = () => CONSULTATION_DURATION;
