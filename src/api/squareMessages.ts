// Square Messages Integration
// Sends messages to Alex via Square's "external inbound" messenger endpoint —
// the same backend pipe Alex's main site (alexsfitness.com) uses for its
// Square Messages chat widget. Messages here land in his Square Messages
// inbox and trigger push notifications on the Square POS app on his phone.
//
// Pre-launch hardening (audit 2026-05-01): the actual Square POST is now
// proxied through the worker at /api/messages/send so the seller_key never
// appears in the browser bundle. The browser still generates a reCAPTCHA
// token (Google's site key has to be in the bundle by design) and forwards
// it; the worker performs the inbound POST with the seller_key from a
// wrangler secret.

const ALEX_PHONE = '8134210633';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

// Square's public reCAPTCHA v3 site key, embedded in their messages-plugin
// JS bundle. The key isn't domain-locked, so we can re-use it from our
// origin too. Spam protection is enforced server-side by Square — Google
// scores the request and Square rejects low-confidence ones.
const RECAPTCHA_SITE_KEY = '6LdIjoYhAAAAANT4Xy0LaHGw4_e_1FKcwveKCxY6';

// Lazy-load reCAPTCHA on first use to keep the third-party script off the
// critical path. Idempotent — repeat calls return the same promise.
let recaptchaPromise: Promise<unknown> | null = null;
function loadRecaptcha(): Promise<unknown> {
  if (recaptchaPromise) return recaptchaPromise;
  recaptchaPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { grecaptcha?: { ready: (cb: () => void) => void; execute: (key: string, opts: { action: string }) => Promise<string> } };
    if (w.grecaptcha?.execute) {
      resolve(w.grecaptcha);
      return;
    }
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      // grecaptcha.ready may not be available immediately on script load.
      const tick = () => {
        if (w.grecaptcha?.ready) {
          w.grecaptcha.ready(() => resolve(w.grecaptcha!));
        } else {
          setTimeout(tick, 50);
        }
      };
      tick();
    };
    s.onerror = () => reject(new Error('recaptcha script failed to load'));
    document.head.appendChild(s);
  });
  return recaptchaPromise;
}

async function getRecaptchaToken(): Promise<string> {
  try {
    const grecaptcha = (await loadRecaptcha()) as { execute: (key: string, opts: { action: string }) => Promise<string> };
    return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'submit' });
  } catch {
    // Soft-fail. Empty token still goes through Square's first validation
    // layer (phone-number realism check), so the message can succeed even
    // without a captcha. Better deliver-without-bot-protection than fail-
    // closed and lose the lead.
    return '';
  }
}

/**
 * Send a message to Alex via the worker proxy. The worker forwards to
 * Square's messenger/inbound/external with the seller_key (worker secret),
 * applies rate + per-phone daily caps, and returns a normalized result.
 */
export async function sendMessageToAlex(params: {
  senderName: string;
  senderPhone: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {

  const tenDigits = params.senderPhone.replace(/\D/g, '').slice(-10);
  if (tenDigits.length !== 10) {
    return { success: false, error: 'Phone number must be 10 digits (US)' };
  }
  if (!WORKER_URL) {
    return { success: false, error: `Messaging unavailable. Please text Alex at ${ALEX_PHONE}.` };
  }

  try {
    const recaptchaToken = await getRecaptchaToken();
    const resp = await fetch(`${WORKER_URL}/api/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderName: params.senderName,
        senderPhone: tenDigits,
        message: params.message,
        recaptchaToken,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.success) {
      storeMessage(params);
      return { success: true };
    }
    storeMessage(params);
    const errorMsg = data.error || 'Could not deliver message';
    return {
      success: false,
      error: `${errorMsg}. Please try again or text Alex at ${ALEX_PHONE}.`,
    };
  } catch (error) {
    console.error('Square message failed:', error);
    storeMessage(params);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Could not deliver message: ${msg}. Please try again or text ${ALEX_PHONE}.`,
    };
  }
}

function storeMessage(params: { senderName: string; senderPhone: string; message: string }) {
  let messages: unknown[] = [];
  try {
    const raw = localStorage.getItem('alex_messages');
    if (raw) messages = JSON.parse(raw);
    if (!Array.isArray(messages)) messages = [];
  } catch { messages = []; }
  messages.push({ ...params, sentAt: new Date().toISOString(), read: false });
  try { localStorage.setItem('alex_messages', JSON.stringify(messages)); } catch { /* quota / private mode */ }
}

export function getAlexSmsLink(message?: string): string {
  const encoded = message ? encodeURIComponent(message) : '';
  return `sms:${ALEX_PHONE}${encoded ? `?body=${encoded}` : ''}`;
}

export function getAlexCallLink(): string {
  return `tel:${ALEX_PHONE}`;
}
