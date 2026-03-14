import { useState, useEffect } from 'react';
import { FeedCard } from '../components/FeedCard';
import { RecommendationsPanel } from '../components/RecommendationsPanel';
import { SimilarModal } from '../components/SimilarModal';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function FeedPage({ activeUser }) {
  const [items, setItems] = useState([]);
  const [ratings, setRatings] = useState({});
  const [personalized, setPersonalized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [similarItem, setSimilarItem] = useState(null);
  const [boards, setBoards] = useState([]);
  const [itemBoards, setItemBoards] = useState({});

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/feed/${activeUser}?limit=20&offset=0`)
      .then(res => res.json())
      .then(data => {
        setItems(data.items || []);
        setPersonalized(data.personalized || false);
        setLoading(false);
      })
      .catch(err => { console.error('Feed error:', err); setLoading(false); });
  }, [activeUser]);

  useEffect(() => {
    fetch(`${API_BASE}/api/ratings/${activeUser}`)
      .then(res => res.json())
      .then(data => setRatings(data))
      .catch(err => console.error('Ratings error:', err));

    fetch(`${API_BASE}/api/boards/${activeUser}`)
      .then(res => res.json())
      .then(data => setBoards(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [activeUser]);

  const submitRating = async (itemId, rating) => {
    try {
      const response = await fetch(`${API_BASE}/api/rate`, {
        method: rating === 0 ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUser, itemId, ...(rating > 0 && { rating }) })
      });
      if (response.ok) {
        setRatings(prev => {
          if (rating === 0) {
            const next = { ...prev };
            delete next[itemId];
            return next;
          }
          // Store all ratings locally (1-5) so stars stay visible.
          // Server only adds >=4 to the taste profile; 1-3 are cleared from DB
          // but we keep them in UI state for the session.
          return { ...prev, [itemId]: rating };
        });
      }
    } catch (err) {
      console.error('Rating error:', err);
    }
  };

  const sendDwellSignal = (itemId, seconds) => {
    fetch(`${API_BASE}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUser, itemId, signalType: 'dwell', value: seconds })
    }).catch(() => {});
  };

  const assignToBoard = async (itemId, boardId) => {
    await fetch(`${API_BASE}/api/interactions/board`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUser, itemId, boardId })
    });
    setItemBoards(prev => ({ ...prev, [itemId]: boardId }));
  };

  return (
    <div>
      <div className="feed-header">
        <h2>Discover</h2>
        {personalized && <span className="personalized-badge">Ranked for you</span>}
      </div>

      {!personalized && !loading && (
        <p className="page-subtitle">
          Rate movies to train your taste profile — the engine learns from what you love.
        </p>
      )}

      {personalized && (
        <RecommendationsPanel
          activeUser={activeUser}
          userRatings={ratings}
          onRate={submitRating}
          onOpenSimilar={setSimilarItem}
        />
      )}

      {loading ? (
        <div className="chart-placeholder">Loading...</div>
      ) : (
        <main className="feed-grid">
          {items.map(item => (
            <FeedCard
              key={item.id}
              item={item}
              userRating={ratings[item.id] || 0}
              onRate={submitRating}
              onClickImage={setSimilarItem}
              onDwell={sendDwellSignal}
              boards={boards}
              userBoardId={itemBoards[item.id] || null}
              onAddToBoard={assignToBoard}
            />
          ))}
        </main>
      )}

      {similarItem && (
        <SimilarModal
          item={similarItem}
          activeUser={activeUser}
          userRatings={ratings}
          onRate={submitRating}
          onClose={() => setSimilarItem(null)}
        />
      )}
    </div>
  );
}
