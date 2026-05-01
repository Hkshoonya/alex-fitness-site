import { useState, useEffect } from 'react';
import { X, Check, ChevronRight, Clock, Calendar, User, CreditCard, Shield, Star, Tag, RefreshCw } from 'lucide-react';
import {
  trainers,
  formatPrice,
  getPriceRange,
  type TrainingPlan,
  type Trainer,
} from '@/data/trainingPlans';
import { getTrainingPlans, refreshCatalog, getCatalogCacheStatus, getLastCatalogError } from '@/api/squareCatalog';
import { initializeAllPaymentMethods, createCardPayment, storePurchase, validateCoupon, type PaymentMethods } from '@/api/squarePayments';
import { getTeamMembers, type TeamMember } from '@/api/squareAvailability';
import { asset } from '@/lib/assets';
import MemberAgreement, { type MemberAgreementSnapshot, type SignedAgreementRecord } from '@/components/MemberAgreement';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
// Recurring auto-pay (purchaseAndSubscribe) is deferred — see handlePayment.

export interface ClientInfo {
  name: string;
  email: string;
  phone: string;
}

interface TrainingPlansShopProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchaseComplete?: (plan: TrainingPlan, trainer: Trainer, clientInfo: ClientInfo) => void;
}

type CategoryFilter = 'all' | 'personal-4week' | 'personal-12week' | 'online' | 'app' | 'class' | 'single-session';

