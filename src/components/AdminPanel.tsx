import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, LogOut, Plus, X, Check, Trash2, Pencil, Calendar, Users, Tag,
  Mail, Phone, ChevronDown, Loader2, AlertCircle, Award, ExternalLink,
  Megaphone, Upload, Image as ImageIcon, Lightbulb, Database, RefreshCw,
} from 'lucide-react';
import {
  isAdminTokenFresh, verifyAdminToken, saveAdminSession, clearAdminSession,
  getAdminTokenAgeWarning,
  getChallengeSignups, getTrainerizePrograms, assignTrainerizeProgram,
  describeTrainerizeReason, refundCredit,
  getCreditMap, clearCreditMap,
  type ChallengeSignup, type TrainerizeProgram, type CreditMapEntry,
} from '@/api/admin';
import {
  getActiveChallenges, addChallenge, removeChallenge, updateChallenge,
  parseChallengeDate,
  type Challenge,
} from '@/api/challenges';
import {
  getAllAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  getAnnouncementStatus,
  type Announcement,
} from '@/api/announcements';
import { getTeamMembers, refreshTeamMembers, type TeamMember } from '@/api/squareAvailability';
import { getCoachPhotos, uploadCoachPhoto, deleteCoachPhoto } from '@/api/coachPhotos';
import {
  getStudioPhotos, uploadStudioPhoto, deleteStudioPhoto,
  type StudioPhoto,
} from '@/api/studioPhotos';
import {
  getClientPhotos, uploadClientPhoto, deleteClientPhoto,
  type ClientPhoto,
} from '@/api/clientPhotos';
import {
  getTransformations, uploadTransformation, deleteTransformation,
  type Transformation,
} from '@/api/transformations';
import { compressImage } from '@/lib/imageUpload';
import { CoachAvatar } from '@/components/CoachAvatar';
import SystemArchitecturePage from '@/components/SystemArchitecturePage';

type Tab = 'challenges' | 'announcements' | 'coaches' | 'studio' | 'stories' | 'transformations' | 'signups' | 'credits' | 'system';

