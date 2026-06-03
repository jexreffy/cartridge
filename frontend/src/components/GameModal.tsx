/**
 * GameModal — used both for editing an existing game and adding a new one.
 * Edit mode: pre-fills fields from the game object, calls PUT /games/{game_id}
 * Add mode:  empty form, calls POST /games
 */

import { useState, FormEvent, useEffect } from 'react';
import { apiFetch } from '../api';

export interface GameEntry {
  game_id: string;
  title: string;
  my_score: number;
  weight: number;
  replayed?: number;
  notes?: string;
  release_year?: number;
  genres?: string[];
  background_image?: string;
}

interface GameModalProps {
  game?: GameEntry;        // undefined = add mode
  onClose: () => void;
  onSaved: (game: GameEntry) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.7rem', background: '#0e0e14',
  border: '1px solid #2a2a35', borderRadius: 6, color: '#e2e2e8',
  fontSize: '0.95rem', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', color: '#888',
  marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em',
};

export default function GameModal({ game, onClose, onSaved }: GameModalProps) {
  const isEdit = !!game;

  const [title, setTitle] = useState(game?.title ?? '');
  const [score, setScore] = useState(String(game?.my_score ?? ''));
  const [weight, setWeight] = useState(String(game?.weight ?? '3'));
  const [replayed, setReplayed] = useState(String(game?.replayed ?? '0'));
  const [notes, setNotes] = useState(game?.notes ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const scoreNum = parseInt(score);
    if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 10) {
      setError('Score must be between 1 and 10.');
      return;
    }
    setLoading(true);
    try {
      let resp: Response;
      if (isEdit) {
        resp = await apiFetch(`/games/${game!.game_id}`, {
          method: 'PUT',
          body: JSON.stringify({
            my_score: scoreNum,
            weight: parseInt(weight),
            replayed: parseInt(replayed),
            notes,
          }),
        });
      } else {
        resp = await apiFetch('/games', {
          method: 'POST',
          body: JSON.stringify({
            title,
            my_score: scoreNum,
            weight: parseInt(weight),
            replayed: parseInt(replayed),
            notes,
          }),
        });
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Request failed');
      onSaved(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
      }} />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 101, width: '100%', maxWidth: 480,
        background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 12,
        padding: '1.75rem', boxSizing: 'border-box',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
            {isEdit ? `Edit — ${game!.title}` : 'Add a game'}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#555', fontSize: '1.4rem',
            cursor: 'pointer', lineHeight: 1, padding: '0 0.25rem',
          }}>×</button>
        </div>

        {game?.background_image && (
          <img src={game.background_image} alt={game.title}
            style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 6, marginBottom: '1.25rem' }} />
        )}

        <form onSubmit={handleSubmit}>
          {/* Title — only shown in add mode */}
          {!isEdit && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Game title</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                required placeholder="e.g. Elden Ring" style={inputStyle} autoFocus />
              <p style={{ fontSize: '0.72rem', color: '#555', marginTop: '0.3rem' }}>
                We'll look this up on RAWG to fetch genres, metacritic score, and cover art.
              </p>
            </div>
          )}

          {/* Score */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Your score (1–10)</label>
            <input type="number" min={1} max={10} value={score}
              onChange={e => setScore(e.target.value)} required style={inputStyle}
              autoFocus={isEdit} />
          </div>

          {/* Replayed */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Did you replay it?</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[['0', 'No'], ['1', 'Yes, played more than once']].map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => setReplayed(val)}
                  style={{
                    flex: val === '1' ? 2 : 1, padding: '0.5rem',
                    background: replayed === val ? (val === '1' ? '#2a1a4a' : '#1a2a1a') : 'transparent',
                    border: `1px solid ${replayed === val ? (val === '1' ? '#6c3fff' : '#2a5a2a') : '#2a2a35'}`,
                    borderRadius: 6, color: replayed === val ? (val === '1' ? '#a78bfa' : '#6ee76e') : '#666',
                    fontSize: '0.85rem', cursor: 'pointer',
                  }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Weight */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>
              Relevance weight ({weight}/5)
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> — how much this influences predictions</span>
            </label>
            <input type="range" min={1} max={5} value={weight}
              onChange={e => setWeight(e.target.value)}
              style={{ width: '100%', accentColor: '#6c3fff' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#555' }}>
              <span>1 — nostalgic context only</span>
              <span>5 — full influence</span>
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} placeholder="Any thoughts on the game…"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          {error && (
            <p style={{ color: '#f87171', fontSize: '0.875rem', marginBottom: '1rem',
              background: '#2a1a1a', padding: '0.6rem', borderRadius: 6, border: '1px solid #4a2a2a' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: '0.65rem', background: 'transparent',
                border: '1px solid #2a2a35', borderRadius: 6, color: '#888',
                fontSize: '0.95rem', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading}
              style={{ flex: 2, padding: '0.65rem',
                background: loading ? '#3a2a6a' : '#6c3fff',
                border: 'none', borderRadius: 6, color: '#fff',
                fontWeight: 600, fontSize: '0.95rem',
                cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save changes' : 'Add game')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
