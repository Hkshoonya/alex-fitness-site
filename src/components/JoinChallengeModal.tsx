import { useState, useEffect, useRef } from 'react';
import { X, Trophy, Check, User, Mail, Phone, Loader2, CreditCard } from 'lucide-react';
import { joinChallenge, parseChallengeDate, type Challenge } from '@/api/challenges';
import { initializeAllPaymentMethods } from '@/api/squarePayments';

interface JoinChallengeModalProps {
  challenge: Challenge | null;
  isOpen: boolean;
  onClose: () => void;
  onJoined?: (challenge: Challenge) => void;
}

export default function JoinChallengeModal({ challenge, isOpen, onClose, onJoined }: JoinChallengeModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'form' | 'payment' | 'sending' | 'done' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [finalChallenge, setFinalChallenge] = useState<Challenge | null>(null);
  const cardRef = useRef<any>(null);
  const [cardReady, setCardReady] = useState(false);
  const cardContainerId = 'challenge-join-card-container';
  const price = typeof challenge?.price === 'number' ? challenge.price : 0;
  const isPaid = price > 0;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
      // Reset ALL state on close — stale name/email/phone across opens would
      // leak PII on shared devices. Match BookingModal's resetState pattern.
      setStep('form');
      setErrorMsg('');
      setFinalChallenge(null);
      setName('');
      setEmail('');
      setPhone('');
      cardRef.current = null;
      setCardReady(false);
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // When the user reaches the payment step for a paid challenge, initialize
  // the Square Web SDK and attach the card input. Uses the same pattern as
  // TrainingPlansShop — no new Square integration, just the existing SDK.
  useEffect(() => {
    if (step !== 'payment' || !isPaid || cardRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const methods = await initializeAllPaymentMethods(Math.round(price * 100));
        if (cancelled || !methods?.card) {
          if (!cancelled) setErrorMsg('Could not load the card form. Please try again or contact Alex directly.');
          return;
        }
        await methods.card.attach(`#${cardContainerId}`);
        if (cancelled) return;
        cardRef.current = methods.card;
        setCardReady(true);
      } catch (e) {
        if (!cancelled) setErrorMsg(e instanceof Error ? e.message : 'Card form failed to load');
      }
    })();
    return () => { cancelled = true; };
  }, [step, isPaid, price]);

  if (!isOpen || !challenge) return null;

  // Form submit: for free challenges → join directly; for paid ones →
  // advance to the payment step so the user can enter a card.
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setErrorMsg('Name and email are required.');
      return;
    }
    if (isPaid) {
      setStep('payment');
      return;
    }
    await submitJoin();
  };

  // Single submit path. For free challenges we call without a cardToken;
  // for paid ones we tokenize the card and let the worker do the charge
  // server-side (it derives the amount from challenge.price, so the client
  // can't influence what they pay). Replaces the old two-call flow that
  // charged via /api/square/payments and then submitted the paymentId.
  const submitJoin = async (cardToken?: string) => {
    setStep('sending');
    const result = await joinChallenge(challenge!.id, {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      cardToken,
    });
    if (result.ok) {
      setFinalChallenge(result.challenge || challenge);
      setStep('done');
      if (result.challenge && onJoined) onJoined(result.challenge);
    } else {
      setErrorMsg(result.error || 'Something went wrong.');
      setStep('error');
    }
  };

  const handlePaymentSubmit = async () => {
    if (!cardRef.current) {
      setErrorMsg('Card form not ready. Please wait a moment.');
      return;
    }
    setStep('sending');
    try {
      const tok = await cardRef.current.tokenize();
      if (tok.status !== 'OK') {
        setErrorMsg(tok.errors?.[0]?.detail || 'Card could not be verified. Please check the details.');
        setStep('error');
        return;
      }
      await submitJoin(tok.token);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Payment failed unexpectedly.');
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF4D2E]/20 flex items-center justify-center">
              <Trophy size={18} className="text-[#FF4D2E]" />
            </div>
            <div>
              <h2 className="text-white font-display font-bold text-lg">
                {step === 'done' ? 'You\'re in!' : step === 'error' ? 'Couldn\'t join' : 'Join Challenge'}
              </h2>
              <p className="text-white/50 text-xs mt-0.5">{challenge.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {step === 'done' ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="text-green-400" size={32} />
              </div>
              <p className="text-white font-semibold mb-1">Welcome to the challenge!</p>
              <p className="text-white/60 text-sm mb-4">
                Alex will be in touch before {parseChallengeDate(challenge.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} with next steps.
              </p>
              {finalChallenge?.spotsLeft !== undefined && finalChallenge.spotsLeft !== null && (
                <p className="text-xs text-white/40">{finalChallenge.spotsLeft} spots left for others</p>
              )}
              <button onClick={onClose} className="mt-6 btn-primary text-sm">Done</button>
            </div>
          ) : step === 'error' ? (
            <div className="text-center py-4">
              <p className="text-white font-semibold mb-2">Hmm, that didn't go through.</p>
              <p className="text-white/60 text-sm mb-6">{errorMsg}</p>
              <button
                onClick={() => { setStep('form'); setErrorMsg(''); }}
                className="text-[#FF4D2E] text-sm font-semibold hover:underline"
              >
                Try again
              </button>
            </div>
          ) : step === 'sending' ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 size={28} className="text-[#FF4D2E] animate-spin mb-3" />
              <p className="text-white/60 text-sm">Saving your spot…</p>
            </div>
          ) : (
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {challenge.spotsLeft !== undefined && challenge.spotsLeft !== null && (
                <p className="text-xs text-white/50">
                  {challenge.spotsLeft} of {challenge.spots ?? challenge.spotsLeft} spots remaining.
                  {challenge.price && challenge.price > 0 ? ` $${challenge.price} to enter.` : ' Free entry.'}
                </p>
              )}

              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Your name"
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                />
              </div>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder="Email"
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                />
              </div>

              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input
                  type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                />
              </div>

              <button type="submit" className="w-full btn-primary text-sm mt-2">
                {isPaid ? `Continue to payment — $${price}` : 'Secure my spot'}
              </button>
            </form>
          )}

          {step === 'payment' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">Entry fee</span>
                <span className="text-white font-semibold">${price}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-white/50 bg-white/5 rounded-lg p-3">
                <CreditCard size={14} /> Payments processed by Square. Your card is not stored on our servers.
              </div>
              <div
                id={cardContainerId}
                className="bg-white/5 border border-white/10 rounded-lg p-3 min-h-[60px]"
              />
              {errorMsg && <p className="text-red-400 text-xs">{errorMsg}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setStep('form'); setErrorMsg(''); }}
                  className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white text-sm rounded-lg"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handlePaymentSubmit}
                  disabled={!cardReady}
                  className="flex-1 btn-primary text-sm disabled:opacity-50"
                >
                  {cardReady ? `Pay $${price} & join` : 'Loading card form…'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