export default function TrainingPlansShop({ isOpen, onClose, onPurchaseComplete }: TrainingPlansShopProps) {
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [selectedPlan, setSelectedPlan] = useState<TrainingPlan | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<number>(0);
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer>(trainers[0]);
  // Live trainer cards shown in the trainer-selection step. Starts as the
  // static catalog (instant render + offline fallback) and gets enriched on
  // mount with real Square Team Member data (name, photo, title, specialties).
  // The catalog `id` ('alex1' / 'alex2') is preserved so the worker pricing
  // contract (TRAINER_MULTIPLIERS) keeps validating.
  const [liveTrainers, setLiveTrainers] = useState<Trainer[]>(trainers);
  const [step, setStep] = useState<'browse' | 'configure' | 'trainer' | 'payment' | 'success'>('browse');
  const [cardElement, setCardElement] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethods | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [catalogErrorMsg, setCatalogErrorMsg] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState({ name: '', email: '', phone: '' });
  // Coupon code state. `couponInput` is the raw text in the input field;
  // `appliedCoupon` is the worker-validated discount (null until Apply
  // succeeds). `couponError` shows messages like "not found" / "doesn't
  // apply to this plan".
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    label: string;
    discountAmountCents: number;
    discountedAmountCents: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  // Agreement gating — payment populates pendingAgreement; signing
  // populates agreementRecord. onPurchaseComplete only fires AFTER signing,
  // so the user can't reach scheduling without finishing the legal step.
  const [pendingAgreement, setPendingAgreement] = useState<{
    paymentId: string;
    snapshot: MemberAgreementSnapshot;
  } | null>(null);
  const [agreementRecord, setAgreementRecord] = useState<SignedAgreementRecord | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      loadPlans();
    } else {
      document.body.style.overflow = 'unset';
      resetState();
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // Square is the source of truth for who's coaching. Every active non-
  // consultation Square Team Member gets a card. Pricing is uniform (all
  // coaches charge Alex's full plan price) — the picker is a preference
  // signal so Alex knows which coach the client wants. The actual coach
  // identity travels to the worker via `coachPreferenceId/Name` and ends
  // up in the Square payment note.
  //
  // The `id: 'alex1'` slot is preserved as the worker pricing key for
  // backwards compat (TRAINER_MULTIPLIERS in webhook-handler.js). All
  // coaches resolve to it now → uniform pricing without a worker change.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const team = await getTeamMembers();
        if (cancelled) return;
        const fallbackHead = trainers.find(t => t.isHead) || trainers[0];
        const merged: Trainer[] = team
          .filter((m: TeamMember) => m.role !== 'consultation')
          .map((m: TeamMember) => {
            const isHead = m.role === 'head-coach';
            return {
              id: 'alex1' as const,
              squareTeamMemberId: m.squareTeamMemberId || m.id,
              isHead,
              name: m.name,
              title: m.title || (isHead ? 'Head Coach & Founder' : 'Trainer'),
              image: m.image || (isHead ? fallbackHead.image : asset('/images/coach-portrait.jpg')),
              bio: isHead
                ? fallbackHead.bio
                : 'Certified personal trainer at Alex\'s Fitness, working alongside Alex Davis to deliver the same proven programs.',
              experience: isHead ? fallbackHead.experience : '',
              specialties: m.specialties.length > 0
                ? m.specialties
                : (isHead ? fallbackHead.specialties : ['Personal Training', 'Strength', 'Conditioning']),
              priceMultiplier: 1.0,
              discount: 0,
            };
          })
          .sort((a, b) => (b.isHead ? 1 : 0) - (a.isHead ? 1 : 0));
        if (merged.length === 0) return;
        setLiveTrainers(merged);
        setSelectedTrainer((prev) => {
          const sameSquareId = prev.squareTeamMemberId
            && merged.find((t) => t.squareTeamMemberId === prev.squareTeamMemberId);
          return sameSquareId || merged[0];
        });
      } catch {
        // Stay on the static fallback — already set as initial state.
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Initialize Square payment SDK when entering payment step; tear it down
  // when leaving. Without the teardown, backing out of the payment step and
  // returning unmounts+remounts the #card-container div while leaving the
  // cached cardElement attached to the old (detached) node — the card field
  // silently goes dead.
  useEffect(() => {
    if (step === 'payment' && !cardElement) {
      initializeSquareSdk();
      return;
    }
    if (step !== 'payment' && cardElement) {
      try { cardElement.destroy?.(); } catch { /* best-effort */ }
      try { paymentMethods?.applePay?.destroy?.(); } catch { /* best-effort */ }
      try { paymentMethods?.googlePay?.destroy?.(); } catch { /* best-effort */ }
      try { paymentMethods?.cashAppPay?.destroy?.(); } catch { /* best-effort */ }
      setCardElement(null);
      setPaymentMethods(null);
    }
  }, [step]);

  const loadPlans = async () => {
    setIsLoadingPlans(true);
    const data = await getTrainingPlans();
    setPlans(data);
    const status = getCatalogCacheStatus();
    setLastSynced(status.lastFetched);
    setCatalogErrorMsg(getLastCatalogError());
    setIsLoadingPlans(false);
  };

  const handleRefreshPlans = async () => {
    setIsRefreshing(true);
    const data = await refreshCatalog();
    setPlans(data);
    const status = getCatalogCacheStatus();
    setLastSynced(status.lastFetched);
    setCatalogErrorMsg(getLastCatalogError());
    setIsRefreshing(false);
  };

  const initializeSquareSdk = async () => {
    try {
      const methods = await initializeAllPaymentMethods(getCurrentPrice() * 100 || 10000);
      if (methods) {
        setPaymentMethods(methods);
        if (methods.card) {
          await methods.card.attach('#card-container');
          setCardElement(methods.card);
        }
        if (methods.applePay) {
          await methods.applePay.attach('#apple-pay-button');
        }
        if (methods.googlePay) {
          await methods.googlePay.attach('#google-pay-button');
        }
        if (methods.cashAppPay) {
          await methods.cashAppPay.attach('#cashapp-button');
        }
      }
    } catch {
      // SDK not available — payment form shows card-only fallback
    }
  };

  const resetState = () => {
    // Tear down the Square Web Payments SDK elements. Without this,
    // `cardElement` state survives close/reopen but points at a detached
    // DOM node (the previous `#card-container` div). Next time the user
    // reaches the payment step, the `!cardElement` guard in the useEffect
    // below skips re-initialization and the card field appears dead.
    // Also affects digital wallet buttons (Apple/Google/Cash App Pay).
    try { cardElement?.destroy?.(); } catch { /* SDK may already be gone */ }
    try { paymentMethods?.applePay?.destroy?.(); } catch { /* best-effort */ }
    try { paymentMethods?.googlePay?.destroy?.(); } catch { /* best-effort */ }
    try { paymentMethods?.cashAppPay?.destroy?.(); } catch { /* best-effort */ }
    setCardElement(null);
    setPaymentMethods(null);
    setSelectedPlan(null);
    setSelectedFrequency(0);
    setSelectedTrainer(liveTrainers[0] || trainers[0]);
    setStep('browse');
    setError(null);
    setClientInfo({ name: '', email: '', phone: '' });
    setCouponInput('');
    setAppliedCoupon(null);
    setCouponError(null);
    setIsValidatingCoupon(false);
    setPendingAgreement(null);
    setAgreementRecord(null);
  };

  // Drop the applied coupon if the user changes plan or frequency — it
  // may not apply to the new selection, and any displayed total would be
  // stale. The user can re-Apply.
  useEffect(() => {
    if (appliedCoupon) {
      setAppliedCoupon(null);
      setCouponError(null);
    }
    // Only depend on plan/frequency identity — not appliedCoupon (would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan?.id, selectedFrequency]);

  const handleApplyCoupon = async () => {
    if (!selectedPlan) return;
    const code = couponInput.trim();
    if (!code) return;
    setIsValidatingCoupon(true);
    setCouponError(null);
    try {
      const result = await validateCoupon({
        code,
        planId: selectedPlan.id,
        frequencyIndex: selectedPlan.frequency.length > 0 ? selectedFrequency : null,
      });
      if (result.valid && result.discountAmountCents != null && result.discountedAmountCents != null) {
        setAppliedCoupon({
          code: result.code || code,
          label: result.label || `${code} applied`,
          discountAmountCents: result.discountAmountCents,
          discountedAmountCents: result.discountedAmountCents,
        });
        setCouponError(null);
      } else {
        setAppliedCoupon(null);
        setCouponError(result.error || 'Coupon not valid');
      }
    } catch (e) {
      setAppliedCoupon(null);
      setCouponError(e instanceof Error ? e.message : 'Validation failed');
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError(null);
    setCouponInput('');
  };

  const filteredPlans = selectedCategory === 'all'
    ? plans
    : plans.filter(plan => plan.category === selectedCategory);

  // Group plans by category for structured "All Plans" view
  const categoryLabels: Record<string, string> = {
    'personal-4week': '4-Week Training Plans',
    'personal-12week': '12-Week Training Plans',
    'online': 'Online Coaching',
    'app': 'App & Self-Guided',
    'class': 'Classes & Specialty Sessions',
    'single-session': 'Drop-In & Extras',
  };
  const categoryOrder: TrainingPlan['category'][] = ['personal-4week', 'personal-12week', 'online', 'app', 'class', 'single-session'];
  const groupedPlans = selectedCategory === 'all'
    ? categoryOrder
        .map(cat => ({ category: cat, label: categoryLabels[cat], plans: plans.filter(p => p.category === cat) }))
        .filter(g => g.plans.length > 0)
    : null;

  const handlePlanSelect = (plan: TrainingPlan) => {
    setSelectedPlan(plan);
    setSelectedFrequency(0);
    if (plan.frequency.length > 0) {
      setStep('configure');
    } else {
      setStep('trainer');
    }
  };

  const handleFrequencyConfirm = () => {
    setStep('trainer');
  };

  const handleTrainerSelect = (trainer: Trainer) => {
    setSelectedTrainer(trainer);
    setStep('payment');
  };

  const getCurrentPrice = (): number => {
    if (!selectedPlan) return 0;
    if (selectedPlan.frequency.length > 0) {
      const freq = selectedPlan.frequency[selectedFrequency];
      return Math.round(freq.totalPrice * selectedTrainer.priceMultiplier);
    }
    return selectedPlan.salePrice || selectedPlan.price;
  };

  // Final price the user will be charged — base price minus any applied
  // coupon. The worker re-derives this server-side; this is for display.
  const getFinalPrice = (): number => {
    const base = getCurrentPrice();
    if (!appliedCoupon) return base;
    return Math.max(0, Math.round(appliedCoupon.discountedAmountCents / 100));
  };

  const handlePayment = async () => {
    if (!selectedPlan) return;
    setIsLoading(true);
    setError(null);

    try {
      let paymentId: string;
      let squareCustomerId: string | undefined;
      let squareCardId: string | undefined;
      let cardToken: string | null = null;
      // Server-resolved purchase metadata. Defaults are used only on the
      // mock-payment path (when Square isn't configured); on the real path
      // these are filled in from the /checkout/charge response.
      let serverAmount = getCurrentPrice();
      let serverSessions = selectedPlan.frequency[selectedFrequency]?.totalSessions || 1;
      let serverPlanName = selectedPlan.name;
      let serverValidUntil = new Date(
        Date.now() + (selectedPlan.planWeeks || 12) * 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      if (cardElement) {
        const result = await cardElement.tokenize();
        if (result.status !== 'OK') throw new Error('Card tokenization failed');
        cardToken = result.token;
        // C-02 fix: send IDs only — the worker derives amount + sessions
        // from its own server-side catalog. We CANNOT send amountCents from
        // the browser; that path is now rejected.
        const paymentResult = await createCardPayment({
          planId: selectedPlan.id,
          frequencyIndex: selectedPlan.frequency.length > 0 ? selectedFrequency : null,
          trainerId: selectedTrainer.id,
          coachPreferenceId: selectedTrainer.squareTeamMemberId,
          coachPreferenceName: selectedTrainer.name,
          couponCode: appliedCoupon?.code,
          cardToken: cardToken!,
          client: { email: clientInfo.email, name: clientInfo.name, phone: clientInfo.phone },
        });
        if (!paymentResult.success) throw new Error(paymentResult.error || 'Payment failed');
        paymentId = paymentResult.paymentId!;
        squareCustomerId = paymentResult.customerId;
        squareCardId = paymentResult.cardId;
        // Use the server's resolved values so localStorage agrees with what
        // was actually charged + granted in Trainerize.
        if (paymentResult.amountCents != null) serverAmount = paymentResult.amountCents / 100;
        if (paymentResult.sessions != null) serverSessions = paymentResult.sessions;
        if (paymentResult.planName) serverPlanName = paymentResult.planName;
        if (paymentResult.validUntil) serverValidUntil = paymentResult.validUntil;
      } else {
        // Mock-payment branch is dev-only. In production, the Complete
        // Purchase button is disabled when cardElement is null (see
        // disabled= line below) so this branch should never fire — but
        // a UI regression that re-enables the button could let a user
        // create a localStorage purchase with a fake paymentId, which
        // PostPurchaseBooking would then trust and turn into real Square
        // bookings. Throwing here is the belt-and-suspenders guard.
        if (!import.meta.env.DEV) {
          throw new Error('Payment form is still loading — please wait a moment and try again.');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        paymentId = `mock_payment_${Date.now()}`;
      }

      storePurchase({
        planId: selectedPlan.id,
        trainerId: selectedTrainer.id,
        coachPreferenceId: selectedTrainer.squareTeamMemberId,
        coachPreferenceName: selectedTrainer.name,
        paymentId,
        amount: serverAmount,
        purchaseDate: new Date().toISOString(),
        sessionsRemaining: serverSessions,
        // Default to 12 weeks when planWeeks is 0/missing (single sessions,
        // classes) — otherwise validUntil=now and the purchase is filtered
        // out as expired immediately.
        validUntil: serverValidUntil,
        // Carry the client details through so PostPurchaseBooking can write
        // real bookings instead of "Client Name" / "client@example.com".
        clientName: clientInfo.name,
        clientEmail: clientInfo.email,
        clientPhone: clientInfo.phone,
        // Coupon applied at checkout — values come from the worker's
        // resolved response, never the typed code, so we can't store a
        // discount the user didn't actually receive.
        couponCode: appliedCoupon?.code,
        couponLabel: appliedCoupon?.label,
        couponDiscountAmount: appliedCoupon ? appliedCoupon.discountAmountCents / 100 : undefined,
      });

      // Register the purchase in worker KV AND provision the Trainerize
      // account inline. We send paymentId + email + saved-card IDs + the
      // client's name/phone — the worker re-verifies the Square payment,
      // re-derives sessions from the catalog, then (server-side) creates
      // the Trainerize user, sends the activation invite, and assigns the
      // matching program. The browser no longer talks to /api/trainerize/*
      // directly (the proxy entries were removed pre-launch — forged Origin
      // previously reached user/add and program/copyToUser).
      // Fire-and-forget — purchase already succeeded; KV reconciles on retry.
      if (WORKER_URL && paymentId && !paymentId.startsWith('mock_')) {
        const nameParts = clientInfo.name.trim().split(' ');
        fetch(`${WORKER_URL}/credit-grant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentId,
            email: clientInfo.email,
            squareCustomerId,
            squareCardId,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            phone: clientInfo.phone || '',
          }),
        }).catch(e => console.error('credit-grant call failed:', e));
      }

      // NOTE: Recurring auto-pay subscription is NOT wired up yet. The
      // previous fire-and-forget call passed a Square catalog item ID
      // where a subscription_plan_variation_id is required, a $0 first
      // charge (Square rejects those), and a payment ID as customer ID —
      // so every multi-week purchase silently failed to set up recurring
      // billing. Removed until a real Square Subscriptions plan exists and
      // the correct IDs are threaded through. Until then, plans charge
      // once at purchase and the coach invoices manually for renewal.

      // Capture purchase snapshot for the Member Agreement form. The
      // success step now embeds the agreement and only fires
      // onPurchaseComplete AFTER the agreement is signed — so the user
      // can't reach scheduling without finishing the legal step.
      setPendingAgreement({
        paymentId,
        snapshot: {
          planName: serverPlanName,
          sessions: serverSessions,
          durationMinutes: selectedPlan.duration || 60,
          amountPaid: serverAmount,
          trainerName: selectedTrainer.name,
          paymentDate: new Date().toISOString(),
        },
      });

      setStep('success');

      // Trainerize provisioning happens server-side inside /credit-grant
      // (the fire-and-forget POST above). The worker creates the user,
      // sends the activation invite via Trainerize's sendMail flag, and
      // assigns the matching program — payment-verified, no proxy exposure.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose} />

      {/* Modal — flex column with min(90vh, 90dvh) max-height (dvh = mobile
          viewport excluding URL bar). Header/footer can't be clipped by
          stale 140px math; content scrolls within the available space. */}
      <div
        className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-4xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(90vh, 90dvh)' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-6 border-b border-white/10">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="text-xl sm:text-2xl font-display font-bold text-white truncate">
              {step === 'browse' && 'Training Plans'}
              {step === 'configure' && 'Choose Frequency'}
              {step === 'trainer' && 'Choose Your Trainer'}
              {step === 'payment' && 'Complete Purchase'}
              {step === 'success' && (agreementRecord ? 'You\'re all set!' : 'Finalize Your Enrollment')}
            </h2>
            {selectedPlan && step !== 'browse' && step !== 'success' && (
              <p className="text-white/60 text-sm mt-1 truncate">{selectedPlan.name}</p>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 text-white/60 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content — flex-1 + min-h-0 so it shrinks to fit + scrolls */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">

          {/* ===== BROWSE PLANS ===== */}
          {step === 'browse' && (
            <div>
              {/* Category Filter + Sync */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {[
                    { id: 'all' as CategoryFilter, label: 'All Plans' },
                    { id: 'personal-4week' as CategoryFilter, label: '4-Week' },
                    { id: 'personal-12week' as CategoryFilter, label: '12-Week' },
                    { id: 'online' as CategoryFilter, label: 'Online' },
                    { id: 'app' as CategoryFilter, label: 'App' },
                    { id: 'class' as CategoryFilter, label: 'Classes' },
                    { id: 'single-session' as CategoryFilter, label: 'Drop-In' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                        selectedCategory === cat.id
                          ? 'bg-[#FF4D2E] text-white'
                          : 'bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Sync indicator */}
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {lastSynced && (
                    <span className="text-white/20 text-xs hidden sm:block">
                      {new Date(lastSynced).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={handleRefreshPlans}
                    disabled={isRefreshing}
                    title="Sync prices"
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Info banner */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-6">
                <p className="text-white/70 text-sm">
                  Choose your plan based on the duration of commitment and number of sessions per week. More training time = more muscle adaptation and more calories burned!
                </p>
              </div>

              {/* Catalog error banner — surfaces when Square is unreachable
                  so the coach/user knows the plans they're seeing are the
                  hardcoded fallback, not live pricing. */}
              {catalogErrorMsg && (
                <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-amber-300 text-sm font-semibold">Live pricing unavailable</p>
                    <p className="text-amber-200/70 text-xs mt-1">
                      Couldn't reach Square to fetch the latest plan list. Showing cached/fallback plans — prices may be out of date.
                    </p>
                  </div>
                  <button
                    onClick={handleRefreshPlans}
                    disabled={isRefreshing}
                    className="text-amber-300 hover:text-amber-200 text-xs font-semibold disabled:opacity-50"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Loading state */}
              {isLoadingPlans ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-[#FF4D2E] rounded-full animate-spin" />
                </div>
              ) : groupedPlans ? (
                /* Grouped view (All Plans) — sections with headers */
                <div className="space-y-8">
                  {groupedPlans.map(({ category, label, plans: sectionPlans }) => (
                    <div key={category}>
                      <div className="flex items-center gap-3 mb-4">
                        <h3 className="text-white font-semibold text-lg">{label}</h3>
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-white/30 text-xs">{sectionPlans.length} {sectionPlans.length === 1 ? 'plan' : 'plans'}</span>
                      </div>
                      <div className="grid md:grid-cols-2 gap-4">
                        {sectionPlans.map((plan) => (
                          <PlanCard key={plan.id} plan={plan} onSelect={handlePlanSelect} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Filtered view (specific category) — flat grid */
                <div className="grid md:grid-cols-2 gap-4">
                  {filteredPlans.map((plan) => (
                    <PlanCard key={plan.id} plan={plan} onSelect={handlePlanSelect} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== CONFIGURE FREQUENCY ===== */}
          {step === 'configure' && selectedPlan && (
            <div>
              <p className="text-white/60 mb-6">How many times per week do you want to train?</p>

              <div className="space-y-3 mb-8">
                {selectedPlan.frequency.map((freq, idx) => (
                  <button
                    key={freq.perWeek}
                    onClick={() => setSelectedFrequency(idx)}
                    className={`w-full flex items-center justify-between p-5 rounded-xl border transition-all ${
                      selectedFrequency === idx
                        ? 'border-[#FF4D2E] bg-[#FF4D2E]/5'
                        : 'border-white/10 bg-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ${
                        selectedFrequency === idx ? 'bg-[#FF4D2E] text-white' : 'bg-white/10 text-white/70'
                      }`}>
                        {freq.perWeek}x
                      </div>
                      <div className="text-left">
                        <p className="text-white font-medium">{freq.perWeek}x per week</p>
                        <p className="text-white/50 text-sm">{freq.totalSessions} total sessions over {selectedPlan.planWeeks} weeks</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-white">{formatPrice(freq.totalPrice)}</p>
                      <p className="text-white/50 text-xs">${selectedPlan.pricePerSession}/session</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('browse')} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors">
                  Back
                </button>
                <button onClick={handleFrequencyConfirm} className="flex-[2] btn-primary">
                  Continue — {formatPrice(selectedPlan.frequency[selectedFrequency].totalPrice)}
                </button>
              </div>
            </div>
          )}

          {/* ===== SELECT TRAINER ===== */}
          {step === 'trainer' && selectedPlan && (
            <div>
              <p className="text-white/60 mb-6">Choose who you want to train with:</p>

              <div className="space-y-4">
                {liveTrainers.map((trainer) => {
                  const cardKey = trainer.squareTeamMemberId || trainer.id;
                  const isSelected = trainer.squareTeamMemberId
                    ? selectedTrainer.squareTeamMemberId === trainer.squareTeamMemberId
                    : selectedTrainer.id === trainer.id;
                  return (
                  <div
                    key={cardKey}
                    onClick={() => handleTrainerSelect(trainer)}
                    className={`bg-white/5 border rounded-xl p-5 cursor-pointer transition-all hover:bg-white/[0.07] ${
                      isSelected
                        ? 'border-[#FF4D2E] bg-[#FF4D2E]/5'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex gap-4">
                      <img src={trainer.image} alt={trainer.name} className="w-20 h-20 rounded-lg object-cover" />
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="text-white font-semibold flex items-center gap-2">
                              {trainer.name}
                              {trainer.isHead && (
                                <span className="bg-[#FF4D2E] text-white text-xs px-2 py-0.5 rounded-full">Head Trainer</span>
                              )}
                            </h3>
                            <p className="text-white/50 text-sm">{trainer.title}</p>
                          </div>
                          {trainer.discount > 0 && (
                            <span className="text-green-400 text-sm">Save {trainer.discount}%</span>
                          )}
                        </div>
                        <p className="text-white/60 text-sm mt-2 line-clamp-2">{trainer.bio}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {trainer.specialties.map((s) => (
                            <span key={s} className="text-white/50 text-xs bg-white/5 px-2 py-1 rounded">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              <button onClick={() => selectedPlan.frequency.length > 0 ? setStep('configure') : setStep('browse')} className="mt-6 text-white/60 hover:text-white text-sm flex items-center gap-1">
                ← Back
              </button>
            </div>
          )}

          {/* ===== PAYMENT ===== */}
          {step === 'payment' && selectedPlan && (
            <div>
              <div className="bg-white/5 rounded-xl p-4 mb-6">
                <h3 className="text-white font-medium mb-3">Order Summary</h3>
                <div className="flex justify-between text-white/70 mb-2">
                  <span>{selectedPlan.name}</span>
                </div>
                {selectedPlan.frequency.length > 0 && (
                  <div className="flex justify-between text-white/70 mb-2">
                    <span>{selectedPlan.frequency[selectedFrequency].perWeek}x/week — {selectedPlan.frequency[selectedFrequency].totalSessions} sessions</span>
                  </div>
                )}
                <div className="flex justify-between text-white/70 mb-2">
                  <span className="flex items-center gap-2">
                    <User size={14} /> Trainer: {selectedTrainer.name}
                  </span>
                  {selectedTrainer.discount > 0 && (
                    <span className="text-green-400">-{selectedTrainer.discount}%</span>
                  )}
                </div>
                {appliedCoupon && (
                  <div className="flex justify-between text-green-400 mb-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Tag size={14} /> Coupon: {appliedCoupon.code}
                    </span>
                    <span>-{formatPrice(appliedCoupon.discountAmountCents / 100)}</span>
                  </div>
                )}
                <div className="border-t border-white/10 pt-2 mt-2">
                  <div className="flex justify-between text-white font-semibold text-lg">
                    <span>Total</span>
                    <span>
                      {appliedCoupon ? (
                        <>
                          <span className="text-white/40 line-through text-sm font-normal mr-2">
                            {formatPrice(getCurrentPrice())}
                          </span>
                          {formatPrice(getFinalPrice())}
                        </>
                      ) : (
                        formatPrice(getCurrentPrice())
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Coupon code entry. Validates against Square Discounts catalog
                  via the worker — unknown / inapplicable codes return an error. */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
                <label className="block text-white/60 text-sm mb-2 flex items-center gap-2">
                  <Tag size={14} /> Promo Code
                </label>
                {appliedCoupon ? (
                  <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 text-green-400 text-sm">
                      <Check size={14} />
                      <span>{appliedCoupon.label}</span>
                    </div>
                    <button
                      onClick={handleRemoveCoupon}
                      className="text-white/50 hover:text-white text-xs underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={e => { setCouponInput(e.target.value); setCouponError(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCoupon(); } }}
                        placeholder="e.g. SPRING20"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                      />
                      <button
                        onClick={handleApplyCoupon}
                        disabled={!couponInput.trim() || isValidatingCoupon}
                        className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isValidatingCoupon ? '…' : 'Apply'}
                      </button>
                    </div>
                    {couponError && (
                      <p className="text-red-400 text-xs mt-2">{couponError}</p>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-4">
                {/* Client info for Trainerize provisioning */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-white/60 text-sm mb-1.5">Full Name *</label>
                    <input type="text" value={clientInfo.name} onChange={e => setClientInfo(p => ({ ...p, name: e.target.value }))} required placeholder="John Doe"
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors" />
                  </div>
                  <div>
                    <label className="block text-white/60 text-sm mb-1.5">Email *</label>
                    <input type="email" value={clientInfo.email} onChange={e => setClientInfo(p => ({ ...p, email: e.target.value }))} required placeholder="john@example.com"
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors" />
                  </div>
                  <div>
                    <label className="block text-white/60 text-sm mb-1.5">Phone</label>
                    <input type="tel" value={clientInfo.phone} onChange={e => setClientInfo(p => ({ ...p, phone: e.target.value }))} placeholder="(813) 421-0633"
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors" />
                  </div>
                </div>

                <div className="flex items-center gap-3 text-white/60 text-sm">
                  <Shield size={16} className="text-green-400" />
                  <span>Secure payment powered by Square</span>
                </div>

                {/* Digital wallet buttons — show based on device */}
                <div className="space-y-2">
                  <div id="apple-pay-button" className="min-h-0" />
                  <div id="google-pay-button" className="min-h-0" />
                  <div id="cashapp-button" className="min-h-0" />
                </div>

                {/* Divider if any wallet button is available */}
                {(paymentMethods?.applePay || paymentMethods?.googlePay || paymentMethods?.cashAppPay) && (
                  <div className="flex items-center gap-4 my-2">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-white/30 text-xs">or pay with card</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>
                )}

                {/* Card input */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div id="card-container" className="min-h-[50px]">
                    {!cardElement && (
                      <div className="bg-white/5 rounded-lg p-4 text-center">
                        <CreditCard className="mx-auto mb-2 text-white/40" size={32} />
                        <p className="text-white/50 text-sm">Loading payment form...</p>
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>
                )}

                <button
                  onClick={handlePayment}
                  disabled={isLoading || !clientInfo.name || !clientInfo.email || !cardElement}
                  className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </>
                  ) : !cardElement ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Loading payment form...
                    </>
                  ) : (
                    <>
                      <CreditCard size={18} />
                      Complete Purchase — {formatPrice(getCurrentPrice())}
                    </>
                  )}
                </button>

                <button onClick={() => setStep('trainer')} className="w-full text-white/60 hover:text-white text-sm py-2">
                  ← Back to trainer selection
                </button>
              </div>
            </div>
          )}

          {/* ===== SUCCESS ===== */}
          {step === 'success' && pendingAgreement && !agreementRecord && (
            <MemberAgreement
              paymentId={pendingAgreement.paymentId}
              client={clientInfo}
              snapshot={pendingAgreement.snapshot}
              onSigned={(record) => {
                // Just record the signing here. We do NOT fire onPurchaseComplete
                // yet — that closes the shop modal, which would unmount the
                // success view before the user can see "You're all set!".
                // Instead, the explicit "Continue to Schedule" button below
                // owns that transition. Either way the agreement is already
                // saved server-side at this point.
                setAgreementRecord(record);
              }}
            />
          )}

          {step === 'success' && agreementRecord && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="text-green-400" size={40} />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">You're all set!</h3>
              <p className="text-white/70 mb-4">
                Welcome to Alex Davis Fitness, {agreementRecord.signedName.split(' ')[0]}.
                Your {selectedPlan?.name} with {selectedTrainer?.name} is confirmed and your
                agreement is on file.
              </p>
              <div className="bg-white/5 rounded-lg p-4 mb-4 inline-block">
                <p className="text-white/60 text-sm">Amount paid</p>
                <p className="text-2xl font-bold text-white">{formatPrice(getCurrentPrice())}</p>
              </div>
              {!agreementRecord.storedRemotely && (
                <p className="text-yellow-300/80 text-xs mb-4 max-w-md mx-auto">
                  Your signed agreement is saved locally and will sync to our server next
                  time you open the site. You can continue with scheduling now.
                </p>
              )}
              <p className="text-white/50 text-sm mb-6">
                Pick your session times next, or close this and pick them later from your account.
              </p>
              <button
                onClick={() => {
                  // Fire the upstream callback that opens PostPurchaseBooking,
                  // then close + reset. App.tsx's handlePurchaseComplete already
                  // closes the shop AND opens the scheduler, so resetState here
                  // is just defensive in case the parent skips the close.
                  if (onPurchaseComplete && selectedPlan && selectedTrainer) {
                    onPurchaseComplete(selectedPlan, selectedTrainer, clientInfo);
                  }
                  onClose();
                  resetState();
                }}
                className="btn-primary text-sm"
              >
                Continue to Schedule
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanCard({ plan, onSelect }: { plan: TrainingPlan; onSelect: (plan: TrainingPlan) => void }) {
  const isClass = plan.category === 'class' || plan.category === 'single-session';

  return (
    <div
      onClick={() => onSelect(plan)}
      className={`bg-white/5 border rounded-xl p-5 cursor-pointer hover:bg-white/[0.07] transition-all group relative ${
        plan.popular ? 'border-[#FF4D2E]/40' : 'border-white/10 hover:border-[#FF4D2E]/30'
      }`}
    >
      {plan.popular && (
        <div className="absolute -top-3 left-4 bg-[#FF4D2E] text-white text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1">
          <Star size={12} /> Most Popular
        </div>
      )}

      {plan.salePrice && plan.originalPrice && (
        <div className="absolute -top-3 right-4 bg-green-500 text-white text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1">
          <Tag size={12} /> Sale
        </div>
      )}

      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 pr-4">
          <h3 className="text-white font-semibold group-hover:text-[#FF4D2E] transition-colors">
            {plan.name}
          </h3>
          {plan.description && (
            <p className="text-white/50 text-sm mt-1 line-clamp-2">{plan.description}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          {plan.salePrice && plan.originalPrice ? (
            <>
              <p className="text-white/40 text-sm line-through">{formatPrice(plan.originalPrice)}</p>
              <p className="text-2xl font-bold text-[#FF4D2E]">{formatPrice(plan.salePrice)}</p>
            </>
          ) : (
            <>
              <p className={`font-bold text-white ${isClass ? 'text-lg' : 'text-xl'}`}>{getPriceRange(plan)}</p>
              {plan.pricePerSession > 0 && (
                <p className="text-white/50 text-xs">${plan.pricePerSession}/session</p>
              )}
              {isClass && <p className="text-white/40 text-xs">per session</p>}
            </>
          )}
        </div>
      </div>

      {/* Meta row — only show relevant info */}
      <div className="flex items-center gap-4 text-white/50 text-sm mb-4">
        {plan.duration > 0 && (
          <span className="flex items-center gap-1">
            <Clock size={14} /> {plan.duration} min
          </span>
        )}
        {plan.planWeeks > 0 && (
          <span className="flex items-center gap-1">
            <Calendar size={14} /> {plan.planWeeks} weeks
          </span>
        )}
        {plan.frequency.length > 0 && (
          <span>1-{plan.frequency[plan.frequency.length - 1].perWeek}x/week</span>
        )}
      </div>

      {/* Features — only for structured plans */}
      {!isClass && plan.features.length > 0 && (
        <ul className="space-y-1 mb-4">
          {plan.features.slice(0, 3).map((feature, i) => (
            <li key={i} className="text-white/60 text-sm flex items-center gap-2">
              <Check size={14} className="text-[#FF4D2E] flex-shrink-0" />
              {feature}
            </li>
          ))}
        </ul>
      )}

      <button className="w-full py-2.5 bg-white/10 hover:bg-[#FF4D2E] text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2">
        {isClass ? 'Book Session' : 'Select Plan'} <ChevronRight size={16} />
      </button>
    </div>
  );
}
