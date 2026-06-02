import { useState } from 'react';
import Library from './components/Library';
import PredictSearch from './components/PredictSearch';
import WeeklyFeed from './components/WeeklyFeed';
import './App.css';

type Tab = 'library' | 'predict' | 'feed';

export default function App() {
  const [tab, setTab] = useState<Tab>('library');

  return (
    <div className="app">
      <header className="header">
        <h1>🎮 Cartridge</h1>
        <p className="subtitle">Your personal game taste predictor</p>
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
