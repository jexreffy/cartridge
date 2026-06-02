import { useEffect, useState } from 'react';

interface FeedItem {
  game_id: string;
  title: string;
  predicted_score: number;
  confidence: number;
  genres: string[];
  background_image?: string;
  created_at: string;
}

const API = import.meta.env.VITE_API_URL ?? '/api';
const scoreColor = (s: number) => s >= 8 ? '#4ade80' : s >= 6 ? '#facc15' : '#f87171';

export default function WeeklyFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/feed`)
      .then((r) => r.json())
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ textAlign: 'center', color: '#888' }}>Loading feed…</p>;
  if (error) return <p style={{ textAlign: 'center', color: '#f87171' }}>Error: {error}</p>;
  if (items.length === 0) return (
    <p style={{ textAlign: 'center', color: '#888' }}>
      No feed data yet — the weekly refresh runs every Sunday. You can trigger it manually from the AWS console.
    </p>
  );

  return (
    <div>
      <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        New Switch releases from the past 2 weeks, ranked by your predicted score.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        {items.map((item) => (
          <div key={item.game_id} style={{
            background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 8, overflow: 'hidden',
          }}>
            {item.background_image && (
              <img src={item.background_image} alt={item.title}
                style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
            )}
            <div style={{ padding: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', flex: 1, marginRight: '0.5rem' }}>{item.title}</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: scoreColor(item.predicted_score), whiteSpace: 'nowrap' }}>
                  {item.predicted_score.toFixed(1)}
                </span>
              </div>
              {item.genres?.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {item.genres.slice(0, 3).map((g) => (
                    <span key={g} style={{ fontSize: '0.7rem', background: '#2a2a3a',
                      padding: '0.15rem 0.4rem', borderRadius: 4, color: '#aaa' }}>{g}</span>
                  ))}
                </div>
              )}
              <p style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.5rem' }}>
                ±{item.confidence} confidence
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
