import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Nav } from '../Nav.js';
import { fetchRun, type RunDetail, type WorkflowStepSummary } from '../api/client.js';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function findStep(run: RunDetail, name: string): WorkflowStepSummary | undefined {
  return run.steps.find((step) => step.name === name);
}

function StepTimeline({ steps }: { steps: WorkflowStepSummary[] }) {
  return (
    <ol className="step-list">
      {steps.map((step) => (
        <li key={`${step.name}-${step.attempt}`}>
          <span className={`status status-${step.status}`}>{step.status}</span>
          <span className="step-name">{step.name}</span>
          <span className="muted">attempt {step.attempt}</span>
          {step.error && <span className="error">{step.error}</span>}
        </li>
      ))}
    </ol>
  );
}

export function RunDetailPage() {
  const params = useParams();
  const runId = params.id;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      return;
    }
    setRun(null);
    setError(null);
    fetchRun(runId)
      .then(setRun)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [runId]);

  const analysis = useMemo(() => (run ? findStep(run, 'analyseChanges')?.output : null), [run]);
  const plan = useMemo(() => (run ? findStep(run, 'planTests')?.output : null), [run]);
  const source = useMemo(() => (run ? findStep(run, 'fetchSource')?.output : null), [run]);

  return (
    <div className="page">
      <Nav />
      <p>
        <Link to="/runs">Back to runs</Link>
      </p>
      {error && <p className="error">Failed to load: {error}</p>}
      {!error && !run && <p>Loading...</p>}
      {run && (
        <>
          <div className="detail-header">
            <div>
              <h1>Run {run.commitSha ? run.commitSha.slice(0, 7) : run.id.slice(0, 8)}</h1>
              <p className="muted">
                {run.projectSlug} / {run.workflowName} / {run.branch ?? '-'}
              </p>
            </div>
            <span className={`status status-${run.status}`}>{run.status}</span>
          </div>

          <section className="panel">
            <h2>Steps</h2>
            <StepTimeline steps={run.steps} />
          </section>

          <section className="panel">
            <h2>Change Analysis</h2>
            {analysis ? (
              <pre>{formatJson(analysis)}</pre>
            ) : (
              <p className="muted">No analysis recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Test Plan</h2>
            {plan ? <pre>{formatJson(plan)}</pre> : <p className="muted">No test plan recorded.</p>}
          </section>

          <section className="panel">
            <h2>Source Context</h2>
            {source ? (
              <pre>{formatJson(source)}</pre>
            ) : (
              <p className="muted">No source context recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Cost</h2>
            <p>Total: ${run.totalCostUsd}</p>
            {run.aiOperations.length > 0 && (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {run.aiOperations.map((operation) => (
                    <tr key={`${operation.kind}-${operation.createdAt}`}>
                      <td>{operation.kind}</td>
                      <td>{operation.model}</td>
                      <td>{operation.promptTokens ?? 0}</td>
                      <td>{operation.completionTokens ?? 0}</td>
                      <td>${operation.costUsd ?? '0.000000'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
