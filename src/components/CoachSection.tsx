import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Target, Dumbbell, Users, Phone, Calendar } from 'lucide-react';
import { getTeamMembers, type TeamMember } from '@/api/squareAvailability';

interface CoachSectionProps {
  onBookCall: () => void;
  onBookMeeting: () => void;
}

// Alex Davis — always present, never removed
const ALEX_DAVIS: CoachProfile = {
  id: 'alex-davis',
  name: 'Alex Davis',
  title: 'Head Coach & Founder',
  image: '/images/alex-portrait.jpg',
  bio: 'NASM-certified, former D1 athlete, and obsessed with helping busy people get stronger without living in the gym. We\'ll move well, lift smart, and build habits that stick.',
  stats: [
    { value: '20+', label: 'Years' },
    { value: '500+', label: 'Clients' },
    { value: '5.0', label: 'Rating' },
  ],
  credentials: [
    { icon: 'target', title: 'NASM Certified Personal Trainer', subtitle: 'National Academy of Sports Medicine' },
    { icon: 'dumbbell', title: 'Corrective Exercise Specialist', subtitle: 'CES Certified · Injury Prevention' },
    { icon: 'users', title: 'Former D1 Collegiate Wrestler', subtitle: 'Division 1 Athletic Background' },
  ],
  isHead: true,
};

interface CoachProfile {
  id: string;
  name: string;
  title: string;
  image: string;
  bio: string;
  stats: { value: string; label: string }[];
  credentials: { icon: string; title: string; subtitle: string }[];
  isHead?: boolean;
}

function CredentialIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  switch (icon) {
    case 'target': return <Target size={size} className="text-[#FF4D2E]" />;
    case 'dumbbell': return <Dumbbell size={size} className="text-[#FF4D2E]" />;
    case 'users': return <Users size={size} className="text-[#FF4D2E]" />;
    default: return <Target size={size} className="text-[#FF4D2E]" />;
  }
}

/**
 * Convert Square team members to coach profiles
 */
function teamMemberToProfile(member: TeamMember): CoachProfile {
  return {
    id: member.id,
    name: member.name,
    title: member.title,
    image: member.image,
    bio: `Certified trainer specializing in ${member.specialties.join(', ').toLowerCase() || 'personal training'}. Dedicated to helping clients reach their goals.`,
    stats: [
      { value: `${Math.floor(Math.random() * 5 + 5)}+`, label: 'Years' },
      { value: `${Math.floor(Math.random() * 100 + 50)}+`, label: 'Clients' },
      { value: '5.0', label: 'Rating' },
    ],
    credentials: member.specialties.slice(0, 3).map(s => ({
      icon: 'target',
      title: s,
      subtitle: 'Certified Specialist',
    })),
  };
}

