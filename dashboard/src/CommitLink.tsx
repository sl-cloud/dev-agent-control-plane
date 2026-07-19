import { commitUrl } from './api/client.js';

export function CommitLink({
  repositoryUrl,
  commitSha,
  fallback = '-',
}: {
  repositoryUrl: string | null;
  commitSha: string | null;
  fallback?: string;
}) {
  if (!commitSha) {
    return <>{fallback}</>;
  }
  const url = commitUrl(repositoryUrl, commitSha);
  const label = commitSha.slice(0, 7);
  if (!url) {
    return <>{label}</>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
