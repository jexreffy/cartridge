import { useState, useEffect } from 'react';
import Library from './components/Library';
import PredictSearch from './components/PredictSearch';
import WeeklyFeed from './components/WeeklyFeed';
import Login from './components/Login';
import { isAuthenticated, signOut } from './auth';
import './App.css';

type Tab = 'library' | 'predict' | 'feed';

export default function App() {
  const [tab, setTab] = useState<Tab>('library');
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    isAuthenticated().then(setAuthed);
  }, []);

  if (authed === null) {
    // Still checking session — show minimal loading state
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
          <button
            onClick={() => { signOut(); setAuthed(false); }}
            style={{ padding: '0.4rem 0.9rem', background: 'transparent',
              border: '1px solid #2a2a35', borderRadius: 6, color: '#666',
              fontSize: '0.8rem', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
        <nav className="tabs">
          {(['library', 'predict', 'feed'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'library' ? '📚 My Library' : t === 'predict' ? '🔮 Predict' : '📡 Weekly Feed'}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {tab === 'library' && <Library />}
        {tab === 'predict' && <PredictSearch />}
        {tab === 'feed' && <WeeklyFeed />}
      </main>
    </div>
  );
}