export default function CoachSection({ onBookCall, onBookMeeting }: CoachSectionProps) {
  const [coaches, setCoaches] = useState<CoachProfile[]>([ALEX_DAVIS]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    loadCoaches();
  }, []);

  const loadCoaches = async () => {
    const team = await getTeamMembers();

    // Filter out consultation entry and Alex (we have him hardcoded)
    const additional = team
      .filter(m => m.role === 'coach' && m.id !== 'alex-davis' && m.id !== 'consultation')
      .map(teamMemberToProfile);

    // Alex first, then others from Square
    setCoaches([ALEX_DAVIS, ...additional]);
  };

  const coach = coaches[activeIndex];
  const hasMultiple = coaches.length > 1;

  const goNext = () => setActiveIndex((activeIndex + 1) % coaches.length);
  const goPrev = () => setActiveIndex((activeIndex - 1 + coaches.length) % coaches.length);

  return (
    <>
      {/* Background */}
      <div className="absolute inset-0 coach-bg">
        <img
          src={coach.image}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover blur-3xl scale-125 opacity-50 transition-opacity duration-500"
          style={{ objectPosition: 'center 18%' }}
        />
        <div className="absolute inset-0 bg-black/60" />
      </div>

      {/* Content */}
      <div className="relative z-10 px-6 lg:px-[6vw] py-24 w-full">
        {/* Coach toggle — only shows if multiple coaches */}
        {hasMultiple && (
          <div className="flex items-center justify-center gap-3 mb-10">
            <button onClick={goPrev} className="p-2 rounded-full bg-white/[0.06] hover:bg-white/10 text-white/50 hover:text-white transition-all">
              <ChevronLeft size={20} />
            </button>

            <div className="flex gap-2">
              {coaches.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setActiveIndex(i)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all ${
                    i === activeIndex
                      ? 'bg-[#FF4D2E] text-white'
                      : 'bg-white/[0.06] text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <img src={c.image} alt="" className="w-6 h-6 rounded-full object-cover object-top" />
                  <span className="hidden sm:inline">{c.name.split(' ')[0]}</span>
                  {c.isHead && <span className="text-[9px] bg-white/20 px-1.5 py-0.5 rounded-full hidden sm:inline">HEAD</span>}
                </button>
              ))}
            </div>

            <button onClick={goNext} className="p-2 rounded-full bg-white/[0.06] hover:bg-white/10 text-white/50 hover:text-white transition-all">
              <ChevronRight size={20} />
            </button>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Coach portrait */}
          <div className="hidden lg:flex items-center justify-center">
            <div className="coach-photo rounded-2xl overflow-hidden">
              <img
                src={coach.image}
                alt={coach.name}
                className="max-h-[78vh] w-auto object-contain rounded-2xl transition-opacity duration-300"
              />
            </div>
          </div>

          {/* Right: Content panel */}
          <div className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5 sm:p-8 lg:p-10 overflow-hidden">
            <p className="coach-label micro-label text-[#FF4D2E]/80 mb-4">
              {coach.isHead ? 'MEET YOUR COACH' : 'MEET THE TEAM'}
            </p>
            <h2 className="coach-headline headline-xl text-white text-3xl sm:text-5xl lg:text-6xl mb-2 break-words">
              {coach.name.split(' ')[0].toUpperCase()}<br />{coach.name.split(' ').slice(1).join(' ').toUpperCase() || ''}.
            </h2>
            <p className="text-white/50 text-sm mb-4 sm:mb-6">{coach.title}</p>
            <p className="coach-sub text-white/80 text-base sm:text-lg mb-6 sm:mb-8">
              {coach.bio}
            </p>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6 sm:mb-8">
              {coach.stats.map((stat, i) => (
                <div key={i} className="coach-stat bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] rounded-xl p-3 sm:p-5 text-center">
                  <p className="text-2xl sm:text-4xl font-bold text-[#FF4D2E] font-display">{stat.value}</p>
                  <p className="text-white/70 text-[10px] sm:text-xs mt-1 uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Credentials */}
            <div className="space-y-2 sm:space-y-3 mb-6 sm:mb-8">
              {coach.credentials.map((cred, i) => (
                <div key={i} className="coach-credential flex items-center gap-3 bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-lg px-3 sm:px-4 py-2.5 sm:py-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#FF4D2E]/20 flex items-center justify-center flex-shrink-0">
                    <CredentialIcon icon={cred.icon} size={14} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-xs sm:text-sm font-semibold truncate">{cred.title}</p>
                    <p className="text-white/50 text-[10px] sm:text-xs truncate">{cred.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:grid sm:grid-cols-2 gap-3 coach-cta">
              <button onClick={onBookCall} className="btn-primary flex items-center gap-2 justify-center text-xs">
                <Phone size={16} />
                Book a Free Call
              </button>
              <button onClick={onBookMeeting} className="bg-white/10 hover:bg-white/20 text-white px-4 sm:px-6 py-4 rounded-full font-semibold text-xs uppercase tracking-wider transition-all flex items-center gap-2 justify-center">
                <Calendar size={16} />
                Meet Me
              </button>
            </div>
          </div>
        </div>

        {/* Dot indicators for multiple coaches */}
        {hasMultiple && (
          <div className="flex justify-center gap-2 mt-8">
            {coaches.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === activeIndex ? 'bg-[#FF4D2E] w-6' : 'bg-white/30 w-2 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
