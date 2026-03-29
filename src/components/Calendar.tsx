import { useState, useEffect } from 'react';
import { format, addDays, startOfWeek, addWeeks, isSameDay, isToday, parseISO, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon, Check } from 'lucide-react';
import type { Booking } from '@/types/booking';
import { syncBookingsWithSquare, isSquareConfigured } from '@/api/square';

interface CalendarProps {
  onSelectSlot?: (date: Date, time: string) => void;
  selectable?: boolean;
  showBookings?: boolean;
}

interface CalendarBooking extends Booking {
  displayTime?: string;
}

export default function Calendar({ onSelectSlot, selectable = false, showBookings = true }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [view, setView] = useState<'month' | 'week'>('week');

  // Load bookings on mount and sync with Square
  useEffect(() => {
    loadBookings();
    syncWithSquare();
  }, []);

  const loadBookings = () => {
    // Load from localStorage (includes both website and Square bookings)
    const websiteBookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const squareBookings = JSON.parse(localStorage.getItem('square_bookings') || '[]');
    
    const allBookings = [...websiteBookings, ...squareBookings]
      .filter((b: Booking) => b.status !== 'cancelled')
      .sort((a: Booking, b: Booking) => 
        new Date(a.date + 'T' + a.time).getTime() - new Date(b.date + 'T' + b.time).getTime()
      );
    
    setBookings(allBookings);
  };

  const syncWithSquare = async () => {
    setIsSyncing(true);
    try {
      const result = await syncBookingsWithSquare();
      if (result.synced > 0) {
        loadBookings();
      }
      setLastSynced(new Date().toISOString());
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Calendar navigation
  const navigatePrevious = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, -1));
    } else {
      setCurrentDate(addWeeks(currentDate, -1));
    }
  };

  const navigateNext = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, 1));
    } else {
      setCurrentDate(addWeeks(currentDate, 1));
    }
  };

  const navigateToday = () => {
    setCurrentDate(new Date());
  };

  // Generate calendar days
  const getCalendarDays = () => {
    if (view === 'month') {
      const start = startOfMonth(currentDate);
      const startDay = start.getDay();
      const days: Date[] = [];
      
      // Add days from previous month
      for (let i = startDay; i > 0; i--) {
        days.push(addDays(start, -i));
      }
      
      // Add days of current month
      const end = endOfMonth(currentDate);
      for (let i = 0; i <= end.getDate() - 1; i++) {
        days.push(addDays(start, i));
      }
      
      // Add days from next month to fill grid
      const remainingDays = 42 - days.length;
      for (let i = 1; i <= remainingDays; i++) {
        days.push(addDays(end, i));
      }
      
      return days;
    } else {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    }
  };

  // Get bookings for a specific date
  const getBookingsForDate = (date: Date) => {
    return bookings.filter(b => {
      const bookingDate = new Date(b.date);
      return isSameDay(bookingDate, date);
    });
  };

  // Handle date selection
  const handleDateClick = (date: Date) => {
    if (selectable) {
      setSelectedDate(date);
    }
  };

  // Handle time slot selection
  const handleTimeSelect = (time: string) => {
    if (selectable && selectedDate && onSelectSlot) {
      onSelectSlot(selectedDate, time);
    }
  };

  const calendarDays = getCalendarDays();
  const selectedDateBookings = selectedDate ? getBookingsForDate(selectedDate) : [];

  return (
    <div className="bg-[#0B0B0D] border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-display font-bold text-white">
            {format(currentDate, view === 'month' ? 'MMMM yyyy' : "MMMM yyyy")}
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={navigatePrevious}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <ChevronLeft size={18} className="text-white" />
            </button>
            <button
              onClick={navigateToday}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors"
            >
              Today
            </button>
            <button
              onClick={navigateNext}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <ChevronRight size={18} className="text-white" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                view === 'week' ? 'bg-[#FF4D2E] text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                view === 'month' ? 'bg-[#FF4D2E] text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Month
            </button>
          </div>

          {/* Sync Button */}
          <button
            onClick={syncWithSquare}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors disabled:opacity-50"
          >
            <div className={`w-4 h-4 border-2 border-current border-t-transparent rounded-full ${isSyncing ? 'animate-spin' : ''}`} />
            {isSquareConfigured() ? 'Sync' : 'Demo'}
          </button>
        </div>
      </div>

      {/* Last Synced */}
      {lastSynced && (
        <div className="px-4 py-2 bg-white/5 text-white/40 text-xs flex items-center justify-between">
          <span>
            Last synced: {format(parseISO(lastSynced), 'MMM d, h:mm a')}
          </span>
          <span className="flex items-center gap-1">
            <Check size={12} className="text-green-500" />
            {bookings.length} bookings
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3">
        {/* Calendar Grid */}
        <div className={`${selectable ? 'lg:col-span-2' : 'lg:col-span-3'} p-4`}>
          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <div key={day} className="text-center text-white/40 text-xs py-2 font-medium">
                {day}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, index) => {
              const isCurrentMonth = date.getMonth() === currentDate.getMonth();
              const isSelected = selectedDate && isSameDay(date, selectedDate);
              const dayBookings = getBookingsForDate(date);
              const hasBooking = dayBookings.length > 0;
              const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

              return (
                <button
                  key={index}
                  onClick={() => handleDateClick(date)}
                  disabled={isPast && !selectable}
                  className={`
                    aspect-square rounded-lg flex flex-col items-center justify-center relative transition-all
                    ${isSelected 
                      ? 'bg-[#FF4D2E] text-white' 
                      : isCurrentMonth
                        ? 'bg-white/5 text-white hover:bg-white/10'
                        : 'bg-white/[0.02] text-white/30'
                    }
                    ${isPast && !selectable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <span className={`font-medium ${isToday(date) ? 'text-[#FF4D2E]' : ''}`}>
                    {format(date, 'd')}
                  </span>
                  
                  {/* Booking Indicator */}
                  {hasBooking && showBookings && (
                    <div className="absolute bottom-1 flex gap-0.5">
                      {dayBookings.slice(0, 3).map((_, i) => (
                        <div 
                          key={i} 
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? 'bg-white' : 'bg-[#FF4D2E]'
                          }`} 
                        />
                      ))}
                      {dayBookings.length > 3 && (
                        <span className={`text-[8px] ${isSelected ? 'text-white' : 'text-[#FF4D2E]'}`}>
                          +{dayBookings.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Date Details / Time Slots */}
        {selectable && selectedDate && (
          <div className="border-t lg:border-t-0 lg:border-l border-white/10 p-4">
            <h4 className="text-white font-medium mb-3 flex items-center gap-2">
              <CalendarIcon size={18} className="text-[#FF4D2E]" />
              {format(selectedDate, 'EEEE, MMM d')}
            </h4>

            {selectedDateBookings.length > 0 ? (
              <div className="space-y-2 mb-4">
                <p className="text-white/60 text-sm">Booked slots:</p>
                {selectedDateBookings.map((booking, index) => (
                  <div 
                    key={index}
                    className="bg-white/5 rounded-lg p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white text-sm font-medium">{booking.time}</p>
                      <p className="text-white/50 text-xs">{booking.name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${
                        booking.status === 'confirmed' ? 'bg-green-500' : 'bg-yellow-500'
                      }`} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-white/40 text-sm mb-4">No bookings for this date</p>
            )}

            {/* Available Time Slots */}
            <div>
              <p className="text-white/60 text-sm mb-2">Available times:</p>
              <div className="grid grid-cols-2 gap-2">
                {['7:30 AM', '9:00 AM', '10:30 AM', '2:00 PM', '3:30 PM', '5:00 PM'].map(time => {
                  const isBooked = selectedDateBookings.some(b => b.time === time);
                  return (
                    <button
                      key={time}
                      onClick={() => handleTimeSelect(time)}
                      disabled={isBooked}
                      className={`
                        py-2 px-3 rounded-lg text-sm transition-all
                        ${isBooked
                          ? 'bg-white/5 text-white/30 cursor-not-allowed line-through'
                          : 'bg-white/10 text-white hover:bg-[#FF4D2E]'
                        }
                      `}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Upcoming Bookings List */}
      {showBookings && bookings.length > 0 && (
        <div className="border-t border-white/10 p-4">
          <h4 className="text-white font-medium mb-3 flex items-center gap-2">
            <Clock size={18} className="text-[#FF4D2E]" />
            Upcoming Bookings
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {bookings
              .filter(b => new Date(b.date) >= new Date(new Date().setHours(0, 0, 0, 0)))
              .slice(0, 10)
              .map((booking, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between bg-white/5 rounded-lg p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#FF4D2E]/20 flex items-center justify-center">
                      <span className="text-[#FF4D2E] text-sm font-bold">
                        {format(new Date(booking.date), 'd')}
                      </span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{booking.name}</p>
                      <p className="text-white/50 text-xs">
                        {format(new Date(booking.date), 'EEE, MMM d')} at {booking.time}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs ${
                      booking.status === 'confirmed' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {booking.status}
                    </span>
                    {booking.squareAppointmentId && (
                      <span className="text-white/30 text-xs" title="Synced with Square">
                        S
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
