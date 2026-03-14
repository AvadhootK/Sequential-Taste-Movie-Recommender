import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const GENRE_MAP = {
  'Action': 'action', 'Adventure': 'adventure', 'Animation': 'animation',
  "Children's": 'family', 'Comedy': 'comedy', 'Crime': 'crime',
  'Documentary': 'documentary', 'Drama': 'drama', 'Fantasy': 'fantasy',
  'Film-Noir': 'noir', 'Horror': 'horror', 'Musical': 'musical',
  'Mystery': 'mystery', 'Romance': 'romance', 'Sci-Fi': 'sci-fi',
  'Thriller': 'thriller', 'War': 'war', 'Western': 'western',
};

const GENRE_COLORS = {
  action: '#f97316', adventure: '#eab308', animation: '#22c55e',
  comedy: '#facc15', crime: '#dc2626', documentary: '#64748b',
  drama: '#6366f1', fantasy: '#a855f7', horror: '#7f1d1d',
  musical: '#ec4899', mystery: '#1e40af', romance: '#f43f5e',
  'sci-fi': '#06b6d4', thriller: '#b91c1c', war: '#713f12',
  western: '#92400e', noir: '#1c1917', family: '#4ade80', other: '#94a3b8',
};

function getGenreBreakdown(trajectory) {
  const counts = {};
  for (const point of trajectory) {
    const genre = GENRE_MAP[point.category] || 'other';
    counts[genre] = (counts[genre] || 0) + 1;
  }
  const total = trajectory.length;
  return Object.entries(counts)
    .map(([genre, count]) => ({ genre, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function TasteEvolutionChart({ trajectory, predictedNext }) {
  const [hovered, setHovered] = useState(null);

  const W = 700;
  const H = 380;
  const M = { top: 24, right: 24, bottom: 24, left: 24 };
  const cW = W - M.left - M.right;
  const cH = H - M.top - M.bottom;

  // Scale PCA coordinates to SVG space
  const allX = trajectory.map(p => p.x);
  const allY = trajectory.map(p => p.y);
  if (predictedNext) { allX.push(predictedNext.x); allY.push(predictedNext.y); }
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const pad = 0.12; // 12% padding so dots aren't clipped at edges
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const sx = (v) => M.left + ((v - xMin) / xRange) * cW * (1 - 2 * pad) + cW * pad;
  const sy = (v) => M.top + (1 - (v - yMin) / yRange) * cH * (1 - 2 * pad) + cH * pad;

  const pts = trajectory.map((p) => ({
    svgX: sx(p.x),
    svgY: sy(p.y),
    genre: GENRE_MAP[p.category] || 'other',
    ...p,
  }));

  const predPt = predictedNext
    ? { svgX: sx(predictedNext.x), svgY: sy(predictedNext.y) }
    : null;

  return (
    <div className="taste-chart-wrap">
      <h3 className="section-heading">Taste evolution</h3>
      <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', margin: '0 0 0.75rem' }}>
        Each dot = one rating, positioned by CLIP embedding similarity. Lines show how taste drifted over time.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Connecting path */}
        {pts.length > 1 && (
          <polyline
            points={pts.map(p => `${p.svgX},${p.svgY}`).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        )}

        {/* Segment lines colored by source genre */}
        {pts.slice(0, -1).map((p, i) => (
          <line
            key={i}
            x1={p.svgX} y1={p.svgY}
            x2={pts[i + 1].svgX} y2={pts[i + 1].svgY}
            stroke={GENRE_COLORS[p.genre] || '#94a3b8'}
            strokeWidth="2"
            strokeOpacity="0.55"
          />
        ))}

        {/* Predicted next dot */}
        {predPt && (
          <g>
            <circle cx={predPt.svgX} cy={predPt.svgY} r="10"
              fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={predPt.svgX} y={predPt.svgY + 22}
              textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10">predicted</text>
          </g>
        )}

        {/* Rating dots */}
        {pts.map((p, i) => {
          const color = GENRE_COLORS[p.genre] || '#94a3b8';
          const isFirst = i === 0;
          const isLast = i === pts.length - 1;
          return (
            <g key={i} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                cx={p.svgX} cy={p.svgY}
                r={hovered === i ? 10 : isFirst || isLast ? 8 : 6}
                fill={color}
                stroke="#080810"
                strokeWidth={isFirst || isLast ? 2.5 : 2}
                opacity={isFirst || isLast ? 1 : 0.85}
              />
              {(isFirst || isLast) && (
                <text x={p.svgX} y={p.svgY - 13}
                  textAnchor="middle" fill={color} fontSize="10" fontWeight="600">
                  {isFirst ? 'start' : 'latest'}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hovered !== null && pts[hovered] && (() => {
          const p = pts[hovered];
          const title = (p.product_name || p.category || '').slice(0, 22);
          const tx = Math.max(M.left, Math.min(p.svgX - 70, W - M.right - 140));
          const ty = p.svgY > H / 2 ? p.svgY - 54 : p.svgY + 16;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width="140" height="38" rx="6"
                fill="#1a1a2e" stroke="rgba(255,255,255,0.12)" />
              <text x={tx + 70} y={ty + 14} textAnchor="middle"
                fill="#e8e8f0" fontSize="11">{title}</text>
              <text x={tx + 70} y={ty + 28} textAnchor="middle"
                fill={GENRE_COLORS[p.genre] || '#94a3b8'} fontSize="10">{p.genre}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function getTrendingGenre(trajectory) {
  if (trajectory.length < 2) return null;
  const recent = trajectory.slice(Math.ceil(trajectory.length / 2));
  const counts = {};
  for (const point of recent) {
    const genre = GENRE_MAP[point.category] || 'other';
    counts[genre] = (counts[genre] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

export function TrajectoryPage({ activeUser }) {
  const [trajectoryData, setTrajectoryData] = useState(null);
  const [predictedItem, setPredictedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API_BASE}/api/trajectory/${activeUser}`)
        .then(res => { if (!res.ok) throw new Error('Request failed'); return res.json(); }),
      fetch(`${API_BASE}/api/feed/${activeUser}?limit=1&offset=0`)
        .then(res => res.json())
        .catch(() => null),
    ]).then(([trajectoryResult, feedResult]) => {
      setTrajectoryData(trajectoryResult);
      setPredictedItem(
        feedResult?.personalized && feedResult?.items?.length > 0
          ? feedResult.items[0]
          : null
      );
      setLoading(false);
    }).catch(err => { setError(err.message); setLoading(false); });
  };

  useEffect(() => { loadData(); }, [activeUser]);

  const removeRating = async (itemId) => {
    await fetch(`${API_BASE}/api/rate`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUser, itemId }),
    });
    loadData();
  };

  if (loading) return <div className="chart-placeholder">Computing taste journey...</div>;
  if (error) return <div className="chart-placeholder">Could not load journey. Is the ML service running?</div>;

  if (!trajectoryData || trajectoryData.trajectory.length === 0) {
    return (
      <div>
        <h2>Taste Journey</h2>
        <div className="chart-placeholder">
          <p>Rate some movies on the Discover page to see your taste journey here.</p>
        </div>
      </div>
    );
  }

  const { trajectory, has_enough_data, predicted_next } = trajectoryData;
  const breakdown = getGenreBreakdown(trajectory);
  const trending = getTrendingGenre(trajectory);

  return (
    <div className="trajectory-page">
      <h2>Taste Journey</h2>

      {trending && (
        <div className="insight-card" style={{ borderLeftColor: GENRE_COLORS[trending] || '#e0e0e0' }}>
          <span className="insight-label">Trending toward</span>
          <span className="insight-style" style={{ color: GENRE_COLORS[trending] }}>
            {trending}
          </span>
          <span className="insight-sub">Based on your recent ratings</span>
        </div>
      )}

      {trajectory.length >= 2 && <TasteEvolutionChart trajectory={trajectory} predictedNext={predicted_next} />}

      <div className="timeline-section">
        <h3 className="section-heading">Your ratings, in order</h3>
        <div className="timeline-scroll">
          {trajectory.map((point, idx) => {
            const genre = GENRE_MAP[point.category] || 'other';
            const isLast = idx === trajectory.length - 1;
            return (
              <div key={point.item_id} className="timeline-item-wrap">
                <div className="timeline-item">
                  <div className="timeline-img-outer">
                    <div
                      className="timeline-img-wrap"
                      style={{ borderColor: isLast ? GENRE_COLORS[genre] : undefined }}
                    >
                      {point.image_url ? (
                        <img src={point.image_url} alt={point.category} />
                      ) : (
                        <div className="timeline-img-placeholder" />
                      )}
                    </div>
                    <button
                      className="timeline-unlike-btn"
                      onClick={() => removeRating(point.item_id)}
                      aria-label="Remove rating"
                    >✕</button>
                  </div>
                  <span className="timeline-label">{point.product_name || point.category}</span>
                  <span className="timeline-step">
                    {idx === 0 ? 'first' : isLast ? 'latest' : `#${idx + 1}`}
                  </span>
                </div>
                {idx < trajectory.length - 1 && (
                  <div className="timeline-connector" />
                )}
              </div>
            );
          })}
          {has_enough_data && predictedItem && (
            <div className="timeline-item-wrap">
              <div className="timeline-connector timeline-connector-dashed" />
              <div className="timeline-item timeline-predicted">
                <div className="timeline-img-wrap timeline-img-predicted">
                  {predictedItem.image_url ? (
                    <img src={predictedItem.image_url} alt={predictedItem.category} />
                  ) : (
                    <span className="predicted-star">★</span>
                  )}
                </div>
                <span className="timeline-label">{predictedItem.product_name || predictedItem.category}</span>
                <span className="timeline-step">next</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="breakdown-section">
        <h3 className="section-heading">Genre breakdown</h3>
        <div className="breakdown-bars">
          {breakdown.map(({ genre, pct }) => (
            <div key={genre} className="breakdown-row">
              <span className="breakdown-style">{genre}</span>
              <div className="breakdown-bar-track">
                <div
                  className="breakdown-bar-fill"
                  style={{ width: `${pct}%`, background: GENRE_COLORS[genre] || '#94a3b8' }}
                />
              </div>
              <span className="breakdown-pct">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
