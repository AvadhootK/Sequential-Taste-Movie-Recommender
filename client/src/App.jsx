import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { NavHeader } from './components/NavHeader';
import { FeedPage } from './pages/FeedPage';
import { TrajectoryPage } from './pages/TrajectoryPage';
import { BoardsPage } from './pages/BoardsPage';
import { SearchPage } from './pages/SearchPage';
import './App.css';

function App() {
  const [activeUser, setActiveUser] = useState(405);

  return (
    <div className="app-container">
      <NavHeader activeUser={activeUser} onUserChange={setActiveUser} />
      <Routes>
        <Route path="/" element={<FeedPage activeUser={activeUser} />} />
        <Route path="/trajectory" element={<TrajectoryPage activeUser={activeUser} />} />
        <Route path="/boards" element={<BoardsPage activeUser={activeUser} />} />
        <Route path="/search" element={<SearchPage activeUser={activeUser} />} />
      </Routes>
    </div>
  );
}

export default App;
