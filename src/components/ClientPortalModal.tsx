import { useState, useEffect } from 'react';
import { X, Mail, Calendar, Clock, Check, AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

interface ClientPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Initial token from a magic-link URL hash (`#/portal?token=...`). When
   * provided, the modal opens directly into the verifying state and loads
   * the customer's bookings instead of asking for an email.
   */
  initialToken?: string;
  /**
   * Hook the "Book another session" CTA into the existing BookingModal.
   * Closes the portal then opens booking.
   */
  onBookSession: () => void;
}

interface PortalBooking {
  id: string;
  startAt: string;
  status: string;
  durationMinutes?: number;
  teamMemberId?: string;
  serviceVariationId?: string;
}

interface PortalCustomer {
  name: string;
  email: string;
}

type Step = 'email' | 'sending' | 'sent' | 'verifying' | 'bookings' | 'error';

export default function ClientPortalModal({ isOpen, onClose, initialToken, onBookSession }: ClientPortalModalProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Body scroll lock + reset on open/close.
  useEffect(() => {
    if (!isOpen) {
      document.body.style.overflow = 'unset';
      setStep('email');
      setEmail('');
      setErrorMessage('');
      setCustomer(null);
      setBookings([]);
      setSessionToken(null);
      setCancellingId(null);
      return;
    }
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // Auto-verify when an initial token is supplied (magic-link click flow).
  useEffect(() => {
    if (!isOpen || !initialToken) return;
    void verifyToken(initialToken);
    // The token clears from the URL once consumed — see App.tsx mount-time
    // hook that strips ?token= after passing it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialToken]);

  async function requestMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!WORKER_URL) {
      setErrorMessage('Portal is not configured. Please contact Alex directly.');
      setStep('error');
      return;
    }
    setStep('sending');
    setErrorMessage('');
    try {
      const resp = await fetch(`${WORKER_URL}/portal/request-magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        setStep('sent');
      } else {
        const reason = data.reason || 'unknown';
        const friendly =
          reason === 'invalid-email' ? 'Please enter a valid email address.' :
          reason === 'email-not-configured' ? "Email login isn't ready yet — please reach out to Alex directly." :
          reason === 'email-send-failed' ? "Couldn't send your link right now. Please try again or text Alex." :
          'Something went wrong. Please try again.';
        setErrorMessage(friendly);
        setStep('error');
      }
    } catch {
      setErrorMessage('Network error. Please check your connection and try again.');
      setStep('error');
    }
  }

  async function verifyToken(token: string) {
    if (!WORKER_URL) {
      setErrorMessage('Portal is not configured.');
      setStep('error');
      return;
    }
    setStep('verifying');
    setErrorMessage('');
    try {
      const resp = await fetch(`${WORKER_URL}/portal/verify-and-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        setSessionToken(data.sessionToken || null);
        setCustomer(data.customer || null);
        setBookings(data.bookings || []);
        setStep('bookings');
      } else {
        const reason = data.reason || 'unknown';
        const friendly =
          reason === 'expired-or-invalid' ? "This link has expired or already been used. Send yourself a new one." :
          'Could not load your bookings. Please request a new login link.';
        setErrorMessage(friendly);
        setStep('error');
      }
    } catch {
      setErrorMessage('Network error. Please try again.');
      setStep('error');
    }
  }

  async function cancelBooking(id: string) {
    if (!sessionToken) return;
    if (!confirm('Cancel this session? You can rebook anytime.')) return;
    setCancellingId(id);
    try {
      const resp = await fetch(`${WORKER_URL}/portal/cancel-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, bookingId: id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        setBookings(prev => prev.filter(b => b.id !== id));
      } else {
        const reason = data.reason || 'unknown';
        const friendly =
          reason === 'session-expired' ? "Your session expired. Please log in again." :
          reason === 'not-your-booking' ? "We can't cancel this booking from this account." :
          (data.detail || 'Could not cancel. Try again or text Alex.');
        alert(friendly);
      }
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setCancellingId(null);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF4D2E]/20 flex items-center justify-center">
              <Calendar size={18} className="text-[#FF4D2E]" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold text-white">
                {step === 'bookings' ? 'Your Bookings' : 'Client Login'}
              </h2>
              {step === 'email' && <p className="text-white/50 text-xs">We'll email you a secure link</p>}
              {step === 'bookings' && customer && <p className="text-white/50 text-xs">{customer.email}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          {step === 'email' && (
            <form onSubmit={requestMagicLink} className="space-y-4">
              <p className="text-white/70 text-sm leading-relaxed">
                Enter the email Alex has on file and we'll send you a one-time login link to view and manage your sessions.
              </p>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="you@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={!email}
                className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                <Mail size={16} />
                Email me a login link
              </button>
            </form>
          )}

          {step === 'sending' && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="text-[#FF4D2E] animate-spin" size={32} />
            </div>
          )}

          {step === 'sent' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-[#FF4D2E]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="text-[#FF4D2E]" size={32} />
              </div>
              <p className="text-white font-semibold mb-1">Link sent!</p>
              <p className="text-white/60 text-sm mb-4">
                Check <span className="text-white">{email}</span> and click the link.
              </p>
              <p className="text-white/40 text-xs">It expires in 10 minutes.</p>
            </div>
          )}

          {step === 'verifying' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="text-[#FF4D2E] animate-spin mb-3" size={32} />
              <p className="text-white/60 text-sm">Loading your bookings…</p>
            </div>
          )}

          {step === 'bookings' && (
            <div className="space-y-4">
              {!customer ? (
                <div className="text-center py-6">
                  <p className="text-white font-semibold mb-1">No account on file</p>
                  <p className="text-white/60 text-sm mb-4">
                    We couldn't find a customer record under this email. If you've trained with Alex before, double-check the email or text him to update it.
                  </p>
                  <button onClick={onBookSession} className="btn-primary text-sm">
                    Book your first session
                  </button>
                </div>
              ) : bookings.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-white font-semibold mb-1">No upcoming sessions</p>
                  <p className="text-white/60 text-sm mb-4">
                    Welcome back, {customer.name.split(' ')[0]}. Ready for your next one?
                  </p>
                  <button
                    onClick={() => { onClose(); onBookSession(); }}
                    className="btn-primary text-sm"
                  >
                    Book a session
                  </button>
                </div>
              ) : (
                <>
                  {bookings.map(b => {
                    const start = new Date(b.startAt);
                    return (
                      <div
                        key={b.id}
                        className="bg-white/[0.03] border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Calendar size={14} className="text-[#FF4D2E] flex-shrink-0" />
                            <p className="text-white font-semibold text-sm truncate">
                              {format(start, 'EEE, MMM d')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-white/60 text-xs">
                            <Clock size={12} />
                            <span>
                              {format(start, 'h:mm a')}
                              {b.durationMinutes ? ` · ${b.durationMinutes} min` : ''}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => cancelBooking(b.id)}
                          disabled={cancellingId === b.id}
                          className="text-xs text-white/60 hover:text-[#FF4D2E] transition-colors flex-shrink-0 disabled:opacity-50"
                        >
                          {cancellingId === b.id ? '…' : 'Cancel'}
                        </button>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => { onClose(); onBookSession(); }}
                    className="w-full btn-primary text-sm flex items-center justify-center gap-2"
                  >
                    Book another session
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-[#FF4D2E]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="text-[#FF4D2E]" size={28} />
              </div>
              <p className="text-white font-semibold mb-2">Couldn't load</p>
              <p className="text-white/60 text-sm mb-4">{errorMessage}</p>
              <button
                onClick={() => { setStep('email'); setErrorMessage(''); }}
                className="text-[#FF4D2E] text-sm font-semibold hover:underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
