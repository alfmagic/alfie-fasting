import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'alfie-fasting-logs';
const PROFILE_KEY = 'alfie-fasting-profile';

// ── Palette ────────────────────────────────────────────────────────────────
// Electric cyan: split-complementary to red-orange, pops on near-black.
// Swap ACCENT to try: violet '#a78bfa' · lime '#a3e635' · gold '#fbbf24'
const ACCENT = '#22d3ee';
const BG     = '#0d0d0d';
const PANEL  = '#0f0f0f';
const TEXT   = '#e4e4e4';
const MUTED  = '#5a5a5a';
const R = 120, CX = 160, CY = 160;
const CIRC = 2 * Math.PI * R;

const PRESETS = [
  { label: 'Circadian', hours: 13,  color: '#7c3aed' },
  { label: '16:8 TRF',  hours: 16,  color: '#0891b2' },
  { label: '18:6 TRF',  hours: 18,  color: '#059669' },
  { label: '20:4 TRF',  hours: 20,  color: '#d97706' },
  { label: '36-Hour',   hours: 36,  color: '#2563eb' },
  { label: 'Custom',    hours: null, color: '#374151' },
];

const DAY_PRESETS = [
  { label: '1 day',  hours: 24  },
  { label: '2 days', hours: 48  },
  { label: '3 days', hours: 72  },
  { label: '4 days', hours: 96  },
  { label: '5 days', hours: 120 },
  { label: '7 days', hours: 168 },
];

