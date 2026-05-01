// Member agreement legal text — single source of truth.
//
// IMPORTANT — when changing wording, BUMP `AGREEMENT_VERSION`. The worker
// stores `agreementVersion` with every signed record. Old signed records keep
// pointing to the old text via their version string, so we can always prove
// what a given member actually agreed to.
//
// The text below is rewritten from the original PDFs in /docsfor to:
//   1. Use plain language (not "I hereby for myself, my heirs, executors,
//      administrators, assigns, or personal representatives" boilerplate).
//   2. Match current operational reality — purchases are one-time charges,
//      not auto-renewing subscriptions. The card-on-file authorization
//      pre-authorizes future renewal charges that still require the member
//      to confirm each one.
//   3. Be readable on a mobile screen.

export const AGREEMENT_VERSION = 'v1' as const;

export const LIABILITY_WAIVER_TEXT = `I am voluntarily starting personal training with Alex Davis Fitness. I understand that fitness training carries real risk — including physical or psychological injury, illness, temporary or permanent disability, and in extreme cases death. This risk extends to traveling to and from sessions.

In exchange for the right to participate, I release Alex Davis, Alex Davis Athletics Co., and its trainers, agents, staff, and representatives from any and all claims, lawsuits, or causes of action arising out of my participation in training — including claims based on negligence.

This release binds me, my heirs, my executors, and my representatives. I voluntarily give up the right to bring legal action for personal injury or property damage related to my training.

I have read this waiver and I understand it is a release of liability.`;

export const PLAN_TERMS_TEXT = `I am enrolling in the plan listed above. Today's payment is a one-time charge for this plan — no recurring charges happen automatically without my explicit confirmation.

Cancellation policy
• Sessions — I will give at least 24 hours' notice to reschedule. Sessions cancelled inside 24 hours are forfeit and will not be rescheduled.
• Plans — I may pause or cancel my plan at any time by contacting Alex with at least 7 days' written notice. Sessions I have already used are not refunded.
• Refunds — Refunds for unused sessions are at Alex's discretion and are not guaranteed.

I understand that scheduling conflicts and emergencies happen and Alex will work with me in good faith on those.`;

export const CARD_AUTHORIZATION_TEXT = `I authorize Alex Davis Athletics Co. to keep the card I used today on file for future use. By signing below I confirm:

• Alex may charge this card for additional sessions or plan renewals only after I confirm each charge (by email, text, or in-person).
• Alex will not charge this card automatically without my explicit confirmation for each individual charge.
• I may revoke this authorization at any time by contacting Alex; revocation does not refund any past charge already authorized and processed.
• The card I used today belongs to me, or I am authorized to use it on behalf of the cardholder.
• I understand my card details (full number, CVV) are stored securely by Square — Alex does not see or store them. Only the last four digits and the brand are visible to Alex.`;

// Concatenated text used for the SHA-256 hash — proves what was signed
// independently of the version string. Both frontend and worker compute
// the hash from this exact string.
export const FULL_AGREEMENT_TEXT = [
  `# Liability Waiver`,
  LIABILITY_WAIVER_TEXT,
  ``,
  `# Fitness Plan & Cancellation Terms`,
  PLAN_TERMS_TEXT,
  ``,
  `# Card-on-File Authorization`,
  CARD_AUTHORIZATION_TEXT,
].join('\n');

/**
 * Compute SHA-256 hash of the full agreement text. Browsers expose this
 * via SubtleCrypto. Workers expose the same API. Both sides hash the same
 * string and the worker stores the hash with the signed record.
 *
 * Returns a lowercase hex string.
 */
export async function hashAgreementText(text: string = FULL_AGREEMENT_TEXT): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
