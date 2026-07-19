# dev-agent-control-plane

A TypeScript control plane that receives deployment webhooks, analyzes source changes, generates Playwright checks, runs them against staging, and exposes the results on a public dashboard.

## What It Runs

- Fastify API for health checks, signed webhooks, admin actions, and dashboard data.
- Worker process for source analysis, test planning, test generation, validation, execution summaries, and retryable workflows.
- React dashboard served as static files behind Caddy in staging.
- Postgres for application data, workflow state, and the job queue.
- Docker Compose for local development and staging deployment.

## Local Development

Copy `.env.example` to `.env` and fill in local values. `PLAYWRIGHT_TARGET_URL` should point at the local or staging app that browser checks should visit.

If ports `3000` or `5432` are already in use, choose alternate host ports:

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
- `generateTests`: generated Playwright source.
- `validateTests`: pass or the validation error list.
- `finaliseReport`: browser execution result with pass and fail counts.
- Token usage rows for recorded provider calls.

To confirm failed browser checks are visible without crashing the workflow, temporarily point `PLAYWRIGHT_TARGET_URL` at an unused local port, restart the worker, trigger another webhook, and inspect the run detail page. The workflow should complete the validation step and show a failed execution report.

## Staging Deployment

The staging workflow deploys immutable GHCR images tagged as `sha-<commit>`. A push to `main` runs CI, pushes the app and proxy images, then deploys the matching tag over SSH.

Staging expects this layout on the VPS:

```text
~/dev-agent-control-plane/
  .env
  docker-compose.yml
  docker-compose.staging.yml
```

Prepare the host once:

```bash
git clone https://github.com/sl-cloud/dev-agent-control-plane.git ~/dev-agent-control-plane
cd ~/dev-agent-control-plane
cp .env.example .env
```

Fill `.env` with real staging values, install Docker with Compose v2, and make sure the host reverse proxy forwards the public HTTPS site to `127.0.0.1:${PROXY_HOST_PORT}`. The Compose proxy listens on `127.0.0.1:8080` unless `PROXY_HOST_PORT` is set.

If the GHCR package is private, log in on the VPS before the first deploy:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
```

If the GHCR package is public, no registry login is needed on the VPS.

### GitHub Actions Configuration

Set these in the repository settings before enabling public access. Store private values as secrets, not variables.

| Name                       | Kind     | Required                    | Used by              | Notes                                                                                          |
| -------------------------- | -------- | --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `STAGING_SSH_KEY`          | Secret   | Yes                         | `deploy-staging.yml` | Private SSH key that can log in to the staging host.                                           |
| `STAGING_HOST`             | Variable | Yes                         | `deploy-staging.yml` | Hostname or IP for SSH deploys.                                                                |
| `STAGING_USER`             | Variable | Yes                         | `deploy-staging.yml` | SSH username on the staging host.                                                              |
| `STAGING_PORT`             | Variable | No                          | `deploy-staging.yml` | SSH port. Defaults to `22` when unset.                                                         |
| `STAGING_BASE_URL`         | Variable | Yes                         | `deploy-staging.yml` | Public HTTPS origin used by the health check, for example `https://control-plane.example.com`. |
| `AI_PROVIDER`              | Variable | Yes                         | `deploy-staging.yml` | `fake`, `openai`, or `deepseek` for staging.                                                   |
| `AI_MODEL_DEFAULT`         | Variable | Yes for real providers      | `deploy-staging.yml` | Default model name passed to the worker.                                                       |
| `AI_MODEL_CHANGE_ANALYSIS` | Variable | No                          | `deploy-staging.yml` | Optional model override for change analysis.                                                   |
| `AI_MODEL_TEST_PLANNING`   | Variable | No                          | `deploy-staging.yml` | Optional model override for test planning.                                                     |
| `OPENAI_API_KEY`           | Secret   | When `AI_PROVIDER=openai`   | `deploy-staging.yml` | OpenAI API key written into the VPS `.env` during deploy.                                      |
| `DEEPSEEK_API_KEY`         | Secret   | When `AI_PROVIDER=deepseek` | `deploy-staging.yml` | DeepSeek API key written into the VPS `.env` during deploy.                                    |

`GITHUB_TOKEN` is supplied automatically by GitHub Actions. It is used by `ci.yml` to push GHCR images and does not need to be configured manually.

The deploy workflow rewrites these keys in the VPS `.env` on each deploy:

```text
IMAGE_TAG
AI_PROVIDER
AI_MODEL_DEFAULT
AI_MODEL_CHANGE_ANALYSIS
AI_MODEL_TEST_PLANNING
DEEPSEEK_API_KEY
OPENAI_API_KEY
```

### Staging Host Environment

Create `~/dev-agent-control-plane/.env` from `.env.example` and set these values on the VPS:

| Name                             | Required                     | Notes                                                                                           |
| -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | Yes                          | Use `production`.                                                                               |
| `PORT`                           | Yes                          | API port inside the container, normally `3000`.                                                 |
| `LOG_LEVEL`                      | Yes                          | Use `info` unless debugging.                                                                    |
| `POSTGRES_PASSWORD`              | Yes                          | Strong database password for the Postgres container.                                            |
| `DATABASE_URL`                   | Yes                          | Must use the same password as `POSTGRES_PASSWORD`, with host `db` and database `control_plane`. |
| `ADMIN_API_TOKEN`                | Yes                          | Bearer token for admin retry and cancel endpoints. Generate with `openssl rand -base64 32`.     |
| `CP_WEBHOOK_SECRET`              | Yes                          | HMAC secret shared with the connected project deploy workflow.                                  |
| `PLAYWRIGHT_TARGET_URL`          | Yes                          | Browser target for generated Playwright checks, usually the staging app URL.                    |
| `PLAYWRIGHT_BASIC_AUTH_USERNAME` | When target needs Basic Auth | Supplied by the runner as a default Basic Auth header.                                          |
| `PLAYWRIGHT_BASIC_AUTH_PASSWORD` | When target needs Basic Auth | Supplied by the runner as a default Basic Auth header.                                          |
| `PROXY_HOST_PORT`                | No                           | Host loopback port for Caddy. Defaults to `8080`.                                               |
| `AI_RUN_BUDGET_USD`              | No                           | Per-run budget guard. Defaults to `1`.                                                          |
| `AI_INPUT_COST_PER_MTOK`         | No                           | Cost estimate for providers that do not return reliable pricing.                                |
| `AI_OUTPUT_COST_PER_MTOK`        | No                           | Cost estimate for providers that do not return reliable pricing.                                |

Keep `.env` on the VPS only. Do not commit real hostnames, database URLs, API keys, webhook secrets, SSH keys, or bearer tokens.

### Deploy And Roll Back

Normal deploys happen automatically after CI succeeds on `main`.

Manual rollback uses the workflow dispatch input:

```text
image_tag=sha-<40-hex-commit>
```

That redeploys an already-built immutable image tag. The workflow updates `IMAGE_TAG`, pulls the images, runs migrations and seed data, restarts `api`, `worker`, `db`, and `proxy`, then checks `${STAGING_BASE_URL}/health/ready`.

## Provider Setup

By default `AI_PROVIDER=fake` and the pipeline needs no model credentials.

For OpenAI locally, set `AI_PROVIDER=openai` and `OPENAI_API_KEY` in `.env`, then restart the worker:

```bash
docker compose restart worker
```

For DeepSeek locally, set `AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` in `.env`, then recreate the worker so Compose reloads env values:

```bash
docker compose up -d --force-recreate --no-deps worker
```

For staging, set `AI_PROVIDER`, model variables, and the matching API key in GitHub repository settings. The deploy workflow syncs those values into the VPS `.env`.

`opencode` is useful for local developer sessions. Run `opencode auth login` on the host, set `AI_PROVIDER=opencode` in `.env`, and restart the worker. The local Compose file mounts the host opencode credential directory read-only into the worker.

## Generated Test Contract

Before test generation, the worker builds a source-derived contract from the checked-out commit. The contract includes changed files plus supporting route, schema, auth, docs, and error-handling files so the generated Playwright spec can use real paths, required request fields, response shapes, and auth behavior from the codebase itself.

For changes that affect generated tests, run a local deployment webhook first and inspect the run detail:

- Run `npm run verify:generated-test-contract`, or `make verify-generated-test-contract` inside the Docker workflow.
- Confirm `fetchSource` includes the relevant route and schema files in `contractFiles`.
- Confirm `planTests` avoids checks that need unavailable global state, such as an empty staging database.
- Confirm `generateTests` uses only paths and response fields proven by the source contract.
- Treat failures from invented routes, placeholder credentials, or impossible setup as contract or harness issues to fix before deployment.

If the target app gates registration behind Basic Auth, set `PLAYWRIGHT_BASIC_AUTH_USERNAME` and `PLAYWRIGHT_BASIC_AUTH_PASSWORD` in the control-plane environment. The runner supplies them as a default Playwright `Authorization` header, so generated specs can test valid credential paths without reading or hardcoding secrets.

## Re-running Analysis For An Already-Deployed Commit

A run is created from a `deployment.completed` webhook. The connected app deploy workflow sends that webhook after a successful staging deploy. Each delivery is keyed by `X-Portfolio-Delivery`, so the same delivery cannot create two runs, but a new delivery for the same commit can create another run.

To regenerate tests for a commit already live on staging, re-run that commit's deploy job in the connected app repository:

```bash
gh run list --repo sl-cloud/api-test-gateway --workflow deploy-staging.yml
gh run rerun <run-id> --repo sl-cloud/api-test-gateway
```

This redeploys the commit and re-sends the webhook with a fresh delivery id. If the commit is not the one currently live on staging, re-run the deploy job for the commit you want live afterwards.

For a run stuck in `failed` status, use the admin retry endpoint:

```bash
curl -sS -X POST "$CONTROL_PLANE_URL/api/v1/admin/runs/<run-id>/retry" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

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