export default function AdminPanel() {
  const [authed, setAuthed] = useState(isAdminTokenFresh());
  const [tab, setTab] = useState<Tab>('challenges');

  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }

  // Soft rotation reminder. The token doesn't auto-expire (Alex can't
  // realistically re-login weekly) but a >180-day-old token represents a
  // long stale exposure window — surface a banner that nudges him to
  // contact Kimi for a fresh one. Hidden when the token is fresh.
  const tokenAge = getAdminTokenAgeWarning();

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-white">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between relative">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 rounded-lg flex items-center justify-center">
              <Shield size={18} className="text-[#FF4D2E]" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg leading-tight">Admin</h1>
              <p className="text-white/50 text-xs leading-tight">Alex's Fitness Training</p>
            </div>
          </div>
          {/* Center attribution — absolute-positioned so left/right stay anchored
              regardless of their widths, and the middle stays perfectly centered.
              Hidden on small screens because the header is already busy there. */}
          <a
            href="https://github.com/Hkshoonya"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-1.5 text-white/40 hover:text-white/70 text-[11px] uppercase tracking-[0.18em] transition-colors"
            title="DocZeus — designed and built this admin panel"
          >
            <span>Designed and Made by</span>
            <span className="text-[#FF4D2E] font-semibold tracking-[0.12em]">DocZeus</span>
          </a>
          <div className="flex items-center gap-2">
            {/*
              Back-to-site uses hash-route navigation. `href="/"` would jump
              to the GitHub Pages account root under sub-path deploys, taking
              Alex off-site. `#/` clears the admin route and lands on the
              homepage regardless of base path (works on both gh-pages and
              apex deploys without modification).
            */}
            <a
              href="#/"
              className="text-white/60 hover:text-white text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#FF4D2E]/40 hover:bg-[#FF4D2E]/5 transition-colors"
              title="Back to website"
            >
              <ExternalLink size={13} /> View Site
            </a>
            <button
              onClick={() => { clearAdminSession(); setAuthed(false); }}
              className="text-white/50 hover:text-white text-sm flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>

        <nav className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto">
          <TabButton active={tab === 'challenges'} onClick={() => setTab('challenges')} label="Challenges" />
          <TabButton active={tab === 'announcements'} onClick={() => setTab('announcements')} label="Announcements" />
          <TabButton active={tab === 'coaches'} onClick={() => setTab('coaches')} label="Coaches" />
          <TabButton active={tab === 'studio'} onClick={() => setTab('studio')} label="Studio" />
          <TabButton active={tab === 'stories'} onClick={() => setTab('stories')} label="Stories" />
          <TabButton active={tab === 'transformations'} onClick={() => setTab('transformations')} label="Transformations" />
          <TabButton active={tab === 'signups'} onClick={() => setTab('signups')} label="Signups" />
          <TabButton active={tab === 'credits'} onClick={() => setTab('credits')} label="Credits" />
          <TabButton active={tab === 'system'} onClick={() => setTab('system')} label="System" />
        </nav>
      </header>

      {tokenAge?.shouldWarn && (
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-amber-200 font-medium">
                Heads up — your admin token has been active for {tokenAge.daysOld} days.
              </p>
              <p className="text-amber-100/80 mt-1">
                For account safety, contact Kimi to issue a fresh token. You won't be locked out;
                this is a routine rotation reminder.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === 'challenges' && <ChallengesTab />}
        {tab === 'announcements' && <AnnouncementsTab />}
        {tab === 'coaches' && <CoachesTab />}
        {tab === 'studio' && <StudioTab />}
        {tab === 'stories' && <StoriesTab />}
        {tab === 'transformations' && <TransformationsTab />}
        {tab === 'signups' && <SignupsTab />}
        {tab === 'credits' && <CreditsTab />}
        {tab === 'system' && <SystemArchitecturePage />}
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-8 text-white/30 text-xs border-t border-white/5 mt-8">
        <div className="flex items-center justify-between">
          <span>Admin token expires after 30 days of inactivity.</span>
          <a href="#/" className="hover:text-white/60 flex items-center gap-1">
            <ExternalLink size={11} /> Back to site
          </a>
        </div>

        {/* DocZeus attribution — same wordmark + glyph used on the public
            site footer (AboutPage), so the brand mark stays consistent
            wherever DocZeus is credited. */}
        <div className="mt-6 pt-4 border-t border-white/5 flex justify-center">
          <a
            href="https://github.com/Hkshoonya"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-col items-center gap-2 text-white/20 hover:text-white/40 transition-colors group"
          >
            <span className="text-[10px] uppercase tracking-[0.2em]">Built by</span>
            <svg viewBox="0 0 200 48" width="100" height="24" aria-label="DocZeus" className="opacity-40 group-hover:opacity-70 transition-opacity">
              <rect x="2" y="8" width="32" height="32" rx="8" fill="none" stroke="#FF4D2E" strokeWidth="3"/>
              <circle cx="18" cy="24" r="6" fill="#FF4D2E"/>
              <text x="40" y="34" fontFamily="system-ui, -apple-system, sans-serif" fontSize="28" fontWeight="bold" fill="currentColor" letterSpacing="1">oczeus</text>
            </svg>
          </a>
        </div>
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
// ADMIN TIPS BOX — consistent guidance card shown at the top of
// each tab. Specs render as a small grid (aspect / size / format
// labels), tips render as bullet points. Both blocks optional so
// the same component fits tabs that need only one.
// ============================================================

function AdminTipsBox({
  specs,
  tips,
  examples,
}: {
  specs?: Array<{ label: string; value: string }>;
  tips?: string[];
  examples?: string[];
}) {
  if (!specs && !tips && !examples) return null;
  return (
    <div className="bg-[#FF4D2E]/[0.06] border border-[#FF4D2E]/20 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={14} className="text-[#FF4D2E]" />
        <p className="text-[#FF4D2E] text-xs uppercase tracking-wider font-semibold">Best Practices</p>
      </div>
      {specs && specs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          {specs.map((s, i) => (
            <div key={i}>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">{s.label}</p>
              <p className="text-white/85 text-sm font-medium">{s.value}</p>
            </div>
          ))}
        </div>
      )}
      {tips && tips.length > 0 && (
        <ul className="space-y-1.5 text-white/65 text-sm">
          {tips.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-[#FF4D2E]/70 mt-0.5">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
      {examples && examples.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5">Caption examples</p>
          <ul className="space-y-1 text-white/55 text-xs italic">
            {examples.map((e, i) => (
              <li key={i}>"{e}"</li>
            ))}
          </ul>
        </div>
      )}
    </div>
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

      <AdminTipsBox
        tips={[
          'Free or paid — toggle the price on/off. Paid challenges collect signups and require manual program assignment.',
          'Set spots wisely. Once full, signups close automatically and the challenge shows as "FILLED" on the public site.',
          'Dates are inclusive — set end date as the LAST day of the challenge, not the day after.',
          'Tags help visitors find the right challenge (e.g. "fat-loss", "strength", "beginners-welcome").',
          'To remove a challenge mid-cycle, edit it and uncheck "Active" rather than deleting (preserves signup history).',
        ]}
      />

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

      <AdminTipsBox
        tips={[
          'Status badges: NEW = signed up but not yet a Trainerize client. EXISTING = already in Trainerize. Filter or scan accordingly.',
          'Click "Assign Program" on any signup → pick a master program → Trainerize creates a copy linked to that user. Takes ~5 seconds.',
          'NEW signups need a Trainerize client account first. Create one in Trainerize, then come back — the row will flip to EXISTING.',
          'Email + phone are clickable for quick outreach.',
        ]}
      />

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

// Refund a session credit. Wraps POST /admin/refund-credit. Common
// case: forgive a no-show. By default the credit is added back to
// `remaining` capped at `total`; toggle "bonus credits" to also raise
// `total`. The reason is required and surfaces in the Trainerize note
// + admin log so refunds are auditable.
function CreditsTab() {
  const [identifier, setIdentifier] = useState('');
  const [identifierKind, setIdentifierKind] = useState<'email' | 'userId'>('email');
  const [sessions, setSessions] = useState(1);
  const [bumpTotal, setBumpTotal] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async () => {
    setResult(null);
    if (!identifier.trim()) {
      setResult({ ok: false, message: 'Enter the client\'s email or Trainerize userId.' });
      return;
    }
    if (!reason.trim()) {
      setResult({ ok: false, message: 'Reason is required (audit trail).' });
      return;
    }
    setSubmitting(true);
    const params: { email?: string; userId?: number; sessions: number; bumpTotal: boolean; reason: string } = {
      sessions, bumpTotal, reason: reason.trim(),
    };
    if (identifierKind === 'email') {
      params.email = identifier.trim();
    } else {
      const n = Number(identifier.trim());
      if (!Number.isFinite(n) || n <= 0) {
        setResult({ ok: false, message: 'userId must be a positive number.' });
        setSubmitting(false);
        return;
      }
      params.userId = n;
    }
    const resp = await refundCredit(params);
    if (resp.ok) {
      setResult({
        ok: true,
        message: `Refunded ${resp.refunded ?? sessions} credit${(resp.refunded ?? sessions) === 1 ? '' : 's'} to userId ${resp.userId}. Now: ${resp.remaining}/${resp.total} remaining.${resp.refunded != null && resp.refunded < (resp.requested ?? sessions) ? ` (Capped at total — toggle "Add as bonus credits" to exceed.)` : ''}`,
      });
      // Clear the form on success so the next refund starts fresh.
      setIdentifier('');
      setSessions(1);
      setBumpTotal(false);
      setReason('');
    } else {
      setResult({ ok: false, message: resp.error || 'Refund failed.' });
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-4xl">
      <AdminTipsBox
        tips={[
          'Use this when a client missed a session you want to forgive (sick, emergency, scheduling mix-up).',
          'The refund is logged with your reason — it shows up in Trainerize as a coach note + client message, and in the admin log.',
          '"Bonus credit" raises the total beyond what they purchased. Use sparingly — it\'s a gift, not a refund.',
        ]}
      />

      <h2 className="text-white text-xl font-semibold mt-6 mb-4 max-w-2xl">Refund a Session Credit</h2>

      <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
        <div>
          <div className="flex gap-3 mb-2 text-sm">
            <button
              onClick={() => setIdentifierKind('email')}
              className={`px-3 py-1.5 rounded-md ${identifierKind === 'email' ? 'bg-[#FF4D2E] text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >
              By email
            </button>
            <button
              onClick={() => setIdentifierKind('userId')}
              className={`px-3 py-1.5 rounded-md ${identifierKind === 'userId' ? 'bg-[#FF4D2E] text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >
              By Trainerize userId
            </button>
          </div>
          <input
            type={identifierKind === 'email' ? 'email' : 'text'}
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder={identifierKind === 'email' ? 'client@example.com' : '12345678'}
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-white/60 text-sm mb-1.5">Sessions to refund</label>
            <input
              type="number"
              min={1}
              max={20}
              value={sessions}
              onChange={e => setSessions(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white focus:outline-none focus:border-[#FF4D2E] transition-colors"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-white/70 text-sm cursor-pointer pb-3">
              <input
                type="checkbox"
                checked={bumpTotal}
                onChange={e => setBumpTotal(e.target.checked)}
                className="w-4 h-4 accent-[#FF4D2E]"
              />
              Add as bonus credits (raises total)
            </label>
          </div>
        </div>

        <div>
          <label className="block text-white/60 text-sm mb-1.5">
            Reason <span className="text-red-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. No-show forgiven — client had a flat tire"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors resize-none"
          />
          <p className="text-white/40 text-xs mt-1">
            Sent to the client via Trainerize and stored in the admin log.
          </p>
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="bg-[#FF4D2E] hover:bg-[#FF6347] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
        >
          {submitting ? 'Refunding…' : 'Refund Credit'}
        </button>

        {result && (
          <div
            className={`mt-2 px-4 py-3 rounded-lg text-sm ${
              result.ok
                ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                : 'bg-red-500/10 border border-red-500/30 text-red-300'
            }`}
          >
            {result.message}
          </div>
        )}
      </div>

      <CreditCatalogMapSection />
    </div>
  );
}

/**
 * Catalog credit map — auto-learning view.
 *
 * Replaces curl /admin/credit-map for Alex. Shows three columns:
 *   • Env: manual overrides set via wrangler secret CREDIT_CATALOG_MAP
 *   • Learned: auto-populated from prior orders (most common case)
 *   • Effective: env wins on conflict — what the worker actually uses
 *
 * The clear button wipes only the learned map (env is not touchable from
 * here for safety — that requires wrangler). Audit log captures the
 * snapshot for recovery.
 */
function CreditCatalogMapSection() {
  const [data, setData] = useState<{
    env: Record<string, CreditMapEntry>;
    learned: Record<string, CreditMapEntry>;
    effective: Record<string, CreditMapEntry>;
    counts: { env: number; learned: number; effective: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [lastClearResult, setLastClearResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const resp = await getCreditMap();
    if (!resp.ok) {
      setError(resp.error || 'Failed to load credit map');
      setData(null);
    } else {
      setData({
        env: resp.env || {},
        learned: resp.learned || {},
        effective: resp.effective || {},
        counts: resp.counts || { env: 0, learned: 0, effective: 0 },
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setClearing(true);
    setLastClearResult(null);
    const resp = await clearCreditMap();
    if (resp.ok) {
      setLastClearResult(`Cleared ${resp.cleared ?? 0} learned variations. Future orders will re-learn via name matching.`);
      await load();
    } else {
      setLastClearResult(`Clear failed: ${resp.error}`);
    }
    setClearing(false);
    setConfirmingClear(false);
  };

  const learnedEntries = data ? Object.entries(data.learned) : [];
  const envEntries = data ? Object.entries(data.env) : [];

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-xl font-semibold flex items-center gap-2">
          <Database size={20} className="text-[#FF4D2E]" />
          Catalog Credit Map
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="text-white/60 hover:text-white text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <AdminTipsBox
        tips={[
          'The worker auto-learns each Square product\'s credit value the first time someone buys it. After the first sale of a product, future orders match by Square ID — so renaming the product is safe.',
          'Env overrides take precedence — set them via wrangler secret CREDIT_CATALOG_MAP if a learned entry was wrong. Until then, learned entries are what get applied.',
          'Clearing the learned map forces every variation to re-learn from name matching on its next sale. Only do this if a misfire needs full reset.',
        ]}
      />

      {loading && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center text-white/50 mt-4 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Loading credit map…
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mt-4 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {data && !loading && !error && (
        <div className="mt-4 space-y-5">
          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-white/40 text-xs uppercase tracking-wider">Env overrides</p>
              <p className="text-2xl font-bold text-white mt-1">{data.counts.env}</p>
              <p className="text-white/50 text-xs mt-0.5">Manual, wrangler-set</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-white/40 text-xs uppercase tracking-wider">Learned</p>
              <p className="text-2xl font-bold text-white mt-1">{data.counts.learned}</p>
              <p className="text-white/50 text-xs mt-0.5">Auto-learned from orders</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-white/40 text-xs uppercase tracking-wider">Effective</p>
              <p className="text-2xl font-bold text-white mt-1">{data.counts.effective}</p>
              <p className="text-white/50 text-xs mt-0.5">What the worker uses</p>
            </div>
          </div>

          {/* Env overrides table */}
          {envEntries.length > 0 && (
            <CreditMapTable
              title="Env Overrides"
              subtitle="From CREDIT_CATALOG_MAP wrangler secret. Always wins."
              entries={envEntries}
              showUsage={false}
            />
          )}

          {/* Learned table */}
          {learnedEntries.length > 0 ? (
            <CreditMapTable
              title="Auto-Learned Variations"
              subtitle="Captured from successful name-matched orders."
              entries={learnedEntries}
              showUsage={true}
            />
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-sm text-white/50">
              No learned variations yet. The first sale of each plan / credits product will populate this list.
            </div>
          )}

          {/* Clear button */}
          {learnedEntries.length > 0 && (
            <div className="border-t border-white/10 pt-5">
              <p className="text-white/60 text-sm mb-3">
                Wipe all auto-learned variations? Future orders will re-learn from name matching. Env overrides are unaffected.
              </p>
              {!confirmingClear ? (
                <button
                  onClick={() => setConfirmingClear(true)}
                  className="text-red-300 hover:text-red-200 text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={14} />
                  Clear learned map
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClear}
                    disabled={clearing}
                    className="bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
                  >
                    {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Yes, clear all {learnedEntries.length} entries
                  </button>
                  <button
                    onClick={() => setConfirmingClear(false)}
                    disabled={clearing}
                    className="text-white/60 hover:text-white text-sm px-3 py-2"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {lastClearResult && (
                <p className={`mt-3 text-sm ${lastClearResult.startsWith('Clear failed') ? 'text-red-300' : 'text-green-300'}`}>
                  {lastClearResult}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreditMapTable({
  title,
  subtitle,
  entries,
  showUsage,
}: {
  title: string;
  subtitle: string;
  entries: [string, CreditMapEntry][];
  showUsage: boolean;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/10">
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        <p className="text-white/50 text-xs mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-white/40 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-white/5">
              <th className="text-left px-5 py-2.5 font-semibold">Product</th>
              <th className="text-left px-3 py-2.5 font-semibold">Variation ID</th>
              <th className="text-right px-3 py-2.5 font-semibold">Credits</th>
              <th className="text-right px-3 py-2.5 font-semibold">Duration</th>
              {showUsage && <>
                <th className="text-right px-3 py-2.5 font-semibold">Sales</th>
                <th className="text-right px-5 py-2.5 font-semibold">Last seen</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {entries.map(([variationId, entry]) => (
              <tr key={variationId} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="px-5 py-2.5 text-white">
                  <div className="font-medium truncate max-w-xs">{entry.name || '—'}</div>
                  {entry.source && (
                    <div className="text-white/40 text-[10px] uppercase tracking-wider mt-0.5">
                      {entry.source}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-white/60 font-mono text-[11px] truncate max-w-[140px]">
                  {variationId}
                </td>
                <td className="px-3 py-2.5 text-right text-white font-semibold">
                  {entry.credits}
                </td>
                <td className="px-3 py-2.5 text-right text-white/70">
                  {entry.duration ? `${entry.duration}m` : '—'}
                </td>
                {showUsage && <>
                  <td className="px-3 py-2.5 text-right text-white/70">
                    {entry.count ?? '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right text-white/50 text-xs">
                    {entry.lastSeen ? new Date(entry.lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

// ============================================================
// ANNOUNCEMENTS TAB — site banner + inline-card content
// ============================================================

function AnnouncementsTab() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const all = await getAllAnnouncements();
    // Newest first — admin most likely to edit recent items.
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setItems(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display font-bold text-2xl mb-1">Announcements</h2>
          <p className="text-white/40 text-sm">
            Sticky banner at the top of the homepage, or an inline card above the plans section.
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => { setShowAddForm(true); setEditingId(null); setError(null); }}
            className="bg-[#FF4D2E] hover:bg-[#FF6B4A] text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> New Announcement
          </button>
        )}
      </div>

      <AdminTipsBox
        tips={[
          'Style: BANNER = floating cards over the hero (high impact, keep ≤2 active). CARD = inline section after Value (more detail, good for promos).',
          'Priority HIGH adds a subtle pulse animation + orange shadow — use sparingly so it stays attention-grabbing.',
          'Schedule with Starts/Ends dates. Past announcements auto-hide; future ones queue up. No need to remember to disable.',
          'CTA Target presets: "View Plans" / "Book Consultation" / "Sign In" cover the common cases. Use "Custom" to point at any URL or hash route.',
          'Discount codes are just text labels — they don\'t enforce anything; Square Checkout still applies the actual code.',
        ]}
      />

      {showAddForm && (
        <AnnouncementForm
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

      {loading && <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Loading announcements...</div>}

      {!loading && items.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <Megaphone size={28} className="mx-auto mb-3 text-white/30" />
          <p className="text-white/40 text-sm">No announcements yet. Hit "New Announcement" to add the first one.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(a => (
            editingId === a.id ? (
              <AnnouncementForm
                key={a.id}
                mode="edit"
                initial={a}
                onCancel={() => { setEditingId(null); setError(null); }}
                onSaved={() => { setEditingId(null); setError(null); load(); }}
                onError={setError}
              />
            ) : (
              <AnnouncementRow
                key={a.id}
                announcement={a}
                onEdit={() => { setEditingId(a.id); setShowAddForm(false); setError(null); }}
                onToggle={async () => {
                  setError(null);
                  const updated = await updateAnnouncement(a.id, { enabled: !a.enabled });
                  if (!updated) setError('Could not update — try again.');
                  load();
                }}
                onDelete={async () => {
                  if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
                  const ok = await deleteAnnouncement(a.id);
                  if (!ok) setError('Delete failed — try again.');
                  load();
                }}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementRow({ announcement: a, onEdit, onToggle, onDelete }: {
  announcement: Announcement;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const status = getAnnouncementStatus(a);
  const statusStyles = {
    live: 'text-green-400 bg-green-500/10',
    scheduled: 'text-[#FF4D2E] bg-[#FF4D2E]/10',
    ended: 'text-white/30 bg-white/5',
    disabled: 'text-white/30 bg-white/5',
  }[status];

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h3 className="font-semibold truncate">{a.title}</h3>
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${statusStyles}`}>
            {status}
          </span>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-white/60 bg-white/5">
            {a.style === 'banner' ? 'Hero overlay' : 'Inline section'}
          </span>
          {a.priority === 'high' && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-[#FF4D2E] bg-[#FF4D2E]/10">
              High priority
            </span>
          )}
          {a.discountCode && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-white/70 bg-white/[0.07] font-mono">
              {a.discountCode}
            </span>
          )}
        </div>
        {a.subtitle && <p className="text-white/50 text-sm mb-3 line-clamp-2">{a.subtitle}</p>}
        <div className="flex flex-wrap gap-4 text-xs text-white/40">
          <span className="flex items-center gap-1.5">
            <Calendar size={12} /> {fmt(a.startsAt)} → {fmt(a.endsAt)}
          </span>
          {a.ctaLabel && a.ctaTarget && (
            <span className="text-white/50 truncate max-w-xs">CTA: "{a.ctaLabel}" → {a.ctaTarget}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggle}
          className={`text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors ${
            a.enabled
              ? 'text-green-400 bg-green-500/10 hover:bg-green-500/20'
              : 'text-white/40 bg-white/5 hover:bg-white/10'
          }`}
          title={a.enabled ? 'Click to disable' : 'Click to enable'}
        >
          {a.enabled ? 'On' : 'Off'}
        </button>
        <button
          onClick={onEdit}
          className="text-white/30 hover:text-[#FF4D2E] transition-colors p-2 rounded-lg hover:bg-[#FF4D2E]/10"
          title="Edit announcement"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={onDelete}
          className="text-white/30 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-500/10"
          title="Delete announcement"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function AnnouncementForm({
  mode, initial, onCancel, onSaved, onError,
}: {
  mode: 'create' | 'edit';
  initial?: Announcement;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    subtitle: initial?.subtitle ?? '',
    ctaLabel: initial?.ctaLabel ?? '',
    ctaTarget: initial?.ctaTarget ?? '',
    style: (initial?.style ?? 'banner') as 'banner' | 'card',
    priority: (initial?.priority ?? 'normal') as 'high' | 'normal',
    startsAt: initial?.startsAt ?? '',
    endsAt: initial?.endsAt ?? '',
    enabled: initial?.enabled ?? true,
    discountCode: initial?.discountCode ?? '',
  });
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    onError(null);
    if (!form.title.trim()) return onError('Title is required.');
    if (form.endsAt && form.startsAt && new Date(form.endsAt) < new Date(form.startsAt)) {
      return onError('End date must be after start date.');
    }
    setSaving(true);
    const payload = {
      ...form,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
    };
    const result = mode === 'create'
      ? await createAnnouncement(payload)
      : await updateAnnouncement(initial!.id, payload);
    setSaving(false);
    if (!result) {
      onError(mode === 'create' ? 'Could not create — check your admin token.' : 'Could not update — check your admin token.');
      return;
    }
    onSaved();
  };

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6 mb-3 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-bold text-lg">
          {mode === 'create' ? 'New Announcement' : 'Edit Announcement'}
        </h3>
        <button onClick={onCancel} className="text-white/40 hover:text-white p-1" aria-label="Cancel">
          <X size={18} />
        </button>
      </div>

      {/* Title */}
      <FormField label="Title" required hint="Max ~40 chars to fit on one line in the banner.">
        <input
          type="text"
          value={form.title}
          onChange={e => setField('title', e.target.value)}
          placeholder="20% off all training plans"
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
        />
      </FormField>

      {/* Subtitle */}
      <FormField label="Subtitle" hint="Optional. Shown next to title (banner) or below (card).">
        <input
          type="text"
          value={form.subtitle}
          onChange={e => setField('subtitle', e.target.value)}
          placeholder="Use code SUMMER20 at checkout — through June 30"
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
        />
      </FormField>

      {/* Display surface + Priority */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Display surface" hint="Where the announcement appears on the page.">
          <div className="grid grid-cols-2 gap-2">
            <RadioPill
              active={form.style === 'banner'}
              onClick={() => setField('style', 'banner')}
              label="Hero overlay"
              hint="Floating, top of page"
            />
            <RadioPill
              active={form.style === 'card'}
              onClick={() => setField('style', 'card')}
              label="Inline section"
              hint="Above plans"
            />
          </div>
        </FormField>

        <FormField label="Priority" hint="High shows pulsing orange accent.">
          <div className="grid grid-cols-2 gap-2">
            <RadioPill
              active={form.priority === 'normal'}
              onClick={() => setField('priority', 'normal')}
              label="Normal"
            />
            <RadioPill
              active={form.priority === 'high'}
              onClick={() => setField('priority', 'high')}
              label="High"
              hint="Pulse + accent"
            />
          </div>
        </FormField>
      </div>

      {/* CTA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="CTA Label" hint='e.g. "View Plans"'>
          <input
            type="text"
            value={form.ctaLabel}
            onChange={e => setField('ctaLabel', e.target.value)}
            placeholder="View Plans"
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
          />
        </FormField>
        <FormField label="CTA Target" hint="Click a preset below or type a custom URL/anchor.">
          <input
            type="text"
            value={form.ctaTarget}
            onChange={e => setField('ctaTarget', e.target.value)}
            placeholder="#plans or https://..."
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
          />
          <CtaPresetChips
            current={form.ctaTarget}
            onPick={(value) => setField('ctaTarget', value)}
          />
        </FormField>
      </div>

      {/* Discount code */}
      <FormField label="Discount code (optional)" hint="Set in Square. Shown next to subtitle.">
        <input
          type="text"
          value={form.discountCode}
          onChange={e => setField('discountCode', e.target.value)}
          placeholder="SUMMER20"
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] font-mono uppercase tracking-wider"
        />
      </FormField>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Starts at" hint="Optional. Empty = show now.">
          <input
            type="datetime-local"
            value={form.startsAt ? form.startsAt.slice(0, 16) : ''}
            onChange={e => setField('startsAt', e.target.value ? new Date(e.target.value).toISOString() : '')}
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
          />
        </FormField>
        <FormField label="Ends at" hint="Optional. Empty = run until disabled.">
          <input
            type="datetime-local"
            value={form.endsAt ? form.endsAt.slice(0, 16) : ''}
            onChange={e => setField('endsAt', e.target.value ? new Date(e.target.value).toISOString() : '')}
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E]"
          />
        </FormField>
      </div>

      {/* Enabled toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={e => setField('enabled', e.target.checked)}
          className="w-4 h-4 rounded border-white/20 bg-white/5 text-[#FF4D2E] focus:ring-[#FF4D2E]"
        />
        <span className="text-sm text-white/80">Enabled (visible to visitors)</span>
      </label>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#FF4D2E] hover:bg-[#FF6B4A] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {mode === 'create' ? 'Create' : 'Save changes'}
        </button>
        <button
          onClick={onCancel}
          className="text-white/50 hover:text-white text-sm px-4 py-2 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FormField({
  label, required, hint, children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-white/50 font-semibold mb-1.5">
        {label}{required && <span className="text-[#FF4D2E]"> *</span>}
      </label>
      {children}
      {hint && <p className="text-white/30 text-xs mt-1">{hint}</p>}
    </div>
  );
}

function RadioPill({
  active, onClick, label, hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
        active
          ? 'border-[#FF4D2E]/40 bg-[#FF4D2E]/10 text-white'
          : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
      }`}
    >
      <span className="font-semibold block">{label}</span>
      {hint && <span className="text-[0.65rem] text-white/40">{hint}</span>}
    </button>
  );
}

// CTA target presets — one click fills the form field with the right
// anchor/modal-key string. Sectioned so Alex can scan by category.
// Section IDs come from <section id="..."> tags in App.tsx; modal keys
// match the openAnnouncementModal switch in App.tsx.
const CTA_TARGET_PRESETS = {
  Sections: [
    { label: 'Plans', value: '#plans' },
    { label: 'Studio', value: '#studio' },
    { label: 'Transformations', value: '#transformations' },
    { label: 'Reviews', value: '#testimonials' },
    { label: 'Get Started', value: '#book' },
  ],
  Modals: [
    { label: 'Booking', value: 'modal:booking' },
    { label: 'Plans Shop', value: 'modal:shop' },
    { label: 'Quick Message', value: 'modal:message' },
    { label: 'About', value: 'modal:about' },
  ],
} as const;

function CtaPresetChips({ current, onPick }: { current: string; onPick: (v: string) => void }) {
  return (
    <div className="mt-3 space-y-2">
      {(Object.entries(CTA_TARGET_PRESETS) as [string, readonly { label: string; value: string }[]][]).map(([group, items]) => (
        <div key={group}>
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-white/30 font-semibold mb-1.5">{group}</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map(item => {
              const active = current === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onPick(item.value)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    active
                      ? 'border-[#FF4D2E]/40 bg-[#FF4D2E]/15 text-[#FF4D2E]'
                      : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.07] hover:text-white'
                  }`}
                  title={item.value}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// COACHES TAB — upload/replace/remove headshot for each Square
// team member. Coach list comes from Square (the source of truth);
// this tab just owns the photo override per coach.
// ============================================================

function CoachesTab() {
  const [coaches, setCoaches] = useState<TeamMember[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin view always bypasses Cloudflare's edge cache for photos so an
  // upload appears immediately (public visitors continue to use the
  // 5-min cached endpoint). The Square team list still respects its
  // 24h localStorage cache here — coaches change rarely; what we need
  // fresh is the photo overrides.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [team, p] = await Promise.all([
        getTeamMembers(),
        getCoachPhotos({ noCache: true }),
      ]);
      setCoaches(team.filter(m => m.role !== 'consultation'));
      setPhotos(p);
    } catch {
      setError('Could not load coach list. Try refreshing.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleResync = async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshTeamMembers();
      const [team, p] = await Promise.all([
        getTeamMembers(),
        getCoachPhotos({ noCache: true }),
      ]);
      setCoaches(team.filter(m => m.role !== 'consultation'));
      setPhotos(p);
    } catch {
      setError('Refresh failed.');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl mb-1">Coaches</h2>
          <p className="text-white/40 text-sm max-w-2xl">
            Coaches sync automatically from Square Team Members. Add or remove coaches in Square Dashboard
            to update this list. Use the upload button below to override a coach's photo (otherwise their
            initials show on the website).
          </p>
        </div>
        <button
          onClick={handleResync}
          className="text-white/60 hover:text-white text-xs flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 hover:border-[#FF4D2E]/40 transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
          Resync from Square
        </button>
      </div>

      <AdminTipsBox
        specs={[
          { label: 'Aspect', value: 'Square (1:1)' },
          { label: 'Min size', value: '600 × 600 px' },
          { label: 'Format', value: 'JPG, PNG, WebP' },
        ]}
        tips={[
          'Center the face — coach photos display as circular avatars (Gmail/Slack style).',
          'Bright, even lighting. Solid or gym-themed background reads cleanly at small sizes.',
          'Photos compress automatically to ~150KB before upload — no need to pre-resize.',
          'No upload? Coaches show with a clean orange-tinted initials avatar (auto-generated).',
        ]}
      />

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {loading && coaches.length === 0 && (
        <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading coaches...
        </div>
      )}

      {!loading && coaches.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <Users size={28} className="mx-auto mb-3 text-white/30" />
          <p className="text-white/40 text-sm">
            No coaches found in Square. Add team members in Square Dashboard, then click "Resync from Square".
          </p>
        </div>
      )}

      {coaches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {coaches.map(c => {
            const adminPhoto = photos[c.id] || (c.squareTeamMemberId ? photos[c.squareTeamMemberId] : undefined);
            // The displayed image priority follows the same chain as the
            // public site, so admin sees exactly what visitors see.
            const displayedImage = adminPhoto ?? c.image;
            return (
              <CoachPhotoCard
                key={c.id}
                coach={c}
                hasAdminPhoto={!!adminPhoto}
                displayedImage={displayedImage}
                onChange={() => load()}
                onError={setError}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CoachPhotoCard({ coach, hasAdminPhoto, displayedImage, onChange, onError }: {
  coach: TeamMember;
  hasAdminPhoto: boolean;
  displayedImage?: string;
  onChange: () => void;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    onError(null);
    setBusy(true);
    try {
      const result = await compressImage(file, { maxEdge: 600, quality: 0.85 });
      const teamId = coach.squareTeamMemberId || coach.id;
      const res = await uploadCoachPhoto(teamId, result.dataUrl);
      if (!res.ok) {
        onError(res.error || 'Upload failed.');
        setBusy(false);
        return;
      }
      onChange();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not process image.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(`Remove uploaded photo for ${coach.name}? They'll show with their initials until you upload another.`)) return;
    onError(null);
    setBusy(true);
    const teamId = coach.squareTeamMemberId || coach.id;
    const ok = await deleteCoachPhoto(teamId);
    if (!ok) onError('Delete failed.');
    onChange();
    setBusy(false);
  };

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 flex items-center gap-4">
      <CoachAvatar
        name={coach.name}
        image={displayedImage}
        isHeadCoach={coach.role === 'head-coach'}
        className="w-16 h-16 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="font-semibold truncate">{coach.name}</p>
          {coach.role === 'head-coach' && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-[#FF4D2E] bg-[#FF4D2E]/10">
              Head Coach
            </span>
          )}
          {hasAdminPhoto && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold text-green-400 bg-green-500/10">
              Custom photo
            </span>
          )}
        </div>
        <p className="text-white/40 text-xs truncate">{coach.title || 'Trainer'}</p>
        <div className="flex gap-2 mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 text-[#FF4D2E] hover:bg-[#FF4D2E]/25 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {hasAdminPhoto ? 'Replace' : 'Upload'}
          </button>
          {hasAdminPhoto && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-red-400 hover:border-red-500/30 disabled:opacity-50 transition-colors"
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STUDIO TAB — admin-managed gallery for the About page Studio
// section. Upload, list, delete. Order is creation order (newest
// first) — no reorder UI by design; if Alex wants a specific photo
// first he can delete + re-upload.
// ============================================================

function StudioTab() {
  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Admin always bypasses Cloudflare's 5-min edge cache so uploads
  // appear immediately. Public visitors keep using the cached path.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getStudioPhotos({ noCache: true });
      setPhotos(list);
    } catch {
      setError('Could not load studio photos. Try refreshing.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      // 1200px max — these display full-width on desktop. Quality stays
      // at 0.85 default; the hard 800KB cap in compressImage will kick
      // down to 0.5 for oversized DSLR shots.
      const result = await compressImage(file, { maxEdge: 1200, quality: 0.85, maxBytes: 780_000 });
      const res = await uploadStudioPhoto(result.dataUrl);
      if (!res.ok) {
        setError(res.error || 'Upload failed.');
        setUploading(false);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process image.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this studio photo? Visitors will no longer see it on the About page.')) return;
    setError(null);
    const ok = await deleteStudioPhoto(id);
    if (!ok) setError('Delete failed. Try again.');
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl mb-1">Studio Photos</h2>
          <p className="text-white/40 text-sm max-w-2xl">
            Photos in this gallery cycle on the <span className="text-white/70">About → The Studio</span> section.
            Newest uploads appear first. If no photos are uploaded, the page falls back to the default studio gallery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 text-[#FF4D2E] hover:bg-[#FF4D2E]/25 disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Uploading…' : 'Upload Photo'}
          </button>
        </div>
      </div>

      <AdminTipsBox
        specs={[
          { label: 'Aspect', value: 'Landscape 16:9' },
          { label: 'Min size', value: '1200 × 675 px' },
          { label: 'Format', value: 'JPG, PNG, WebP' },
        ]}
        tips={[
          'Wide angles read best — shoot from a corner showing equipment + space.',
          'Bright, even lighting. Avoid harsh shadows or extreme contrast.',
          'Mix variety: weight floor, dojo / open mat, cardio area, recovery zone.',
          'Photos compress automatically to ~150KB before upload — no need to pre-resize.',
        ]}
      />

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {loading && photos.length === 0 && (
        <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading studio photos...
        </div>
      )}

      {!loading && photos.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <ImageIcon size={28} className="mx-auto mb-3 text-white/30" />
          <p className="text-white/50 text-sm mb-1">No studio photos uploaded yet.</p>
          <p className="text-white/30 text-xs">
            The About page is showing the default gallery until you upload here.
          </p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p) => (
            <StudioPhotoCard key={p.id} photo={p} onDelete={() => handleDelete(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudioPhotoCard({ photo, onDelete }: { photo: StudioPhoto; onDelete: () => void }) {
  return (
    <div className="group relative aspect-[4/3] rounded-xl overflow-hidden border border-white/10 bg-white/[0.02]">
      <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
      {/* Hover overlay with delete button — desktop. On mobile/tap the
          button is always at 70% opacity so it's reachable without hover. */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-end p-2">
        <button
          type="button"
          onClick={onDelete}
          className="opacity-70 group-hover:opacity-100 text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-red-500/80 hover:bg-red-500 text-white backdrop-blur-sm transition-all"
          title="Delete photo"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ============================================================
// STORIES TAB — admin-curated client success photos with optional
// captions. Cycles above the testimonials section on the homepage.
// Caption is the storytelling hook — kept short (≤140) so it
// reads well as an overlay.
// ============================================================

const MAX_CAPTION_LEN = 140;

function StoriesTab() {
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getClientPhotos({ noCache: true });
      setPhotos(list);
    } catch {
      setError('Could not load stories. Try refreshing.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Two-step upload: pick file (shows preview + caption field), then
  // submit. This lets Alex compose the caption while looking at the
  // photo, instead of being dropped a "what's the caption?" prompt
  // mid-upload after the file dialog closes.
  const handlePickFile = (file: File) => {
    setError(null);
    setPendingFile(file);
    setPendingCaption('');
    const reader = new FileReader();
    reader.onload = () => setPendingPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleCancelPending = () => {
    setPendingFile(null);
    setPendingPreview(null);
    setPendingCaption('');
  };

  const handleSubmit = async () => {
    if (!pendingFile) return;
    setError(null);
    setUploading(true);
    try {
      const result = await compressImage(pendingFile, { maxEdge: 1200, quality: 0.85, maxBytes: 780_000 });
      const res = await uploadClientPhoto(result.dataUrl, pendingCaption.trim() || undefined);
      if (!res.ok) {
        setError(res.error || 'Upload failed.');
        setUploading(false);
        return;
      }
      handleCancelPending();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process image.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this story? Visitors will no longer see it on the homepage.')) return;
    setError(null);
    const ok = await deleteClientPhoto(id);
    if (!ok) setError('Delete failed. Try again.');
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl mb-1">Client Success Stories</h2>
          <p className="text-white/40 text-sm max-w-2xl">
            These photos cycle above the <span className="text-white/70">What Clients Say</span> section.
            Captions are optional but recommended — they're the storytelling hook
            (e.g. "Lost 35 lbs in 12 weeks. — Sarah M.").
            If no stories are uploaded, the homepage falls back to the original photo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs">{photos.length} {photos.length === 1 ? 'story' : 'stories'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handlePickFile(f);
              e.target.value = '';
            }}
          />
          {!pendingFile && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 text-[#FF4D2E] hover:bg-[#FF4D2E]/25 transition-colors"
            >
              <Upload size={13} /> Add Story
            </button>
          )}
        </div>
      </div>

      <AdminTipsBox
        specs={[
          { label: 'Aspect', value: 'Portrait 4:5' },
          { label: 'Min size', value: '1000 × 1250 px' },
          { label: 'Format', value: 'JPG, PNG, WebP' },
        ]}
        tips={[
          'Portrait crop works best — the homepage container is 4:5. Square or taller is fine; landscape gets letterboxed.',
          'Caption is your storytelling hook. Lead with the result, then the name.',
          'Use first name + last initial (privacy-friendly, still feels personal).',
          'Captions are capped at 140 characters — short and punchy beats long.',
        ]}
        examples={[
          'Lost 35 lbs in 12 weeks. — Sarah M.',
          "Dropped 4 dress sizes for the wedding. — Jenna K.",
          "PR'd squat at 405. — Mike R.",
          'From couch to first 5K in 8 weeks. — David L.',
        ]}
      />

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {/* Pending upload composer — visible only after a file is picked */}
      {pendingFile && pendingPreview && (
        <div className="bg-white/[0.04] border border-[#FF4D2E]/30 rounded-2xl p-5 mb-6">
          <div className="grid sm:grid-cols-[200px_1fr] gap-5 items-start">
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-black">
              <img src={pendingPreview} alt="Pending upload" className="w-full h-full object-cover" />
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-white/60 text-xs uppercase tracking-wider mb-1.5">
                  Caption <span className="text-white/30 normal-case tracking-normal">(optional, {MAX_CAPTION_LEN} char max)</span>
                </label>
                <textarea
                  value={pendingCaption}
                  onChange={e => setPendingCaption(e.target.value.slice(0, MAX_CAPTION_LEN))}
                  rows={2}
                  placeholder='e.g. "Lost 35 lbs in 12 weeks. — Sarah M."'
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] resize-none"
                />
                <p className="text-white/30 text-[10px] mt-1">
                  {pendingCaption.length} / {MAX_CAPTION_LEN}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={uploading}
                  className="text-xs flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF4D2E] hover:bg-[#FF4D2E]/90 text-white disabled:opacity-50 transition-colors font-semibold"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {uploading ? 'Uploading…' : 'Save Story'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelPending}
                  disabled={uploading}
                  className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-50 transition-colors"
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && photos.length === 0 && (
        <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading stories...
        </div>
      )}

      {!loading && photos.length === 0 && !pendingFile && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <ImageIcon size={28} className="mx-auto mb-3 text-white/30" />
          <p className="text-white/50 text-sm mb-1">No client stories uploaded yet.</p>
          <p className="text-white/30 text-xs">
            The homepage is showing the original client photo until you upload here.
          </p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {photos.map((p) => (
            <StoryPhotoCard key={p.id} photo={p} onDelete={() => handleDelete(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function StoryPhotoCard({ photo, onDelete }: { photo: ClientPhoto; onDelete: () => void }) {
  return (
    <div className="group rounded-xl overflow-hidden border border-white/10 bg-white/[0.02] flex flex-col">
      <div className="relative aspect-[4/3] bg-black">
        <img src={photo.dataUrl} alt={photo.caption || ''} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-end p-2">
          <button
            type="button"
            onClick={onDelete}
            className="opacity-70 group-hover:opacity-100 text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-red-500/80 hover:bg-red-500 text-white backdrop-blur-sm transition-all"
            title="Delete story"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
      <div className="p-3 min-h-[3.5rem]">
        {photo.caption ? (
          <p className="text-white/80 text-sm leading-snug">"{photo.caption}"</p>
        ) : (
          <p className="text-white/30 text-xs italic">No caption</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// TRANSFORMATIONS TAB — admin-managed before/after composite photos
// for the homepage Transformations carousel. Single image per record;
// Alex composites externally before upload (matches existing workflow
// and avoids redesigning the gallery UX with a label/overlay surface).
// ============================================================

function TransformationsTab() {
  const [photos, setPhotos] = useState<Transformation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getTransformations({ noCache: true });
      setPhotos(list);
    } catch {
      setError('Could not load transformations. Try refreshing.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const result = await compressImage(file, { maxEdge: 1400, quality: 0.85, maxBytes: 780_000 });
      const res = await uploadTransformation(result.dataUrl);
      if (!res.ok) {
        setError(res.error || 'Upload failed.');
        setUploading(false);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process image.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this transformation? It will no longer appear in the homepage carousel.')) return;
    setError(null);
    const ok = await deleteTransformation(id);
    if (!ok) setError('Delete failed. Try again.');
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl mb-1">Transformations</h2>
          <p className="text-white/40 text-sm max-w-2xl">
            These photos cycle in the <span className="text-white/70">Real Results</span> carousel on the homepage.
            Upload your before/after composite as a single image. Newest uploads appear first.
            If no transformations are uploaded, the page falls back to the default gallery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FF4D2E]/15 border border-[#FF4D2E]/30 text-[#FF4D2E] hover:bg-[#FF4D2E]/25 disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Uploading…' : 'Upload Transformation'}
          </button>
        </div>
      </div>

      <AdminTipsBox
        specs={[
          { label: 'Aspect', value: 'Side-by-side composite' },
          { label: 'Min width', value: '1400 px' },
          { label: 'Format', value: 'JPG, PNG, WebP' },
        ]}
        tips={[
          'Build the before/after as a single image (Canva, Photoshop, or any photo editor with split layout).',
          'Same lighting, pose, and angle for both halves — the comparison is the story.',
          "Keep the subject centered. The homepage carousel uses object-contain — nothing's cropped.",
          'Get written client consent before posting transformations publicly.',
        ]}
      />

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {loading && photos.length === 0 && (
        <div className="text-white/50 text-sm flex items-center gap-2 py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading transformations...
        </div>
      )}

      {!loading && photos.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl p-12 text-center">
          <ImageIcon size={28} className="mx-auto mb-3 text-white/30" />
          <p className="text-white/50 text-sm mb-1">No transformations uploaded yet.</p>
          <p className="text-white/30 text-xs">
            The homepage is showing the default gallery until you upload here.
          </p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {photos.map((p) => (
            <TransformationCard key={p.id} transformation={p} onDelete={() => handleDelete(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TransformationCard({ transformation, onDelete }: { transformation: Transformation; onDelete: () => void }) {
  return (
    <div className="group relative aspect-[4/3] rounded-xl overflow-hidden border border-white/10 bg-black">
      <img src={transformation.dataUrl} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-end p-2">
        <button
          type="button"
          onClick={onDelete}
          className="opacity-70 group-hover:opacity-100 text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-red-500/80 hover:bg-red-500 text-white backdrop-blur-sm transition-all"
          title="Delete transformation"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}
