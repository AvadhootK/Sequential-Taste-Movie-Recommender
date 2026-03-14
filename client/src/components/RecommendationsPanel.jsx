import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function RecommendationsPanel({ activeUser, userRatings, onRate, onOpenSimilar }) {
  const [recs, setRecs] = useState([]);
  const [influencers, setInfluencers] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!activeUser) return;
    fetch(`${API_BASE}/api/recommendations/${activeUser}`)
      .then(res => res.json())
      .then(data => {
        setRecs(data.items || []);
        setInfluencers(data.influencers || []);
        setHasLoaded(true);
      })
      .catch(() => {});
  }, [activeUser, userRatings]);

  // Don't render until first load completes; after that keep previous recs visible while refetching
  if (!hasLoaded || recs.length === 0) return null;

  return (
    <section className="recs-panel">
      <div className="recs-panel-header">
        <div>
          <h3 className="recs-title">Predicted for you</h3>
          {influencers.length > 0 && (
            <div className="influencers-row">
              <span className="influencers-label">Because you loved</span>
              {influencers.map(inf => (
                <div key={inf.item_id} className="influencer-chip">
                  <img src={inf.image_url} alt={inf.product_name} className="influencer-thumb" />
                  <div className="influencer-info">
                    <span className="influencer-name">{inf.product_name || inf.category}</span>
                    <div className="influence-bar-track">
                      <div
                        className="influence-bar-fill"
                        style={{ width: `${inf.influence_pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="recs-scroll">
        {recs.map(item => (
          <div key={item.id} className="rec-card-wrap">
            <div className="rec-card" onClick={() => onOpenSimilar(item)}>
              <img src={item.image_url} alt={item.product_name || item.category} className="rec-card-img" />
              <div className="rec-card-meta">
                <span className="rec-card-title">{item.product_name || item.category}</span>
                <span className="rec-card-genre">{item.category}{item.year ? ` · ${item.year}` : ''}</span>
              </div>
            </div>
            <div className="rec-card-stars">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  className={`star-btn ${star <= (userRatings[item.id] || 0) ? 'filled' : ''}`}
                  onClick={e => { e.stopPropagation(); onRate(item.id, star); }}
                >★</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
