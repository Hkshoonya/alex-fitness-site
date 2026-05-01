// Combined member agreement — Liability Waiver + Plan Terms + Card-on-File.
//
// Lives inside TrainingPlansShop's success step. After payment but before
// the user can move to scheduling, they sign here. Designed prop-driven
// (no modal chrome) so it can later be reused for free intro consults
// (waiver only) and challenges (waiver + challenge-terms variant).
//
// TODO — reuse paths still pending:
//   • JoinChallengeModal — needs Liability + challenge-specific terms.
//   • BookingModal free consults — Liability only, before slot is held.
//   • PostPurchaseBooking re-entry — abandonment recovery (handled in App.tsx).

import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Shield, CreditCard, AlertCircle, Loader2 } from 'lucide-react';
import {
  AGREEMENT_VERSION,
  LIABILITY_WAIVER_TEXT,
  PLAN_TERMS_TEXT,
  CARD_AUTHORIZATION_TEXT,
  FULL_AGREEMENT_TEXT,
  hashAgreementText,
} from '@/data/agreementText';
import { markAgreementSigned } from '@/api/squarePayments';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

export interface MemberAgreementSnapshot {
  planName: string;
  sessions: number;
  durationMinutes: number;
  amountPaid: number;
  trainerName?: string;
  paymentDate: string; // ISO
}

interface MemberAgreementProps {
  paymentId: string;
  client: { name: string; email: string; phone?: string };
  snapshot: MemberAgreementSnapshot;
  // Fired once the agreement is recorded (server OK or stashed locally for retry).
  onSigned: (record: SignedAgreementRecord) => void;
  // Optional override of submit URL — primarily for tests.
  workerUrl?: string;
}

export interface SignedAgreementRecord {
  paymentId: string;
  agreementVersion: string;
  signedAt: string; // ISO
  signedName: string;
  isMinor: boolean;
  childName?: string;
  parentSignature?: string;
  textHash: string;
  storedRemotely: boolean; // false = pending retry from localStorage
}

