import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Clock, Calendar, Check, Phone, Mail, User, MapPin, Video } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, isSameDay, isToday } from 'date-fns';
import { getAvailability, createBooking, type TimeSlot } from '@/api/squareAvailability';
import { createMeetEvent, type MeetingDetails } from '@/api/googleMeet';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SessionType = 'in-studio' | 'virtual';

const CONSULTATION_COACH = 'alex-davis';
const CONSULTATION_DURATION = 30;

export default function BookingModal({ isOpen, onClose }: BookingModalProps) {
  const [step, setStep] = useState<'calendar' | 'details' | 'success'>('calendar');
  const [sessionType, setSessionType] = useState<SessionType>('in-studio');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedStartAt, setSelectedStartAt] = useState<string | null>(null);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [meetDetails, setMeetDetails] = useState<MeetingDetails | null>(null);
  const [bookingData, setBookingData] = useState({
    name: '', email: '', phone: '', goals: '',
  });

  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), currentWeekOffset);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
      resetState();
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const resetState = () => {
    setStep('calendar');
    setSessionType('in-studio');
    setSelectedDate(null);
    setSelectedTime(null);
    setSelectedStartAt(null);
    setTimeSlots([]);
    setCurrentWeekOffset(0);
    setMeetDetails(null);
    setBookingData({ name: '', email: '', phone: '', goals: '' });
  };

  const loadSlots = async (date: Date) => {
    setIsLoadingSlots(true);
    const dateStr = date.toISOString().split('T')[0];
    const avail = await getAvailability(dateStr, CONSULTATION_COACH, CONSULTATION_DURATION);
    setTimeSlots(avail.slots);
    setIsLoadingSlots(false);
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setSelectedTime(null);
    setSelectedStartAt(null);
    loadSlots(date);
  };

  const handleTimeSelect = (slot: TimeSlot) => {
    if (!slot.available) return;
    setSelectedTime(slot.time);
    setSelectedStartAt(slot.startAt);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStartAt) return;
    setIsSubmitting(true);

    let meetLink = '';

    // For virtual sessions, create Google Meet link first
    if (sessionType === 'virtual') {
      const meetResult = await createMeetEvent({
        title: `Free Consultation — ${bookingData.name}`,
        startAt: selectedStartAt,
        durationMinutes: CONSULTATION_DURATION,
        attendeeEmail: bookingData.email,
        attendeeName: bookingData.name,
        description: `Virtual consultation with Alex Davis Fitness\n\nClient Goals: ${bookingData.goals || 'Not specified'}`,
      });

      if (meetResult.success && meetResult.meeting) {
        setMeetDetails(meetResult.meeting);
        meetLink = meetResult.meeting.meetLink;
      }
    }

    // Create booking in Square calendar (includes meet link in notes for virtual)
    const result = await createBooking(
      CONSULTATION_COACH,
      selectedStartAt,
      CONSULTATION_DURATION,
      {
        name: bookingData.name,
        email: bookingData.email,
        phone: bookingData.phone,
        goals: sessionType === 'virtual'
          ? `[Virtual] Meet: ${meetLink}\n${bookingData.goals}`
          : `[In-Studio] ${bookingData.goals}`,
      }
    );

    setIsSubmitting(false);
    if (result.success) {
      setStep('success');
      setTimeout(() => { onClose(); resetState(); }, 4000);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setBookingData(prev => ({ ...prev, [name]: value }));
  };

  const isPast = (date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-display font-bold text-white">
              {step === 'success' ? 'Booking Confirmed!' : 'Book Free Consultation'}
            </h2>
            {step !== 'success' && (
              <p className="text-white/60 text-sm mt-1">
                {step === 'calendar' ? '30-minute free consultation' : 'Step 2 of 2'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">

          {/* ===== CALENDAR ===== */}
          {step === 'calendar' && (
            <div>
              {/* Session type toggle */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button
                  onClick={() => setSessionType('in-studio')}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                    sessionType === 'in-studio'
                      ? 'border-[#FF4D2E] bg-[#FF4D2E]/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    sessionType === 'in-studio' ? 'bg-[#FF4D2E]' : 'bg-white/10'
                  }`}>
                    <MapPin size={18} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className={`font-semibold text-sm ${sessionType === 'in-studio' ? 'text-white' : 'text-white/70'}`}>In-Studio</p>
                    <p className="text-white/40 text-xs">Private gym session</p>
                  </div>
                </button>

                <button
                  onClick={() => setSessionType('virtual')}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                    sessionType === 'virtual'
                      ? 'border-[#FF4D2E] bg-[#FF4D2E]/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    sessionType === 'virtual' ? 'bg-[#FF4D2E]' : 'bg-white/10'
                  }`}>
                    <Video size={18} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className={`font-semibold text-sm ${sessionType === 'virtual' ? 'text-white' : 'text-white/70'}`}>Virtual</p>
                    <p className="text-white/40 text-xs">Video call session</p>
                  </div>
                </button>
              </div>

              {/* Week navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setCurrentWeekOffset(prev => Math.max(0, prev - 1))}
                  disabled={currentWeekOffset === 0}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={20} className="text-white" />
                </button>
                <span className="text-white font-medium">{format(weekStart, 'MMMM yyyy')}</span>
                <button
                  onClick={() => setCurrentWeekOffset(prev => prev + 1)}
                  disabled={currentWeekOffset >= 3}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={20} className="text-white" />
                </button>
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-2 mb-6">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="text-center text-white/40 text-xs py-2">{day}</div>
                ))}
                {weekDates.map((date, index) => {
                  const isSelected = selectedDate && isSameDay(date, selectedDate);
                  const past = isPast(date);

                  return (
                    <button
                      key={index}
                      onClick={() => !past && handleDateSelect(date)}
                      disabled={past}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all ${
                        isSelected
                          ? 'bg-[#FF4D2E] text-white'
                          : !past
                            ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                            : 'bg-white/5 text-white/30 cursor-not-allowed'
                      }`}
                    >
                      <span className="font-medium">{format(date, 'd')}</span>
                      {isToday(date) && <span className="text-[10px] mt-0.5">Today</span>}
                    </button>
                  );
                })}
              </div>

              {/* Time Slots */}
              {selectedDate && (
                <div>
                  <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                    <Clock size={18} className="text-[#FF4D2E]" />
                    Available Times for {format(selectedDate, 'EEEE, MMM d')}
                  </h3>

                  {isLoadingSlots ? (
                    <div className="flex justify-center py-8">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-[#FF4D2E] rounded-full animate-spin" />
                    </div>
                  ) : timeSlots.length === 0 || timeSlots.filter(s => s.available).length === 0 ? (
                    <p className="text-white/40 text-sm py-4 text-center">No availability — try another date</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {timeSlots.map((slot) => (
                        <button
                          key={slot.time}
                          onClick={() => handleTimeSelect(slot)}
                          disabled={!slot.available}
                          className={`py-3 px-4 rounded-lg text-sm font-medium transition-all ${
                            selectedTime === slot.time
                              ? 'bg-[#FF4D2E] text-white'
                              : slot.available
                                ? 'bg-white/10 text-white hover:bg-white/20'
                                : 'bg-white/5 text-white/30 cursor-not-allowed line-through'
                          }`}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== DETAILS ===== */}
          {step === 'details' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Summary */}
              <div className="bg-white/5 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3 text-white">
                  {sessionType === 'in-studio' ? <MapPin size={18} className="text-[#FF4D2E]" /> : <Video size={18} className="text-[#FF4D2E]" />}
                  <span className="font-medium">{sessionType === 'in-studio' ? 'In-Studio Session' : 'Virtual Session'}</span>
                </div>
                <div className="flex items-center gap-3 text-white mt-2">
                  <Calendar size={18} className="text-[#FF4D2E]" />
                  <span>{selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}</span>
                </div>
                <div className="flex items-center gap-3 text-white mt-2">
                  <Clock size={18} className="text-[#FF4D2E]" />
                  <span>{selectedTime} · 30 minutes</span>
                </div>
                <button type="button" onClick={() => setStep('calendar')} className="text-[#FF4D2E] text-sm mt-3 hover:underline">
                  Change
                </button>
              </div>

              <div>
                <label className="block text-white/70 text-sm mb-2">Full Name *</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                  <input type="text" name="name" value={bookingData.name} onChange={handleInputChange} required placeholder="John Doe"
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors" />
                </div>
              </div>

              <div>
                <label className="block text-white/70 text-sm mb-2">Email *</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                  <input type="email" name="email" value={bookingData.email} onChange={handleInputChange} required placeholder="john@example.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors" />
                </div>
              </div>

              <div>
                <label className="block text-white/70 text-sm mb-2">Phone Number *</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                  <input type="tel" name="phone" value={bookingData.phone} onChange={handleInputChange} required placeholder="(813) 421-0633"
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors" />
                </div>
              </div>

              <div>
                <label className="block text-white/70 text-sm mb-2">Fitness Goals (Optional)</label>
                <textarea name="goals" value={bookingData.goals} onChange={handleInputChange} rows={3} placeholder="Tell us about your fitness goals..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors resize-none" />
              </div>
            </form>
          )}

          {/* ===== SUCCESS ===== */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-[#FF4D2E]/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="text-[#FF4D2E]" size={40} />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">You're all set!</h3>
              <p className="text-white/70 mb-4">Your free consultation is booked:</p>
              <div className="bg-white/5 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-center gap-2 text-white/60 text-sm mb-2">
                  {sessionType === 'in-studio' ? <MapPin size={14} /> : <Video size={14} />}
                  {sessionType === 'in-studio' ? 'In-Studio' : 'Virtual'}
                </div>
                <p className="text-white font-semibold">{selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
                <p className="text-[#FF4D2E]">{selectedTime}</p>
              </div>

              {sessionType === 'virtual' && meetDetails && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-center gap-2 text-white/60 text-sm mb-3">
                    <Video size={16} className="text-green-400" />
                    <span>Google Meet link created</span>
                  </div>
                  <a
                    href={meetDetails.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#FF4D2E] text-white px-6 py-3 rounded-full font-semibold text-sm hover:bg-[#e54327] transition-colors"
                  >
                    <Video size={16} />
                    Join Meeting
                  </a>
                  <p className="text-white/30 text-xs mt-3 font-mono break-all">{meetDetails.meetLink}</p>
                </div>
              )}

              {sessionType === 'virtual' && (
                <p className="text-white/50 text-sm mb-2">Meeting link and calendar invite sent to your email.</p>
              )}
              {sessionType === 'in-studio' && (
                <p className="text-white/50 text-sm mb-2">13305 Sanctuary Cove Dr, Temple Terrace, FL</p>
              )}
              <p className="text-white/60 text-sm">Confirmation sent to {bookingData.email}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'success' && (
          <div className="p-6 border-t border-white/10">
            {step === 'calendar' ? (
              <button
                onClick={() => setStep('details')}
                disabled={!selectedDate || !selectedTime}
                className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !bookingData.name || !bookingData.email || !bookingData.phone}
                className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Booking...
                  </>
                ) : (
                  'Confirm Booking'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
