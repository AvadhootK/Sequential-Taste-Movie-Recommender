import { Link, useLocation } from 'react-router-dom';

const MOVIELENS_USERS = [
  { id: 405, name: 'User 405' },
  { id: 655, name: 'User 655' },
  { id: 13, name: 'User 13' },
  { id: 450, name: 'User 450' },
  { id: 276, name: 'User 276' },
  { id: 416, name: 'User 416' },
  { id: 537, name: 'User 537' },
  { id: 303, name: 'User 303' },
  { id: 234, name: 'User 234' },
  { id: 393, name: 'User 393' },
];

export function NavHeader({ activeUser, onUserChange }) {
  const location = useLocation();

  return (
    <header className="header">
      <h1>Temporal Taste Engine</h1>
      <nav className="main-nav">
        <Link to="/" className={location.pathname === '/' ? 'nav-link active' : 'nav-link'}>
          Discover
        </Link>
        <Link to="/trajectory" className={location.pathname === '/trajectory' ? 'nav-link active' : 'nav-link'}>
          Taste Journey
        </Link>
        <Link to="/boards" className={location.pathname === '/boards' ? 'nav-link active' : 'nav-link'}>
          Boards
        </Link>
        <Link to="/search" className={location.pathname === '/search' ? 'nav-link active' : 'nav-link'}>
          Search
        </Link>
      </nav>
      <select
        value={activeUser}
        onChange={(e) => onUserChange(Number(e.target.value))}
        className="user-selector"
      >
        {MOVIELENS_USERS.map(user => (
          <option key={user.id} value={user.id}>{user.name}</option>
        ))}
      </select>
    </header>
  );
}
