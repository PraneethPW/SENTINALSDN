# Railway + Neon + Vercel

## Neon

Use a dedicated database/branch for this project. In the Neon console, select **Connect**, select the intended database and role, and copy the complete pooled PostgreSQL URL, including its actual password, `sslmode=require`, and `channel_binding=require`. A string containing asterisks cannot authenticate. Never put the URL in frontend settings or Git.

Keep schema ownership separate from runtime access for a multi-user deployment. This initial container runs the versioned additive migrations before starting. To enforce a least-privilege runtime role, run migrations as a separate release step and adapt `entrypoint.sh` so the runtime only starts Uvicorn. Use a direct Neon endpoint for administrative/session-level tasks if your pooler configuration does not support them; application locks here are transaction-scoped.

## Railway backend

Create the project in the chosen Praneeth_Reddy workspace. Use `backend` as the service root, Dockerfile as builder, and `/health/ready` as healthcheck. The deployed service is defined in `backend/.railway/railway.ts`; install root dependencies with `npm ci`, review `npm run infra:plan`, then apply the reviewed changes. Variables remain unmanaged by IaC so secrets never enter source. The deployed API uses US East Metal near the Neon US East database, and the generated domain targets Railway's injected port 8080. If deploying the local directory via the Railway CLI, run from `backend`. It includes the verified public-data model with controlled benign-lab adaptation; raw training data and all `.env` files are excluded from the Docker context.

Set these service variables through Railway's Variables UI, or a secure credential workflow:

| Variable | Value |
| --- | --- |
| ENVIRONMENT | production |
| DATABASE_URL | full Neon connection URL with TLS |
| CORS_ORIGINS | exact HTTPS Vercel origin; comma separated if multiple |
| COLLECTOR_TOKEN | cryptographically random secret, ≥32 characters |
| MODEL_PATH | artifacts/model.joblib |
| MODEL_SHA256 | SHA-256 of the artifact actually deployed |
| DETECTION_THRESHOLD | 0.525 (must match the promoted artifact) |
| MINIMUM_ATTACK_PACKETS | 100 |
| MITIGATION_ENABLED | false until deployment validation |
| RETENTION_DAYS | 7 (configurable 1–90) |
| OPENROUTER_API_KEY | optional provider key |
| OPENROUTER_MODEL | openrouter/free |

No secrets are needed during image build. The Docker container runs as a non-root user. Railway provides `PORT`. Generate a Railway HTTPS domain and record it. Do not enable request logging of WebSocket query strings; tickets are one-use and expire after 30 seconds but are still credentials.

Create the first account from a trusted environment using this project's admin CLI against Neon. For the CLI, enter the production URL securely into a local ignored environment file, or use Railway's authorized shell with the deployed image. Do not put passwords on command lines. There is no public registration endpoint.

## Vercel frontend

Create a Vite project with Root Directory `frontend`, Build Command `npm run build`, and Output Directory `dist`. Set only `VITE_API_URL=https://the-actual-backend.up.railway.app` in the frontend environment. Redeploy whenever that URL changes because Vite embeds it at build time.

Use the final Vercel origin in Railway's `CORS_ORIGINS`. Add individual preview origins explicitly; do not use `*`. `vercel.json` allows API/WebSocket connections to Railway's `*.up.railway.app` domains. If you use a custom API domain, add that exact HTTPS/WSS origin to the CSP `connect-src` and redeploy.

## Collector and release verification

1. Point the real collector or isolated lab at the Railway HTTPS API with the matching collector token. Keep the controller's REST API private.
2. Verify `/health/ready`, sign-in, one-use WebSocket tickets, collector heartbeat, fresh flow timestamps, and a live chart after two samples.
3. Verify the model version, digest, feature contract, public dataset provenance, and held-out metrics in Intelligence.
4. Use independent network captures to validate false positives/negatives. Do not reuse the public test set for model tuning.
5. If mitigation is needed, enable it on both services and verify a scoped temporary rule in the actual switch. Verify revocation and hard timeout before use outside the lab.
6. Check that API failures and expired credentials produce visible states, and that OpenRouter quota failure leaves detection operational.
7. Configure an external monitor for `/health/ready` and alert on missing collector heartbeats. Set resource/concurrency limits and assess your expected volume before production exposure.

The running API automatically enforces retention after its first minute and hourly thereafter, with a PostgreSQL advisory lock across replicas. It clears expired sessions/tickets/attempts and audits each cleanup. For a manual run, use `python -m app.maintenance`; no additional cron service is required. Incident and audit retention is intentionally separate so investigation history is preserved; define a policy appropriate to your organization before extended operation.

The code does not provision a paid database, raise an account's spending limit, or change unrelated Railway services. A connected account's usage cap can prevent a service from remaining online; inspect available capacity before deployment.
