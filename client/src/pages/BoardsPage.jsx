import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function BoardRecs({ activeUser, boardId, boardName }) {
  const [recs, setRecs] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/boards/${activeUser}/${boardId}/recommendations`)
      .then(res => res.json())
      .then(data => setRecs(data.items || []))
      .catch(() => setRecs([]));
  }, [activeUser, boardId]);

  if (recs === null) return <p className="board-recs-loading">Finding similar movies...</p>;
  if (recs.length === 0) return <p className="board-recs-loading">Add more movies to this board to get recommendations.</p>;

  return (
    <div className="board-recs-section">
      <p className="board-recs-label">Because of your <strong>{boardName}</strong> board</p>
      <div className="board-recs-strip">
        {recs.map(item => (
          <div key={item.id} className="board-rec-card">
            <img src={item.image_url} alt={item.product_name} className="board-rec-img" />
            <span className="board-rec-title">{item.product_name}</span>
            <span className="board-rec-genre">{item.category}{item.year ? ` · ${item.year}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardsPage({ activeUser }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newBoardName, setNewBoardName] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedBoard, setExpandedBoard] = useState(null);

  const loadBoards = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/boards/${activeUser}`)
      .then(res => res.json())
      .then(data => { setBoards(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadBoards(); setExpandedBoard(null); }, [activeUser]);

  const createBoard = async () => {
    if (!newBoardName.trim()) return;
    setCreating(true);
    await fetch(`${API_BASE}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUser, name: newBoardName.trim() })
    });
    setNewBoardName('');
    setCreating(false);
    loadBoards();
  };

  const deleteBoard = async (boardId) => {
    await fetch(`${API_BASE}/api/boards/${boardId}`, { method: 'DELETE' });
    if (expandedBoard === boardId) setExpandedBoard(null);
    loadBoards();
  };

  const toggleBoard = (boardId) => {
    setExpandedBoard(prev => prev === boardId ? null : boardId);
  };

  return (
    <div>
      <div className="feed-header">
        <h2>My Boards</h2>
      </div>
      <p className="page-subtitle">
        Organize your rated movies into collections. Each board captures a distinct facet of your taste.
      </p>

      <div className="board-create-row">
        <input
          className="board-name-input"
          type="text"
          placeholder="New board name (e.g. Dark Thrillers)"
          value={newBoardName}
          onChange={e => setNewBoardName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createBoard(); }}
        />
        <button
          className="board-create-btn"
          onClick={createBoard}
          disabled={creating || !newBoardName.trim()}
        >
          Create
        </button>
      </div>

      {loading ? (
        <div className="chart-placeholder">Loading boards...</div>
      ) : boards.length === 0 ? (
        <div className="chart-placeholder">
          <p>No boards yet. Create one above, then save rated movies to it from the feed.</p>
        </div>
      ) : (
        <div className="boards-list">
          {boards.map(board => {
            const isExpanded = expandedBoard === board.id;
            return (
              <div key={board.id} className={`board-row${isExpanded ? ' expanded' : ''}`}>
                <div className="board-row-header" onClick={() => toggleBoard(board.id)}>
                  <div className="board-thumbs-inline">
                    {board.thumbnails.slice(0, 4).map((url, i) => (
                      <img key={i} src={url} alt="" className="board-thumb" />
                    ))}
                    {board.thumbnails.length === 0 && <div className="board-thumb-empty" />}
                  </div>
                  <div className="board-row-meta">
                    <p className="board-name">{board.name}</p>
                    <p className="board-count">{board.item_count} movies</p>
                  </div>
                  <div className="board-row-actions">
                    <span className="board-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                    <button
                      className="board-delete-btn"
                      onClick={e => { e.stopPropagation(); deleteBoard(board.id); }}
                      aria-label="Delete board"
                    >✕</button>
                  </div>
                </div>
                {isExpanded && (
                  <BoardRecs
                    activeUser={activeUser}
                    boardId={board.id}
                    boardName={board.name}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
