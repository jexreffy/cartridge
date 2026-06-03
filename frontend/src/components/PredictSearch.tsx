import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { apiFetch } from '../api';

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

const scoreColor = (s: number) => s >= 8 ? '#4ade80' : s >= 6 ? '#facc15' : '#f87171';

const cardStyle: React.CSSProperties = {
  background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8,
  padding: '1.25rem 1.5rem', marginBottom: '2rem',
};

export default function PredictSearch() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    apiFetch('/profile')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.text) setProfile(data); })
      .catch(() => { /* profile may not exist yet */ });
  }, []);

  const predict = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await apiFetch(`/predict?title=${encodeURIComponent(query)}`);
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
      {!profile && (
        <div style={{ ...cardStyle, color: '#555', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>⏳</span>
          <div>
            <div style={{ color: '#888', fontWeight: 600, marginBottom: '0.25rem' }}>Taste profile not ready yet</div>
            Your library is still being imported and the model is training. Check back in a few minutes — predictions will work once training completes.
          </div>
        </div>
      )}
      {profile && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.2rem' }}>🎮</span>
            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em',
              color: '#6c3fff', fontWeight: 700, margin: 0 }}>Your Taste Profile</h3>
          </div>
          {profile.text.split('\n\n').map((para, i) => {
            const icons = ['🏆', '⚠️', '🔮'];
            const labels = ['What you love', 'What turns you off', 'What to look for'];
            return (
              <div key={i} style={{ marginBottom: i < 2 ? '1rem' : 0,
                paddingBottom: i < 2 ? '1rem' : 0,
                borderBottom: i < 2 ? '1px solid #22222e' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{icons[i]}</span>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: '#666', fontWeight: 600 }}>{labels[i]}</span>
                </div>
                <p style={{ fontSize: '0.875rem', lineHeight: 1.65, color: '#bbb', margin: 0 }}>{para}</p>
              </div>
            );
          })}
          {profile.top_features && profile.top_features.length > 0 && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #22222e' }}>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em',
                color: '#666', fontWeight: 600 }}>Top signals in your model</span>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {profile.top_features.slice(0, 8).map((f) => (
                  <span key={f.name} style={{ fontSize: '0.75rem', background: '#2a1a4a',
                    border: '1px solid #3a2a5a', color: '#a78bfa',
                    padding: '0.2rem 0.55rem', borderRadius: 12 }}>
                    {f.name} · {Math.round(Number(f.importance) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}
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
