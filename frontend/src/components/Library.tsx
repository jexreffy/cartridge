import { useEffect, useState } from 'react';

interface Game {
  game_id: string;
  title: string;
  my_score: number;
  weight: number;
  replayed?: number;
  times_completed?: number; // legacy field, some records may still have it
  genres?: string[];
  developers?: string[];
  release_year?: number;
  metacritic_score?: number;
  background_image?: string;
  notes?: string;
}

const API = import.meta.env.VITE_API_URL ?? '/api';

const scoreColor = (s: number) => {
  if (s >= 9) return '#4ade80';
  if (s >= 7) return '#facc15';
  if (s >= 5) return '#fb923c';
  return '#f87171';
};

export default function Library() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'title' | 'year'>('score');

  useEffect(() => {
    fetch(`${API}/library`)
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

  if (loading) return <p style={{ textAlign: 'center', color: '#888' }}>Loading library…</p>;
  if (error) return <p style={{ textAlign: 'center', color: '#f87171' }}>Error: {error}</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          placeholder="Search games…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '0.5rem 0.75rem', background: '#1a1a24',
            border: '1px solid #2a2a35', borderRadius: 6, color: '#e2e2e8', fontSize: '0.95rem' }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          style={{ padding: '0.5rem 0.75rem', background: '#1a1a24', border: '1px solid #2a2a35',
            borderRadius: 6, color: '#e2e2e8' }}
        >
          <option value="score">Sort: Score</option>
          <option value="title">Sort: Title</option>
          <option value="year">Sort: Year</option>
        </select>
        <span style={{ alignSelf: 'center', color: '#888', fontSize: '0.9rem' }}>
          {filtered.length} games
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        {filtered.map((g) => (
          <div key={g.game_id} style={{
            background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8, overflow: 'hidden',
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
                    <span key={genre} style={{
                      fontSize: '0.7rem', background: '#2a2a3a', padding: '0.15rem 0.4rem',
                      borderRadius: 4, color: '#aaa',
                    }}>{genre}</span>
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
