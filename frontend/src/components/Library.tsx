import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../api';
import GameModal, { GameEntry } from './GameModal';

interface Game extends GameEntry {
  genres?: string[];
  developers?: string[];
  release_year?: number;
  metacritic_score?: number;
  background_image?: string;
}

const scoreColor = (s: number) => {
  if (s >= 9) return '#4ade80';
  if (s >= 7) return '#facc15';
  if (s >= 5) return '#fb923c';
  return '#f87171';
};

type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';

interface LibraryProps {
  onTrainingStarted?: () => void;
}

export default function Library({ onTrainingStarted }: LibraryProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'title' | 'year'>('score');

  // Modal state
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState(false);

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importMsg, setImportMsg] = useState('');
  const [showImport, setShowImport] = useState(false);

  // Retrain
  const [retraining, setRetraining] = useState(false);

  useEffect(() => {
    apiFetch('/library')
      .then((r) => r.json())
      .then(setGames)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = games
    .filter((g) => g.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'score') return b.my_score - a.my_score;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return (b.release_year ?? 0) - (a.release_year ?? 0);
    });

  // ---- Handlers ----

  const handleGameSaved = (saved: GameEntry) => {
    setGames((prev) => {
      const idx = prev.findIndex((g) => g.game_id === saved.game_id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...prev[idx], ...saved };
        return updated;
      }
      return [saved as Game, ...prev];
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/games/${deleteTarget.game_id}`, { method: 'DELETE' });
      setGames((prev) => prev.filter((g) => g.game_id !== deleteTarget.game_id));
      setDeleteTarget(null);
    } catch {
      // keep modal open, let user retry
    } finally {
      setDeleting(false);
    }
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImportStatus('uploading');
    setImportMsg('');
    try {
      const text = await file.text();
      const resp = await apiFetch('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Import failed');
      setImportStatus('success');
      setImportMsg(data.message);
      onTrainingStarted?.();
    } catch (err) {
      setImportStatus('error');
      setImportMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetrain = async () => {
    setRetraining(true);
    try {
      await apiFetch('/train', { method: 'POST' });
      onTrainingStarted?.();
    } finally {
      setRetraining(false);
    }
  };

  if (loading) return <p style={{ textAlign: 'center', color: '#888' }}>Loading library…</p>;
  if (error) return <p style={{ textAlign: 'center', color: '#f87171' }}>Error: {error}</p>;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search games…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '0.5rem 0.75rem', background: '#1a1a24',
            border: '1px solid #2a2a35', borderRadius: 6, color: '#e2e2e8', fontSize: '0.95rem' }}
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          style={{ padding: '0.5rem 0.75rem', background: '#1a1a24', border: '1px solid #2a2a35',
            borderRadius: 6, color: '#e2e2e8' }}>
          <option value="score">Sort: Score</option>
          <option value="title">Sort: Title</option>
          <option value="year">Sort: Year</option>
        </select>
        <span style={{ color: '#888', fontSize: '0.9rem' }}>{filtered.length} games</span>

        {/* Action buttons */}
        <button onClick={() => setShowAdd(true)}
          style={{ padding: '0.5rem 1rem', background: '#6c3fff', border: 'none',
            borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>
          + Add game
        </button>
        <button onClick={() => setShowImport((v) => !v)}
          style={{ padding: '0.5rem 1rem', background: 'transparent',
            border: '1px solid #2a2a35', borderRadius: 6, color: '#aaa',
            cursor: 'pointer', fontSize: '0.9rem' }}>
          📥 Import CSV
        </button>
        <button onClick={handleRetrain} disabled={retraining}
          title="Retrain the ML model after manual edits"
          style={{ padding: '0.5rem 1rem', background: 'transparent',
            border: '1px solid #2a2a35', borderRadius: 6, color: '#aaa',
            cursor: retraining ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>
          {retraining ? '⚙ Retraining…' : '⚙ Retrain model'}
        </button>
      </div>

      {/* Import panel */}
      {showImport && (
        <div style={{ background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8,
          padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em',
            color: '#888', margin: '0 0 0.75rem' }}>Import from CSV</h3>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem', lineHeight: 1.6 }}>
            Upload a CSV with columns: <code style={{ background: '#0e0e14', padding: '0.1rem 0.3rem',
            borderRadius: 3 }}>title, my_score, weight, replayed, release_year, notes</code>.
            Your existing library will be replaced. Enrichment takes ~4 minutes.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept=".csv"
              style={{ color: '#aaa', fontSize: '0.9rem' }}
              onChange={() => setImportStatus('idle')} />
            <button onClick={handleImport} disabled={importStatus === 'uploading'}
              style={{ padding: '0.5rem 1.25rem', background: '#6c3fff', border: 'none',
                borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>
              {importStatus === 'uploading' ? 'Uploading…' : 'Import'}
            </button>
          </div>
          {importStatus === 'success' && (
            <p style={{ color: '#4ade80', fontSize: '0.875rem', marginTop: '0.75rem' }}>
              ✓ {importMsg}
            </p>
          )}
          {importStatus === 'error' && (
            <p style={{ color: '#f87171', fontSize: '0.875rem', marginTop: '0.75rem' }}>
              {importMsg}
            </p>
          )}
        </div>
      )}

      {/* Game grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        {filtered.map((g) => (
          <div key={g.game_id} style={{
            background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8,
            overflow: 'hidden', position: 'relative',
          }}>
            {g.background_image && (
              <img src={g.background_image} alt={g.title}
                style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
            )}
            <div style={{ padding: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', flex: 1, marginRight: '0.5rem' }}>{g.title}</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: scoreColor(g.my_score), whiteSpace: 'nowrap' }}>
                  {g.my_score}/10
                </span>
              </div>
              {g.genres && g.genres.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {g.genres.slice(0, 3).map((genre) => (
                    <span key={genre} style={{ fontSize: '0.7rem', background: '#2a2a3a',
                      padding: '0.15rem 0.4rem', borderRadius: 4, color: '#aaa' }}>{genre}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem', alignItems: 'center' }}>
                {g.release_year && (
                  <span style={{ fontSize: '0.72rem', color: '#666' }}>{g.release_year}</span>
                )}
                {g.my_score >= 1 && (
                  <span style={{ fontSize: '0.72rem', background: '#1a2a1a', border: '1px solid #2a3a2a',
                    color: '#6ee76e', padding: '0.15rem 0.45rem', borderRadius: 10 }}>
                    ✓ Completed
                  </span>
                )}
                {g.replayed === 1 && (
                  <span style={{ fontSize: '0.72rem', background: '#1a1a2a', border: '1px solid #3a2a5a',
                    color: '#a78bfa', padding: '0.15rem 0.45rem', borderRadius: 10 }}>
                    🔁 Replayed
                  </span>
                )}
                <span style={{ fontSize: '0.72rem', background: '#1a1a2a', border: '1px solid #2a2a3a',
                  color: '#888', padding: '0.15rem 0.45rem', borderRadius: 10 }}>
                  {'★'.repeat(g.weight)}{'☆'.repeat(5 - g.weight)} relevance
                </span>
              </div>
              {g.notes && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#888', fontStyle: 'italic',
                  overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as const }}>{g.notes}</p>
              )}

              {/* Edit / Delete */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', borderTop: '1px solid #22222e', paddingTop: '0.6rem' }}>
                <button onClick={() => setEditGame(g)}
                  style={{ flex: 1, padding: '0.35rem', background: 'transparent',
                    border: '1px solid #2a2a35', borderRadius: 5, color: '#888',
                    fontSize: '0.8rem', cursor: 'pointer' }}>
                  ✏ Edit
                </button>
                <button onClick={() => setDeleteTarget(g)}
                  style={{ padding: '0.35rem 0.6rem', background: 'transparent',
                    border: '1px solid #3a2a2a', borderRadius: 5, color: '#664',
                    fontSize: '0.8rem', cursor: 'pointer' }}>
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit modal */}
      {editGame && (
        <GameModal game={editGame} onClose={() => setEditGame(null)} onSaved={handleGameSaved} />
      )}

      {/* Add modal */}
      {showAdd && (
        <GameModal onClose={() => setShowAdd(false)} onSaved={handleGameSaved} />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <>
          <div onClick={() => setDeleteTarget(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 101, background: '#1a1a24', border: '1px solid #3a2a2a',
            borderRadius: 10, padding: '1.5rem', maxWidth: 380, width: '90%',
          }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Remove game?</h3>
            <p style={{ color: '#aaa', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              <strong style={{ color: '#e2e2e8' }}>{deleteTarget.title}</strong> will be removed from your library.
              This won't affect your model until you retrain.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setDeleteTarget(null)}
                style={{ flex: 1, padding: '0.6rem', background: 'transparent',
                  border: '1px solid #2a2a35', borderRadius: 6, color: '#888', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ flex: 1, padding: '0.6rem', background: '#7f1d1d',
                  border: '1px solid #991b1b', borderRadius: 6, color: '#fca5a5',
                  fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
