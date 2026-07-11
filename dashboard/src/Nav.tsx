import { NavLink } from 'react-router-dom';

export function Nav() {
  return (
    <nav className="nav">
      <span className="nav-brand">Control Plane</span>
      <NavLink to="/overview" className={({ isActive }) => (isActive ? 'active' : '')}>
        Overview
      </NavLink>
      <NavLink to="/runs" className={({ isActive }) => (isActive ? 'active' : '')}>
        Runs
      </NavLink>
    </nav>
  );
}
