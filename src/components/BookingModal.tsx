import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Clock, Calendar, Check, Phone, Mail, User, MapPin, Video, Dumbbell, Users } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, isSameDay, isToday } from 'date-fns';
import { getAvailability, getTeamMembers, createBooking, type TimeSlot, type TeamMember } from '@/api/squareAvailability';
import { createMeetEvent, type MeetingDetails } from '@/api/googleMeet';
// Trainerize sync handled automatically inside createBooking

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  showChoice?: boolean; // true = show Session/Consultation choice; false = go straight to consultation
}

type BookingMode = null | 'session' | 'consultation';
type SessionType = 'in-studio' | 'virtual';

const DEFAULT_COACH = 'alex-davis';

export default function BookingModal({ isOpen, onClose, showChoice = false }: BookingModalProps) {
  // Flow state
  const [mode, setMode] = useState<BookingMode>(null);
  const [step, setStep] = useState<'choose' | 'duration' | 'coach' | 'type' | 'calendar' | 'details' | 'success'>('choose');

  // Session config
  const [sessionDuration, setSessionDuration] = useState(60);
  const [sessionType, setSessionType] = useState<SessionType>('in-studio');
  const [selectedCoach, setSelectedCoach] = useState<TeamMember | null>(null);
  const [coaches, setCoaches] = useState<TeamMember[]>([]);

  // Calendar
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedStartAt, setSelectedStartAt] = useState<string | null>(null);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);

  // Submit
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [meetDetails, setMeetDetails] = useState<MeetingDetails | null>(null);
  const [bookingData, setBookingData] = useState({ name: '', email: '', phone: '', goals: '' });

  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), currentWeekOffset);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Set initial state based on showChoice prop
      if (showChoice) {
        setMode(null);
        setStep('choose');
      } else {
        setMode('consultation');
        setSessionDuration(30);
        setStep('type');
      }
      loadCoaches();
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const loadCoaches = async () => {
    const team = await getTeamMembers();
    setCoaches(team.filter(m => m.role !== 'consultation'));
  };

  const resetState = () => {
    setMode(showChoice ? null : 'consultation');
    setStep(showChoice ? 'choose' : 'type');
    setSessionDuration(60);
    setSessionType('in-studio');
    setSelectedCoach(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setSelectedStartAt(null);
    setTimeSlots([]);
    setCurrentWeekOffset(0);
    setMeetDetails(null);
    setBookingData({ name: '', email: '', phone: '', goals: '' });
  };

  // --- Handlers ---

  const handleSessionMode = () => {
    setMode('session');
    setStep('duration');
  };

  const handleConsultationMode = () => {
    setMode('consultation');
    setSessionDuration(30);
    setStep('type'); // go straight to in-studio/virtual
  };

  const handleDurationSelect = (dur: number) => {
    setSessionDuration(dur);
    setStep('coach');
  };

  const handleCoachSelect = (coach: TeamMember) => {
    setSelectedCoach(coach);
    setStep('type');
  };

  const handleTypeSelect = (type: SessionType) => {
    setSessionType(type);
    setStep('calendar');
  };

  const loadSlots = async (date: Date) => {
    setIsLoadingSlots(true);
    const coachId = mode === 'consultation' ? DEFAULT_COACH : (selectedCoach?.id || DEFAULT_COACH);
    const dateStr = date.toISOString().split('T')[0];
    const avail = await getAvailability(dateStr, coachId, sessionDuration);
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

    const coachId = mode === 'consultation' ? DEFAULT_COACH : (selectedCoach?.id || DEFAULT_COACH);
    let meetLink = '';

    if (sessionType === 'virtual') {
      const title = mode === 'consultation'
        ? `Free Consultation — ${bookingData.name}`
        : `${sessionDuration} Min Session — ${bookingData.name}`;
      const meetResult = await createMeetEvent({
        title,
        startAt: selectedStartAt,
        durationMinutes: sessionDuration,
        attendeeEmail: bookingData.email,
        attendeeName: bookingData.name,
        description: `${mode === 'consultation' ? 'Free consultation' : 'Training session'} with Alex Davis Fitness\n\nGoals: ${bookingData.goals || 'Not specified'}`,
      });
      if (meetResult.success && meetResult.meeting) {
        setMeetDetails(meetResult.meeting);
        meetLink = meetResult.meeting.meetLink;
      }
    }

    const label = mode === 'consultation' ? 'Free Consultation' : `${sessionDuration} Min Session`;
    const result = await createBooking(coachId, selectedStartAt, sessionDuration, {
      name: bookingData.name,
      email: bookingData.email,
      phone: bookingData.phone,
      goals: sessionType === 'virtual'
        ? `[Virtual][${label}] Meet: ${meetLink}\n${bookingData.goals}`
        : `[In-Studio][${label}] ${bookingData.goals}`,
    });

    setIsSubmitting(false);
    if (result.success) {
      setStep('success');

      // Trainerize sync happens automatically inside createBooking
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setBookingData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleBack = () => {
    if (step === 'details') setStep('calendar');
    else if (step === 'calendar') setStep('type');
    else if (step === 'type' && mode === 'session') setStep('coach');
    else if (step === 'type' && mode === 'consultation' && showChoice) setStep('choose');
    else if (step === 'type' && mode === 'consultation' && !showChoice) onClose();
    else if (step === 'coach') setStep('duration');
    else if (step === 'duration') setStep('choose');
    else setStep('choose');
  };

  const isPast = (date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0));

  // --- Header title ---
  const getTitle = () => {
    if (step === 'success') return 'Booking Confirmed!';
    if (step === 'choose') return 'Book Now';
    if (mode === 'consultation') return 'Book Free Consultation';
    return 'Book Session';
  };

  const getSubtitle = () => {
    if (step === 'choose' || step === 'success') return null;
    if (step === 'duration') return 'Select session length';
    if (step === 'coach') return 'Choose your coach';
    if (step === 'type') return 'In-studio or virtual?';
    if (step === 'calendar') return `${sessionDuration} min · ${sessionType === 'in-studio' ? 'In-Studio' : 'Virtual'}${selectedCoach ? ` · ${selectedCoach.name}` : ''}`;
    if (step === 'details') return 'Your details';
    return null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-display font-bold text-white">{getTitle()}</h2>
            {getSubtitle() && <p className="text-white/60 text-sm mt-1">{getSubtitle()}</p>}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">

          {/* ===== CHOOSE: Session or Consultation ===== */}
          {step === 'choose' && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleSessionMode}
                className="flex flex-col items-center gap-4 p-8 rounded-2xl border border-white/10 bg-white/5 hover:border-[#FF4D2E]/30 hover:bg-white/[0.07] transition-all group"
              >
                <div className="w-16 h-16 rounded-2xl bg-[#FF4D2E]/20 flex items-center justify-center group-hover:bg-[#FF4D2E] transition-colors">
                  <Dumbbell size={28} className="text-[#FF4D2E] group-hover:text-white transition-colors" />
                </div>
                <div className="text-center">
                  <p className="text-white font-display font-bold text-lg mb-1">Book Session</p>
                  <p className="text-white/40 text-xs">30 or 60 min</p>
                  <p className="text-white/40 text-xs">Choose your coach</p>
                </div>
              </button>

              <button
                onClick={handleConsultationMode}
                className="flex flex-col items-center gap-4 p-8 rounded-2xl border border-white/10 bg-white/5 hover:border-[#FF4D2E]/30 hover:bg-white/[0.07] transition-all group"
              >
                <div className="w-16 h-16 rounded-2xl bg-green-500/20 flex items-center justify-center group-hover:bg-green-500 transition-colors">
                  <Calendar size={28} className="text-green-400 group-hover:text-white transition-colors" />
                </div>
                <div className="text-center">
                  <p className="text-white font-display font-bold text-lg mb-1">Free Consultation</p>
                  <p className="text-white/40 text-xs">30 min</p>
                  <p className="text-green-400/70 text-xs font-medium">No charge</p>
                </div>
              </button>
            </div>
          )}

          {/* ===== DURATION (Session only) ===== */}
          {step === 'duration' && (
            <div className="grid grid-cols-2 gap-4">
              {[30, 60].map(dur => (
                <button
                  key={dur}
                  onClick={() => handleDurationSelect(dur)}
                  className={`flex flex-col items-center gap-3 p-8 rounded-2xl border transition-all hover:border-[#FF4D2E]/30 hover:bg-white/[0.07] group ${
                    sessionDuration === dur ? 'border-[#FF4D2E] bg-[#FF4D2E]/10' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                    sessionDuration === dur ? 'bg-[#FF4D2E]' : 'bg-white/10 group-hover:bg-white/20'
                  }`}>
                    <Clock size={24} className="text-white" />
                  </div>
                  <p className="text-white font-display font-bold text-2xl">{dur}</p>
                  <p className="text-white/50 text-sm">minutes</p>
                </button>
              ))}
            </div>
          )}

          {/* ===== COACH (Session only) ===== */}
          {step === 'coach' && (
            <div className="space-y-3">
              {coaches.map(coach => (
                <button
                  key={coach.id}
                  onClick={() => handleCoachSelect(coach)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:border-[#FF4D2E]/30 hover:bg-white/[0.07] transition-all text-left group"
                >
                  <img src={coach.image} alt={coach.name} className="w-14 h-14 rounded-xl object-cover object-top" />
                  <div className="flex-1">
                    <p className="text-white font-semibold flex items-center gap-2 group-hover:text-[#FF4D2E] transition-colors">
                      {coach.name}
                      {coach.role === 'head-coach' && (
                        <span className="bg-[#FF4D2E] text-white text-[10px] px-2 py-0.5 rounded-full">Head Coach</span>
                      )}
                    </p>
                    <p className="text-white/50 text-sm">{coach.title}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {coach.specialties.slice(0, 3).map(s => (
                        <span key={s} className="text-white/30 text-[10px] bg-white/5 px-1.5 py-0.5 rounded">{s}</span>
                      ))}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-white/30 group-hover:text-[#FF4D2E] transition-colors" />
                </button>
              ))}
            </div>
          )}

          {/* ===== TYPE: In-Studio / Virtual ===== */}
          {step === 'type' && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleTypeSelect('in-studio')}
                className="flex flex-col items-center gap-4 p-8 rounded-2xl border border-white/10 bg-white/5 hover:border-[#FF4D2E]/30 hover:bg-white/[0.07] transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center group-hover:bg-[#FF4D2E] transition-colors">
                  <MapPin size={24} className="text-white" />
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold">In-Studio</p>
                  <p className="text-white/40 text-xs">Private gym session</p>
                </div>
              </button>

              <button
                onClick={() => handleTypeSelect('virtual')}
                className="flex flex-col items-center gap-4 p-8 rounded-2xl border border-white/10 bg-white/5 hover:border-[#FF4D2E]/30 hover:bg-white/[0.07] transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center group-hover:bg-[#FF4D2E] transition-colors">
                  <Video size={24} className="text-white" />
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold">Virtual</p>
                  <p className="text-white/40 text-xs">Video call session</p>
                </div>
              </button>
            </div>
          )}

          {/* ===== CALENDAR ===== */}
          {step === 'calendar' && (
            <div>
              {/* Week navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCurrentWeekOffset(p => Math.max(0, p - 1))} disabled={currentWeekOffset === 0}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={20} className="text-white" />
                </button>
                <span className="text-white font-medium">{format(weekStart, 'MMMM yyyy')}</span>
                <button onClick={() => setCurrentWeekOffset(p => p + 1)} disabled={currentWeekOffset >= 3}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors">
                  <ChevronRight size={20} className="text-white" />
                </button>
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-2 mb-6">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="text-center text-white/40 text-xs py-2">{d}</div>
                ))}
                {weekDates.map((date, i) => {
                  const sel = selectedDate && isSameDay(date, selectedDate);
                  const past = isPast(date);
                  return (
                    <button key={i} onClick={() => !past && handleDateSelect(date)} disabled={past}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all ${
                        sel ? 'bg-[#FF4D2E] text-white'
                          : !past ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                          : 'bg-white/5 text-white/30 cursor-not-allowed'
                      }`}>
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
                  ) : timeSlots.filter(s => s.available).length === 0 ? (
                    <p className="text-white/40 text-sm py-4 text-center">No availability — try another date</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {timeSlots.map(slot => (
                        <button key={slot.time} onClick={() => handleTimeSelect(slot)} disabled={!slot.available}
                          className={`py-3 px-4 rounded-lg text-sm font-medium transition-all ${
                            selectedTime === slot.time ? 'bg-[#FF4D2E] text-white'
                              : slot.available ? 'bg-white/10 text-white hover:bg-white/20'
                              : 'bg-white/5 text-white/30 cursor-not-allowed line-through'
                          }`}>
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
              <div className="bg-white/5 rounded-lg p-4 mb-6 space-y-2">
                <div className="flex items-center gap-3 text-white">
                  <Dumbbell size={18} className="text-[#FF4D2E]" />
                  <span className="font-medium">{mode === 'consultation' ? 'Free Consultation' : 'Training Session'} · {sessionDuration} min</span>
                </div>
                <div className="flex items-center gap-3 text-white">
                  {sessionType === 'in-studio' ? <MapPin size={18} className="text-[#FF4D2E]" /> : <Video size={18} className="text-[#FF4D2E]" />}
                  <span>{sessionType === 'in-studio' ? 'In-Studio' : 'Virtual'}</span>
                </div>
                {selectedCoach && (
                  <div className="flex items-center gap-3 text-white">
                    <Users size={18} className="text-[#FF4D2E]" />
                    <span>{selectedCoach.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-white">
                  <Calendar size={18} className="text-[#FF4D2E]" />
                  <span>{selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}</span>
                </div>
                <div className="flex items-center gap-3 text-white">
                  <Clock size={18} className="text-[#FF4D2E]" />
                  <span>{selectedTime}</span>
                </div>
                <button type="button" onClick={() => setStep('calendar')} className="text-[#FF4D2E] text-sm mt-2 hover:underline">Change</button>
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
              <p className="text-white/70 mb-4">
                Your {mode === 'consultation' ? 'free consultation' : `${sessionDuration}-min session`} is booked:
              </p>
              <div className="bg-white/5 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-center gap-2 text-white/60 text-sm mb-2">
                  {sessionType === 'in-studio' ? <MapPin size={14} /> : <Video size={14} />}
                  {sessionType === 'in-studio' ? 'In-Studio' : 'Virtual'}
                  {selectedCoach && <span>· {selectedCoach.name}</span>}
                </div>
                <p className="text-white font-semibold">{selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
                <p className="text-[#FF4D2E]">{selectedTime} · {sessionDuration} min</p>
              </div>

              {sessionType === 'virtual' && meetDetails && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-center gap-2 text-white/60 text-sm mb-3">
                    <Video size={16} className="text-green-400" />
                    <span>Google Meet link created</span>
                  </div>
                  <a href={meetDetails.meetLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#FF4D2E] text-white px-6 py-3 rounded-full font-semibold text-sm hover:bg-[#e54327] transition-colors">
                    <Video size={16} /> Join Meeting
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
              <p className="text-white/60 text-sm mb-6">Confirmation sent to {bookingData.email}</p>

              <button
                onClick={() => { onClose(); resetState(); }}
                className="btn-primary text-sm"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'success' && step !== 'choose' && (
          <div className="p-6 border-t border-white/10 flex gap-3">
            <button onClick={handleBack} className="flex-shrink-0 py-3 px-5 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors text-sm">
              ← Back
            </button>

            {step === 'calendar' && (
              <button onClick={() => setStep('details')} disabled={!selectedDate || !selectedTime}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                Continue
              </button>
            )}

            {step === 'details' && (
              <button onClick={handleSubmit} disabled={isSubmitting || !bookingData.name || !bookingData.email || !bookingData.phone}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Booking...</>
                ) : 'Confirm Booking'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
