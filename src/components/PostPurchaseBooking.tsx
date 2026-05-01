import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Clock, Check, Repeat, User, Info } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, isSameDay, isToday } from 'date-fns';
import type { TrainingPlan, Trainer } from '@/data/trainingPlans';
import { getPurchases, useSession } from '@/api/squarePayments';
import { createBooking } from '@/api/squareAvailability';

// Trainer picker uses the frontend ID ('alex1' / 'alex2'); real Square
// bookings need the Square team_member_id. Until we have a proper mapping,
// post-purchase bookings go to the default coach (Alex). Alex sees the plan
// name + client in the Square booking's customer_note so he can triage.
const DEFAULT_SQUARE_COACH = 'alex-davis';

function slotToIsoStart(date: Date, time: string): string | null {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const pm = match[3].toUpperCase() === 'PM';
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

interface PostPurchaseBookingProps {
  isOpen: boolean;
  onClose: () => void;
  plan?: TrainingPlan;
  trainer?: Trainer;
  clientInfo?: { name: string; email: string; phone: string };
}

interface BookingSlot {
  date: Date;
  time: string;
}

const timeSlots = [
  '7:30 AM', '9:00 AM', '10:30 AM', '12:00 PM',
  '2:00 PM', '3:30 PM', '5:00 PM', '6:30 PM'
];

// Generate available dates
const generateAvailableDates = (weeks: number = 4) => {
  const dates: Date[] = [];
  const today = new Date();
  
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(today, i);
    if (date.getDay() !== 0) { // Exclude Sundays
      dates.push(date);
    }
  }
  return dates;
};