const ACCENT_GOAL = '#22c55e'; // green — ring turns this color when goal is reached

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtHHMMSS(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function parseTime(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${String(m).padStart(2,'0')}m`;
}
function fmtHoursLabel(hours) {
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24), h = hours % 24;
  return h > 0 ? `${d}d ${h}h` : `${d} day${d !== 1 ? 's' : ''}`;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false });
}
function toLocalInput(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0,16);
}

function getStorage() {
  if (window.storage?.get && window.storage?.set) {
    return {
      get: async (k) => { const r = await window.storage.get({ [k]: null }); return r?.[k] ?? null; },
      set: async (k, v) => { await window.storage.set({ [k]: v }); },
    };
  }
  return {
    get: async (k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; },
    set: async (k, v) => { localStorage.setItem(k, JSON.stringify(v)); },
  };
}

function arcTip(progress) {
  const a = progress * 2 * Math.PI - Math.PI / 2;
  return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
}

function calcBMR(gender, age, weight, height) {
  const a = Number(age), w = Number(weight), h = Number(height);
  if (!a || !w || !h || a <= 0 || w <= 0 || h <= 0) return null;
  const base = 10 * w + 6.25 * h - 5 * a;
  if (gender === 'male')   return base + 5;
  if (gender === 'female') return base - 161;
  return base - 78;
}
function calcKcal(bmr, ms) {
  if (!bmr || ms <= 0) return null;
  return Math.round((bmr / 24) * (ms / 3_600_000));
}
function fmtFatMass(kcal) {
  const kg = kcal / 7700;
  return kg < 0.1 ? `${Math.round(kg * 1000)}g` : `${kg.toFixed(2)} kg`;
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const storeRef = useRef(getStorage());

  const [logs,   setLogs]   = useState([]);
  const [active, setActive] = useState(null);
  const [now,    setNow]    = useState(Date.now());

  const [profile,     setProfile]     = useState({ gender:'male', age:'', weight:'', height:'' });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ gender:'male', age:'', weight:'', height:'' });

  const [presetOpen, setPresetOpen] = useState(false);
  const [customVal,  setCustomVal]  = useState('');
  const [customUnit, setCustomUnit] = useState('hours');
  const [customErr,  setCustomErr]  = useState('');

  // 'elapsed' shows elapsed time + %; 'remaining' shows time left
  const [centerMode, setCenterMode] = useState('elapsed');

  // live-fast targeted editing: 'start' | 'goal' | null
  const [liveEdit,     setLiveEdit]     = useState(null);
  const [liveStartVal, setLiveStartVal] = useState('');
  const [liveGoalVal,  setLiveGoalVal]  = useState('');
  const [liveGoalUnit, setLiveGoalUnit] = useState('hours');
  const [liveErr,      setLiveErr]      = useState('');

  const [editModal, setEditModal] = useState(null);
  const [editForm,  setEditForm]  = useState({ start:'', end:'', goalHours:'', note:'' });
  const [editErr,   setEditErr]   = useState('');
  const [delTarget, setDelTarget] = useState(null);

  const initialized = useRef(false);

  // ── load ──
  useEffect(() => {
    storeRef.current.get(STORAGE_KEY).then(saved => {
      const list = Array.isArray(saved) ? saved : [];
      setActive(list.find(l => l.end === null) ?? null);
      setLogs(list.filter(l => l.end !== null).sort((a,b) => new Date(b.start)-new Date(a.start)));
    });
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (p) { setProfile(p); setProfileForm(p); }
    } catch {}
  }, []);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const persist = useCallback(async (done, act) => {
    const payload = [...done]; if (act) payload.unshift(act);
    await storeRef.current.set(STORAGE_KEY, payload);
  }, []);

  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    persist(logs, active);
  }, [logs, active, persist]);

  // ── week dots ──
  const DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  const weekDots = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    const dow = today.getDay();
    monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
    monday.setHours(0,0,0,0);
    const all = active ? [...logs, active] : logs;
    return DAYS.map((day, i) => {
      const ds = new Date(monday.getTime() + i * 86_400_000);
      const de = new Date(ds.getTime() + 86_400_000);
      return {
        day,
        hasFast: all.some(l => {
          const s = new Date(l.start);
          const e = l.end ? new Date(l.end) : new Date(now);
          return s < de && e >= ds; // fast overlaps this calendar day
        }),
        isToday: today.toDateString() === ds.toDateString(),
      };
    });
  }, [logs, active, now]);

  // ── ring ──
  const elapsed    = active ? now - new Date(active.start).getTime() : 0;
  const goalMs     = active ? (active.goalHours || 16) * 3_600_000 : 1;
  const progress   = active ? Math.min(elapsed / goalMs, 1) : 0;
  const goalReached = active && progress >= 1;
  const arcColor    = goalReached ? ACCENT_GOAL : ACCENT;
  const tip         = arcTip(progress);
  const dashOffset  = CIRC * (1 - progress);

  const remaining   = active ? Math.max(goalMs - elapsed, 0) : 0;
  const pct         = active ? (progress * 100).toFixed(1) : '0.0';
  const displayMs   = centerMode === 'elapsed' ? elapsed : remaining;
  const tParts      = parseTime(displayMs);

  // ── import / export ──
  const [importErr, setImportErr] = useState('');
  const importRef = useRef(null);

  const exportData = () => {
    const all = active ? [active, ...logs] : [...logs];
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `alfie-fasting-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!Array.isArray(parsed)) throw new Error('Expected a JSON array.');
        const valid = parsed.filter(l => l.id && l.start);
        if (!valid.length) throw new Error('No valid entries found.');

        // merge: existing ids win, incoming fills gaps
        const existingIds = new Set([...logs.map(l => l.id), ...(active ? [active.id] : [])]);
        const incoming    = valid.filter(l => !existingIds.has(l.id));
        const newActive   = active ?? incoming.find(l => l.end === null) ?? null;
        const newLogs     = [
          ...logs,
          ...incoming.filter(l => l.end !== null),
        ].sort((a,b) => new Date(b.start) - new Date(a.start));

        setLogs(newLogs);
        if (!active && newActive) setActive(newActive);
        await storeRef.current.set(STORAGE_KEY, newActive ? [newActive, ...newLogs] : newLogs);
        setImportErr(`✓ Imported ${incoming.length} new entr${incoming.length === 1 ? 'y' : 'ies'}.`);
      } catch (err) {
        setImportErr(`Error: ${err.message}`);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // ── calories ──
  const bmr        = useMemo(() => calcBMR(profile.gender, profile.age, profile.weight, profile.height), [profile]);
  const activeKcal = active ? calcKcal(bmr, elapsed) : null;
  const goalEndTime = active
    ? new Date(new Date(active.start).getTime() + active.goalHours * 3_600_000).toISOString()
    : null;

  // ── fast control ──
  const startFast = (hours) => {
    if (active) return;
    setActive({ id: Date.now(), start: new Date().toISOString(), end: null, goalHours: hours, note: '' });
    setPresetOpen(false); setCustomVal(''); setCustomErr('');
  };
  const endFast = () => {
    if (!active) return;
    const finished = { ...active, end: new Date().toISOString() };
    setLogs(prev => [finished, ...prev].sort((a,b) => new Date(b.start)-new Date(a.start)));
    setActive(null);
  };
  const handleCustomStart = () => {
    let h = parseFloat(customVal);
    if (customUnit === 'days') h *= 24;
    if (!h || h < 1 || h > 168) { setCustomErr(`Enter 1–${customUnit === 'days' ? '7 days' : '168 hours'}.`); return; }
    startFast(Math.round(h * 10) / 10);
  };

  // ── live edit: start ──
  const openLiveStart = () => {
    setLiveStartVal(toLocalInput(active.start));
    setLiveErr(''); setLiveEdit('start');
  };
  const submitLiveStart = (e) => {
    e.preventDefault();
    const d = new Date(liveStartVal);
    if (isNaN(d.getTime())) { setLiveErr('Invalid date.'); return; }
    if (d >= new Date()) { setLiveErr('Start must be in the past.'); return; }
    setActive(prev => ({ ...prev, start: d.toISOString() }));
    setLiveEdit(null); setLiveErr('');
  };

  // ── live edit: goal ──
  const openLiveGoal = () => {
    setLiveGoalVal(String(active.goalHours || 16));
    setLiveGoalUnit('hours'); setLiveErr(''); setLiveEdit('goal');
  };
  const applyLiveGoal = (hours) => {
    setActive(prev => ({ ...prev, goalHours: hours }));
    setLiveEdit(null); setLiveErr('');
  };
  const submitLiveGoalCustom = () => {
    let h = parseFloat(liveGoalVal);
    if (liveGoalUnit === 'days') h *= 24;
    if (!h || h < 1 || h > 168) { setLiveErr(`Enter 1–${liveGoalUnit === 'days' ? '7 days' : '168 hours'}.`); return; }
    applyLiveGoal(Math.round(h * 10) / 10);
  };

  // ── log edit ──
  const openEditLog = (log) => {
    setEditForm({ start: toLocalInput(log.start), end: toLocalInput(log.end), goalHours: String(log.goalHours||16), note: log.note||'' });
    setEditErr(''); setEditModal(log.id);
  };
  const closeEdit = () => { setEditModal(null); setEditErr(''); };
  const submitEdit = (e) => {
    e.preventDefault();
    const start = new Date(editForm.start), gh = Number(editForm.goalHours);
    if (!editForm.start || isNaN(start.getTime())) { setEditErr('Invalid start time.'); return; }
    if (!gh || gh < 1 || gh > 168) { setEditErr('Goal hours must be 1–168.'); return; }
    const end = new Date(editForm.end);
    if (!editForm.end || isNaN(end.getTime()) || end <= start) { setEditErr('End must be after start.'); return; }
    setLogs(prev => prev.map(l => l.id === editModal
      ? { ...l, start: start.toISOString(), end: end.toISOString(), goalHours: gh, note: editForm.note.trim() }
      : l));
    closeEdit();
  };

  const stats = useMemo(() => {
    if (!logs.length) return { total: 0, avg: '—', longest: '—' };
    const d = logs.map(l => new Date(l.end) - new Date(l.start));
    const sum = d.reduce((a,b) => a+b, 0);
    return { total: logs.length, avg: fmtDuration(sum / logs.length), longest: fmtDuration(Math.max(...d)) };
  }, [logs]);

  const customPreview = (() => {
    const v = parseFloat(customVal);
    if (!v || isNaN(v)) return '';
    return customUnit === 'days' ? `= ${Math.round(v * 24)}h` : v >= 24 ? `≈ ${(v/24).toFixed(1)} days` : '';
  })();

  const liveGoalPreview = (() => {
    const v = parseFloat(liveGoalVal);
    if (!v || isNaN(v)) return '';
    return liveGoalUnit === 'days' ? `= ${Math.round(v * 24)}h` : v >= 24 ? `≈ ${(v/24).toFixed(1)} days` : '';
  })();

  return (
    <div style={{ minHeight:'100vh', background:BG, color:TEXT, fontFamily:"'IBM Plex Mono',monospace", padding:'24px 16px 56px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:${BG}; }
        button, input, select { font-family:'IBM Plex Mono',monospace; }
        .hov { transition:opacity .13s,transform .13s; cursor:pointer; }
        .hov:hover  { opacity:.78; transform:translateY(-1px); }
        .hov:active { transform:translateY(0); }
        .tap { transition:background .13s,border-color .13s; cursor:pointer; }
        .tap:hover { background:#181818 !important; border-color:${ACCENT}55 !important; }
        input[type="datetime-local"],input[type="number"],input[type="text"],select { color-scheme:dark; }
        @keyframes pulse-ring {
          0%   { box-shadow:0 0 0 0    ${ACCENT}44; }
          70%  { box-shadow:0 0 0 20px ${ACCENT}00; }
          100% { box-shadow:0 0 0 0    ${ACCENT}00; }
        }
        .pulse { animation:pulse-ring 2.4s ease-out infinite; }
      `}</style>

      <div style={{ maxWidth:460, margin:'0 auto' }}>

        {/* ── HEADER ── */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:34 }}>
          <div>
            <div style={{ fontSize:'2rem', fontWeight:700, letterSpacing:'0.04em', lineHeight:1 }}>
              alfie<span style={{ color:ACCENT }}>.</span>
            </div>
            <div style={{ color:MUTED, fontSize:'0.56rem', letterSpacing:'0.26em', textTransform:'uppercase', marginTop:7 }}>
              fasting tracker
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, paddingTop:2 }}>
            <div style={{ display:'flex', gap:7 }}>
              {weekDots.map(({ day, hasFast, isToday }) => (
                <div key={day} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5 }}>
                  <div style={{
                    width:8, height:8, borderRadius:'50%',
                    background: hasFast ? ACCENT : '#1e1e1e',
                    outline: isToday ? `2px solid ${ACCENT}` : '2px solid transparent',
                    outlineOffset:2, transition:'background .3s',
                  }} />
                  <span style={{ fontSize:'0.48rem', color:MUTED, letterSpacing:'0.04em' }}>{day}</span>
                </div>
              ))}
            </div>
            <button className="hov" title="Body stats"
              style={{ ...S.iconBtn, padding:'5px 9px', fontSize:'0.85rem' }}
              onClick={() => { setProfileForm(profile); setProfileOpen(true); }}>⚙</button>
          </div>
        </div>

        {/* ── RING ── */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:20 }}>

          {/* SVG arc + HTML center overlay */}
          <div style={{ position:'relative', width:290, height:290 }}>
            <svg viewBox="0 0 320 320" width={290} height={290}
              style={{ position:'absolute', top:0, left:0, overflow:'visible' }}>
              {/* Track */}
              <circle cx={CX} cy={CY} r={R} fill="none" stroke="#161616" strokeWidth={14} />
              {/* Arc */}
              {active && (
                <circle cx={CX} cy={CY} r={R} fill="none" stroke={arcColor} strokeWidth={14} strokeLinecap="round"
                  strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${CX} ${CY})`}
                  style={{ transition:'stroke-dashoffset .8s ease, stroke .6s ease' }} />
              )}
              {/* Tip dot */}
              {active && progress > 0.005 && (
                <circle cx={tip.x} cy={tip.y} r={goalReached ? 0 : 6} fill="white"
                  style={{ filter:'drop-shadow(0 0 4px white)', transition:'r .4s ease' }} />
              )}
            </svg>

            {/* Center content overlay */}
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center', textAlign:'center', gap:0 }}>

              {/* Timer — click to toggle elapsed ↔ remaining */}
              <div
                onClick={() => active && setCenterMode(m => m === 'elapsed' ? 'remaining' : 'elapsed')}
                style={{ cursor: active ? 'pointer' : 'default', userSelect:'none', width:'100%' }}
                title={active ? 'Click to toggle elapsed / remaining' : undefined}
              >
                {/* h m s display */}
                <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'center', gap:0, lineHeight:1 }}>
                  {[
                    [String(tParts.h).padStart(2,'0'), 'h'],
                    [String(tParts.m).padStart(2,'0'), 'm'],
                    [String(tParts.s).padStart(2,'0'), 's'],
                  ].map(([num, unit], i) => (
                    <span key={unit} style={{ display:'flex', alignItems:'flex-end', marginRight: i < 2 ? 6 : 0 }}>
                      <span style={{ fontSize:'1.95rem', fontWeight:700, letterSpacing:'-0.02em',
                        color: goalReached ? ACCENT_GOAL : '#ffffff',
                        textShadow: goalReached ? `0 0 20px ${ACCENT_GOAL}88` : '0 0 12px rgba(255,255,255,0.15)' }}>
                        {num}
                      </span>
                      <span style={{ fontSize:'0.6rem', color: goalReached ? ACCENT_GOAL : ACCENT,
                        marginBottom:4, marginLeft:2, letterSpacing:'0.04em' }}>{unit}</span>
                    </span>
                  ))}
                </div>

                {/* Mode label — same accent color for both modes */}
                {active && (
                  <div style={{ fontSize:'0.55rem', color: goalReached ? ACCENT_GOAL : ACCENT,
                    letterSpacing:'0.18em', textTransform:'uppercase', marginTop:7, transition:'color .3s' }}>
                    {goalReached
                      ? 'goal reached! ⇅'
                      : centerMode === 'elapsed'
                        ? `${pct}% elapsed ⇅`
                        : `${(100 - parseFloat(pct)).toFixed(1)}% remaining ⇅`}
                  </div>
                )}
              </div>

              {/* Goal chip — click to change goal */}
              {active && (
                <div
                  className="tap"
                  onClick={openLiveGoal}
                  style={{ marginTop:10, padding:'4px 12px', borderRadius:999,
                    border:`1px solid ${goalReached ? ACCENT_GOAL+'55' : '#222'}`,
                    background: goalReached ? ACCENT_GOAL+'18' : '#111',
                    cursor:'pointer', userSelect:'none' }}
                  title="Click to change goal"
                >
                  <span style={{ fontSize:'0.6rem', color: goalReached ? ACCENT_GOAL : MUTED,
                    letterSpacing:'0.14em', textTransform:'uppercase' }}>
                    {`${active.goalHours}h · ${fmtHoursLabel(active.goalHours)} ✎`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Calorie strip */}
          {active && activeKcal !== null && (
            <div style={{ display:'flex', gap:20, marginTop:6, marginBottom:10,
              background:'#0e0e0e', border:'1px solid #1c1c1c', borderRadius:14, padding:'10px 22px' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:MUTED, fontSize:'0.52rem', letterSpacing:'0.16em', marginBottom:4 }}>EST. BURNED</div>
                <div style={{ fontSize:'0.95rem', fontWeight:700, color:'#fbbf24' }}>{activeKcal.toLocaleString()} kcal</div>
              </div>
              <div style={{ width:1, background:'#1e1e1e' }} />
              <div style={{ textAlign:'center' }}>
                <div style={{ color:MUTED, fontSize:'0.52rem', letterSpacing:'0.16em', marginBottom:4 }}>FAT EQUIV.</div>
                <div style={{ fontSize:'0.95rem', fontWeight:700, color:'#a78bfa' }}>{fmtFatMass(activeKcal)}</div>
              </div>
            </div>
          )}
          {active && !bmr && (
            <button style={{ ...S.linkBtn, fontSize:'0.66rem', marginBottom:8 }}
              onClick={() => { setProfileForm(profile); setProfileOpen(true); }}>
              Add body stats to see calorie estimates →
            </button>
          )}

          {/* STARTED / GOAL tappable cards */}
          {active && goalEndTime && (
            <div style={{ display:'flex', gap:10, marginBottom:14, width:'100%' }}>
              <div className="tap"
                style={{ flex:1, textAlign:'center', padding:'12px 10px', borderRadius:14,
                  border:'1px solid #1a1a1a', background:'#0a0a0a', cursor:'pointer' }}
                onClick={openLiveStart}>
                <div style={{ color:MUTED, fontSize:'0.52rem', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:6 }}>Started ✎</div>
                <div style={{ fontSize:'0.78rem', lineHeight:1.6 }}>{fmtDate(active.start)}</div>
                <div style={{ fontSize:'0.78rem' }}>{fmtTime(active.start)}</div>
              </div>
              <div className="tap"
                style={{ flex:1, textAlign:'center', padding:'12px 10px', borderRadius:14,
                  border:`1px solid ${goalReached ? ACCENT_GOAL+'44' : '#1a1a1a'}`,
                  background: goalReached ? ACCENT_GOAL+'0a' : '#0a0a0a', cursor:'pointer' }}
                onClick={openLiveGoal}>
                <div style={{ color: goalReached ? ACCENT_GOAL : MUTED, fontSize:'0.52rem', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:6 }}>Goal ✎</div>
                <div style={{ fontSize:'0.78rem', lineHeight:1.6 }}>{fmtDate(goalEndTime)}</div>
                <div style={{ fontSize:'0.78rem' }}>{fmtTime(goalEndTime)}</div>
              </div>
            </div>
          )}

          {active
            ? <button className="hov pulse" style={{ ...S.pillBtn, background: goalReached ? ACCENT_GOAL : ACCENT, color:BG, transition:'background .6s ease' }} onClick={endFast}>END FAST</button>
            : <button className="hov"       style={{ ...S.pillBtn, background:ACCENT, color:BG }} onClick={() => setPresetOpen(true)}>START FAST</button>
          }
        </div>

        {/* ── STATS ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
          {[['FASTS', stats.total], ['AVG', stats.avg], ['LONGEST', stats.longest]].map(([l,v]) => (
            <div key={l} style={{ background:PANEL, border:'1px solid #171717', borderRadius:14, padding:'14px 10px', textAlign:'center' }}>
              <div style={{ color:MUTED, fontSize:'0.52rem', letterSpacing:'0.18em', marginBottom:7 }}>{l}</div>
              <div style={{ fontSize:'0.88rem', fontWeight:700 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* ── HISTORY ── */}
        <div style={{ background:PANEL, border:'1px solid #171717', borderRadius:18, padding:'18px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <div style={{ color:MUTED, fontSize:'0.54rem', letterSpacing:'0.22em', textTransform:'uppercase' }}>History</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input ref={importRef} type="file" accept=".json" style={{ display:'none' }} onChange={importData} />
              <button className="hov" style={{ ...S.ghostBtn, padding:'6px 12px', fontSize:'0.7rem' }}
                onClick={() => { setImportErr(''); importRef.current?.click(); }}>
                ↑ Import
              </button>
              <button className="hov" style={{ ...S.ghostBtn, padding:'6px 12px', fontSize:'0.7rem' }}
                onClick={exportData}>
                ↓ Export
              </button>
            </div>
          </div>
          {importErr && (
            <div style={{ fontSize:'0.72rem', color: importErr.startsWith('✓') ? ACCENT : '#f87171',
              marginBottom:12, padding:'8px 12px', background:'#111', borderRadius:10,
              border:`1px solid ${importErr.startsWith('✓') ? ACCENT+'44' : '#4a000088'}` }}>
              {importErr}
              <button style={{ ...S.linkBtn, display:'inline', marginLeft:10, fontSize:'0.68rem' }}
                onClick={() => setImportErr('')}>✕</button>
            </div>
          )}
          {logs.length === 0
            ? <div style={{ color:MUTED, fontSize:'0.82rem', padding:'6px 0' }}>No completed fasts yet.</div>
            : logs.map(log => {
                const dur  = new Date(log.end) - new Date(log.start);
                const kcal = calcKcal(bmr, dur);
                return (
                  <div key={log.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'13px 0', borderTop:'1px solid #161616' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:'1.05rem', fontWeight:700 }}>{fmtDuration(dur)}</div>
                      <div style={{ color:MUTED, fontSize:'0.68rem', marginTop:3 }}>
                        {fmtDate(log.start)} {fmtTime(log.start)} → {fmtTime(log.end)}
                      </div>
                      {kcal !== null && (
                        <div style={{ fontSize:'0.64rem', color:'#fbbf2477', marginTop:3 }}>
                          ~{kcal.toLocaleString()} kcal · {fmtFatMass(kcal)}
                        </div>
                      )}
                    </div>
                    <button style={S.iconBtn} className="hov" onClick={() => openEditLog(log)}>✎</button>
                    <button style={{ ...S.iconBtn, color:'#f87171' }} className="hov" onClick={() => setDelTarget(log.id)}>✕</button>
                  </div>
                );
              })
          }
        </div>
      </div>

      {/* ══ PRESET MODAL ══ */}
      {presetOpen && (
        <Overlay onClose={() => { setPresetOpen(false); setCustomVal(''); setCustomErr(''); }}>
          <div style={{ ...S.modalBox, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={S.modalTitle}>Start a fast</div>
            <SectionLabel>Presets</SectionLabel>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
              {PRESETS.map(p => (
                <div key={p.label} className="hov"
                  style={{ background:`${p.color}1a`, border:`1.5px solid ${p.color}55`, borderRadius:16,
                    padding:'14px', height:118, display:'flex', flexDirection:'column', justifyContent:'space-between',
                    cursor: p.hours ? 'pointer' : 'default' }}
                  onClick={() => p.hours && startFast(p.hours)}
                >
                  <span style={{ fontSize:'0.58rem', color:MUTED, letterSpacing:'0.12em', textTransform:'uppercase' }}>{p.label}</span>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
                    <div>
                      <div style={{ fontSize: p.hours ? '2.1rem' : '0.95rem', fontWeight:700, color: p.hours ? p.color : MUTED, lineHeight:1 }}>
                        {p.hours ? `${p.hours}h` : 'custom'}
                      </div>
                      {p.hours && p.hours >= 24 && (
                        <div style={{ fontSize:'0.58rem', color:p.color, opacity:.7, marginTop:3 }}>{fmtHoursLabel(p.hours)}</div>
                      )}
                    </div>
                    <span style={{ color:MUTED, fontSize:'0.82rem' }}>ⓘ</span>
                  </div>
                </div>
              ))}
            </div>
            <SectionLabel>Quick days</SectionLabel>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:20 }}>
              {DAY_PRESETS.map(d => (
                <button key={d.hours} className="hov"
                  style={{ border:'1px solid #1e1e1e', background:'#141414', color:TEXT, borderRadius:12,
                    padding:'10px 6px', cursor:'pointer', textAlign:'center' }}
                  onClick={() => startFast(d.hours)}
                >
                  <div style={{ fontSize:'0.85rem', fontWeight:700 }}>{d.label}</div>
                  <div style={{ color:MUTED, fontSize:'0.62rem', marginTop:3 }}>{d.hours}h</div>
                </button>
              ))}
            </div>
            <SectionLabel>Custom</SectionLabel>
            <UnitToggle value={customUnit} onChange={u => { setCustomUnit(u); setCustomVal(''); setCustomErr(''); }} />
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <input type="number" min="1" max={customUnit==='days'?7:168} step={customUnit==='days'?.5:1}
                placeholder={customUnit==='days'?'e.g. 3':'e.g. 48'} value={customVal}
                onChange={e => { setCustomVal(e.target.value); setCustomErr(''); }}
                style={{ ...S.input, flex:1 }} />
              <button className="hov"
                style={{ ...S.pillBtn, padding:'10px 16px', fontSize:'0.8rem', background:ACCENT, color:BG, flexShrink:0 }}
                onClick={handleCustomStart}>Start</button>
            </div>
            {customPreview && !customErr && <div style={{ color:MUTED, fontSize:'0.68rem', marginTop:6 }}>{customPreview}</div>}
            {customErr && <div style={{ color:'#f87171', fontSize:'0.72rem', marginTop:6 }}>{customErr}</div>}
          </div>
        </Overlay>
      )}

      {/* ══ LIVE EDIT: START ══ */}
      {liveEdit === 'start' && (
        <Overlay onClose={() => { setLiveEdit(null); setLiveErr(''); }}>
          <div style={S.modalBox}>
            <div style={S.modalTitle}>Change start time</div>
            <form onSubmit={submitLiveStart}>
              <Field label="Started at">
                <input type="datetime-local" value={liveStartVal}
                  onChange={e => { setLiveStartVal(e.target.value); setLiveErr(''); }}
                  style={S.input} required />
              </Field>
              {liveErr && <div style={{ color:'#f87171', fontSize:'0.78rem', marginBottom:12 }}>{liveErr}</div>}
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
                <button type="button" className="hov" style={S.ghostBtn} onClick={() => { setLiveEdit(null); setLiveErr(''); }}>Cancel</button>
                <button type="submit" className="hov"
                  style={{ ...S.pillBtn, padding:'10px 22px', fontSize:'0.85rem', background:ACCENT, color:BG }}>Save</button>
              </div>
            </form>
          </div>
        </Overlay>
      )}

      {/* ══ LIVE EDIT: GOAL ══ */}
      {liveEdit === 'goal' && (
        <Overlay onClose={() => { setLiveEdit(null); setLiveErr(''); }}>
          <div style={{ ...S.modalBox, maxHeight:'88vh', overflowY:'auto' }}>
            <div style={S.modalTitle}>Change goal</div>
            <SectionLabel>Quick presets</SectionLabel>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:16 }}>
              {[16,18,20,24,36,48,72,96,120,168].map(h => (
                <button key={h} className="hov"
                  style={{ border:`1px solid ${active?.goalHours === h ? ACCENT : '#1e1e1e'}`,
                    background: active?.goalHours === h ? `${ACCENT}18` : '#141414',
                    color: active?.goalHours === h ? ACCENT : TEXT,
                    borderRadius:12, padding:'10px 6px', cursor:'pointer', textAlign:'center' }}
                  onClick={() => applyLiveGoal(h)}
                >
                  <div style={{ fontSize:'0.85rem', fontWeight:700 }}>{h}h</div>
                  {h >= 24 && <div style={{ color:MUTED, fontSize:'0.6rem', marginTop:2 }}>{fmtHoursLabel(h)}</div>}
                </button>
              ))}
            </div>
            <SectionLabel>Custom</SectionLabel>
            <UnitToggle value={liveGoalUnit} onChange={u => { setLiveGoalUnit(u); setLiveGoalVal(''); setLiveErr(''); }} />
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <input type="number" min="1" max={liveGoalUnit==='days'?7:168} step={liveGoalUnit==='days'?.5:1}
                placeholder={liveGoalUnit==='days'?'e.g. 2':'e.g. 36'} value={liveGoalVal}
                onChange={e => { setLiveGoalVal(e.target.value); setLiveErr(''); }}
                style={{ ...S.input, flex:1 }} />
              <button className="hov"
                style={{ ...S.pillBtn, padding:'10px 16px', fontSize:'0.8rem', background:ACCENT, color:BG, flexShrink:0 }}
                onClick={submitLiveGoalCustom}>Apply</button>
            </div>
            {liveGoalPreview && !liveErr && <div style={{ color:MUTED, fontSize:'0.68rem', marginTop:6 }}>{liveGoalPreview}</div>}
            {liveErr && <div style={{ color:'#f87171', fontSize:'0.72rem', marginTop:6 }}>{liveErr}</div>}
          </div>
        </Overlay>
      )}

      {/* ══ PROFILE MODAL ══ */}
      {profileOpen && (
        <Overlay onClose={() => setProfileOpen(false)}>
          <div style={S.modalBox}>
            <div style={S.modalTitle}>Body stats</div>
            <p style={{ color:MUTED, fontSize:'0.72rem', marginBottom:18, lineHeight:1.75 }}>
              Estimates calories burned &amp; fat equivalent. Stored locally only.
            </p>
            <Field label="Gender">
              <select value={profileForm.gender}
                onChange={e => setProfileForm(p => ({ ...p, gender: e.target.value }))}
                style={{ ...S.input, appearance:'none' }}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other / Prefer not to say</option>
              </select>
            </Field>
            <Field label="Age (years)">
              <input type="number" min="1" max="120" value={profileForm.age} style={S.input}
                onChange={e => setProfileForm(p => ({ ...p, age: e.target.value }))} />
            </Field>
            <Field label="Weight (kg)">
              <input type="number" min="1" max="500" step="0.1" value={profileForm.weight} style={S.input}
                onChange={e => setProfileForm(p => ({ ...p, weight: e.target.value }))} />
            </Field>
            <Field label="Height (cm)">
              <input type="number" min="50" max="300" value={profileForm.height} style={S.input}
                onChange={e => setProfileForm(p => ({ ...p, height: e.target.value }))} />
            </Field>
            {(() => {
              const b = calcBMR(profileForm.gender, profileForm.age, profileForm.weight, profileForm.height);
              if (!b) return null;
              return (
                <div style={{ background:'#0a0a0a', border:'1px solid #1e1e1e', borderRadius:14, padding:'14px 16px', marginBottom:18 }}>
                  <div style={{ color:MUTED, fontSize:'0.52rem', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:10 }}>
                    Estimates · Mifflin-St Jeor
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:10 }}>
                    {[['BMR/day',`${Math.round(b)} kcal`],['16h',`~${Math.round(b/24*16)} kcal`],['24h',`~${Math.round(b)} kcal`],['3 days',`~${Math.round(b/24*72)} kcal`]].map(([lbl,val]) => (
                      <div key={lbl} style={{ textAlign:'center' }}>
                        <div style={{ color:MUTED, fontSize:'0.5rem', letterSpacing:'0.1em', marginBottom:4 }}>{lbl}</div>
                        <div style={{ fontSize:'0.76rem', fontWeight:700 }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop:'1px solid #1c1c1c', paddingTop:10 }}>
                    <div style={{ color:MUTED, fontSize:'0.5rem', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:8 }}>Fat equivalent</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                      {[['16h',16],['24h',24],['3 days',72],['7 days',168]].map(([lbl,h]) => (
                        <div key={lbl} style={{ textAlign:'center' }}>
                          <div style={{ color:MUTED, fontSize:'0.5rem', letterSpacing:'0.1em', marginBottom:4 }}>{lbl}</div>
                          <div style={{ fontSize:'0.76rem', fontWeight:700, color:'#a78bfa' }}>{fmtFatMass(Math.round(b/24*h))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button className="hov" style={S.ghostBtn} onClick={() => setProfileOpen(false)}>Cancel</button>
              <button className="hov"
                style={{ ...S.pillBtn, padding:'10px 22px', fontSize:'0.85rem', background:ACCENT, color:BG }}
                onClick={() => { localStorage.setItem(PROFILE_KEY, JSON.stringify(profileForm)); setProfile(profileForm); setProfileOpen(false); }}>
                Save
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* ══ EDIT LOG ══ */}
      {editModal !== null && (
        <Overlay onClose={closeEdit}>
          <div style={S.modalBox}>
            <div style={S.modalTitle}>Edit fast</div>
            <form onSubmit={submitEdit}>
              <Field label="Start"><input type="datetime-local" value={editForm.start} style={S.input} required onChange={e => setEditForm(p => ({ ...p, start: e.target.value }))} /></Field>
              <Field label="End"><input type="datetime-local" value={editForm.end} style={S.input} required onChange={e => setEditForm(p => ({ ...p, end: e.target.value }))} /></Field>
              <Field label="Goal hours"><input type="number" min="1" max="168" value={editForm.goalHours} style={S.input} onChange={e => setEditForm(p => ({ ...p, goalHours: e.target.value }))} /></Field>
              <Field label="Note"><input type="text" value={editForm.note} placeholder="Optional" style={S.input} onChange={e => setEditForm(p => ({ ...p, note: e.target.value }))} /></Field>
              {editErr && <div style={{ color:'#f87171', fontSize:'0.8rem', marginBottom:12 }}>{editErr}</div>}
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
                <button type="button" className="hov" style={S.ghostBtn} onClick={closeEdit}>Cancel</button>
                <button type="submit" className="hov" style={{ ...S.pillBtn, padding:'10px 22px', fontSize:'0.85rem', background:ACCENT, color:BG }}>Save</button>
              </div>
            </form>
          </div>
        </Overlay>
      )}

      {/* ══ DELETE ══ */}
      {delTarget !== null && (
        <Overlay onClose={() => setDelTarget(null)}>
          <div style={S.modalBox}>
            <div style={S.modalTitle}>Delete fast?</div>
            <p style={{ color:MUTED, fontSize:'0.86rem', marginBottom:22, lineHeight:1.65 }}>This will permanently remove the entry.</p>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button className="hov" style={S.ghostBtn} onClick={() => setDelTarget(null)}>Cancel</button>
              <button className="hov" style={{ ...S.ghostBtn, color:'#f87171', borderColor:'#4a0000' }}
                onClick={() => { setLogs(prev => prev.filter(l => l.id !== delTarget)); setDelTarget(null); }}>Delete</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────────
function Overlay({ children, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex',
      alignItems:'center', justifyContent:'center', padding:20, zIndex:100 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block', color:MUTED, fontSize:'0.6rem', textTransform:'uppercase', letterSpacing:'0.16em', marginBottom:6 }}>{label}</label>
      {children}
    </div>
  );
}
function SectionLabel({ children }) {
  return <div style={{ color:MUTED, fontSize:'0.56rem', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:8 }}>{children}</div>;
}
function UnitToggle({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {['hours','days'].map(u => (
        <button key={u}
          style={{ border:`1px solid ${value===u ? ACCENT : '#1e1e1e'}`,
            background: value===u ? `${ACCENT}1a` : 'transparent',
            color: value===u ? ACCENT : MUTED,
            borderRadius:8, padding:'5px 14px', fontSize:'0.68rem', cursor:'pointer',
            textTransform:'uppercase', letterSpacing:'0.1em' }}
          onClick={() => onChange(u)}>{u}</button>
      ))}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const S = {
  pillBtn:  { border:'none', borderRadius:999, padding:'14px 40px', fontSize:'0.88rem', fontWeight:700, letterSpacing:'0.12em', cursor:'pointer' },
  ghostBtn: { border:'1px solid #242424', background:'transparent', color:TEXT, borderRadius:12, padding:'10px 16px', fontSize:'0.8rem', cursor:'pointer' },
  iconBtn:  { border:'1px solid #1e1e1e', background:'transparent', color:MUTED, borderRadius:10, padding:'6px 10px', fontSize:'0.88rem', cursor:'pointer' },
  linkBtn:  { border:'none', background:'transparent', color:ACCENT, fontSize:'0.62rem', cursor:'pointer', textDecoration:'underline', padding:0, display:'block' },
  input:    { width:'100%', border:'1px solid #222', background:'#0a0a0a', color:TEXT, borderRadius:12, padding:'10px 12px', fontSize:'0.84rem', outline:'none' },
  modalBox: { width:'100%', maxWidth:480, background:'#0f0f0f', border:'1px solid #1c1c1c', borderRadius:22, padding:'24px 20px', boxShadow:'0 28px 70px rgba(0,0,0,0.7)' },
  modalTitle: { fontSize:'0.95rem', fontWeight:700, letterSpacing:'0.1em', marginBottom:18 },
};
