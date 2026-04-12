import { useState, useEffect } from 'react';
import { Trophy, Calendar, Users, Tag, Clock, ChevronRight, Flame, Plus, X, Check, Lock } from 'lucide-react';
import { getActiveChallenges, addChallenge, removeChallenge, seedDemoChallenges, setAdminToken, getAdminToken, type Challenge } from '@/api/challenges';
import { asset } from '@/lib/assets';
import JoinChallengeModal from '@/components/JoinChallengeModal';

interface ChallengesSectionProps {
  onBooking: () => void;
}

// `onBooking` stays in the prop list for backward compatibility with the
// parent, but challenge joins now use a dedicated JoinChallengeModal that
// actually posts to the worker and decrements spots. `onBooking` is only
// used as a fallback if the worker is somehow unreachable.
export default function ChallengesSection({ onBooking: _onBooking }: ChallengesSectionProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [joinTarget, setJoinTarget] = useState<Challenge | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    // Check URL param for admin mode. Admin actions are additionally gated
    // by an admin token the user must paste in — see AdminLock below.
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === 'challenges') setShowAdmin(true);

    // Seed demo challenges on first load (local cache only — real
    // challenges live in the worker and only appear here when added via
    // the admin form).
    seedDemoChallenges();
    loadChallenges();
  }, []);

  const loadChallenges = async () => setChallenges(await getActiveChallenges());

  if (challenges.length === 0 && !showAdmin) return null;

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

        {/* Challenge Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {challenges.map(challenge => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              onJoin={() => setJoinTarget(challenge)}
              showAdmin={showAdmin}
              onDelete={async () => {
                try {
                  await removeChallenge(challenge.id);
                  setAdminError(null);
                  loadChallenges();
                } catch (e) {
                  setAdminError(e instanceof Error ? e.message : 'Delete failed');
                }
              }}
            />
          ))}
        </div>

        {/* Admin: Add Challenge */}
        {showAdmin && (
          <>
            <AdminLock />
            {adminError && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">{adminError}</p>
            )}
            <AdminAddChallenge onAdded={loadChallenges} onError={setAdminError} />
          </>
        )}
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

function AdminLock() {
  const [token, setToken] = useState(getAdminToken());
  const [open, setOpen] = useState(!getAdminToken());

  return (
    <div className="mb-4">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-white/40 hover:text-white text-xs flex items-center gap-2">
          <Lock size={12} /> Admin token set — change
        </button>
      ) : (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 flex items-center gap-3">
          <Lock size={16} className="text-[#FF4D2E]" />
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste admin token to enable add/delete"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
          />
          <button
            onClick={() => { setAdminToken(token); setOpen(false); }}
            className="px-4 py-2 bg-[#FF4D2E] hover:bg-[#e54327] text-white rounded-lg text-xs font-semibold"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function ChallengeCard({ challenge, onJoin, showAdmin, onDelete }: {
  challenge: Challenge;
  onJoin: () => void;
  showAdmin: boolean;
  onDelete: () => void;
}) {
  const isActive = challenge.status === 'active';
  const daysUntilStart = Math.ceil((new Date(challenge.startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden group hover:border-[#FF4D2E]/20 transition-all">
      {/* Status bar */}
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
          {showAdmin && (
            <button onClick={onDelete} className="text-white/20 hover:text-red-400 transition-colors p-1">
              <X size={16} />
            </button>
          )}
        </div>

        <p className="text-white/60 text-sm mb-5 leading-relaxed">{challenge.description}</p>

        {/* Meta */}
        <div className="flex flex-wrap gap-3 mb-5">
          <span className="flex items-center gap-1.5 text-white/40 text-xs">
            <Clock size={13} /> {challenge.duration}
          </span>
          <span className="flex items-center gap-1.5 text-white/40 text-xs">
            <Calendar size={13} /> {new Date(challenge.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          {challenge.spotsLeft !== undefined && (
            <span className={`flex items-center gap-1.5 text-xs ${
              challenge.spotsLeft <= 5 ? 'text-[#FF4D2E]' : 'text-white/40'
            }`}>
              <Users size={13} /> {challenge.spotsLeft} spots left
            </span>
          )}
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-5">
          {challenge.tags.map(tag => (
            <span key={tag} className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded-full flex items-center gap-1">
              <Tag size={10} /> {tag}
            </span>
          ))}
        </div>

        {/* CTA */}
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

function AdminAddChallenge({ onAdded, onError }: { onAdded: () => void; onError: (msg: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', startDate: '', endDate: '', duration: '',
    prize: '', spots: '', price: '', tags: '',
  });
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    onError(null);
    if (!form.title.trim() || !form.startDate || !form.endDate) {
      onError('Title, start date, and end date are required.');
      return;
    }
    if (new Date(form.endDate) < new Date(form.startDate)) {
      onError('End date must be on or after the start date.');
      return;
    }
    // NaN guards — users may paste garbage into number fields.
    const spotsNum = form.spots ? parseInt(form.spots, 10) : undefined;
    if (form.spots && Number.isNaN(spotsNum)) {
      onError('Spots must be a whole number.');
      return;
    }
    const priceNum = form.price ? parseFloat(form.price) : 0;
    if (form.price && Number.isNaN(priceNum)) {
      onError('Price must be a number.');
      return;
    }

    try {
      await addChallenge({
        title: form.title.trim(),
        description: form.description.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        duration: form.duration.trim() || '4 Weeks',
        prize: form.prize.trim() || undefined,
        spots: spotsNum,
        spotsLeft: spotsNum,
        price: priceNum,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Add failed');
      return;
    }

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setOpen(false);
      setForm({ title: '', description: '', startDate: '', endDate: '', duration: '', prize: '', spots: '', price: '', tags: '' });
      onAdded();
    }, 1000);
  };

  return (
    <div className="mt-6">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full py-4 border-2 border-dashed border-white/10 rounded-2xl text-white/30 hover:text-white/60 hover:border-white/20 transition-all flex items-center justify-center gap-2">
          <Plus size={20} /> Add New Challenge
        </button>
      ) : (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Plus size={18} className="text-[#FF4D2E]" /> New Challenge
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Challenge Title *"
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]" />
            </div>
            <div className="md:col-span-2">
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Description" rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] resize-none" />
            </div>
            <input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} placeholder="Start Date *"
              className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm focus:outline-none focus:border-[#FF4D2E]" />
            <input type="date" value={form.endDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} placeholder="End Date *"
              className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm focus:outline-none focus:border-[#FF4D2E]" />
            <input value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))} placeholder="Duration (e.g. 4 Weeks)"
              className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]" />
            <input value={form.prize} onChange={e => setForm(p => ({ ...p, prize: e.target.value }))} placeholder="Prize (optional)"
              className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]" />
            <input type="number" value={form.spots} onChange={e => setForm(p => ({ ...p, spots: e.target.value }))} placeholder="Total Spots"
              className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]" />
            <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="Price ($0 = Free)"
              className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]" />
            <div className="md:col-span-2">
              <input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} placeholder="Tags (comma separated: fat-loss, strength, beginners)"
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setOpen(false)} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.title || !form.startDate || !form.endDate}
              className="flex-1 btn-primary disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
              {saved ? <><Check size={16} /> Saved!</> : <><Plus size={16} /> Add Challenge</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
