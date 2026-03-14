import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const MOODS = [
  { key: 'dark',         label: 'Dark & Intense' },
  { key: 'feel-good',   label: 'Feel Good' },
  { key: 'mind-bending', label: 'Mind-Bending' },
  { key: 'epic',        label: 'Epic Adventure' },
  { key: 'award-bait',  label: 'Award-Worthy' },
  { key: 'comfort',     label: 'Comfort Watch' },
];

const ALL_GENRES = [
  'Action', 'Adventure', 'Animation', "Children's", 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Fantasy', 'Film-Noir', 'Horror', 'Musical',
  'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western',
];

export function SearchPage({ activeUser }) {
  const [query, setQuery] = useState('');
  const [selectedMood, setSelectedMood] = useState(null);
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [items, setItems] = useState([]);
  const [ratings, setRatings] = useState({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/ratings/${activeUser}`)
      .then(res => res.json())
      .then(data => setRatings(data))
      .catch(() => {});
  }, [activeUser]);

  const doSearch = async ({ q, mood, genre } = {}) => {
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams({ limit: 30 });
    if (q) params.set('q', q);
    if (mood) params.set('mood', mood);
    if (genre) params.set('genre', genre);
    try {
      const res = await fetch(`${API_BASE}/api/search?${params}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMoodClick = (moodKey) => {
    const next = selectedMood === moodKey ? null : moodKey;
    setSelectedMood(next);
    setSelectedGenre(null);
    doSearch({ q: query, mood: next });
  };

  const handleGenreClick = (genre) => {
    const next = selectedGenre === genre ? null : genre;
    setSelectedGenre(next);
    setSelectedMood(null);
    doSearch({ q: query, genre: next });
  };

  const handleSearch = () => {
    doSearch({ q: query, mood: selectedMood, genre: selectedGenre });
  };

  const submitRating = async (itemId, rating) => {
    try {
      const res = await fetch(`${API_BASE}/api/rate`, {
        method: rating === 0 ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUser, itemId, ...(rating > 0 && { rating }) }),
      });
      if (res.ok) {
        setRatings(prev => {
          if (rating === 0) {
            const next = { ...prev };
            delete next[itemId];
            return next;
          }
          return { ...prev, [itemId]: rating };
        });
      }
    } catch (err) {
      console.error('Rating error:', err);
    }
  };

  return (
    <div className="search-page">
      <div className="feed-header">
        <h2>Search</h2>
      </div>
      <p className="page-subtitle">Find movies by title, genre, or mood.</p>

      <div className="search-bar-row">
        <input
          className="search-input"
          type="text"
          placeholder="Search by title or genre..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button className="search-btn" onClick={handleSearch}>Search</button>
      </div>

      <div className="search-section">
        <p className="search-section-label">I'm in the mood for...</p>
        <div className="mood-chips">
          {MOODS.map(m => (
            <button
              key={m.key}
              className={`mood-chip${selectedMood === m.key ? ' active' : ''}`}
              onClick={() => handleMoodClick(m.key)}
            >{m.label}</button>
          ))}
        </div>
      </div>

      <div className="search-section">
        <p className="search-section-label">By genre</p>
        <div className="genre-pills">
          {ALL_GENRES.map(g => (
            <button
              key={g}
              className={`genre-pill${selectedGenre === g ? ' active' : ''}`}
              onClick={() => handleGenreClick(g)}
            >{g}</button>
          ))}
        </div>
      </div>

      {loading && <div className="chart-placeholder">Searching...</div>}

      {!loading && searched && items.length === 0 && (
        <div className="chart-placeholder">No movies found. Try a different search.</div>
      )}

      {!loading && items.length > 0 && (
        <div className="search-results-grid">
          {items.map(item => (
            <div key={item.id} className="search-result-card">
              <img src={item.image_url} alt={item.product_name} className="search-result-img" />
              <div className="search-result-meta">
                <span className="search-result-title">{item.product_name}</span>
                <span className="search-result-genre">
                  {item.category}{item.year ? ` · ${item.year}` : ''}
                </span>
                <div className="search-result-stars">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      className={`star-btn${star <= (ratings[item.id] || 0) ? ' filled' : ''}`}
                      onClick={() => submitRating(item.id, star === (ratings[item.id] || 0) ? 0 : star)}
                    >★</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
