import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Prediction {
  title: string;
  predicted_score: number;
  confidence: number;
  on_nintendo: boolean;
  genres: string[];
  developers: string[];
  release_year?: number;
  metacritic_score?: number;
  background_image?: string;
  taste_profile?: string;
  top_factors: { feature: string; type: string; importance: number; matched: boolean }[];
}

interface Profile {
  text: string;
  top_features: { name: string; importance: number }[];
}

const API = import.meta.env.VITE_API_URL ?? '/api';
const scoreColor = (s: number) => s >= 8 ? '#4ade80' : s >= 6 ? '#facc15' : '#f87171';

export default function PredictSearch() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    fetch(`${API}/profile`)
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => { /* profile may not exist yet */ });
  }, []);

  const predict = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await fetch(`${API}/predict?title=${encodeURIComponent(query)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Unknown error');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const factorData = result?.top_factors.map((f) => ({
    name: f.feature,
    value: Math.round(f.importance * 100),
    matched: f.matched,
  })) ?? [];

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      {profile && (
        <div style={{ background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8,
          padding: '1rem 1.25rem', marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase',
            letterSpacing: '0.05em', color: '#888' }}>Your Taste Profile</h3>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#ccc' }}>{profile.text}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem' }}>
        <input
          placeholder="Enter a game title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && predict()}
          style={{ flex: 1, padding: '0.6rem 0.9rem', background: '#1a1a24',
            border: '1px solid #2a2a35', borderRadius: 6, color: '#e2e2e8', fontSize: '1rem' }}
        />
        <button onClick={predict} disabled={loading}
          style={{ padding: '0.6rem 1.5rem', background: '#6c3fff', border: 'none',
            borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '1rem' }}>
          {loading ? '…' : 'Predict'}
        </button>
      </div>

      {error && <p style={{ color: '#f87171', marginBottom: '1rem' }}>Error: {error}</p>}

      {result && (
        <div style={{ background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8, overflow: 'hidden' }}>
          {result.background_image && (
            <img src={result.background_image} alt={result.title}
              style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
          )}
          <div style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>{result.title}</h2>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                  {result.genres.slice(0, 4).map((g) => (
                    <span key={g} style={{ fontSize: '0.75rem', background: '#2a2a3a',
                      padding: '0.2rem 0.5rem', borderRadius: 4, color: '#aaa' }}>{g}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: scoreColor(result.predicted_score), lineHeight: 1 }}>
                  {result.predicted_score.toFixed(1)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#666' }}>±{result.confidence} confidence</div>
                {!result.on_nintendo && (
                  <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#fb923c',
                    background: '#2a1a0a', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                    ⚠ Not on Switch
                  </div>
                )}
              </div>
            </div>

            {factorData.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: '#888', marginBottom: '0.75rem' }}>Top contributing factors</h4>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={factorData} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#ccc' }} />
                    <Tooltip formatter={(v) => `${v}% influence`} contentStyle={{ background: '#1a1a24', border: '1px solid #2a2a35' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {factorData.map((entry, i) => (
                        <Cell key={i} fill={entry.matched ? '#6c3fff' : '#2a2a4a'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                  Purple = matched your library · Grey = not matched
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
