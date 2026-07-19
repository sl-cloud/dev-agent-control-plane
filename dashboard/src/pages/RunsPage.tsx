import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Nav } from '../Nav.js';
import { fetchRuns, type RunSummary } from '../api/client.js';

export function RunsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const project = searchParams.get('project') ?? undefined;
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRuns(null);
    fetchRuns({ project, page })
      .then((res) => setRuns(res.runs))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [project, page]);

  return (
    <div className="page">
      <Nav />
      <h1>Runs</h1>
      <div className="filters">
        <input
          type="text"
          placeholder="Filter by project slug"
          defaultValue={project ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const value = (e.target as HTMLInputElement).value.trim();
              const next = new URLSearchParams();
              if (value) {
                next.set('project', value);
              }
              setSearchParams(next);
            }
          }}
        />
      </div>
      {error && <p className="error">Failed to load: {error}</p>}
      {!error && !runs && <p>Loading...</p>}
      {runs && runs.length === 0 && <p>No runs found.</p>}
      {runs && runs.length > 0 && (
        <table className="runs-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Workflow</th>
              <th>Status</th>
              <th>Branch</th>
              <th>Commit</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.projectSlug}</Link>
                </td>
                <td>{run.workflowName}</td>
                <td>
                  <span className={`status status-${run.status}`}>{run.status}</span>
                </td>
                <td>{run.branch ?? '-'}</td>
                <td>{run.commitSha ? run.commitSha.slice(0, 7) : '-'}</td>
                <td>{new Date(run.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
