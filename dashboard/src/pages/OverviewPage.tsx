import { useEffect, useState } from 'react';
import { Nav } from '../Nav.js';
import { fetchOverview, type ProjectSummary } from '../api/client.js';

export function OverviewPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverview()
      .then((res) => setProjects(res.projects))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="page">
      <Nav />
      <h1>Overview</h1>
      {error && <p className="error">Failed to load: {error}</p>}
      {!error && !projects && <p>Loading...</p>}
      {projects && projects.length === 0 && <p>No public projects yet.</p>}
      {projects && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.slug}>
              <strong>{project.name}</strong> <span className="muted">({project.slug})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
