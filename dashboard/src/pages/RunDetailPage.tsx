import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CommitLink } from '../CommitLink.js';
import { Nav } from '../Nav.js';
import { fetchRun, type RunDetail, type WorkflowStepSummary } from '../api/client.js';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function findStep(run: RunDetail, name: string): WorkflowStepSummary | undefined {
  return run.steps.find((step) => step.name === name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function outputRecord(step: WorkflowStepSummary | undefined): Record<string, unknown> | null {
  return isRecord(step?.output) ? step.output : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function text(value: unknown, fallback = '-'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberText(value: unknown, fallback = '0'): string {
  return typeof value === 'number' ? String(value) : fallback;
}

function violationText(error: string | null): string[] {
  if (!error) {
    return [];
  }
  const marker = 'Generated spec validation failed: ';
  if (!error.startsWith(marker)) {
    return [error];
  }
  try {
    const parsed = JSON.parse(error.slice(marker.length)) as { violations?: unknown };
    return Array.isArray(parsed.violations)
      ? parsed.violations.filter((violation): violation is string => typeof violation === 'string')
      : [error];
  } catch {
    return [error];
  }
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

function SummaryGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="summary-grid">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RawJsonDetails({ value }: { value: unknown }) {
  return (
    <details className="raw-json">
      <summary>View raw JSON</summary>
      <textarea readOnly rows={14} value={formatJson(value)} />
    </details>
  );
}

function ChangeAnalysisReport({ analysis }: { analysis: unknown }) {
  const output = isRecord(analysis) ? analysis : {};
  const changes = records(output.behaviouralChanges);
  return (
    <>
      <p>{text(output.summary, 'No summary recorded.')}</p>
      <SummaryGrid
        items={[
          { label: 'Security Sensitive', value: output.securitySensitive ? 'Yes' : 'No' },
          { label: 'Behaviour Changes', value: String(changes.length) },
        ]}
      />
      {changes.length > 0 && (
        <table className="runs-table">
          <thead>
            <tr>
              <th>Change</th>
              <th>Kind</th>
              <th>Risk</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change, index) => (
              <tr key={`${text(change.kind)}-${index}`}>
                <td>{text(change.description)}</td>
                <td>{text(change.kind)}</td>
                <td>{text(change.risk)}</td>
                <td>{strings(change.files).join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function TestPlanReport({ plan }: { plan: unknown }) {
  const tests = records(isRecord(plan) ? plan.tests : []);
  if (tests.length === 0) {
    return <p className="muted">No planned tests recorded.</p>;
  }
  return (
    <table className="runs-table">
      <thead>
        <tr>
          <th>Test</th>
          <th>Kind</th>
          <th>Priority</th>
          <th>Reasoning</th>
        </tr>
      </thead>
      <tbody>
        {tests.map((testCase, index) => (
          <tr key={`${text(testCase.title, 'test')}-${index}`}>
            <td>{text(testCase.title, 'Untitled test')}</td>
            <td>{text(testCase.kind)}</td>
            <td>{text(testCase.priority)}</td>
            <td>{text(testCase.reasoning)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceContextReport({
  source,
  repositoryUrl,
}: {
  source: unknown;
  repositoryUrl: string | null;
}) {
  const output = isRecord(source) ? source : {};
  const changedFiles = strings(output.changedFiles);
  const contractFiles = records(output.contractFiles);
  const existingGeneratedTests = records(output.existingGeneratedTests);
  const commitSha = typeof output.commitSha === 'string' ? output.commitSha : null;
  const baseSha = typeof output.baseSha === 'string' ? output.baseSha : null;
  return (
    <>
      <SummaryGrid
        items={[
          { label: 'Repository', value: text(output.repository) },
          { label: 'Branch', value: text(output.branch) },
          {
            label: 'Commit',
            value: <CommitLink repositoryUrl={repositoryUrl} commitSha={commitSha} />,
          },
          {
            label: 'Base',
            value: <CommitLink repositoryUrl={repositoryUrl} commitSha={baseSha} />,
          },
          { label: 'Changed Files', value: String(changedFiles.length) },
          { label: 'Contract Files', value: String(contractFiles.length) },
          { label: 'Accepted Prior Suites', value: String(existingGeneratedTests.length) },
        ]}
      />
      {changedFiles.length > 0 && (
        <>
          <h3>Changed Files</h3>
          <ul className="compact-list">
            {changedFiles.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </>
      )}
      {contractFiles.length > 0 && (
        <>
          <h3>Contract Files Used</h3>
          <ul className="compact-list columns">
            {contractFiles.map((file) => (
              <li key={text(file.path)}>{text(file.path)}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function RegressionRerunsReport({ reruns }: { reruns: Record<string, unknown>[] }) {
  if (reruns.length === 0) {
    return <p className="muted">No previously accepted tests to rerun.</p>;
  }
  return (
    <table className="runs-table">
      <thead>
        <tr>
          <th>Commit</th>
          <th>Branch</th>
          <th>Result</th>
          <th>Passed</th>
          <th>Failed</th>
        </tr>
      </thead>
      <tbody>
        {reruns.map((rerun, index) => (
          <tr key={`${text(rerun.acceptedTestId, 'rerun')}-${index}`}>
            <td>{text(rerun.commitSha).slice(0, 8)}</td>
            <td>{text(rerun.branch)}</td>
            <td className={rerun.passed ? '' : 'error'}>{rerun.passed ? 'Passed' : 'Failed'}</td>
            <td>{numberText(rerun.passedCount)}</td>
            <td>{numberText(rerun.failedCount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const generatedSpec = useMemo(
    () => outputRecord(run ? findStep(run, 'generateTests') : undefined)?.specSource,
    [run],
  );
  const validationStep = useMemo(() => (run ? findStep(run, 'validateTests') : undefined), [run]);
  const finalReport = useMemo(
    () => outputRecord(run ? findStep(run, 'finaliseReport') : undefined),
    [run],
  );
  const acceptedTests = useMemo(
    () => outputRecord(run ? findStep(run, 'persistAcceptedTests') : undefined),
    [run],
  );
  const reruns = useMemo(
    () => records(outputRecord(run ? findStep(run, 'rerunAcceptedTests') : undefined)?.reruns),
    [run],
  );

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
              <h1>
                Run{' '}
                {run.commitSha ? (
                  <CommitLink repositoryUrl={run.repositoryUrl} commitSha={run.commitSha} />
                ) : (
                  run.id.slice(0, 8)
                )}
              </h1>
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
              <>
                <ChangeAnalysisReport analysis={analysis} />
                <RawJsonDetails value={analysis} />
              </>
            ) : (
              <p className="muted">No analysis recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Test Plan</h2>
            {plan ? (
              <>
                <TestPlanReport plan={plan} />
                <RawJsonDetails value={plan} />
              </>
            ) : (
              <p className="muted">No test plan recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Generated Spec</h2>
            {typeof generatedSpec === 'string' ? (
              <pre>{generatedSpec}</pre>
            ) : (
              <p className="muted">No generated spec recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Validation Result</h2>
            {validationStep ? (
              validationStep.status === 'succeeded' ? (
                <p>Passed</p>
              ) : (
                <>
                  <p className="error">Failed</p>
                  <ul>
                    {violationText(validationStep.error).map((violation) => (
                      <li key={violation}>{violation}</li>
                    ))}
                  </ul>
                </>
              )
            ) : (
              <p className="muted">No validation result recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Execution Result</h2>
            {finalReport ? (
              <>
                <p>
                  {Number(finalReport.failedCount ?? 0) > 0 ? 'Failed' : 'Passed'} / passed{' '}
                  {String(finalReport.passedCount ?? 0)} / failed{' '}
                  {String(finalReport.failedCount ?? 0)} / duration{' '}
                  {String(finalReport.duration ?? 0)} ms
                </p>
                {Array.isArray(finalReport.results) && finalReport.results.length > 0 && (
                  <table className="runs-table">
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Status</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalReport.results.filter(isRecord).map((result, index) => (
                        <tr key={`${String(result.title ?? 'test')}-${index}`}>
                          <td>{String(result.title ?? 'untitled test')}</td>
                          <td>{String(result.status ?? 'unknown')}</td>
                          <td>{result.error ? String(result.error) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <RawJsonDetails value={finalReport} />
              </>
            ) : (
              <p className="muted">No execution report recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Repair Attempts</h2>
            {finalReport && Array.isArray(finalReport.repairAttempts) ? (
              finalReport.repairAttempts.length > 0 ? (
                <>
                  <p>
                    Stop reason: {String(finalReport.repairStopReason ?? 'unknown')} / repaired:{' '}
                    {finalReport.repaired ? 'yes' : 'no'}
                  </p>
                  <table className="runs-table">
                    <thead>
                      <tr>
                        <th>Attempt</th>
                        <th>Classification</th>
                        <th>Repair</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalReport.repairAttempts.filter(isRecord).map((attempt) => {
                        const classification = isRecord(attempt.classification)
                          ? attempt.classification
                          : {};
                        const execution = isRecord(attempt.execution) ? attempt.execution : null;
                        const validation = isRecord(attempt.validation) ? attempt.validation : null;
                        return (
                          <tr key={String(attempt.attempt ?? 'attempt')}>
                            <td>{String(attempt.attempt ?? '-')}</td>
                            <td>
                              {String(classification.category ?? 'unknown')}
                              <br />
                              <span className="muted">
                                {String(classification.summary ?? '').slice(0, 180)}
                              </span>
                            </td>
                            <td>
                              {validation
                                ? validation.valid
                                  ? 'valid'
                                  : 'validation failed'
                                : classification.repairRecommended
                                  ? 'not run'
                                  : 'not recommended'}
                            </td>
                            <td>
                              {execution
                                ? `${execution.failed ? 'failed' : 'passed'}`
                                : 'not executed'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <RawJsonDetails value={finalReport.repairAttempts} />
                </>
              ) : (
                <p className="muted">No repair needed.</p>
              )
            ) : (
              <p className="muted">No repair attempt history recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Source Context</h2>
            {source ? (
              <>
                <SourceContextReport source={source} repositoryUrl={run.repositoryUrl} />
                <RawJsonDetails value={source} />
              </>
            ) : (
              <p className="muted">No source context recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Accepted Test Persistence</h2>
            {acceptedTests ? (
              acceptedTests.persisted ? (
                <>
                  <SummaryGrid
                    items={[
                      { label: 'Persisted', value: 'Yes' },
                      { label: 'Source', value: text(acceptedTests.source) },
                      { label: 'Passed Tests', value: numberText(acceptedTests.passedCount) },
                      { label: 'Duration', value: `${numberText(acceptedTests.duration)} ms` },
                    ]}
                  />
                  <RawJsonDetails value={acceptedTests} />
                </>
              ) : (
                <>
                  <p className="muted">{text(acceptedTests.reason, 'Not persisted.')}</p>
                  <RawJsonDetails value={acceptedTests} />
                </>
              )
            ) : (
              <p className="muted">No accepted-test persistence result recorded.</p>
            )}
          </section>

          <section className="panel">
            <h2>Regression Reruns</h2>
            <RegressionRerunsReport reruns={reruns} />
          </section>

          <section className="panel">
            <h2>Token Usage</h2>
            {run.aiOperations.length > 0 ? (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Model</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {run.aiOperations.map((operation) => (
                    <tr key={`${operation.kind}-${operation.createdAt}`}>
                      <td>{operation.kind}</td>
                      <td>{operation.model}</td>
                      <td>{operation.promptTokens ?? 0}</td>
                      <td>{operation.completionTokens ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No token usage recorded.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
