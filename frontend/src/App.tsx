import { useState, useEffect, useCallback, useRef } from 'react';
import Library from './components/Library';
import PredictSearch from './components/PredictSearch';
import WeeklyFeed from './components/WeeklyFeed';
import Login from './components/Login';
import { isAuthenticated, signOut } from './auth';
import { apiFetch } from './api';
import './App.css';

type Tab = 'library' | 'predict' | 'feed';
type TrainPhase = 'idle' | 'training' | 'done';

export default function App() {
  const [tab, setTab] = useState<Tab>('library');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [trainPhase, setTrainPhase] = useState<TrainPhase>('idle');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trainStartRef = useRef<string | null>(null);

  useEffect(() => {
    isAuthenticated().then(setAuthed);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  // Poll /profile every 15s when training — stop when generated_at is newer than when we started
  const startPolling = useCallback(() => {
    stopPolling();
    trainStartRef.current = new Date().toISOString();

    pollRef.current = setInterval(async () => {
      try {
        const r = await apiFetch('/profile');
        if (!r.ok) return;
        const data = await r.json();
        if (data?.generated_at && trainStartRef.current &&
            data.generated_at > trainStartRef.current) {
          stopPolling();
          setTrainPhase('done');
          // Auto-hide the success banner after 5s
          setTimeout(() => setTrainPhase('idle'), 5000);
        }
      } catch { /* ignore poll errors */ }
    }, 15_000);

    // Safety fallback — stop polling after 12 minutes regardless
    watchdogRef.current = setTimeout(() => {
      stopPolling();
      setTrainPhase('idle');
    }, 12 * 60 * 1000);
  }, [stopPolling]);

  const handleTrainingStarted = useCallback(() => {
    setTrainPhase('training');
    startPolling();
  }, [startPolling]);

  if (authed === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#0e0e14', color: '#555' }}>
        Loading…
      </div>
    );
  }

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h1>🎮 Cartridge</h1>
            <p className="subtitle">Your personal game taste predictor</p>
          </div>
          <button onClick={() => { signOut(); setAuthed(false); }}
            style={{ padding: '0.4rem 0.9rem', background: 'transparent',
              border: '1px solid #2a2a35', borderRadius: 6, color: '#666',
              fontSize: '0.8rem', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
        <nav className="tabs">
          {(['library', 'predict', 'feed'] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}>
              {t === 'library' ? '📚 My Library' : t === 'predict' ? '🔮 Predict' : '📡 Weekly Feed'}
            </button>
          ))}
        </nav>
      </header>

      {/* Training in-progress banner */}
      {trainPhase === 'training' && (
        <div style={{
          background: '#1a1a2e', border: '1px solid #3a2a6a', borderRadius: 8,
          padding: '0.75rem 1.25rem', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.1rem', animation: 'spin 2s linear infinite' }}>⚙</span>
          <div style={{ flex: 1 }}>
            <span style={{ color: '#a78bfa', fontWeight: 600, fontSize: '0.9rem' }}>
              Model training in progress
            </span>
            <span style={{ color: '#555', fontSize: '0.85rem', marginLeft: '0.75rem' }}>
              This takes a few minutes — predictions will update automatically when done.
            </span>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%', background: '#6c3fff',
                animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        </div>
      )}

      {/* Training complete banner */}
      {trainPhase === 'done' && (
        <div style={{
          background: '#0a2a1a', border: '1px solid #2a5a3a', borderRadius: 8,
          padding: '0.75rem 1.25rem', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>✓</span>
          <span style={{ color: '#4ade80', fontWeight: 600, fontSize: '0.9rem' }}>
            Model training complete — your predictions are up to date.
          </span>
        </div>
      )}

      <main className="main">
        {tab === 'library' && <Library onTrainingStarted={handleTrainingStarted} />}
        {tab === 'predict' && <PredictSearch />}
        {tab === 'feed' && <WeeklyFeed />}
      </main>
    </div>
  );
}
