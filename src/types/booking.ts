export interface Booking {
  id: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  service: string;
  duration: number;
  goals?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  squareAppointmentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeSlot {
  time: string;
  available: boolean;
  bookingId?: string;
}

export interface DayAvailability {
  date: string;
  slots: TimeSlot[];
  isAvailable: boolean;
}

export interface BookingRequest {
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  service: string;
  duration: number;
  goals?: string;
}

export interface BookingResponse {
  success: boolean;
  booking?: Booking;
  error?: string;
  message?: string;
}

export interface CalendarSyncStatus {
  lastSynced: string;
  syncedBookings: number;
  pendingBookings: number;
  isSyncing: boolean;
}