export default function PostPurchaseBooking({ isOpen, onClose, plan, trainer, clientInfo }: PostPurchaseBookingProps) {
  const [step, setStep] = useState<'select' | 'calendar' | 'confirm' | 'success'>('select');
  const [selectedDates, setSelectedDates] = useState<BookingSlot[]>([]);
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [recurringOption, setRecurringOption] = useState<'none' | 'weekly' | 'biweekly'>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [bookingResults, setBookingResults] = useState<{ succeeded: number; failed: number }>({ succeeded: 0, failed: 0 });

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      loadPurchases();
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const loadPurchases = () => {
    const userPurchases = getPurchases();
    setPurchases(userPurchases.filter((p: any) => p.sessionsRemaining > 0));
  };

  const availableDates = generateAvailableDates(6);
  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), currentWeekOffset);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const handleTimeSelect = (time: string) => {
    if (!selectedDate) return;

    const newSlot = { date: selectedDate, time };
    
    // Check if already selected
    const exists = selectedDates.some(
      slot => isSameDay(slot.date, selectedDate) && slot.time === time
    );

    if (exists) {
      // Remove if already selected
      setSelectedDates(prev => prev.filter(
        slot => !(isSameDay(slot.date, selectedDate) && slot.time === time)
      ));
    } else {
      // Add new slot
      if (recurringOption !== 'none') {
        // Add recurring slots
        addRecurringSlots(selectedDate, time);
      } else {
        setSelectedDates(prev => [...prev, newSlot]);
      }
    }

    setSelectedDate(null);
  };

  const addRecurringSlots = (startDate: Date, time: string) => {
    const slots: BookingSlot[] = [];
    const interval = recurringOption === 'weekly' ? 7 : 14;
    const maxSessions = plan?.frequency?.[0]?.totalSessions || 1;

    for (let i = 0; i < maxSessions; i++) {
      const date = addDays(startDate, i * interval);
      if (date.getDay() !== 0) { // Skip Sundays
        slots.push({ date, time });
      }
    }

    setSelectedDates(prev => [...prev, ...slots]);
  };

  const handleRemoveSlot = (index: number) => {
    setSelectedDates(prev => prev.filter((_, i) => i !== index));
  };

  const handleConfirmBooking = async () => {
    setIsSubmitting(true);

    // Prefer the real client info threaded from the purchase flow. Fall
    // back to the latest purchase's record if the caller didn't pass it.
    const fallbackPurchase = getPurchases().slice(-1)[0];
    const clientName = clientInfo?.name?.trim() || fallbackPurchase?.clientName || '';
    const clientEmail = clientInfo?.email?.trim() || fallbackPurchase?.clientEmail || '';
    const clientPhone = clientInfo?.phone?.trim() || fallbackPurchase?.clientPhone || '';

    // Actually create real Square bookings for each selected slot so Alex
    // sees them in his Square/Trainerize calendar — the old code wrote to
    // localStorage only and the coach never knew.
    const duration = plan?.duration || 60;
    const coachId = DEFAULT_SQUARE_COACH;
    const results: Array<{ slot: BookingSlot; success: boolean; error?: string }> = [];

    // Phase B: bookings need a purchaseToken so the worker can verify the
    // payment and decrement credits server-side. Find the matching purchase
    // for this plan/trainer combo with the most sessions remaining. We pick
    // ONE purchase for the whole batch — if the user has multiple purchases
    // and the batch spans them, the worker will reject overflow with
    // "no-credits" and the user can re-book against the second purchase.
    const allPurchases = getPurchases();
    const matchingPurchases = allPurchases
      .filter((p: any) => p.sessionsRemaining > 0)
      .filter((p: any) => !plan?.id || p.planId === plan.id)
      .filter((p: any) => !trainer?.id || p.trainerId === trainer.id)
      // Skip mock-payment IDs — those will fail at the worker anyway.
      .filter((p: any) => p.paymentId && !String(p.paymentId).startsWith('mock_'));
    const purchaseToken = matchingPurchases[0]?.paymentId;

    for (const slot of selectedDates) {
      const startAt = slotToIsoStart(slot.date, slot.time);
      if (!startAt) {
        results.push({ slot, success: false, error: 'Unrecognized time format' });
        continue;
      }
      const goalsNote = `Post-purchase booking — ${plan?.name || 'Training Session'} (session ${results.length + 1} of ${selectedDates.length})`;
      const result = await createBooking(coachId, startAt, duration, {
        name: clientName,
        email: clientEmail,
        phone: clientPhone,
        goals: goalsNote,
      }, undefined, purchaseToken);
      results.push({
        slot,
        success: result.success,
        error: result.error,
      });
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;

    // Decrement ONE session credit per SUCCESSFUL booking only. Old code
    // decremented regardless of whether the booking actually went through.
    if (succeeded > 0) {
      const purchases = getPurchases();
      const matching = purchases.filter((p: any) =>
        p.sessionsRemaining > 0 &&
        (!plan?.id || p.planId === plan.id) &&
        (!trainer?.id || p.trainerId === trainer.id)
      );
      // Drain each purchase in order (oldest first → nearest-expiring plan
      // burns down first). Walk through matching purchases' sessionsRemaining
      // so we don't leak credits when successful > matching.length.
      let bookingIdx = 0;
      for (const purchase of matching) {
        let remaining = purchase.sessionsRemaining;
        while (remaining > 0 && bookingIdx < succeeded) {
          useSession(purchase.id);
          remaining--;
          bookingIdx++;
        }
        if (bookingIdx >= succeeded) break;
      }
    }

    // Store a local record of every result (including failures) so the user
    // can see in their own calendar what went through vs what needs manual
    // follow-up. Webhook flow handles the real Trainerize sync for the
    // successful ones.
    let existing: unknown[] = [];
    try {
      const raw = localStorage.getItem('bookings');
      if (raw) existing = JSON.parse(raw);
      if (!Array.isArray(existing)) existing = [];
    } catch { existing = []; }
    const newBookings = results.map(r => ({
      id: `booking_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      date: r.slot.date.toISOString().split('T')[0],
      time: r.slot.time,
      name: clientName,
      email: clientEmail,
      phone: clientPhone,
      service: plan?.name || 'Training Session',
      duration,
      trainerId: trainer?.id || 'alex1',
      status: r.success ? 'confirmed' : 'failed',
      source: 'post-purchase-booking',
      error: r.error,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    try {
      localStorage.setItem('bookings', JSON.stringify([...existing, ...newBookings]));
    } catch { /* quota / private mode */ }

    setBookingResults({ succeeded, failed });
    setIsSubmitting(false);
    setStep('success');
  };

  const resetState = () => {
    setStep('select');
    setSelectedDates([]);
    setSelectedDate(null);
    setCurrentWeekOffset(0);
    setRecurringOption('none');
  };

  const isSlotSelected = (date: Date, time: string) => {
    return selectedDates.some(
      slot => isSameDay(slot.date, date) && slot.time === time
    );
  };

  const getBookingsForDate = (date: Date) => {
    const allBookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    return allBookings.filter((b: any) => {
      const bookingDate = new Date(b.date);
      return isSameDay(bookingDate, date) && b.trainerId === trainer?.id;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal — flex column with min(90vh, 90dvh) max-height. dvh excludes
          the mobile URL bar so the modal fits the actual visible viewport;
          vh is the fallback for older browsers. shrink-0 header + flex-1
          content guarantees the action buttons inside the scroll area can
          always be reached without magic 140px math. */}
      <div
        className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(90vh, 90dvh)' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-6 border-b border-white/10">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="text-xl sm:text-2xl font-display font-bold text-white truncate">
              {step === 'select' && 'Book Your Sessions'}
              {step === 'calendar' && 'Select Date & Time'}
              {step === 'confirm' && 'Confirm Booking'}
              {step === 'success' && (bookingResults.failed === 0 ? 'Booked!' : bookingResults.succeeded === 0 ? 'Couldn\'t book' : 'Partially booked')}
            </h2>
            {trainer && (
              <p className="text-white/60 text-sm mt-1 flex items-center gap-2 truncate">
                <User size={14} className="shrink-0" />
                Training with {trainer.name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-white/60 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content — flex-1 + min-h-0 so it shrinks to fit available space
            and scrolls when content overflows. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          {/* Session Selection */}
          {step === 'select' && (
            <div>
              <div className="bg-[#FF4D2E]/10 border border-[#FF4D2E]/30 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Info className="text-[#FF4D2E] mt-0.5" size={20} />
                  <div>
                    <p className="text-white font-medium">Your Available Sessions</p>
                    <p className="text-white/60 text-sm">
                      You have {purchases.reduce((acc, p) => acc + p.sessionsRemaining, 0)} sessions remaining
                    </p>
                  </div>
                </div>
              </div>

              {/* Recurring Options */}
              {plan?.frequency?.[0]?.totalSessions && plan.frequency[0].totalSessions > 1 && (
                <div className="mb-6">
                  <p className="text-white/70 text-sm mb-3 flex items-center gap-2">
                    <Repeat size={16} className="text-[#FF4D2E]" />
                    Recurring Schedule (Optional)
                  </p>
                  <div className="flex gap-2">
                    {[
                      { id: 'none', label: 'One-time' },
                      { id: 'weekly', label: 'Weekly' },
                      { id: 'biweekly', label: 'Bi-weekly' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setRecurringOption(opt.id as any)}
                        className={`px-4 py-2 rounded-lg text-sm transition-all ${
                          recurringOption === opt.id
                            ? 'bg-[#FF4D2E] text-white'
                            : 'bg-white/5 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {recurringOption !== 'none' && (
                    <p className="text-white/50 text-xs mt-2">
                      We'll automatically schedule {plan?.frequency?.[0]?.totalSessions || 1} sessions {recurringOption === 'weekly' ? 'every week' : 'every 2 weeks'}
                    </p>
                  )}
                </div>
              )}

              {/* Selected Sessions Preview */}
              {selectedDates.length > 0 && (
                <div className="mb-6">
                  <p className="text-white/70 text-sm mb-3">
                    Selected Sessions ({selectedDates.length})
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {selectedDates.map((slot, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-white/5 rounded-lg p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-[#FF4D2E]/20 flex items-center justify-center">
                            <span className="text-[#FF4D2E] text-sm font-bold">
                              {format(slot.date, 'd')}
                            </span>
                          </div>
                          <div>
                            <p className="text-white text-sm">{format(slot.date, 'EEEE, MMM d')}</p>
                            <p className="text-white/50 text-xs">{slot.time}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveSlot(index)}
                          className="text-white/40 hover:text-red-400 transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Calendar Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setCurrentWeekOffset(prev => Math.max(0, prev - 1))}
                  disabled={currentWeekOffset === 0}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={20} className="text-white" />
                </button>
                <span className="text-white font-medium">
                  {format(weekStart, 'MMMM yyyy')}
                </span>
                <button
                  onClick={() => setCurrentWeekOffset(prev => prev + 1)}
                  disabled={currentWeekOffset >= 5}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={20} className="text-white" />
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1 mb-4">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="text-center text-white/40 text-xs py-2">
                    {day}
                  </div>
                ))}
                {weekDates.map((date, index) => {
                  const isAvailable = availableDates.some(d => isSameDay(d, date));
                  const dayBookings = getBookingsForDate(date);
                  const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

                  return (
                    <button
                      key={index}
                      onClick={() => isAvailable && !isPast && handleDateSelect(date)}
                      disabled={!isAvailable || isPast}
                      className={`
                        aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all
                        ${selectedDate && isSameDay(date, selectedDate)
                          ? 'bg-[#FF4D2E] text-white'
                          : isAvailable && !isPast
                            ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                            : 'bg-white/5 text-white/30 cursor-not-allowed'
                        }
                      `}
                    >
                      <span className={isToday(date) ? 'text-[#FF4D2E] font-bold' : ''}>
                        {format(date, 'd')}
                      </span>
                      {dayBookings.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5">
                          {dayBookings.slice(0, 2).map((_b: any, idx: number) => (
                            <div key={idx} className="w-1 h-1 rounded-full bg-[#FF4D2E]" />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Time Slots */}
              {selectedDate && (
                <div>
                  <p className="text-white/70 text-sm mb-3 flex items-center gap-2">
                    <Clock size={16} className="text-[#FF4D2E]" />
                    Available Times for {format(selectedDate, 'EEEE, MMM d')}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {timeSlots.map((time) => {
                      const isBooked = getBookingsForDate(selectedDate).some(
                        (b: any) => b.time === time
                      );
                      const isSelected = isSlotSelected(selectedDate, time);

                      return (
                        <button
                          key={time}
                          onClick={() => !isBooked && handleTimeSelect(time)}
                          disabled={isBooked}
                          className={`
                            py-2 px-3 rounded-lg text-sm transition-all
                            ${isSelected
                              ? 'bg-[#FF4D2E] text-white'
                              : isBooked
                                ? 'bg-white/5 text-white/30 cursor-not-allowed line-through'
                                : 'bg-white/10 text-white hover:bg-white/20'
                            }
                          `}
                        >
                          {time}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Continue Button */}
              {selectedDates.length > 0 && (
                <button
                  onClick={() => setStep('confirm')}
                  className="w-full btn-primary mt-6"
                >
                  Continue with {selectedDates.length} Session{selectedDates.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}

          {/* Confirm Step */}
          {step === 'confirm' && (
            <div>
              <p className="text-white/70 mb-4">Please review your booking:</p>

              <div className="bg-white/5 rounded-xl p-4 mb-6">
                <h3 className="text-white font-medium mb-3">Selected Sessions</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedDates.map((slot, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 bg-white/5 rounded-lg p-3"
                    >
                      <div className="w-10 h-10 rounded-lg bg-[#FF4D2E]/20 flex items-center justify-center">
                        <span className="text-[#FF4D2E] text-sm font-bold">
                          {format(slot.date, 'd')}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-sm">{format(slot.date, 'EEEE, MMMM d, yyyy')}</p>
                        <p className="text-white/50 text-xs">{slot.time} • {plan?.duration || 60} mins</p>
                      </div>
                      <Check size={18} className="text-green-400" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('select')}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmBooking}
                  disabled={isSubmitting}
                  className="flex-[2] btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <Check size={18} />
                      Confirm {selectedDates.length} Session{selectedDates.length > 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="text-green-400" size={40} />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                {bookingResults.failed === 0
                  ? 'All Booked!'
                  : bookingResults.succeeded === 0
                    ? 'Nothing went through'
                    : `${bookingResults.succeeded} of ${bookingResults.succeeded + bookingResults.failed} booked`}
              </h3>
              <p className="text-white/70 mb-4">
                {bookingResults.succeeded > 0
                  ? `${bookingResults.succeeded} session${bookingResults.succeeded > 1 ? 's' : ''} confirmed with ${trainer?.name}`
                  : `Square couldn't accept these slots. Alex has been notified — expect a reply within 24 hours.`}
              </p>
              {bookingResults.failed > 0 && bookingResults.succeeded > 0 && (
                <p className="text-yellow-300/80 text-sm mb-4">
                  {bookingResults.failed} slot{bookingResults.failed > 1 ? 's' : ''} didn't go through — Alex will reach out about those.
                </p>
              )}
              <div className="bg-white/5 rounded-lg p-4 inline-block text-left">
                <p className="text-white/60 text-sm mb-2">First session:</p>
                <p className="text-white font-medium">
                  {format(selectedDates[0]?.date, 'EEEE, MMMM d')} at {selectedDates[0]?.time}
                </p>
              </div>
              <p className="text-white/50 text-sm mt-4">
                {bookingResults.failed === 0
                  ? 'A confirmation has been sent to Alex and to your email.'
                  : bookingResults.succeeded > 0
                    ? 'Confirmed slots are on Alex\'s calendar. For the failed ones, we\'ll reach out within 24 hours.'
                    : 'We\'ve logged your request — Alex will reach out within 24 hours to schedule.'}
              </p>
              <button onClick={() => { onClose(); resetState(); }} className="btn-primary text-sm mt-6">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
