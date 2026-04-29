import { useState, useEffect, useCallback } from 'react';
import {
  Shield, LogOut, Plus, X, Check, Trash2, Pencil, Calendar, Users, Tag,
  Mail, Phone, ChevronDown, Loader2, AlertCircle, Award, ExternalLink,
} from 'lucide-react';
import {
  isAdminTokenFresh, verifyAdminToken, saveAdminSession, clearAdminSession,
  getChallengeSignups, getTrainerizePrograms, assignTrainerizeProgram,
  describeTrainerizeReason,
  type ChallengeSignup, type TrainerizeProgram,
} from '@/api/admin';
import {
  getActiveChallenges, addChallenge, removeChallenge, updateChallenge,
  parseChallengeDate,
  type Challenge,
} from '@/api/challenges';

type Tab = 'challenges' | 'signups';

export default function AdminPanel() {
  const [authed, setAuthed] = useState(isAdminTokenFresh());
  const [tab, setTab] = useState<Tab>('challenges');

  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-white">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 rounded-lg flex items-center justify-center">
              <Shield size={18} className="text-[#FF4D2E]" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg leading-tight">Admin</h1>
              <p className="text-white/50 text-xs leading-tight">Alex's Fitness Training</p>
            </div>
          </div>
          <button
            onClick={() => { clearAdminSession(); setAuthed(false); }}
            className="text-white/50 hover:text-white text-sm flex items-center gap-2"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>

        <nav className="max-w-6xl mx-auto px-6 flex gap-1">
          <TabButton active={tab === 'challenges'} onClick={() => setTab('challenges')} label="Challenges" />
          <TabButton active={tab === 'signups'} onClick={() => setTab('signups')} label="Signups" />
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === 'challenges' && <ChallengesTab />}
        {tab === 'signups' && <SignupsTab />}
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-8 text-white/30 text-xs flex items-center justify-between border-t border-white/5 mt-8">
        <span>Admin token expires after 30 days of inactivity.</span>
        <a href="/" className="hover:text-white/60 flex items-center gap-1">
          <ExternalLink size={11} /> Back to site
        </a>
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'text-white border-[#FF4D2E]'
          : 'text-white/40 hover:text-white/70 border-transparent'
      }`}
    >
      {label}
    </button>
  );
}

// ============================================================
// LOGIN
// ============================================================

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    const result = await verifyAdminToken(token);
    setVerifying(false);
    if (result.ok) {
      saveAdminSession(token);
      onSuccess();
      return;
    }
    if (result.reason === 'invalid-token') setError('That token is incorrect. Check it in your Cloudflare Worker → Settings → Variables (ADMIN_LOG_TOKEN).');
    else if (result.reason === 'not-configured') setError('Admin login is not configured on the worker yet.');
    else if (result.reason === 'network-error') setError('Could not reach the server. Check your connection and try again.');
    else setError('Something went wrong. Try again.');
  };

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-white flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield size={26} className="text-[#FF4D2E]" />
          </div>
          <h1 className="font-display font-bold text-2xl mb-2">Admin Sign In</h1>
          <p className="text-white/50 text-sm">Alex's Fitness Training</p>
        </div>

        <label className="block text-white/60 text-xs uppercase tracking-wider font-semibold mb-2">
          Admin Token
        </label>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="Paste your admin token"
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
        />

        {error && (
          <p className="text-red-400 text-xs mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!token || verifying}
          className="w-full mt-4 py-3 bg-[#FF4D2E] hover:bg-[#e54327] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          {verifying ? <><Loader2 size={16} className="animate-spin" /> Verifying...</> : 'Sign in'}
        </button>

        <p className="text-white/30 text-xs text-center mt-6">
          The token is set in Cloudflare Worker → Variables → <code className="text-white/40">ADMIN_LOG_TOKEN</code>.
          Your session stays signed in for 30 days.
        </p>
      </form>
    </div>
  );
}

// ============================================================
// CHALLENGES TAB — CRUD
// ============================================================

function ChallengesTab() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  // ID of the challenge currently being edited inline. Null = none.
  // Mutually exclusive with showAddForm — only one form is open at a time
  // to keep focus and validation messages unambiguous.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getActiveChallenges();
      setChallenges(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold mb-1">Challenges</h2>
          <p className="text-white/50 text-sm">Create, edit, and remove fitness challenges shown on the public site.</p>
        </div>
        {!showAddForm && !editingId && (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-[#FF4D2E] hover:bg-[#e54327] text-white rounded-lg text-sm font-semibold flex items-center gap-2"
          >
            <Plus size={16} /> New Challenge
          </button>
        )}
      </div>

      {showAddForm && (
        <ChallengeForm
          mode="create"
          onCancel={() => { setShowAddForm(false); setError(null); }}
          onSaved={() => { setShowAddForm(false); setError(null); load(); }}
          onError={setError}
        />
      )}

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {loading && <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Loading challenges...</div>}

      {!loading && challenges.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <p className="text-white/40 text-sm">No challenges yet. Create your first one with "New Challenge".</p>
        </div>
      )}

      {!loading && challenges.length > 0 && (
        <div className="space-y-3">
          {challenges.map(c => (
            editingId === c.id ? (
              <ChallengeForm
                key={c.id}
                mode="edit"
                initial={c}
                onCancel={() => { setEditingId(null); setError(null); }}
                onSaved={() => { setEditingId(null); setError(null); load(); }}
                onError={setError}
              />
            ) : (
              <ChallengeRow
                key={c.id}
                challenge={c}
                onEdit={() => { setEditingId(c.id); setShowAddForm(false); setError(null); }}
                onDelete={async () => {
                  if (!confirm(`Delete "${c.title}"? This cannot be undone — and any signups for this challenge will be orphaned (the data stays in KV but won't show in the Signups tab).`)) return;
                  try {
                    await removeChallenge(c.id);
                    setError(null);
                    load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Delete failed');
                  }
                }}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

