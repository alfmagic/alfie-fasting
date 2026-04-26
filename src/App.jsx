import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'fasting-logs';
const accent = '#ff6b1a';
const panel = '#121212';
const text = '#e6e6e6';
const muted = '#8a8a8a';

const formatDuration = (ms) => {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const formatDate = (iso) => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatTime = (iso) => {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const toLocalInputValue = (iso) => {
  const date = new Date(iso);
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
};

const getStorageApi = () => {
  if (window.storage?.get && window.storage?.set) {
    return {
      get: async (key) => {
        const response = await window.storage.get({ [key]: null });
        return response?.[key] ?? null;
      },
      set: async (key, value) => {
        await window.storage.set({ [key]: value });
      },
    };
  }
  return {
    get: async (key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };
};

const Stat = ({ label, value }) => {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
};

export default function App() {
  const storage = useRef(getStorageApi());
  const [completedLogs, setCompletedLogs] = useState([]);
  const [activeLog, setActiveLog] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ start: '', end: '', note: '' });
  const [editId, setEditId] = useState(null);
  const [formError, setFormError] = useState('');
  const initialized = useRef(false);

  const saveAll = useCallback(async (completed, active) => {
    const payload = [...completed];
    if (active) payload.unshift(active);
    await storage.current.set(STORAGE_KEY, payload);
  }, []);

  useEffect(() => {
    const load = async () => {
      const saved = await storage.current.get(STORAGE_KEY);
      const list = Array.isArray(saved) ? saved : [];
      const active = list.find((item) => item.end === null) ?? null;
      const completed = list.filter((item) => item.end !== null);
      setCompletedLogs(completed.sort((a, b) => new Date(b.start) - new Date(a.start)));
      setActiveLog(active);
    };
    load();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    saveAll(completedLogs, activeLog);
  }, [completedLogs, activeLog, saveAll]);

  const startQuickFast = (hours) => {
    if (activeLog) return;
    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const active = { id: Date.now(), start, end: null, note: `${hours}h quick start` };
    setActiveLog(active);
    saveAll(completedLogs, active);
  };

  const stopFast = async () => {
    if (!activeLog) return;
    const finished = { ...activeLog, end: new Date().toISOString() };
    const updated = [finished, ...completedLogs];
    setCompletedLogs(updated);
    setActiveLog(null);
    await saveAll(updated, null);
  };

  const openNewLog = () => {
    setEditId(null);
    setFormError('');
    setForm({ start: toLocalInputValue(new Date().toISOString()), end: toLocalInputValue(new Date().toISOString()), note: '' });
    setModalOpen(true);
  };

  const openEditLog = (log) => {
    setEditId(log.id);
    setFormError('');
    setForm({ start: toLocalInputValue(log.start), end: toLocalInputValue(log.end), note: log.note || '' });
    setModalOpen(true);
  };

  const handleFormChange = (field, value) => {
    setFormError('');
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const applyPreset = (hours) => {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    setForm({ start: toLocalInputValue(start.toISOString()), end: toLocalInputValue(end.toISOString()), note: `${hours}h preset` });
  };

  const submitLog = async (event) => {
    event.preventDefault();
    const start = new Date(form.start);
    const end = new Date(form.end);

    if (!form.start || !form.end || start >= end) {
      setFormError('Please choose a valid start and end time. End must be after start.');
      return;
    }

    const entry = { id: editId ?? Date.now(), start: start.toISOString(), end: end.toISOString(), note: form.note.trim() };
    const updated = editId
      ? completedLogs.map((item) => (item.id === editId ? entry : item))
      : [entry, ...completedLogs];

    updated.sort((a, b) => new Date(b.start) - new Date(a.start));
    setCompletedLogs(updated);
    setModalOpen(false);
    setEditId(null);
    setFormError('');
    await saveAll(updated, activeLog);
  };

  const confirmDelete = (log) => {
    setDeleteTarget(log);
    setDeleteOpen(true);
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    const updated = completedLogs.filter((item) => item.id !== deleteTarget.id);
    setCompletedLogs(updated);
    setDeleteOpen(false);
    setDeleteTarget(null);
    await saveAll(updated, activeLog);
  };

  const stats = useMemo(() => {
    const totalFasts = completedLogs.length;
    const totalDuration = completedLogs.reduce((sum, log) => sum + (new Date(log.end) - new Date(log.start)), 0);
    const averageDuration = totalFasts ? formatDuration(totalDuration / totalFasts) : '0h 00m';
    const longest = totalFasts
      ? formatDuration(Math.max(...completedLogs.map((log) => new Date(log.end) - new Date(log.start))))
      : '0h 00m';

    return {
      totalFasts,
      totalTime: formatDuration(totalDuration),
      averageDuration,
      longest,
    };
  }, [completedLogs]);

  const activeElapsed = activeLog ? Date.now() - new Date(activeLog.start).getTime() : 0;
  const canStartQuick = !activeLog;

  return (
    <div style={styles.page}>
      <style>{`
        .hover-fade:hover { opacity: 0.88; transform: translateY(-1px); }
        .pulse-border { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,107,26,0.24); } 70% { box-shadow: 0 0 0 24px rgba(255,107,26,0); } 100% { box-shadow: 0 0 0 0 rgba(255,107,26,0); } }
      `}</style>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.titleRow}>
            <span style={styles.title}>ALFIE</span>
            <span style={styles.dot}>.</span>
          </div>
          <div style={styles.subtitle}>fasting tracker</div>
        </header>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionTitle}>Quick start</div>
              <div style={styles.sectionMeta}>Launch a fast from a preset duration.</div>
            </div>
            <button style={styles.simpleButton} onClick={openNewLog}>Log past fast</button>
          </div>
          <div style={styles.grid}>
            {['16:8', '18:6', '20:4', '24h', '36h', '48h'].map((label) => {
              const hours = Number(label.replace('h', '').split(':')[0]);
              return (
                <button
                  key={label}
                  style={{
                    ...styles.quickButton,
                    opacity: canStartQuick ? 1 : 0.45,
                    cursor: canStartQuick ? 'pointer' : 'not-allowed',
                  }}
                  className="hover-fade"
                  onClick={() => canStartQuick && startQuickFast(hours)}
                  disabled={!canStartQuick}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {activeLog && (
          <section style={{ ...styles.section, ...styles.activeSection }}>
            <div style={styles.activeCard} className="pulse-border">
              <div style={styles.activeHeading}>Active fast</div>
              <div style={styles.activeTime}>{formatDuration(activeElapsed)}</div>
              <div style={styles.activeRange}>{`${formatDate(activeLog.start)} · ${formatTime(activeLog.start)} → now`}</div>
              {activeLog.note && <div style={styles.activeNote}>{activeLog.note}</div>}
              <button style={styles.stopButton} onClick={stopFast}>STOP NOW</button>
            </div>
          </section>
        )}

        <section style={styles.section}>
          <div style={styles.statsRow}>
            <Stat label="Total fasts" value={stats.totalFasts} />
            <Stat label="Total time" value={stats.totalTime} />
            <Stat label="Average" value={stats.averageDuration} />
            <Stat label="Longest" value={stats.longest} />
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>History</div>
          <div style={styles.tableHeader}>
            <div style={styles.tableCellWide}>Fast</div>
            <div style={styles.tableCell}>Duration</div>
            <div style={styles.tableCell}>Note</div>
            <div style={styles.tableCellActions}>Actions</div>
          </div>
          {completedLogs.length === 0 ? (
            <div style={styles.emptyState}>No completed fasts logged yet.</div>
          ) : (
            completedLogs.map((log) => (
              <div key={log.id} style={styles.historyRow}>
                <div style={styles.tableCellWide}>
                  <div>{formatDate(log.start)}</div>
                  <div style={styles.smallText}>{`${formatTime(log.start)} → ${formatTime(log.end)}`}</div>
                </div>
                <div style={styles.tableCell}>{formatDuration(new Date(log.end) - new Date(log.start))}</div>
                <div style={styles.tableCell}>{log.note || '—'}</div>
                <div style={styles.tableCellActions}>
                  <button style={styles.actionButton} onClick={() => openEditLog(log)}>Edit</button>
                  <button style={styles.deleteButton} onClick={() => confirmDelete(log)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {modalOpen && (
        <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>{editId ? 'Edit fast log' : 'Log a past fast'}</div>
            <form onSubmit={submitLog}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Start</label>
                <input style={styles.input} type="datetime-local" value={form.start} onChange={(e) => handleFormChange('start', e.target.value)} required />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>End</label>
                <input style={styles.input} type="datetime-local" value={form.end} onChange={(e) => handleFormChange('end', e.target.value)} required />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Note</label>
                <input style={styles.input} type="text" value={form.note} onChange={(e) => handleFormChange('note', e.target.value)} placeholder="Optional note" />
              </div>
              <div style={styles.presetBar}>
                {[12, 16, 18, 24].map((hours) => (
                  <button key={hours} type="button" style={styles.presetButton} onClick={() => applyPreset(hours)}>{hours}h</button>
                ))}
              </div>
              {formError && <div style={styles.formError}>{formError}</div>}
              <div style={styles.modalActions}>
                <button type="button" style={styles.simpleButton} onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" style={styles.primaryButton}>{editId ? 'Save log' : 'Add log'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && setDeleteOpen(false)}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>Confirm delete</div>
            <p style={styles.confirmText}>Delete this fast entry forever?</p>
            <div style={styles.modalActions}>
              <button type="button" style={styles.simpleButton} onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button type="button" style={styles.deleteButton} onClick={executeDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: text,
    fontFamily: "'IBM Plex Mono', monospace",
    padding: '24px',
  },
  container: {
    maxWidth: '1100px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '24px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '8px',
  },
  title: {
    fontSize: '3rem',
    letterSpacing: '0.08em',
    fontWeight: 700,
  },
  dot: {
    color: accent,
    fontSize: '3rem',
  },
  subtitle: {
    color: muted,
    textTransform: 'uppercase',
    fontSize: '0.9rem',
    letterSpacing: '0.2em',
  },
  section: {
    background: panel,
    border: '1px solid #1c1c1c',
    borderRadius: '18px',
    padding: '20px',
    marginBottom: '20px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '18px',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: '1rem',
    color: text,
    fontWeight: 600,
  },
  sectionMeta: {
    color: muted,
    fontSize: '0.9rem',
    marginTop: '4px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '12px',
  },
  quickButton: {
    border: '1px solid #262626',
    background: '#111111',
    color: text,
    padding: '16px 12px',
    fontSize: '0.95rem',
    cursor: 'pointer',
    borderRadius: '14px',
    transition: 'transform 0.15s ease, opacity 0.15s ease',
  },
  simpleButton: {
    border: '1px solid #2f2f2f',
    background: '#0f0f0f',
    color: text,
    padding: '12px 16px',
    cursor: 'pointer',
    borderRadius: '14px',
    letterSpacing: '0.08em',
  },
  primaryButton: {
    border: 'none',
    background: accent,
    color: '#0a0a0a',
    padding: '12px 18px',
    cursor: 'pointer',
    borderRadius: '14px',
    fontWeight: 700,
  },
  stopButton: {
    border: 'none',
    background: accent,
    color: '#0a0a0a',
    padding: '14px 22px',
    cursor: 'pointer',
    borderRadius: '16px',
    fontWeight: 700,
    marginTop: '18px',
  },
  deleteButton: {
    border: '1px solid #520000',
    background: '#210000',
    color: '#ff9b9b',
    padding: '10px 14px',
    cursor: 'pointer',
    borderRadius: '14px',
  },
  activeSection: {
    padding: '24px',
  },
  activeCard: {
    border: `1px solid ${accent}`,
    borderRadius: '22px',
    padding: '24px',
    background: '#111111',
    display: 'grid',
    gap: '12px',
  },
  activeHeading: {
    color: accent,
    letterSpacing: '0.18em',
    fontSize: '0.9rem',
    textTransform: 'uppercase',
  },
  activeTime: {
    fontSize: '3rem',
    fontWeight: 700,
  },
  activeRange: {
    color: muted,
    fontSize: '0.95rem',
  },
  activeNote: {
    color: text,
    opacity: 0.9,
    fontSize: '0.95rem',
    marginTop: '6px',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '14px',
  },
  statCard: {
    background: '#101010',
    border: '1px solid #1d1d1d',
    borderRadius: '18px',
    padding: '18px',
    minHeight: '100px',
  },
  statLabel: {
    color: muted,
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.16em',
  },
  statValue: {
    marginTop: '10px',
    fontSize: '1.55rem',
    fontWeight: 700,
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '2.5fr 1fr 1.5fr 1fr',
    gap: '12px',
    color: muted,
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.16em',
    marginBottom: '12px',
  },
  tableCellWide: {
    display: 'grid',
    gap: '4px',
  },
  tableCell: {
    color: text,
    fontSize: '0.95rem',
  },
  tableCellActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  historyRow: {
    display: 'grid',
    gridTemplateColumns: '2.5fr 1fr 1.5fr 1fr',
    gap: '12px',
    padding: '16px 0',
    borderTop: '1px solid #161616',
    alignItems: 'center',
  },
  smallText: {
    color: muted,
    fontSize: '0.82rem',
  },
  actionButton: {
    border: '1px solid #333',
    background: '#0f0f0f',
    color: text,
    padding: '8px 12px',
    cursor: 'pointer',
    borderRadius: '12px',
  },
  emptyState: {
    color: muted,
    padding: '18px 0',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10,10,10,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    zIndex: 50,
  },
  modal: {
    width: '100%',
    maxWidth: '520px',
    background: '#101010',
    border: '1px solid #1d1d1d',
    borderRadius: '22px',
    padding: '28px',
    boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
  },
  modalHeader: {
    fontSize: '1.15rem',
    fontWeight: 700,
    marginBottom: '18px',
  },
  fieldGroup: {
    display: 'grid',
    gap: '8px',
    marginBottom: '16px',
  },
  label: {
    color: muted,
    fontSize: '0.82rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  input: {
    border: '1px solid #252525',
    background: '#111111',
    color: text,
    padding: '12px 14px',
    borderRadius: '14px',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.95rem',
    outline: 'none',
  },
  presetBar: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '20px',
  },
  formError: {
    color: '#ff7676',
    marginBottom: '16px',
    fontSize: '0.9rem',
  },
  presetButton: {
    border: '1px solid #282828',
    background: '#111111',
    color: text,
    padding: '10px 14px',
    borderRadius: '14px',
    cursor: 'pointer',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    flexWrap: 'wrap',
  },
  confirmText: {
    color: text,
    marginBottom: '22px',
    lineHeight: 1.6,
  },
};
