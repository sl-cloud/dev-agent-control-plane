# dev-agent-control-plane

Control plane for receiving deployment webhooks, running analysis workflows, and showing run details on a public dashboard.

## Local Development

Start the API, worker, and Postgres with Docker Compose. If ports `3000` or `5432` are already in use, choose alternate host ports:

```bash
API_HOST_PORT=3300 DB_HOST_PORT=55432 docker compose up -d --build --wait
```

Check the API:

```bash
curl -sS http://localhost:3300/health/live
curl -sS http://localhost:3300/api/v1/public/runs
```

Start the dashboard dev server from the repository root:

```bash
CP_API_PROXY_TARGET=http://localhost:3300 npm --prefix dashboard run dev -- --host 0.0.0.0
```

Open the dashboard:

```text
http://localhost:5173/runs
```

## Trigger A Local Deployment Run

The local seed creates an `api-test-gateway` project. Send a signed deployment webhook to create and process a run:

```bash
set -euo pipefail
set -a
source .env
set +a

commit_sha=$(git -C ../api-test-gateway rev-parse HEAD)
base_sha=$(git -C ../api-test-gateway rev-parse HEAD~1)

body=$(node -e "const [commitSha, baseSha] = process.argv.slice(1); console.log(JSON.stringify({project:'api-test-gateway',event:'deployment.completed',repository:'sl-cloud/api-test-gateway',branch:'main',commitSha,baseSha,environment:'local',ciRunUrl:'http://local.test/ci',deployedAt:new Date().toISOString()}))" "$commit_sha" "$base_sha")

timestamp=$(date +%s)
delivery_id="local-$(date +%s)"
signature="sha256=$(printf '%s.%s' "$timestamp" "$body" | openssl dgst -sha256 -hmac "$CP_WEBHOOK_SECRET" | sed 's/^.* //')"

curl -sS -X POST http://localhost:3300/api/v1/webhooks/github-ci \
  -H "Content-Type: application/json" \
  -H "X-Portfolio-Event: deployment.completed" \
  -H "X-Portfolio-Delivery: $delivery_id" \
  -H "X-Portfolio-Timestamp: $timestamp" \
  -H "X-Portfolio-Signature: $signature" \
  -d "$body"
```

The response contains a `runId`. Refresh `/runs`, click the new row, and inspect:

- `fetchSource`: git diff, changed files, and selected file contents.
- `analyseChanges`: structured change summary.
- `planTests`: structured test plan.
- Cost rows for the recorded operations.

## Useful Commands

Run these inside the healthy API container:

```bash
docker compose exec api npm test
docker compose exec api npm run lint
docker compose exec api npm run typecheck
```

Inspect recent worker logs:

```bash
docker compose logs --no-color --tail=120 worker
```