export default function MemberAgreement({
  paymentId,
  client,
  snapshot,
  onSigned,
  workerUrl,
}: MemberAgreementProps) {
  const url = workerUrl ?? WORKER_URL;

  const [isMinor, setIsMinor] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [childName, setChildName] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentSignature, setParentSignature] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pre-fill the typed-signature field with the name on the purchase. They
  // can edit, but the default reduces friction for the 95% case.
  useEffect(() => {
    if (!signatureName && client.name) setSignatureName(client.name);
  }, [client.name, signatureName]);

  // Single combined accept covers all three sections. We send all three
  // consents=true to the worker for backwards compatibility — the user's
  // intent is identical (one act of acceptance covers the bundle), and
  // the worker's existing validation is unchanged. Legal weight comes from
  // the typed signature + version-pinned text hash + IP, not the number of
  // checkboxes.
  const allConsentsTicked = accepted;

  const adultSignatureValid =
    !isMinor && signatureName.trim().length >= 2;

  // Minor flow requires all three: child name, parent legal name, parent
  // typed signature. Empty / blank fields are not OK.
  const minorSignatureValid =
    isMinor &&
    childName.trim().length >= 2 &&
    parentName.trim().length >= 2 &&
    parentSignature.trim().length >= 2;

  const canSubmit = allConsentsTicked && (adultSignatureValid || minorSignatureValid) && !submitting;

  const formattedPaymentDate = useMemo(() => {
    try {
      return new Date(snapshot.paymentDate).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch {
      return snapshot.paymentDate;
    }
  }, [snapshot.paymentDate]);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setSubmitError(null);

    const textHash = await hashAgreementText();
    const signedAt = new Date().toISOString();

    // Body sent to /api/agreement/sign. Worker stores all of this immutably.
    // We send `agreementText` alongside `textHash` so the worker can re-hash
    // server-side and verify integrity (defense-in-depth) AND can embed the
    // exact signed text in the notification email + KV record without having
    // to maintain a duplicate copy of the legal text.
    const body = {
      paymentId,
      agreementVersion: AGREEMENT_VERSION,
      signedAt,
      email: client.email,
      phone: client.phone || null,
      signedName: isMinor ? parentSignature.trim() : signatureName.trim(),
      legalName: isMinor ? parentName.trim() : signatureName.trim(),
      isMinor,
      childName: isMinor ? childName.trim() : null,
      parentSignature: isMinor ? parentSignature.trim() : null,
      textHash,
      agreementText: FULL_AGREEMENT_TEXT,
      consents: {
        liability: accepted,
        planTerms: accepted,
        cardOnFile: accepted,
      },
      planSnapshot: snapshot,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };

    const localKey = `pending_agreement_${paymentId}`;
    const localPayload = JSON.stringify({ body, queuedAt: Date.now() });

    let storedRemotely = false;

    if (url) {
      try {
        const response = await fetch(`${url}/api/agreement/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          storedRemotely = true;
          // Clean up any prior queued attempt for this payment.
          try { localStorage.removeItem(localKey); } catch { /* ignore */ }
        } else {
          // Queue for App.tsx mount-time retry. The user paid — we don't
          // block them on a transient worker error, but we don't lose the
          // signature either.
          try { localStorage.setItem(localKey, localPayload); } catch { /* ignore */ }
          console.warn('Agreement remote save failed, queued locally:', response.status);
        }
      } catch (err) {
        try { localStorage.setItem(localKey, localPayload); } catch { /* ignore */ }
        console.warn('Agreement remote save errored, queued locally:', err);
      }
    } else {
      // No worker URL — dev / mock mode. Queue locally.
      try { localStorage.setItem(localKey, localPayload); } catch { /* ignore */ }
    }

    // Mark the local purchase record as signed regardless of remote-store
    // outcome — local UI gates use this flag and the worker retry effect
    // in App.tsx will eventually flush a queued POST. Either way the
    // signature exists at least on this device.
    try { markAgreementSigned(paymentId); } catch { /* purchases storage may be wiped */ }

    setSubmitting(false);

    onSigned({
      paymentId,
      agreementVersion: AGREEMENT_VERSION,
      signedAt,
      signedName: body.signedName,
      isMinor,
      childName: body.childName || undefined,
      parentSignature: body.parentSignature || undefined,
      textHash,
      storedRemotely,
    });
  };

  return (
    <div className="text-left space-y-6">
      {/* Header — what they bought */}
      <div className="bg-gradient-to-br from-[#FF4D2E]/10 to-[#FF4D2E]/5 border border-[#FF4D2E]/20 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
            <Check size={20} className="text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold">Payment received — almost done</p>
            <p className="text-white/60 text-sm mt-1">
              Please review and sign the agreement below to finalize your enrollment.
              This protects both you and Alex, and it's required before scheduling sessions.
            </p>
          </div>
        </div>
      </div>

      {/* Plan summary card — the data we'll snapshot into the signed record */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider">Member</p>
          <p className="text-white font-medium truncate">{client.name}</p>
          <p className="text-white/50 text-xs truncate">{client.email}</p>
        </div>
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider">Plan</p>
          <p className="text-white font-medium truncate">{snapshot.planName}</p>
          <p className="text-white/50 text-xs">
            {snapshot.sessions} session{snapshot.sessions === 1 ? '' : 's'}
            {snapshot.durationMinutes > 0 && ` • ${snapshot.durationMinutes} min each`}
          </p>
        </div>
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider">Amount paid today</p>
          <p className="text-white font-medium">${snapshot.amountPaid.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider">Date</p>
          <p className="text-white font-medium">{formattedPaymentDate}</p>
        </div>
      </div>

      {/* Minor toggle */}
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-white/80 text-sm">
            This agreement is for a minor (under 18). I am the parent or legal guardian signing on their behalf.
          </span>
          <span className="relative shrink-0">
            <input
              type="checkbox"
              checked={isMinor}
              onChange={e => setIsMinor(e.target.checked)}
              className="sr-only peer"
            />
            <span
              className={`w-11 h-6 rounded-full transition-colors block ${
                isMinor ? 'bg-[#FF4D2E]' : 'bg-white/20'
              }`}
            />
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                isMinor ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
        </label>
      </div>

      {/* Single User Agreement collapsible — opens to reveal all three
          sections inline with their own sub-headers. One click target, full
          legal text on tap. */}
      <UserAgreementBlock />

      {/* Single combined acceptance — covers everything in the User Agreement. */}
      <div className="bg-[#FF4D2E]/[0.06] border border-[#FF4D2E]/20 rounded-xl p-4">
        <ConsentRow
          checked={accepted}
          onChange={setAccepted}
          label="I have read and accept the User Agreement above (Liability Waiver, Plan Terms, and Card-on-File Authorization)."
        />
      </div>

      {/* Signature block — adult or minor variant */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <p className="text-white font-semibold mb-1">Signature</p>
        <p className="text-white/50 text-xs mb-4">
          Type your full legal name. Your typed name has the same legal effect as a handwritten signature.
        </p>

        {!isMinor && (
          <div>
            <label className="block text-white/70 text-xs mb-1.5">Full legal name</label>
            <input
              type="text"
              value={signatureName}
              onChange={e => setSignatureName(e.target.value)}
              placeholder="e.g. Alex Davis"
              className="w-full bg-black/30 border border-white/10 focus:border-[#FF4D2E] rounded-lg px-3 py-2.5 text-white placeholder-white/30 outline-none transition-colors"
              autoComplete="name"
            />
          </div>
        )}

        {isMinor && (
          <div className="space-y-3">
            <div>
              <label className="block text-white/70 text-xs mb-1.5">Child's full name</label>
              <input
                type="text"
                value={childName}
                onChange={e => setChildName(e.target.value)}
                placeholder="The minor enrolled"
                className="w-full bg-black/30 border border-white/10 focus:border-[#FF4D2E] rounded-lg px-3 py-2.5 text-white placeholder-white/30 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-white/70 text-xs mb-1.5">Parent or guardian — full legal name</label>
              <input
                type="text"
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                placeholder="Your full legal name"
                className="w-full bg-black/30 border border-white/10 focus:border-[#FF4D2E] rounded-lg px-3 py-2.5 text-white placeholder-white/30 outline-none transition-colors"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="block text-white/70 text-xs mb-1.5">Parent or guardian — type your signature</label>
              <input
                type="text"
                value={parentSignature}
                onChange={e => setParentSignature(e.target.value)}
                placeholder="Type your name to sign"
                className="w-full bg-black/30 border border-white/10 focus:border-[#FF4D2E] rounded-lg px-3 py-2.5 text-white placeholder-white/30 outline-none transition-colors font-display italic"
              />
            </div>
          </div>
        )}

        <p className="text-white/40 text-xs mt-3">
          Signed on {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          {' '}— Agreement version {AGREEMENT_VERSION}
        </p>
      </div>

      {submitError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-300 text-sm">{submitError}</p>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
          canSubmit
            ? 'bg-[#FF4D2E] hover:bg-[#FF4D2E]/90 text-white'
            : 'bg-white/5 text-white/30 cursor-not-allowed'
        }`}
      >
        {submitting ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Saving signature…
          </>
        ) : (
          <>
            <Check size={18} />
            Sign &amp; Continue to Schedule
          </>
        )}
      </button>

      {!canSubmit && !submitting && (
        <p className="text-white/40 text-xs text-center">
          {!allConsentsTicked
            ? 'Tick the acceptance box above to enable.'
            : isMinor
              ? 'Fill in the child\'s name, parent name, and parent signature.'
              : 'Type your full legal name to sign.'}
        </p>
      )}

      {/* Hash footnote — same text the worker hashes. Reassures the user
          (and any auditor) that this exact text is what gets archived. */}
      <details className="text-xs text-white/30">
        <summary className="cursor-pointer hover:text-white/50 transition-colors">
          What gets recorded when I sign?
        </summary>
        <p className="mt-2 leading-relaxed">
          We record your signed name, the date and time you signed, your IP address,
          your email, the plan you bought, and a cryptographic fingerprint of the
          exact agreement text shown above (version {AGREEMENT_VERSION}). This lets
          both you and Alex prove what was agreed, even if the wording later changes
          for new members. We do not record your card number or any payment details
          beyond Square's payment ID.
        </p>
        <pre className="mt-3 p-2 bg-black/30 border border-white/10 rounded text-[10px] whitespace-pre-wrap break-words leading-snug max-h-40 overflow-y-auto">
{FULL_AGREEMENT_TEXT}
        </pre>
      </details>
    </div>
  );
}

