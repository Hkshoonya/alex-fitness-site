// CoachAvatar — single component for rendering a coach's image OR a
// graceful initials-monogram fallback. Used everywhere a coach is shown
// (booking modal, coach section, etc) so coaches added in Square but
// without an uploaded photo still render professionally.
//
// When Square returns a new coach who isn't in the COACH_IMAGE_MAP, the
// image field is undefined — this component renders their initials in an
// orange-tinted circle instead of a generic stock photo.

interface CoachAvatarProps {
  name: string;
  image?: string;
  /** Tailwind size class, e.g. 'w-14 h-14'. Caller controls layout. */
  className?: string;
  /** Override text size (defaults sensible based on container). */
  textClassName?: string;
  /** Whether this is the head coach — affects monogram color. */
  isHeadCoach?: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  // First initial of first word + first initial of last word.
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function CoachAvatar({
  name,
  image,
  className = 'w-14 h-14',
  textClassName,
  isHeadCoach = false,
}: CoachAvatarProps) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className={`${className} rounded-xl object-cover object-top`}
      />
    );
  }

  // Initials fallback. Orange-tinted background for head coach to keep
  // the same "Head Coach" visual emphasis as the real-photo path. Other
  // coaches use a softer neutral tint.
  const bg = isHeadCoach
    ? 'bg-gradient-to-br from-[#FF4D2E]/20 to-[#FF4D2E]/5 border border-[#FF4D2E]/25'
    : 'bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10';

  const text = isHeadCoach
    ? 'text-[#FF4D2E]'
    : 'text-white/80';

  return (
    <div
      className={`${className} ${bg} rounded-xl flex items-center justify-center`}
      role="img"
      aria-label={name}
    >
      <span className={`${textClassName ?? 'text-base'} font-display font-bold tracking-wider ${text}`}>
        {getInitials(name)}
      </span>
    </div>
  );
}
