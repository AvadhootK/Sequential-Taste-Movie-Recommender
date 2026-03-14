import { useState, useRef } from 'react';

const DWELL_THRESHOLD_MS = 2000;

export function FeedCard({ item, userRating, onRate, onClickImage, onDwell, boards, userBoardId, onAddToBoard }) {
  const [hovered, setHovered] = useState(0);
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const dwellStart = useRef(null);
  const displayRating = hovered || userRating || 0;

  const handleMouseEnter = () => {
    dwellStart.current = Date.now();
  };

  const handleMouseLeave = () => {
    if (dwellStart.current && !userRating) {
      const elapsed = Date.now() - dwellStart.current;
      if (elapsed >= DWELL_THRESHOLD_MS) {
        onDwell?.(item.id, elapsed / 1000);
      }
    }
    dwellStart.current = null;
    setHovered(0);
  };

  const handleRate = (star) => {
    if (star === userRating) {
      onRate(item.id, 0);
      setShowBoardPicker(false);
    } else {
      onRate(item.id, star);
      if (star >= 4) setShowBoardPicker(true);
      else setShowBoardPicker(false);
    }
  };

  const assignBoard = (boardId) => {
    onAddToBoard?.(item.id, boardId);
    setShowBoardPicker(false);
  };

  const currentBoard = boards?.find(b => b.id === userBoardId);

  return (
    <div className="image-card" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <img
        src={item.image_url}
        alt={item.product_name || item.category}
        onClick={() => onClickImage?.(item)}
        style={{ cursor: 'pointer' }}
      />

      {/* Dwell indicator — subtle pulse when user hovers long enough */}
      <div className="card-footer">
        <div className="card-meta">
          <span className="category-label">{item.product_name || item.category}</span>
          <span className="genre-year-label">
            {item.category}{item.year ? ` · ${item.year}` : ''}
          </span>
          {currentBoard && (
            <span className="board-tag">{currentBoard.name}</span>
          )}
        </div>
        <div className="star-rating" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              className={`star-btn ${star <= displayRating ? 'filled' : ''}`}
              onMouseEnter={() => setHovered(star)}
              onClick={() => handleRate(star)}
              aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
            >★</button>
          ))}
        </div>
      </div>

      {/* Board picker — appears after rating 4+ stars */}
      {showBoardPicker && boards && (
        <div className="board-picker">
          <p className="board-picker-label">Save to board</p>
          {boards.map(board => (
            <button
              key={board.id}
              className={`board-picker-option ${userBoardId === board.id ? 'active' : ''}`}
              onClick={() => assignBoard(board.id)}
            >
              {board.name}
            </button>
          ))}
          <button className="board-picker-skip" onClick={() => setShowBoardPicker(false)}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
