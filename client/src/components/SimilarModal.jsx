import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function SimilarModal({ item, activeUser, userRatings, onRate, onClose }) {
  const [similar, setSimilar] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!item) return;
    setLoading(true);
    fetch(`${API_BASE}/api/similar/${item.id}?userId=${activeUser}&limit=8`)
      .then(res => res.json())
      .then(data => { setSimilar(data.similar || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [item?.id]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!item) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-source">
            <img src={item.image_url} alt={item.product_name} className="modal-source-thumb" />
            <div>
              <p className="modal-source-label">Visually similar to</p>
              <p className="modal-source-title">{item.product_name || item.category}</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="modal-loading">Finding similar movies...</div>
        ) : (
          <div className="modal-grid">
            {similar.map(s => (
              <div key={s.id} className="modal-item">
                <div className="modal-item-img-wrap">
                  <img src={s.image_url} alt={s.product_name || s.category} />
                </div>
                <span className="modal-item-title">{s.product_name || s.category}</span>
                <span className="modal-item-genre">{s.category}{s.year ? ` · ${s.year}` : ''}</span>
                <div className="modal-item-stars">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      className={`star-btn ${star <= (userRatings[s.id] || 0) ? 'filled' : ''}`}
                      onClick={() => onRate(s.id, star)}
                    >★</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