/**
 * Single collapsible "User Agreement" block. Header shows a one-line
 * summary of what's inside; expanded view renders all three sub-sections
 * with their own icons + titles so the structure is preserved. One click
 * target instead of three — same legal text, less visual noise.
 */
function UserAgreementBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors"
        aria-expanded={open}
      >
        <span className="shrink-0 w-9 h-9 rounded-lg bg-[#FF4D2E]/15 flex items-center justify-center">
          <FileText size={18} className="text-[#FF4D2E]" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-white font-semibold text-sm">User Agreement</span>
          <span className="block text-white/50 text-xs mt-0.5 line-clamp-2">
            Liability waiver, fitness plan &amp; cancellation terms, and card-on-file authorization.
          </span>
        </span>
        <span className="shrink-0 text-white/60 text-xs flex items-center gap-1">
          {open ? 'Hide' : 'Read'}
          <span
            className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            ▾
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 sm:px-5 py-4 space-y-5">
          <SubSection
            icon={<Shield size={16} className="text-[#FF4D2E]" />}
            title="1. Personal Training Liability Waiver"
            body={LIABILITY_WAIVER_TEXT}
          />
          <div className="border-t border-white/5" />
          <SubSection
            icon={<FileText size={16} className="text-[#FF4D2E]" />}
            title="2. Fitness Plan & Cancellation Terms"
            body={PLAN_TERMS_TEXT}
          />
          <div className="border-t border-white/5" />
          <SubSection
            icon={<CreditCard size={16} className="text-[#FF4D2E]" />}
            title="3. Card-on-File Authorization"
            body={CARD_AUTHORIZATION_TEXT}
          />
        </div>
      )}
    </div>
  );
}

function SubSection({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h5 className="text-white font-semibold text-sm">{title}</h5>
      </div>
      <p className="text-white/70 text-sm leading-relaxed whitespace-pre-line">
        {body}
      </p>
    </div>
  );
}

function ConsentRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <span className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <span
          className={`w-5 h-5 rounded border-2 transition-colors flex items-center justify-center ${
            checked ? 'bg-[#FF4D2E] border-[#FF4D2E]' : 'bg-transparent border-white/30'
          }`}
        >
          {checked && <Check size={14} className="text-white" strokeWidth={3} />}
        </span>
      </span>
      <span className="text-white/90 text-sm leading-snug font-medium">{label}</span>
    </label>
  );
}
