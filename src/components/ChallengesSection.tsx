import { useState, useEffect } from 'react';
import { Trophy, Calendar, Users, Tag, Clock, ChevronRight, Flame } from 'lucide-react';
import { getActiveChallenges, seedDemoChallenges, parseChallengeDate, type Challenge } from '@/api/challenges';
import { asset } from '@/lib/assets';
import JoinChallengeModal from '@/components/JoinChallengeModal';

interface ChallengesSectionProps {
  onBooking: () => void;
}

// Public-facing challenge list. Admin CRUD lives in AdminPanel (`#/admin`).
export default function ChallengesSection({ onBooking: _onBooking }: ChallengesSectionProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [joinTarget, setJoinTarget] = useState<Challenge | null>(null);

  useEffect(() => {
    // Demo seeding is dev-only. M-05 fix: in production, never inject
    // synthetic challenges — if the worker is unreachable, the section just
    // stays empty rather than showing fake data. Real challenges always
    // come from the admin-gated worker endpoint.
    if (import.meta.env.DEV) {
      seedDemoChallenges();
    }
    loadChallenges();
  }, []);

  // Function declaration (not arrow const) so this is hoisted above the
  // useEffect call. Eliminates the "cannot access before declared" lint
  // error and matches the pattern used elsewhere in the codebase.
  async function loadChallenges() {
    setChallenges(await getActiveChallenges());
  }

  if (challenges.length === 0) return null;

  return (
    <section className="relative py-24 px-6 lg:px-[6vw] overflow-hidden">
      {/* Blurred ambient background — matches coach section */}
      <div className="absolute inset-0">
        <img src={asset("/images/alex-portrait.jpg")} alt="" aria-hidden="true" className="w-full h-full object-cover blur-3xl scale-125 opacity-50" style={{ objectPosition: 'center 18%' }} />
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <div className="max-w-5xl mx-auto relative z-10">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-[#FF4D2E]/10 border border-[#FF4D2E]/20 rounded-full px-4 py-2 mb-6">
            <Flame size={16} className="text-[#FF4D2E]" />
            <span className="text-[#FF4D2E] text-sm font-semibold">Active Challenges</span>
          </div>
          <h2 className="headline-xl text-white text-3xl sm:text-5xl break-words mb-4">
            JOIN THE CHALLENGE.
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            Push yourself further. Compete with the community. Win prizes.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {challenges.map(challenge => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              onJoin={() => setJoinTarget(challenge)}
            />
          ))}
        </div>
      </div>

      <JoinChallengeModal
        challenge={joinTarget}
        isOpen={!!joinTarget}
        onClose={() => setJoinTarget(null)}
        onJoined={updated => {
          setChallenges(list => list.map(c => c.id === updated.id ? updated : c));
        }}
      />
    </section>
  );
}

function ChallengeCard({ challenge, onJoin }: {
  challenge: Challenge;
  onJoin: () => void;
}) {
  const isActive = challenge.status === 'active';
  const daysUntilStart = Math.ceil((parseChallengeDate(challenge.startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden group hover:border-[#FF4D2E]/20 transition-all">
      <div className={`px-5 py-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${
        isActive ? 'bg-green-500/10 text-green-400' : 'bg-[#FF4D2E]/10 text-[#FF4D2E]'
      }`}>
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-[#FF4D2E]'}`} />
          {isActive ? 'Live Now' : `Starts in ${daysUntilStart} days`}
        </span>
        {challenge.price === 0 && <span className="bg-green-500/20 px-2 py-0.5 rounded text-green-400">Free</span>}
        {challenge.price !== undefined && challenge.price > 0 && <span>${challenge.price}</span>}
      </div>

      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-white font-display font-bold text-xl group-hover:text-[#FF4D2E] transition-colors">
              {challenge.title}
            </h3>
            {challenge.prize && (
              <p className="text-[#FF4D2E] text-sm font-semibold flex items-center gap-1 mt-1">
                <Trophy size={14} /> {challenge.prize}
              </p>
            )}
          </div>
        </div>

        <p className="text-white/60 text-sm mb-5 leading-relaxed">{challenge.description}</p>

        <div className="flex flex-wrap gap-3 mb-5">
          <span className="flex items-center gap-1.5 text-white/40 text-xs">
            <Clock size={13} /> {challenge.duration}
          </span>
          <span className="flex items-center gap-1.5 text-white/40 text-xs">
            <Calendar size={13} /> {parseChallengeDate(challenge.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          {challenge.spotsLeft !== undefined && (
            <span className={`flex items-center gap-1.5 text-xs ${
              challenge.spotsLeft <= 5 ? 'text-[#FF4D2E]' : 'text-white/40'
            }`}>
              <Users size={13} /> {challenge.spotsLeft} spots left
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {challenge.tags.map(tag => (
            <span key={tag} className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded-full flex items-center gap-1">
              <Tag size={10} /> {tag}
            </span>
          ))}
        </div>

        <button
          onClick={onJoin}
          className="w-full py-3 bg-[#FF4D2E] hover:bg-[#e54327] text-white rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2"
        >
          {isActive ? 'Join Now' : 'Reserve Your Spot'}
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
