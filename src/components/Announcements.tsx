// Announcement banner (sticky top) + inline card.
//
// Both render from the same Announcement record but differ in visual style:
//   - banner: thin strip at top of page, single line on desktop, dismissible
//   - card:   glass-morphism poster between sections, larger headline
//
// Aesthetic targets:
//   - Brand: dark base #0B0B0D + accent #FF4D2E only (no rainbow).
//   - Match existing glass-morphism (bg-white/[0.06], rounded-2xl).
//   - Editorial typography — uppercase micro-labels, display-font headlines.
//   - Subtle motion: animated 1px gradient line on banner, soft pulse on dot.
//   - Whisper-thin dismiss; 7-day cookie remembers it.

import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import {
  type Announcement,
  getActiveAnnouncements,
  isAnnouncementDismissed,
  dismissAnnouncement,
} from '@/api/announcements';

// ============================================================
// Shared CTA action
// ============================================================
//
// ctaTarget supports three forms:
//   - "#section-id"            → smooth-scroll to section
//   - "modal:booking|portal|.."→ caller-supplied modal key (caller wires it)
//   - "url:https://..."        → external link (new tab)

function handleCtaClick(target: string, openModal?: (key: string) => void) {
  if (!target) return;
  if (target.startsWith('#')) {
    const el = document.querySelector(target);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (target.startsWith('modal:')) {
    const key = target.slice(6);
    openModal?.(key);
    return;
  }
  if (target.startsWith('url:')) {
    window.open(target.slice(4), '_blank', 'noopener,noreferrer');
    return;
  }
  // Bare URL fallback — be lenient about admin input.
  if (/^https?:\/\//.test(target)) {
    window.open(target, '_blank', 'noopener,noreferrer');
  }
}

// ============================================================
// Top-of-page banner (sticky, single line on desktop)
// ============================================================

interface BannerProps {
  openModal?: (key: string) => void;
}

export function AnnouncementBanner({ openModal }: BannerProps) {
  const [active, setActive] = useState<Announcement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getActiveAnnouncements();
      // Only banner-style announcements live here; cards render elsewhere.
      // Show the highest-priority one — keeps the page from being a wall.
      const banners = all.filter(a => a.style === 'banner' && !isAnnouncementDismissed(a.id));
      banners.sort((a, b) => {
        if (a.priority === b.priority) return 0;
        return a.priority === 'high' ? -1 : 1;
      });
      if (!cancelled) {
        setActive(banners[0] || null);
        // Tiny delay before mount-anim trigger so the entrance is visible
        // even when the API resolves instantly from cache.
        requestAnimationFrame(() => setMounted(true));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!active) return null;

  const handleDismiss = () => {
    dismissAnnouncement(active.id);
    setActive(null);
  };

  const accentBg = active.priority === 'high' ? 'bg-[#FF4D2E]' : 'bg-white/40';

  return (
    <div
      role="region"
      aria-label="Site announcement"
      className={`
        relative z-40 overflow-hidden
        bg-[#0B0B0D]/95 backdrop-blur-md
        border-b border-white/[0.06]
        transition-all duration-700 ease-out
        ${mounted ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'}
      `}
    >
      {/* Top accent line — animated gradient sweep matches site GSAP feel */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#FF4D2E] to-transparent" />

      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
        {/* Pulse dot signaling "live offer" — only on high-priority */}
        {active.priority === 'high' && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF4D2E] opacity-60" />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${accentBg}`} />
          </span>
        )}

        {/* Title + subtitle on one line on desktop, stacked on mobile */}
        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <p className="font-display font-semibold text-white text-sm sm:text-[0.95rem] tracking-tight truncate">
            {active.title}
          </p>
          {active.subtitle && (
            <p className="text-white/60 text-xs sm:text-sm truncate">
              {active.subtitle}
              {active.discountCode && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.07] border border-white/[0.08] text-white/80 text-[0.7rem] font-mono tracking-wider">
                  {active.discountCode}
                </span>
              )}
            </p>
          )}
        </div>

        {/* CTA pill — small, brand orange */}
        {active.ctaLabel && active.ctaTarget && (
          <button
            type="button"
            onClick={() => handleCtaClick(active.ctaTarget, openModal)}
            className="
              flex-shrink-0 hidden sm:inline-flex items-center gap-1.5
              px-3 py-1.5 rounded-full
              bg-[#FF4D2E] hover:bg-[#FF6B4A]
              text-white text-xs font-semibold uppercase tracking-wider
              transition-colors
            "
          >
            {active.ctaLabel}
            <ArrowRight size={12} />
          </button>
        )}

        {/* Whisper-thin dismiss */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss announcement"
          className="flex-shrink-0 text-white/30 hover:text-white/70 transition-colors p-1 -mr-1"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Mobile-only CTA below the line so it never gets squeezed */}
      {active.ctaLabel && active.ctaTarget && (
        <div className="sm:hidden px-6 pb-3 -mt-1">
          <button
            type="button"
            onClick={() => handleCtaClick(active.ctaTarget, openModal)}
            className="
              inline-flex items-center gap-1.5
              text-[#FF4D2E] hover:text-[#FF6B4A]
              text-xs font-semibold uppercase tracking-wider
            "
          >
            {active.ctaLabel}
            <ArrowRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Inline card (poster between sections)
// ============================================================

interface CardProps {
  openModal?: (key: string) => void;
  /** Render only the first card matching this filter, or all if undefined. */
  filter?: (a: Announcement) => boolean;
}

export function AnnouncementCards({ openModal, filter }: CardProps) {
  const [cards, setCards] = useState<Announcement[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getActiveAnnouncements();
      // Render every active announcement as a card — the page is the only
      // surface now (sticky-banner variant retired for being too popup-y).
      // The `style` field stays in the data model as a future-proof hint.
      let list = all.filter(a => !isAnnouncementDismissed(a.id));
      if (filter) list = list.filter(filter);
      // Sort by priority high-first, then created descending
      list.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      if (!cancelled) {
        setCards(list);
        requestAnimationFrame(() => setMounted(true));
      }
    })();
    return () => { cancelled = true; };
  // Live updates without page reload aren't needed for this surface.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (cards.length === 0) return null;

  // Cap at 3 — beyond that the overlay starts to feel like a wall, not a hint.
  const visible = cards.slice(0, 3);

  return (
    <div
      // Absolute overlay positioned within the hero section.
      //   Mobile: bottom-center (sm:right-6 = right-aligned on tablet+)
      //   Desktop: bottom-right with larger gutters
      // pointer-events-none on the wrapper so empty space doesn't block
      // hero interactions (scroll hint, etc); each card opts back in.
      className="
        absolute z-20 pointer-events-none
        bottom-24 left-1/2 -translate-x-1/2
        sm:left-auto sm:right-6 sm:translate-x-0
        lg:right-12 lg:bottom-32
        w-[calc(100%-3rem)] max-w-xs sm:max-w-sm
        space-y-3 sm:space-y-4
      "
      aria-label="Site announcements"
    >
      {visible.map((c, i) => (
        <div
          key={c.id}
          className={`
            pointer-events-auto
            transition-all duration-700 ease-out
            ${mounted
              ? 'opacity-100 translate-x-0 translate-y-0'
              : 'opacity-0 translate-x-6 translate-y-2'
            }
          `}
          // Stagger entrance — each card starts 120ms after the previous so
          // the overlay materializes like a notification stack rather than
          // appearing all at once.
          style={{ transitionDelay: `${i * 120}ms` }}
        >
          <AnnouncementCard announcement={c} openModal={openModal} />
        </div>
      ))}
    </div>
  );
}

function AnnouncementCard({
  announcement: a,
  openModal,
}: {
  announcement: Announcement;
  openModal?: (key: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const handleDismiss = () => {
    dismissAnnouncement(a.id);
    setDismissed(true);
  };

  const isHigh = a.priority === 'high';
  const priorityAccent = isHigh ? 'border-[#FF4D2E]/25' : 'border-white/[0.08]';

  return (
    <article
      className={`
        relative group
        bg-white/[0.04] backdrop-blur-xl
        border ${priorityAccent} hover:border-[#FF4D2E]/40
        rounded-2xl p-5 lg:p-6
        transition-all duration-500
        hover:bg-white/[0.07] hover:scale-[1.02]
        shadow-[0_8px_32px_rgba(0,0,0,0.24)]
      `}
    >
      {/* Editorial signature: asymmetric orange rule line + eyebrow text.
          High-priority gets a soft pulsing glow on the rule for ambient
          motion that signals "live" without being noisy. */}
      <div className="flex items-center gap-3 mb-4">
        <span
          className={`
            block h-px w-8 bg-[#FF4D2E]
            ${isHigh ? 'shadow-[0_0_8px_#FF4D2E] animate-pulse' : ''}
          `}
        />
        <p className="text-[#FF4D2E] text-[0.6rem] uppercase tracking-[0.22em] font-semibold">
          {isHigh ? 'Limited Time' : 'Announcement'}
        </p>
      </div>

      <h3 className="font-display font-bold text-white text-lg lg:text-xl leading-tight mb-2">
        {a.title}
      </h3>

      {a.subtitle && (
        <p className="text-white/70 text-xs lg:text-sm leading-relaxed mb-4">
          {a.subtitle}
        </p>
      )}

      {a.discountCode && (
        <div className="mb-4 inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#FF4D2E]/10 border border-[#FF4D2E]/30">
          <span className="text-[#FF4D2E]/80 text-[0.6rem] uppercase tracking-wider font-semibold">Code</span>
          <span className="text-white font-mono text-xs tracking-wider">{a.discountCode}</span>
        </div>
      )}

      {a.ctaLabel && a.ctaTarget && (
        <button
          type="button"
          onClick={() => handleCtaClick(a.ctaTarget, openModal)}
          className="
            inline-flex items-center gap-1.5
            text-[#FF4D2E] hover:text-[#FF6B4A]
            font-semibold text-xs uppercase tracking-[0.15em]
            transition-colors group/cta
          "
        >
          {a.ctaLabel}
          <ArrowRight size={12} className="group-hover/cta:translate-x-1 transition-transform duration-300" />
        </button>
      )}

      {/* Whisper-thin dismiss in corner */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss announcement"
        className="absolute top-3 right-3 text-white/25 hover:text-white/60 transition-colors p-1"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </article>
  );
}