function ChallengeRow({ challenge, onEdit, onDelete }: {
  challenge: Challenge;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const start = parseChallengeDate(challenge.startDate);
  const end = parseChallengeDate(challenge.endDate);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const statusColor = challenge.status === 'active' ? 'text-green-400 bg-green-500/10' :
                      challenge.status === 'upcoming' ? 'text-[#FF4D2E] bg-[#FF4D2E]/10' :
                      'text-white/30 bg-white/5';

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h3 className="font-semibold truncate">{challenge.title}</h3>
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>
            {challenge.status}
          </span>
          {challenge.price === 0 && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-green-400 bg-green-500/10">Free</span>}
          {challenge.price && challenge.price > 0 && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-white/60 bg-white/5">${challenge.price}</span>}
        </div>
        <p className="text-white/50 text-sm mb-3 line-clamp-2">{challenge.description || <em className="text-white/30">No description</em>}</p>
        <div className="flex flex-wrap gap-4 text-xs text-white/40">
          <span className="flex items-center gap-1.5"><Calendar size={12} /> {fmt(start)} → {fmt(end)}</span>
          <span className="flex items-center gap-1.5"><Users size={12} /> {challenge.spotsLeft ?? '?'} / {challenge.spots ?? '?'} spots left</span>
          {challenge.tags?.length > 0 && (
            <span className="flex items-center gap-1.5"><Tag size={12} /> {challenge.tags.join(', ')}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="text-white/30 hover:text-[#FF4D2E] transition-colors p-2 rounded-lg hover:bg-[#FF4D2E]/10"
          title="Edit challenge"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={onDelete}
          className="text-white/30 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-500/10"
          title="Delete challenge"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// Dual-mode form — `mode: 'create'` calls addChallenge, `mode: 'edit'` calls
// updateChallenge with the existing challenge's id (preserves signups).
function ChallengeForm({
  mode, initial, onCancel, onSaved, onError,
}: {
  mode: 'create' | 'edit';
  initial?: Challenge;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    startDate: initial?.startDate ?? '',
    endDate: initial?.endDate ?? '',
    duration: initial?.duration ?? '4 Weeks',
    prize: initial?.prize ?? '',
    spots: initial?.spots != null ? String(initial.spots) : '',
    price: initial?.price != null ? String(initial.price) : '0',
    tags: initial?.tags?.join(', ') ?? '',
  });
  const [saving, setSaving] = useState(false);

  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    onError(null);
    if (!form.title.trim()) return onError('Title is required.');
    if (!form.startDate || !form.endDate) return onError('Start and end dates are required.');
    if (new Date(form.endDate) < new Date(form.startDate)) return onError('End date must be on or after the start date.');

    const spotsNum = form.spots ? parseInt(form.spots, 10) : undefined;
    if (form.spots && Number.isNaN(spotsNum)) return onError('Spots must be a whole number.');
    const priceNum = form.price ? parseFloat(form.price) : 0;
    if (form.price && Number.isNaN(priceNum)) return onError('Price must be a number.');

    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        await updateChallenge(initial.id, {
          title: form.title.trim(),
          description: form.description.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          duration: form.duration.trim() || '4 Weeks',
          prize: form.prize.trim() || undefined,
          spots: spotsNum,
          price: priceNum,
          tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        });
      } else {
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
      }
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = mode === 'edit';

  return (
    <div className="bg-white/[0.03] border border-[#FF4D2E]/30 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          {isEdit ? <Pencil size={18} className="text-[#FF4D2E]" /> : <Plus size={18} className="text-[#FF4D2E]" />}
          {isEdit ? `Edit "${initial?.title}"` : 'New Challenge'}
        </h3>
        {isEdit && initial && (
          <span className="text-white/30 text-xs">id: <code>{initial.id}</code></span>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Title *" className="md:col-span-2">
          <input value={form.title} onChange={setField('title')} placeholder="30-Day Shred Challenge" className={inputClass} />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <textarea value={form.description} onChange={setField('description')} placeholder="Push yourself further..." rows={3} className={`${inputClass} resize-none`} />
        </Field>
        <Field label="Start Date *">
          <input type="date" value={form.startDate} onChange={setField('startDate')} className={inputClass} />
        </Field>
        <Field label="End Date *">
          <input type="date" value={form.endDate} onChange={setField('endDate')} className={inputClass} />
        </Field>
        <Field label="Duration Label">
          <input value={form.duration} onChange={setField('duration')} placeholder="4 Weeks / 30 Days" className={inputClass} />
        </Field>
        <Field label="Prize (optional)">
          <input value={form.prize} onChange={setField('prize')} placeholder="$500 cash, free month..." className={inputClass} />
        </Field>
        <Field label="Total Spots">
          <input type="number" min="1" value={form.spots} onChange={setField('spots')} placeholder="20" className={inputClass} />
        </Field>
        <Field label="Price ($, 0 = free)">
          <input type="number" min="0" step="0.01" value={form.price} onChange={setField('price')} placeholder="0" className={inputClass} />
        </Field>
        <Field label="Tags (comma separated)" className="md:col-span-2">
          <input value={form.tags} onChange={setField('tags')} placeholder="fat-loss, strength, beginners" className={inputClass} />
        </Field>
      </div>
      {isEdit && initial?.spots != null && (
        <p className="text-white/40 text-xs mt-3">
          Currently <span className="text-white/70">{initial.spotsLeft ?? '?'}</span> of <span className="text-white/70">{initial.spots}</span> spots left.
          Changing total spots adjusts spots-left to keep already-joined people counted.
        </p>
      )}
      <div className="flex gap-3 mt-5">
        <button onClick={onCancel} disabled={saving} className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !form.title || !form.startDate || !form.endDate}
          className="flex-1 px-4 py-2.5 bg-[#FF4D2E] hover:bg-[#e54327] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
        >
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> :
           isEdit ? <><Check size={16} /> Save Changes</> :
           <><Check size={16} /> Save Challenge</>}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-white/60 text-xs uppercase tracking-wider font-semibold mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-3.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]';

// ============================================================
// SIGNUPS TAB
// ============================================================

function SignupsTab() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [signups, setSignups] = useState<ChallengeSignup[]>([]);
  const [loadingChallenges, setLoadingChallenges] = useState(true);
  const [loadingSignups, setLoadingSignups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<ChallengeSignup | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await getActiveChallenges();
        setChallenges(list);
        if (list.length > 0) setSelectedId(list[0].id);
      } finally {
        setLoadingChallenges(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setSignups([]); return; }
    setLoadingSignups(true);
    setError(null);
    getChallengeSignups(selectedId)
      .then(r => setSignups(r.signups))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load signups'))
      .finally(() => setLoadingSignups(false));
  }, [selectedId]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-display font-bold mb-1">Signups</h2>
        <p className="text-white/50 text-sm">Everyone who joined a challenge, with client status and 1-click Trainerize program assignment.</p>
      </div>

      {loadingChallenges && <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Loading challenges...</div>}

      {!loadingChallenges && challenges.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <p className="text-white/40 text-sm">No challenges yet — create one in the Challenges tab to start collecting signups.</p>
        </div>
      )}

      {!loadingChallenges && challenges.length > 0 && (
        <>
          <div className="mb-5 max-w-md">
            <label className="block text-white/60 text-xs uppercase tracking-wider font-semibold mb-2">Challenge</label>
            <div className="relative">
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg py-2.5 pl-4 pr-10 text-white text-sm focus:outline-none focus:border-[#FF4D2E]"
              >
                {challenges.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#1a1a1d]">
                    {c.title} ({c.status})
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}

          {loadingSignups && <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Loading signups...</div>}

          {!loadingSignups && !error && signups.length === 0 && (
            <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
              <p className="text-white/40 text-sm">No signups yet for this challenge.</p>
            </div>
          )}

          {!loadingSignups && signups.length > 0 && (
            <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                <span className="text-white/60 text-sm">{signups.length} {signups.length === 1 ? 'signup' : 'signups'}</span>
                <span className="text-white/30 text-xs">Newest first</span>
              </div>
              <div className="divide-y divide-white/5">
                {signups.map((s, i) => (
                  <SignupRow key={`${s.email}-${i}`} signup={s} onAssign={() => setAssignTarget(s)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {assignTarget && (
        <AssignProgramModal
          signup={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}

function SignupRow({ signup, onAssign }: { signup: ChallengeSignup; onAssign: () => void }) {
  const status = signup.clientStatus;
  const statusBadge = status === 'current-client'
    ? { label: 'Current Client', color: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-400' }
    : status === 'past-client'
    ? { label: 'Past Client',    color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' }
    : { label: 'Non-Client',     color: 'bg-white/5 text-white/50 border-white/10', dot: 'bg-white/30' };

  const joined = signup.joinedAt
    ? new Date(signup.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
      <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_auto] gap-4 items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold truncate">{signup.name}</span>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold flex items-center gap-1 ${statusBadge.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
              {statusBadge.label}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-white/50">
            <span className="flex items-center gap-1.5"><Mail size={10} /> {signup.email}</span>
            {signup.phone && <span className="flex items-center gap-1.5"><Phone size={10} /> {signup.phone}</span>}
          </div>
        </div>

        <div className="text-xs text-white/50">
          <div className="text-white/30 uppercase text-[10px] tracking-wider mb-0.5">Joined</div>
          <div>{joined}</div>
        </div>

        <div className="text-xs">
          {signup.paid ? (
            <span className="inline-flex items-center gap-1 text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5 font-semibold">
              <Check size={11} /> Paid
            </span>
          ) : (
            <span className="text-white/30">Free join</span>
          )}
        </div>

        <button
          onClick={onAssign}
          disabled={!signup.trainerizeUserId}
          title={signup.trainerizeUserId ? 'Assign Trainerize program' : 'Client not in Trainerize yet'}
          className="px-3 py-2 bg-white/5 hover:bg-[#FF4D2E]/15 border border-white/10 hover:border-[#FF4D2E]/30 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Award size={13} /> Assign Program
        </button>
      </div>
    </div>
  );
}

// ============================================================
// ASSIGN PROGRAM MODAL
// ============================================================

function AssignProgramModal({ signup, onClose }: { signup: ChallengeSignup; onClose: () => void }) {
  const [programs, setPrograms] = useState<TrainerizeProgram[]>([]);
  const [configured, setConfigured] = useState(true);
  const [reason, setReason] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTrainerizePrograms()
      .then(r => {
        setConfigured(r.configured);
        setReason(r.reason);
        setPrograms(r.programs);
        if (r.programs.length > 0) setSelectedId(r.programs[0].id);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load programs'))
      .finally(() => setLoading(false));
  }, []);

  const handleAssign = async () => {
    if (!signup.trainerizeUserId || !selectedId) return;
    setAssigning(true);
    setError(null);
    const result = await assignTrainerizeProgram({
      trainerizeUserId: signup.trainerizeUserId,
      programId: selectedId,
    });
    setAssigning(false);
    if (result.success) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      setError(describeTrainerizeReason(result.reason));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0F0F12] border border-white/10 rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="font-display font-bold text-lg">Assign Program</h3>
            <p className="text-white/50 text-sm mt-1">to <span className="text-white">{signup.name}</span></p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        {loading && <div className="text-white/50 text-sm flex items-center gap-2 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading programs...</div>}

        {!loading && !configured && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-4">
            <p className="text-yellow-400 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{describeTrainerizeReason(reason)}</span>
            </p>
            <p className="text-white/50 text-xs mt-2">
              You can still assign manually inside the Trainerize app for now. This button will start working once the API key is active.
            </p>
          </div>
        )}

        {!loading && configured && programs.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4 text-white/60 text-sm">
            No master programs found in your Trainerize account. Create one in the Trainerize app first, then come back here.
          </div>
        )}

        {!loading && configured && programs.length > 0 && (
          <>
            <label className="block text-white/60 text-xs uppercase tracking-wider font-semibold mb-2">Program</label>
            <div className="relative mb-4">
              <select
                value={selectedId ?? ''}
                onChange={e => setSelectedId(parseInt(e.target.value))}
                className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg py-2.5 pl-4 pr-10 text-white text-sm focus:outline-none focus:border-[#FF4D2E]"
              >
                {programs.map(p => (
                  <option key={p.id} value={p.id} className="bg-[#1a1a1d]">
                    {p.name}{p.durationDays ? ` — ${p.durationDays}d` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-3 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
              </p>
            )}

            <button
              onClick={handleAssign}
              disabled={assigning || success || !selectedId}
              className="w-full py-3 bg-[#FF4D2E] hover:bg-[#e54327] disabled:opacity-50 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            >
              {success ? <><Check size={16} /> Assigned!</> :
               assigning ? <><Loader2 size={16} className="animate-spin" /> Assigning...</> :
               <><Award size={16} /> Assign Program</>}
            </button>
          </>
        )}

        <p className="text-white/30 text-xs mt-4 text-center">
          Trainerize User ID: <span className="text-white/50">{signup.trainerizeUserId ?? 'not yet provisioned'}</span>
        </p>
      </div>
    </div>
  );
}
