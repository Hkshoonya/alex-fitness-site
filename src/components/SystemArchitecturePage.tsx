// System Architecture Page
// ──────────────────────────────────────────────────────────────────
// A live-feeling, animated systems map of the Alex Davis Fitness platform.
// Six sections, each renders independently so partial ship is safe:
//   1. Hero — what this page is + headline counts
//   2. Architecture diagram — interactive SVG, click any node to highlight
//      the connections that flow through it
//   3. Automation pipelines — five swimlanes (purchase, booking, no-show,
//      refund, people-sync) showing sequenced steps
//   4. Smartness showcase — non-obvious engineering patterns worth crediting
//   5. Engineering complexity matrix — Effort/Logic/hero detail per piece
//
// GSAP idiom mirrors src/App.tsx: timeline + ScrollTrigger + ref targets,
// cleaned up on unmount via ScrollTrigger.getAll().forEach(st => st.kill()).
import { useEffect, useRef, useState, useMemo } from 'react';
import type { RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Activity, Globe, Server, Database, CreditCard, Users, Calendar,
  AlertTriangle, RotateCcw, GitMerge, Zap, ShieldCheck, Clock,
  ChevronRight, Cpu, Webhook, Lock, Sparkles,
  Workflow, ShieldAlert, DollarSign,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

// ──────────────────────────────────────────────────────────────────
// Architecture node + edge model
// ──────────────────────────────────────────────────────────────────
// The diagram is a static topology — nodes have fixed coordinates so the
// SVG layout stays predictable. Edges carry a `flows` array of human-readable
// data labels; clicking a node filters edges to just the ones it touches,
// which is the "what does this thing actually do" payoff.

type NodeId =
  | 'user' | 'browser' | 'worker' | 'kv' | 'square' | 'trainerize' | 'cron';

interface DiagramNode {
  id: NodeId;
  label: string;
  sublabel: string;
  x: number;     // SVG coordinate
  y: number;
  Icon: typeof Globe;
  color: string; // tailwind text color for the icon
  ring: string;  // tailwind ring/border color
  fill: string;  // tailwind bg color for the node card
}

interface DiagramEdge {
  from: NodeId;
  to: NodeId;
  flows: string[];      // labels shown when edge is highlighted
  curve?: number;       // curvature offset; positive bows perpendicular
  bidirectional?: boolean;
}

const NODES: DiagramNode[] = [
  { id: 'user',       label: 'Client',          sublabel: 'web + mobile',         x: 96,  y: 240, Icon: Users,      color: 'text-sky-300',    ring: 'ring-sky-400/40',    fill: 'bg-sky-500/10' },
  { id: 'browser',    label: 'React Frontend',  sublabel: 'Vite · GitHub Pages',  x: 280, y: 240, Icon: Globe,      color: 'text-violet-300', ring: 'ring-violet-400/40', fill: 'bg-violet-500/10' },
  { id: 'worker',     label: 'Cloudflare Worker', sublabel: 'central hub',        x: 520, y: 240, Icon: Server,     color: 'text-[#FF4D2E]',  ring: 'ring-[#FF4D2E]/50',  fill: 'bg-[#FF4D2E]/10' },
  { id: 'kv',         label: 'Workers KV',      sublabel: 'edge state · TTL',     x: 520, y: 420, Icon: Database,   color: 'text-amber-300',  ring: 'ring-amber-400/40',  fill: 'bg-amber-500/10' },
  { id: 'square',     label: 'Square',          sublabel: 'payments + bookings',  x: 760, y: 140, Icon: CreditCard, color: 'text-emerald-300',ring: 'ring-emerald-400/40',fill: 'bg-emerald-500/10' },
  { id: 'trainerize', label: 'Trainerize',      sublabel: 'coaching app · v03',   x: 760, y: 340, Icon: Activity,   color: 'text-rose-300',   ring: 'ring-rose-400/40',   fill: 'bg-rose-500/10' },
  { id: 'cron',       label: 'Cron Triggers',   sublabel: '15min · daily 04:00',  x: 280, y: 420, Icon: Clock,      color: 'text-indigo-300', ring: 'ring-indigo-400/40', fill: 'bg-indigo-500/10' },
];

// Edges describe the *logical* relationships, not raw HTTP calls. The labels
// are what's actually flowing from a domain perspective — that's what the
// reader cares about, not "GET /v2/customers".
const EDGES: DiagramEdge[] = [
  { from: 'user',    to: 'browser',    flows: ['Booking & checkout interactions', 'Admin actions'] },
  { from: 'browser', to: 'worker',     flows: ['Charge card · book session · validate coupon', 'Admin token-gated calls'] },
  { from: 'worker',  to: 'square',     flows: ['Payments · Catalog · Bookings · Discounts · Customers'], bidirectional: true, curve: -40 },
  { from: 'worker',  to: 'trainerize', flows: ['Sessions, credits, messages, trainer notes (v03 RPC)'], bidirectional: true, curve: 40 },
  { from: 'worker',  to: 'kv',         flows: ['Linkage, idempotency keys, webhook dedup, rate-limit windows'], bidirectional: true },
  { from: 'square',  to: 'worker',     flows: ['Webhook: payment.completed, booking.created/updated, invoice.*'], curve: 40 },
  { from: 'cron',    to: 'worker',     flows: ['Scheduled: people-sync, TZ→SQ booking reverse-sync'] },
  { from: 'browser', to: 'square',     flows: ['Web Payments SDK tokenizes card (PCI scope)'], curve: 80 },
];

// ──────────────────────────────────────────────────────────────────
// Automation pipelines (the swimlanes section)
// ──────────────────────────────────────────────────────────────────
type PipelineActor = 'user' | 'browser' | 'worker' | 'square' | 'trainerize' | 'kv' | 'cron';

interface PipelineStep {
  who: PipelineActor;
  what: string;
  detail?: string;
}

interface Pipeline {
  id: string;
  title: string;
  Icon: typeof CreditCard;
  accent: string;
  glow: string;
  description: string;
  steps: PipelineStep[];
}

const PIPELINES: Pipeline[] = [
  {
    id: 'purchase',
    title: 'Plan purchase → credits',
    Icon: CreditCard,
    accent: 'text-emerald-300',
    glow: 'shadow-emerald-500/20',
    description: 'A new client buys a 4-week 30-min plan with a coupon. From card swipe to Trainerize credits, every step is observable and retry-safe.',
    steps: [
      { who: 'browser',    what: 'Square Web Payments tokenizes card', detail: 'Card data never touches the worker; PCI scope stays in the browser.' },
      { who: 'browser',    what: 'POST /checkout/validate-coupon',     detail: '5-min cached lookup against Square Discounts catalog.' },
      { who: 'worker',     what: 'Resolve plan + coupon authoritatively', detail: 'Browser sends only IDs — worker re-fetches Square price, applies discount, computes amount.' },
      { who: 'worker',     what: 'POST /checkout/charge', detail: 'Idempotency key per request prevents double-charge on retry.' },
      { who: 'square',     what: 'payments.create succeeds', detail: 'Plan claim JSON is embedded in payment.note for replay.' },
      { who: 'browser',    what: 'POST /credit-grant', detail: 'Re-resolves Square price + coupon; rejects if amount drifted from the charge.' },
      { who: 'trainerize', what: 'Credits added + welcome message sent', detail: 'Trainer note + audit log entry written for Alex.' },
      { who: 'kv',         what: 'Sentinels written: credit-handled, session-counted', detail: 'Prevents double-grant if the webhook arrives later.' },
    ],
  },
  {
    id: 'booking',
    title: 'Book a session',
    Icon: Calendar,
    accent: 'text-violet-300',
    glow: 'shadow-violet-500/20',
    description: 'Client picks a slot. Square is source of truth for availability; Trainerize gets the appointment so the coach sees it in their app.',
    steps: [
      { who: 'browser',    what: 'GET /availability?date=…&duration=60', detail: 'Worker calls Square bookings/availability/search; overlays Trainerize blocks.' },
      { who: 'worker',     what: 'Apply 90-min buffer rule', detail: 'Slots within 90 minutes need coach confirmation (UI shows amber).' },
      { who: 'browser',    what: 'POST /bookings/validate', detail: 'Last-line check the slot is still open (race-safe).' },
      { who: 'square',     what: 'bookings.create commits', detail: 'Idempotency key prevents duplicate on network retry.' },
      { who: 'square',     what: 'webhook → /webhook (booking.created)', detail: 'Worker verifies signature, dedupes by event_id.' },
      { who: 'trainerize', what: 'appointment.add (virtual type 2845440)', detail: 'In-person types need a locationID our key cannot access — virtual works.' },
      { who: 'trainerize', what: 'Confirmation message + trainer note', detail: 'Coach sees “New session booked” inside the Trainerize app.' },
    ],
  },
  {
    id: 'noshow',
    title: 'Late-cancel & no-show enforcement',
    Icon: AlertTriangle,
    accent: 'text-amber-300',
    glow: 'shadow-amber-500/20',
    description: 'Three nets catch missed sessions: real-time webhook, manual coach action, and a daily cron safety net. A credit is deducted at most once.',
    steps: [
      { who: 'square',     what: 'Webhook: booking.updated (status=NO_SHOW or late cancel)' },
      { who: 'worker',     what: 'Compute hours-until-start at cancel time', detail: '< 24 hr → late-cancel; never started → no-show.' },
      { who: 'kv',         what: 'Check session-counted:{bookingId}', detail: 'If already counted, skip (idempotent — same event can fire twice).' },
      { who: 'trainerize', what: '/credit/deduct on coach Alex', detail: 'Single session removed from client\'s remaining count.' },
      { who: 'trainerize', what: 'Trainer note + courtesy DM sent', detail: 'Client gets policy reminder; coach sees deduction reason.' },
      { who: 'cron',       what: 'Daily 04:00 UTC safety-net pass', detail: 'Catches anything the webhook missed; same KV sentinel prevents double-decrement.' },
    ],
  },
  {
    id: 'refund',
    title: 'Admin refunds a credit',
    Icon: RotateCcw,
    accent: 'text-sky-300',
    glow: 'shadow-sky-500/20',
    description: 'Coach Alex can restore a session credit from the admin panel. Reason is required so the audit trail and Trainerize note both record why.',
    steps: [
      { who: 'browser',    what: 'Admin Credits tab → POST /admin/refund-credit', detail: 'Identifier (email or Trainerize userId) + sessions + reason.' },
      { who: 'worker',     what: 'Verify X-Admin-Token against ADMIN_LOG_TOKEN', detail: 'Constant-time comparison; rate-limited.' },
      { who: 'trainerize', what: '/credit/refund (with optional total bump)', detail: 'Bump-total option raises lifetime credits, not just current balance.' },
      { who: 'trainerize', what: 'Client DM + trainer note posted', detail: 'Both reference the reason supplied by admin.' },
      { who: 'kv',         what: 'Audit event written with original TTL preserved', detail: '90-day retention for the audit trail; refund visible in admin log endpoint.' },
    ],
  },
  {
    id: 'peoplesync',
    title: 'People-sync (Trainerize ↔ Square identity)',
    Icon: GitMerge,
    accent: 'text-rose-300',
    glow: 'shadow-rose-500/20',
    description: '29 active Trainerize clients had no Square email — they couldn\'t use the portal. A nightly bidirectional reconciler keeps email/phone/firstName/lastName in lockstep.',
    steps: [
      { who: 'cron',       what: 'Daily 04:00 UTC fires reconcile job', detail: 'KV mutex prevents overlap if a run takes >15 min.' },
      { who: 'worker',     what: 'Tier 1 link: email exact match', detail: 'Lowercased; the safest signal.' },
      { who: 'worker',     what: 'Tier 2 link: phone last-10 + corroboration', detail: 'Requires name overlap or shared email domain — catches household-phone false-positives (e.g. Vaneeka/Micah).' },
      { who: 'worker',     what: 'Tier 3 link: full name match (only if SQ email blank)', detail: 'Last resort; never overwrites existing identifiers.' },
      { who: 'worker',     what: 'Apply policy: P2 (Trainerize wins) on drift', detail: 'But only when names align. Conflicts go to a queue, never auto-merged.' },
      { who: 'kv',         what: 'snap:link:{tzId}:{sqId} updated only on success', detail: 'If subrequest cap is hit mid-batch, snap is NOT advanced — retry next night with no false confidence.' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────
// Smartness showcase — patterns worth crediting
// ──────────────────────────────────────────────────────────────────
interface SmartCard {
  title: string;
  why: string;
  Icon: typeof Sparkles;
  tint: string;
}

const SMART_CARDS: SmartCard[] = [
  {
    title: 'Server-side authoritative pricing',
    why: 'Browser sends only plan IDs and coupon codes. Worker re-fetches the live Square price + discount and computes the amount itself. Closes the C-02 audit finding where a tampered browser could have undercharged.',
    Icon: ShieldCheck,
    tint: 'text-emerald-300',
  },
  {
    title: 'Idempotency keys everywhere',
    why: 'Square charges, bookings, and credit grants all carry stable idempotency keys. A network retry never produces a second charge or a duplicate session credit.',
    Icon: Lock,
    tint: 'text-sky-300',
  },
  {
    title: 'Triple-net credit deduction',
    why: 'Webhooks (real-time), manual coach action, and a daily cron safety net all hit the same KV sentinel. Whatever fires first wins; the others see “already counted” and skip.',
    Icon: Webhook,
    tint: 'text-amber-300',
  },
  {
    title: 'KV TTL preservation on refund',
    why: 'Refunding a credit doesn\'t clobber the audit trail\'s remaining TTL — the original 90-day retention window is preserved so refunds remain visible until the original event would have expired.',
    Icon: Database,
    tint: 'text-violet-300',
  },
  {
    title: 'Square Discounts as coupon codes',
    why: 'No separate coupon system. Square Discounts in the catalog are the codes — name-as-code or PIN-as-code. Coach edits Square; site picks it up on the next 5-min cache refresh.',
    Icon: Sparkles,
    tint: 'text-rose-300',
  },
  {
    title: '90-min booking buffer + 24-hr cancel policy',
    why: 'Bookings within 90 minutes need coach confirmation (amber UI). Cancellations under 24 hr trigger a credit-loss warning before submit, then enforce the deduction server-side.',
    Icon: Clock,
    tint: 'text-indigo-300',
  },
  {
    title: 'Webhook signature verification',
    why: 'Every Square webhook is HMAC-verified against SQUARE_WEBHOOK_SIGNATURE_KEY before any state change. Attempts that fail signature are logged to KV with a fingerprint, not silently ignored.',
    Icon: Lock,
    tint: 'text-emerald-300',
  },
  {
    title: 'Snap-on-success-only writes',
    why: 'People-sync only advances the linkage snapshot when the underlying writes succeed. If the Cloudflare 1000-subrequest cap aborts a batch mid-stream, the next night retries with no false confidence.',
    Icon: Cpu,
    tint: 'text-sky-300',
  },
];

// ──────────────────────────────────────────────────────────────────
// Engineering complexity matrix — every column is a deliberate choice:
// `effort` is build-time burden, `logic` is reasoning depth (1-5), `hero`
// is the single most non-obvious detail in that area.
// ──────────────────────────────────────────────────────────────────
interface ComplexityRow {
  area: string;
  effort: 'S' | 'M' | 'L';
  logic: 1 | 2 | 3 | 4 | 5;
  hero: string;
}

const COMPLEXITY_ROWS: ComplexityRow[] = [
  { area: 'Cloudflare Worker (central hub)',     effort: 'L', logic: 5, hero: '~3,000 lines: proxy, webhooks, cron, admin endpoints, rate limits — single source of business logic.' },
  { area: 'Square integration (catalog + payments)', effort: 'L', logic: 4, hero: 'Catalog auto-discovery means Alex edits Square; site updates without a code change.' },
  { area: 'Trainerize v03 client (RPC over HTTP)', effort: 'M', logic: 4, hero: 'Every endpoint is POST with JSON body; field names are non-obvious (trainerNote uses `content`, not `note`).' },
  { area: 'People-sync reconciler',                effort: 'L', logic: 5, hero: 'Three-tier linkage with corroboration guards + P2-conservative merge policy. Avoids household-phone false-positives.' },
  { area: 'Booking calendar + buffer rules',       effort: 'M', logic: 4, hero: 'Square availability search overlaid with Trainerize blocks — neither system fully knows about the other.' },
  { area: 'Webhook handler & signature verify',    effort: 'M', logic: 4, hero: 'HMAC verify + event_id KV dedup → handlers are safe to receive duplicate webhooks.' },
  { area: 'Admin panel (this page included)',      effort: 'L', logic: 3, hero: '8 tabs, token freshness check, Cloudflare token gating on every write.' },
  { area: 'Card tokenization (Web Payments SDK)',  effort: 'S', logic: 3, hero: 'Lifecycle is fragile — element must be destroy()d on unmount or re-mounts attach to detached DOM.' },
  { area: 'Idempotency + retry safety',            effort: 'S', logic: 4, hero: 'Stable keys on charges, bookings, and credit grants. Retries never double-act.' },
  { area: 'Challenges + announcements (KV-backed)',effort: 'S', logic: 2, hero: 'Worker is source of truth; admin add/remove syncs to KV instantly across all visitors.' },
];

// ──────────────────────────────────────────────────────────────────
// Build investment — fee-for-service model
// ──────────────────────────────────────────────────────────────────
// Cadence: 4 hrs/week part-time, 11 weeks elapsed → 44 hrs to date, ongoing.
// Hourly: $200/hr (US senior full-stack, custom platform integration).
// Plus a flat $1,500 fixed fee per discrete workflow, automation, database
// model, or security fix delivered. Each fixed-fee line is a piece of work
// that took non-trivial design + integration effort beyond raw coding hours.

const HOURS_PER_WEEK = 4;
const WEEKS_TO_DATE = 11;
const HOURS_TO_DATE = HOURS_PER_WEEK * WEEKS_TO_DATE;
const RATE = 200;
// Mixed pricing model:
//   • Workflows:  $200 per item (each is a distinct user/admin-facing flow)
//   • Automations: $200 per item (background jobs / event handlers)
//   • Databases:  flat $2,000 for the entire state-model + KV namespace setup
//   • Security:   flat $2,000 for the entire hardening + audit-fix setup
// Per-item billing for workflows/automations because they grow with surface
// area; flat fees for databases/security because once the framework is in
// place, adding the next item is incremental.
const FIXED_FEE = 200;
const AUTOMATION_FEE = 200;
const DATABASE_FLAT_FEE = 2000;
const SECURITY_FLAT_FEE = 2000;

interface FeeLine {
  title: string;
  detail: string;
}

// Workflows: end-to-end user/admin-facing flows.
const WORKFLOWS: FeeLine[] = [
  { title: 'Plan purchase → credit grant',         detail: 'Tokenize → validate coupon → resolve price → charge → grant credits + welcome message.' },
  { title: 'Session booking + buffer/cancel rules', detail: '90-min buffer · 24-hr cancel policy · slot validation · idempotent bookings.create.' },
  { title: 'Admin credit refund',                   detail: 'Identifier → reason → /credit/refund → Trainerize DM + trainer note + audit event.' },
  { title: 'Admin panel CRUD across 8 tabs',        detail: 'Challenges, announcements, coaches, studio, stories, transformations, signups, credits.' },
];

// Automations: background jobs, schedules, and event-driven handlers.
const AUTOMATIONS: FeeLine[] = [
  { title: 'Late-cancel / no-show triple-net deduction', detail: 'Webhook (real-time) + manual + daily cron safety net all hit a single KV sentinel.' },
  { title: 'People-sync nightly reconciler',             detail: '04:00 UTC cron · 3-tier linkage with corroboration guards · P2 conservative merge.' },
  { title: 'Trainerize → Square booking reverse-sync',   detail: '15-min cron pulls TZ-only appointments, creates Square bookings, prevents loops.' },
  { title: 'Square webhook ingestion + dedup',           detail: 'HMAC verify · event_id dedup · routes to payment / booking / invoice handlers.' },
  { title: 'Trainerize tag automations',                 detail: 'Payment-paid / payment-due / subscription-active tags trigger TZ push notifications.' },
];

// Databases: distinct KV namespaces / state models with their own lifecycle.
const DATABASES: FeeLine[] = [
  { title: 'People-sync linkage tables',           detail: 'link:tz:* · link:sq:* · snap:link:* · conflict:* (90d TTL audit trail).' },
  { title: 'Idempotency & dedup sentinels',        detail: 'credit-handled · session-counted · event_id seen — every state-changing action is replay-safe.' },
  { title: 'Audit log + admin event store',        detail: 'Per-action records with TTL preservation on refund — refunds remain visible until original event would expire.' },
  { title: 'Challenges + announcements KV',        detail: 'Worker-side source of truth · admin add/remove syncs to all visitors instantly.' },
  { title: 'Photo & content stores',               detail: 'Coach photos · studio · stories · transformations — uploads + client-side compression.' },
];

// Security: hardening items and audit fixes.
const SECURITY_ITEMS: FeeLine[] = [
  { title: 'C-02: Server-side authoritative pricing',  detail: 'Browser sends only plan IDs + coupon codes. Worker re-fetches Square price + applies discount. Closes browser-tampered undercharge vector.' },
  { title: 'C-01: Worker proxy allowlist hardening',   detail: 'Removed /locations from SQUARE_ALLOW · audit reproducer fully closed.' },
  { title: 'Webhook HMAC signature verification',      detail: 'Every Square webhook verified against signing key before any state change · failures logged with fingerprint.' },
  { title: 'Square access token rotation',             detail: 'Token rotated · old prod token revoked · end-to-end verified.' },
  { title: 'Webhook signing-key rotation',             detail: 'New SQUARE_WEBHOOK_SIGNATURE_KEY · live test event verified.' },
  { title: 'Trainerize + Google OAuth + admin token rotation', detail: 'All worker secrets rotated and live-verified pre-launch.' },
  { title: 'Admin token freshness + constant-time compare', detail: '30-day TTL · X-Admin-Token verified per write · timing-safe comparison.' },
  { title: 'PCI scope contained to browser',           detail: 'Web Payments SDK tokenizes card client-side · no PAN ever touches the worker or KV.' },
];

const FIXED_ITEM_COUNT = WORKFLOWS.length + AUTOMATIONS.length + DATABASES.length + SECURITY_ITEMS.length;
const FIXED_FEE_TOTAL =
  WORKFLOWS.length * FIXED_FEE +
  AUTOMATIONS.length * AUTOMATION_FEE +
  DATABASE_FLAT_FEE +
  SECURITY_FLAT_FEE;
const HOURLY_TOTAL = HOURS_TO_DATE * RATE;
const BUILD_TOTAL = HOURLY_TOTAL + FIXED_FEE_TOTAL;
const ONGOING_PER_WEEK = HOURS_PER_WEEK * RATE;

// ──────────────────────────────────────────────────────────────────
// Helper: compute SVG path between two nodes with optional curvature
// ──────────────────────────────────────────────────────────────────
// Quadratic Bezier with the control point pushed perpendicular to the line.
// `curve` controls how much it bows; positive bows one way, negative the
// other — this lets bidirectional pairs render as two visibly separate arcs
// instead of overlapping straight lines.
function pathBetween(a: DiagramNode, b: DiagramNode, curve = 0): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (curve === 0) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len; // perpendicular unit vector
  const py = dx / len;
  const cx = mx + px * curve;
  const cy = my + py * curve;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

// ──────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────
export default function SystemArchitecturePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const pipelinesRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<HTMLDivElement>(null);
  const phasesRef = useRef<HTMLDivElement>(null);

  // Selected node controls which edges/labels are highlighted on the diagram.
  // Hovering temporarily overrides; clicking pins. Null = show everything.
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);
  const [hoverNode, setHoverNode] = useState<NodeId | null>(null);
  const activeNode = hoverNode ?? selectedNode;

  // Active pipeline starts on the first one. Tabs swap which steps render
  // — keeps the page short instead of scrolling through five long lists.
  const [activePipeline, setActivePipeline] = useState<string>(PIPELINES[0].id);
  const currentPipeline = useMemo(
    () => PIPELINES.find(p => p.id === activePipeline) ?? PIPELINES[0],
    [activePipeline]
  );

  useEffect(() => {
    // Hero entrance — short timeline, no scroll trigger needed since the
    // user lands on this section.
    const heroTl = gsap.timeline();
    heroTl
      .fromTo('.sa-hero-label',     { y: -10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 })
      .fromTo('.sa-hero-headline',  { y: 24,  opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.1)
      .fromTo('.sa-hero-sub',       { y: 16,  opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.25)
      .fromTo('.sa-hero-stat',      { y: 16,  opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08 }, 0.4);

    // Diagram nodes pop in with a stagger once their container is ~half
    // visible. Lines draw via stroke-dashoffset animation.
    if (diagramRef.current) {
      gsap.fromTo('.sa-node',
        { scale: 0.85, opacity: 0 },
        {
          scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.6)', stagger: 0.06,
          scrollTrigger: { trigger: diagramRef.current, start: 'top 80%', toggleActions: 'play none none reverse' },
        }
      );
      gsap.fromTo('.sa-edge',
        { strokeDashoffset: 1000 },
        {
          strokeDashoffset: 0, duration: 1.4, ease: 'power2.out', stagger: 0.08,
          scrollTrigger: { trigger: diagramRef.current, start: 'top 75%', toggleActions: 'play none none reverse' },
        }
      );
    }

    // Section-level fade-up for the rest of the page, mirroring App.tsx.
    [pipelinesRef, cardsRef, matrixRef, phasesRef].forEach(ref => {
      if (!ref.current) return;
      gsap.fromTo(ref.current,
        { y: 50, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.7, ease: 'power2.out',
          scrollTrigger: { trigger: ref.current, start: 'top 85%', toggleActions: 'play none none reverse' },
        }
      );
    });

    return () => {
      ScrollTrigger.getAll().forEach(st => st.kill());
    };
  }, []);

  return (
    <div className="space-y-16">
      <HeroSection refProp={heroRef} />
      <DiagramSection
        refProp={diagramRef}
        activeNode={activeNode}
        selectedNode={selectedNode}
        setSelectedNode={setSelectedNode}
        setHoverNode={setHoverNode}
      />
      <PipelinesSection
        refProp={pipelinesRef}
        activePipeline={activePipeline}
        setActivePipeline={setActivePipeline}
        currentPipeline={currentPipeline}
      />
      <SmartnessSection refProp={cardsRef} />
      <ComplexitySection refProp={matrixRef} />
      <PhasesSection refProp={phasesRef} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────────
function HeroSection({ refProp }: { refProp: RefObject<HTMLDivElement | null> }) {
  return (
    <section ref={refProp} className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0F1014] via-[#0B0B0D] to-[#15080A] p-8 md:p-10">
      {/* Decorative orbs — purely visual, no interaction */}
      <div aria-hidden className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-[#FF4D2E]/15 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -left-16 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative">
        <p className="sa-hero-label inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] uppercase tracking-[0.18em] text-white/60">
          <Zap size={12} className="text-[#FF4D2E]" />
          How the system works
        </p>
        <h1 className="sa-hero-headline mt-4 font-display text-3xl md:text-5xl font-bold leading-tight">
          One platform. Three systems.<br />
          <span className="text-[#FF4D2E]">Zero hand-offs.</span>
        </h1>
        <p className="sa-hero-sub mt-4 max-w-2xl text-white/60 text-base md:text-lg leading-relaxed">
          From card swipe to credit grant to coach notification — every step is automated, observable, and retry-safe.
          This page is a live map of how the platform actually works under the hood.
        </p>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          <HeroStat label="Engineering to date" value={`${HOURS_TO_DATE} hrs`} sub={`${HOURS_PER_WEEK}h/wk × ${WEEKS_TO_DATE} weeks · ongoing`} />
          <HeroStat label="Build invested" value={`$${(BUILD_TOTAL / 1000).toFixed(1)}k`} sub={`$${RATE}/hr + per-item fixed fees`} highlight />
          <HeroStat label="Fixed-fee items" value={`${FIXED_ITEM_COUNT}`} sub="workflows · automations · databases · security" />
          <HeroStat label="Ongoing rate" value={`$${ONGOING_PER_WEEK}/wk`} sub={`${HOURS_PER_WEEK}h/wk continuing`} />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`sa-hero-stat rounded-xl border ${highlight ? 'border-[#FF4D2E]/40 bg-[#FF4D2E]/10' : 'border-white/10 bg-white/5'} p-4`}>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${highlight ? 'text-[#FF4D2E]' : 'text-white'}`}>{value}</p>
      <p className="text-[11px] text-white/50 mt-0.5">{sub}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Architecture diagram — interactive SVG topology
// ──────────────────────────────────────────────────────────────────
interface DiagramProps {
  activeNode: NodeId | null;
  selectedNode: NodeId | null;
  setSelectedNode: (n: NodeId | null) => void;
  setHoverNode: (n: NodeId | null) => void;
  refProp: RefObject<HTMLDivElement | null>;
}

function DiagramSection({ activeNode, selectedNode, setSelectedNode, setHoverNode, refProp }: DiagramProps) {
  // Edges stay on-screen but dim when inactive; the visible "selected" state
  // colors only the edges that touch the active node.
  const isEdgeActive = (e: DiagramEdge) =>
    !activeNode || e.from === activeNode || e.to === activeNode;

  const visibleFlows = activeNode
    ? EDGES.filter(e => e.from === activeNode || e.to === activeNode).flatMap(e => e.flows.map(f => ({ flow: f, edge: e })))
    : [];

  return (
    <section ref={refProp}>
      <SectionHeader
        eyebrow="Architecture"
        title="Click any node to follow its connections"
        subtitle="The Cloudflare Worker is the single hub — every external system speaks to it, never to each other directly."
      />

      <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-sm overflow-hidden">
        <svg viewBox="0 0 880 540" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="sa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#FF4D2E" />
            </marker>
            <marker id="sa-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.2)" />
            </marker>
            {/* Subtle background grid — adds depth without being noisy */}
            <pattern id="sa-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="880" height="540" fill="url(#sa-grid)" />

          {/* Edges first so nodes stack on top */}
          {EDGES.map((edge, i) => {
            const a = NODES.find(n => n.id === edge.from)!;
            const b = NODES.find(n => n.id === edge.to)!;
            const active = isEdgeActive(edge);
            return (
              <path
                key={`edge-${i}`}
                d={pathBetween(a, b, edge.curve ?? 0)}
                fill="none"
                stroke={active ? '#FF4D2E' : 'rgba(255,255,255,0.12)'}
                strokeWidth={active ? 2 : 1.5}
                strokeDasharray="1000"
                className="sa-edge transition-[stroke,stroke-width] duration-300"
                markerEnd={active ? 'url(#sa-arrow)' : 'url(#sa-arrow-dim)'}
                markerStart={edge.bidirectional ? (active ? 'url(#sa-arrow)' : 'url(#sa-arrow-dim)') : undefined}
              />
            );
          })}

          {/* Nodes — single foreignObject per node so Tailwind controls
              layout. Box is 168×72; transform centers it on (node.x, node.y).
              Wider than the original 140 so labels like "Cloudflare Worker"
              fit without bleeding past the box edge. */}
          {NODES.map(node => {
            const isActive = activeNode === node.id;
            const isPinned = selectedNode === node.id;
            const NodeIcon = node.Icon;
            return (
              <g
                key={node.id}
                className="sa-node cursor-pointer"
                onMouseEnter={() => setHoverNode(node.id)}
                onMouseLeave={() => setHoverNode(null)}
                onClick={() => setSelectedNode(isPinned ? null : node.id)}
              >
                <foreignObject x={node.x - 84} y={node.y - 36} width="168" height="72">
                  <div
                    className={`w-full h-full rounded-xl bg-[#0B0B0D]/90 border flex items-center gap-2.5 px-2.5 transition-all duration-200 ${
                      isActive ? 'border-[#FF4D2E]' : 'border-white/15'
                    } ${isPinned ? 'ring-2 ring-[#FF4D2E]/50 ring-offset-2 ring-offset-[#0B0B0D]' : ''}`}
                  >
                    <div className={`w-10 h-10 shrink-0 rounded-lg ${node.fill} flex items-center justify-center ring-1 ${node.ring}`}>
                      <NodeIcon size={18} className={node.color} />
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="text-white text-[12.5px] font-semibold truncate">{node.label}</div>
                      <div className="text-white/50 text-[10px] mt-0.5 truncate">{node.sublabel}</div>
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>

        {/* Edge flow legend — appears when a node is selected */}
        <div className="border-t border-white/10 px-5 py-4 min-h-[88px]">
          {activeNode ? (
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] text-white/50 mb-2">
                What flows through {NODES.find(n => n.id === activeNode)?.label}
              </p>
              <ul className="space-y-1.5">
                {visibleFlows.map((vf, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                    <ChevronRight size={14} className="text-[#FF4D2E] mt-0.5 shrink-0" />
                    <span>{vf.flow}</span>
                    <span className="text-white/30 text-xs ml-auto whitespace-nowrap">
                      {vf.edge.from} → {vf.edge.to}{vf.edge.bidirectional ? ' ↔' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-white/40 italic">Hover or click any node to see what data flows through it.</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Pipelines (swimlanes)
// ──────────────────────────────────────────────────────────────────
interface PipelinesProps {
  refProp: RefObject<HTMLDivElement | null>;
  activePipeline: string;
  setActivePipeline: (id: string) => void;
  currentPipeline: Pipeline;
}

function PipelinesSection({ refProp, activePipeline, setActivePipeline, currentPipeline }: PipelinesProps) {
  const Icon = currentPipeline.Icon;
  return (
    <section ref={refProp}>
      <SectionHeader
        eyebrow="Automation"
        title="Five pipelines that run themselves"
        subtitle="Each is a sequence of steps across systems — pick one to see what happens at every hop."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {PIPELINES.map(p => {
          const active = p.id === activePipeline;
          const PIcon = p.Icon;
          return (
            <button
              key={p.id}
              onClick={() => setActivePipeline(p.id)}
              className={`group inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                active
                  ? 'border-[#FF4D2E] bg-[#FF4D2E]/15 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/30'
              }`}
            >
              <PIcon size={14} className={active ? p.accent : 'text-white/40 group-hover:text-white/70'} />
              {p.title}
            </button>
          );
        })}
      </div>

      <div className={`rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 md:p-8 shadow-xl ${currentPipeline.glow}`}>
        <div className="flex items-start gap-4 mb-6">
          <div className={`w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center ${currentPipeline.accent}`}>
            <Icon size={22} />
          </div>
          <div>
            <h3 className="font-display text-2xl font-bold">{currentPipeline.title}</h3>
            <p className="text-white/60 mt-1 max-w-3xl">{currentPipeline.description}</p>
          </div>
        </div>

        <ol className="space-y-3 relative">
          {/* Vertical timeline line — runs through the step indices */}
          <div aria-hidden className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-white/20 via-white/10 to-transparent" />
          {currentPipeline.steps.map((step, idx) => (
            <PipelineStepRow key={idx} step={step} index={idx + 1} />
          ))}
        </ol>
      </div>
    </section>
  );
}

const ACTOR_META: Record<PipelineActor, { label: string; cls: string }> = {
  user:       { label: 'Client',     cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  browser:    { label: 'Frontend',   cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  worker:     { label: 'Worker',     cls: 'bg-[#FF4D2E]/15 text-[#FF4D2E] border-[#FF4D2E]/40' },
  square:     { label: 'Square',     cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  trainerize: { label: 'Trainerize', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
  kv:         { label: 'KV',         cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  cron:       { label: 'Cron',       cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30' },
};

function PipelineStepRow({ step, index }: { step: PipelineStep; index: number }) {
  const meta = ACTOR_META[step.who];
  return (
    <li className="relative pl-12">
      <div className="absolute left-0 top-1 w-8 h-8 rounded-full bg-[#0B0B0D] border-2 border-[#FF4D2E]/60 flex items-center justify-center text-xs font-bold text-white">
        {index}
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${meta.cls}`}>
            {meta.label}
          </span>
          <span className="text-white/90 font-medium">{step.what}</span>
        </div>
        {step.detail && <p className="text-sm text-white/55 mt-1">{step.detail}</p>}
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────
// Smartness cards
// ──────────────────────────────────────────────────────────────────
function SmartnessSection({ refProp }: { refProp: RefObject<HTMLDivElement | null> }) {
  return (
    <section ref={refProp}>
      <SectionHeader
        eyebrow="Smartness"
        title="The non-obvious patterns under the hood"
        subtitle="These are decisions that look like nothing from the outside — but are the difference between “works” and “survives at 3am.”"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SMART_CARDS.map((card, i) => {
          const Icon = card.Icon;
          return (
            <div
              key={i}
              className="rounded-xl border border-white/10 bg-white/[0.025] p-5 hover:border-white/25 hover:bg-white/[0.04] transition-colors"
            >
              <div className={`w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center ${card.tint} mb-3`}>
                <Icon size={18} />
              </div>
              <h4 className="font-semibold text-white text-base mb-1.5">{card.title}</h4>
              <p className="text-sm text-white/55 leading-relaxed">{card.why}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Engineering complexity matrix
// ──────────────────────────────────────────────────────────────────
function ComplexitySection({ refProp }: { refProp: RefObject<HTMLDivElement | null> }) {
  return (
    <section ref={refProp}>
      <SectionHeader
        eyebrow="Engineering effort"
        title="How much logic and smartness lives in each piece"
        subtitle="Effort is build burden (S/M/L). Logic is reasoning depth (1–5). Hero detail is the single thing that defines the area."
      />
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_60px_80px_3fr] gap-4 px-5 py-3 bg-white/5 border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50 font-semibold">
          <span>Area</span>
          <span>Effort</span>
          <span>Logic</span>
          <span>Hero detail</span>
        </div>
        {COMPLEXITY_ROWS.map((row, i) => (
          <ComplexityMatrixRow key={i} row={row} alt={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function ComplexityMatrixRow({ row, alt }: { row: ComplexityRow; alt: boolean }) {
  const effortColor = row.effort === 'L' ? 'bg-rose-500/15 text-rose-300 border-rose-400/30'
    : row.effort === 'M' ? 'bg-amber-500/15 text-amber-300 border-amber-400/30'
    : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30';

  return (
    <div className={`grid grid-cols-1 md:grid-cols-[2fr_60px_80px_3fr] gap-3 md:gap-4 px-5 py-4 items-start ${alt ? 'bg-white/[0.015]' : 'bg-transparent'} border-b border-white/5 last:border-b-0`}>
      <div className="text-white font-medium text-sm md:text-base">{row.area}</div>
      <div>
        <span className={`inline-flex items-center justify-center w-7 h-7 text-xs font-bold rounded-md border ${effortColor}`}>
          {row.effort}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <span
            key={n}
            className={`w-2 h-5 rounded-sm ${n <= row.logic ? 'bg-[#FF4D2E]' : 'bg-white/10'}`}
          />
        ))}
      </div>
      <div className="text-sm text-white/65 leading-relaxed">{row.hero}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Phases & investment — itemized fee-for-service breakdown
// ──────────────────────────────────────────────────────────────────
// Two cost components rendered side by side:
//   1. Hourly engineering — accumulates at $200/hr × 4h/week, ongoing
//   2. Fixed-fee items — one $1,500 line per workflow / automation /
//      database model / security item delivered or fixed
// Grand total = hourly + fixed fees. Ongoing rate continues until done.
function PhasesSection({ refProp }: { refProp: RefObject<HTMLDivElement | null> }) {
  return (
    <section ref={refProp}>
      <SectionHeader
        eyebrow="Build phases & investment"
        title="What it took to build, in hours and dollars"
        subtitle={`Engineering at ${HOURS_PER_WEEK} hrs/week × ${WEEKS_TO_DATE} weeks (${HOURS_TO_DATE} hrs to date) at $${RATE}/hr. Mixed fixed-fee model: $${FIXED_FEE} per workflow and $${AUTOMATION_FEE} per automation (per-item), plus flat $${(DATABASE_FLAT_FEE / 1000).toFixed(0)}k for the entire database setup and flat $${(SECURITY_FLAT_FEE / 1000).toFixed(0)}k for the entire security setup. Engineering ongoing at the same rate.`}
      />

      {/* Three headline totals — hourly tally, fixed-fee tally, grand total */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <TotalCard
          Icon={Clock}
          label="Hourly engineering"
          value={`$${HOURLY_TOTAL.toLocaleString()}`}
          sub={`${HOURS_TO_DATE} hrs × $${RATE}/hr (${HOURS_PER_WEEK}h/week × ${WEEKS_TO_DATE} weeks)`}
          tint="text-violet-300"
        />
        <TotalCard
          Icon={Workflow}
          label="Fixed-fee items"
          value={`$${FIXED_FEE_TOTAL.toLocaleString()}`}
          sub={`${FIXED_ITEM_COUNT} items × $${FIXED_FEE.toLocaleString()} each`}
          tint="text-amber-300"
        />
        <TotalCard
          Icon={DollarSign}
          label="Build to date"
          value={`$${BUILD_TOTAL.toLocaleString()}`}
          sub={`+ ongoing $${ONGOING_PER_WEEK}/week (${HOURS_PER_WEEK}h/week × $${RATE}/hr)`}
          tint="text-emerald-300"
          highlight
        />
      </div>

      {/* Itemized fixed-fee lines, grouped by category */}
      <div className="space-y-6">
        <FeeGroup
          Icon={Workflow}
          title="Workflows"
          subtitle="End-to-end user and admin-facing flows"
          items={WORKFLOWS}
          accent="text-emerald-300"
        />
        <FeeGroup
          Icon={Cpu}
          title="Automations"
          subtitle="Background jobs, schedules, and event-driven handlers"
          items={AUTOMATIONS}
          accent="text-amber-300"
          fee={AUTOMATION_FEE}
        />
        <FeeGroup
          Icon={Database}
          title="Databases & state models"
          subtitle="Flat fee for the entire state-model + KV namespace setup"
          items={DATABASES}
          accent="text-violet-300"
          flatFee={DATABASE_FLAT_FEE}
        />
        <FeeGroup
          Icon={ShieldAlert}
          title="Security & hardening"
          subtitle="Flat fee for the entire hardening + audit-fix bundle"
          items={SECURITY_ITEMS}
          accent="text-rose-300"
          flatFee={SECURITY_FLAT_FEE}
        />
      </div>

      {/* Honest caveat — what's not included so the total isn't confusing */}
      <div className="mt-8 rounded-xl border border-white/5 bg-white/[0.015] p-4 text-xs text-white/45 leading-relaxed">
        <strong className="text-white/70">What this total includes:</strong>{' '}
        {`Engineering hours at $${RATE}/hr, plus a mixed fixed-fee model: per-item billing for workflows ($${FIXED_FEE} each) and automations ($${AUTOMATION_FEE} each), plus flat fees for infrastructure-style work — $${(DATABASE_FLAT_FEE / 1000).toFixed(0)}k for the complete database/state setup and $${(SECURITY_FLAT_FEE / 1000).toFixed(0)}k for the complete security/hardening bundle (once the framework is built, additional items are incremental cost). Engineering continues at $${ONGOING_PER_WEEK}/week until the project is complete. `}
        <em>Not included:</em> design assets, Trainerize gym subscription, Cloudflare Workers paid plan ($5/mo if needed),
        Square processing fees (2.6% + 30¢ per transaction), or future maintenance after handoff.
      </div>
    </section>
  );
}

// One row per fixed-fee item, grouped under a category header. Two pricing
// modes:
//   • Per-item (default): each line shows its own $ on the right; group
//     total = item count × fee. Used for workflows + automations.
//   • Flat (when `flatFee` is provided): no $ per row; group total = flatFee
//     applied once for the whole bundle. Used for databases + security.
function FeeGroup({ Icon, title, subtitle, items, accent, fee = FIXED_FEE, flatFee }: {
  Icon: typeof Workflow;
  title: string;
  subtitle: string;
  items: FeeLine[];
  accent: string;
  fee?: number;
  flatFee?: number;
}) {
  const isFlat = typeof flatFee === 'number';
  const groupTotal = isFlat ? (flatFee as number) : items.length * fee;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] overflow-hidden">
      <div className="flex items-start gap-3 px-5 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className={`w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center ${accent} shrink-0`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-white text-base">{title}</h4>
          <p className="text-xs text-white/50">{subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Group total</p>
          <p className="text-sm font-semibold text-emerald-300">
            ${groupTotal.toLocaleString()}
          </p>
          <p className="text-[10px] text-white/40">
            {isFlat
              ? `Flat — ${items.length} items included`
              : `${items.length} × $${fee.toLocaleString()}`}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-white/5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
            <span className="text-[#FF4D2E] mt-0.5 shrink-0">›</span>
            <div className="flex-1 min-w-0">
              <p className="text-white/90 text-sm font-medium">{it.title}</p>
              <p className="text-white/50 text-xs mt-0.5 leading-relaxed">{it.detail}</p>
            </div>
            {isFlat ? (
              <span className="text-white/30 text-xs shrink-0 italic">included</span>
            ) : (
              <span className="text-emerald-300 text-sm font-semibold shrink-0 tabular-nums">
                ${fee.toLocaleString()}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TotalCard({ Icon, label, value, sub, tint, highlight }: {
  Icon: typeof Clock;
  label: string;
  value: string;
  sub: string;
  tint: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-5 ${
      highlight
        ? 'border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5'
        : 'border-white/10 bg-white/[0.025]'
    }`}>
      <div className={`w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center ${tint} mb-3`}>
        <Icon size={18} />
      </div>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      <p className={`mt-1 font-display text-2xl md:text-3xl font-bold ${highlight ? 'text-emerald-300' : 'text-white'}`}>{value}</p>
      <p className="text-[12px] text-white/50 mt-1.5 leading-snug">{sub}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Reusable section header
// ──────────────────────────────────────────────────────────────────
function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#FF4D2E] font-semibold">
        <span className="w-6 h-px bg-[#FF4D2E]" />
        {eyebrow}
      </p>
      <h2 className="font-display text-2xl md:text-3xl font-bold mt-2">{title}</h2>
      <p className="text-white/55 mt-2 max-w-3xl">{subtitle}</p>
    </div>
  );
}
