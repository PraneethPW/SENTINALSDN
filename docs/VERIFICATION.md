# Verification record — 27 October 2026

The verified story is: real packets in an isolated Mininet network → Open vSwitch counters → private OS-Ken REST API → durable collector → Railway ingestion → verified Random Forest inference → Neon PostgreSQL → authenticated WebSocket → React on Vercel.

## Results

| Boundary | Evidence |
| --- | --- |
| Frontend | Strict TypeScript and Vite production build pass; Vercel production deployment READY at https://sentinel-sdn.vercel.app/ |
| Backend | Docker image built successfully locally and on Railway; HTTPS readiness returns 200 with a live Neon connection |
| Identity | Initial admin created without default credentials; deployed frontend sign-in succeeded; credentials delivered separately |
| Cross-origin requests | Production CORS preflight returns the exact Vercel origin; authenticated snapshot returns 200 |
| Telemetry | Actual ICMP and bounded 64 Kbit/s UDP streams among isolated namespaces; collector discovers the switch and posts measured delta windows to Railway |
| Persistence and inference | Live Neon snapshots contain observed protocol 1/17 records, timestamps, counts, model version, and actual benign verdicts; historical training rows are never inserted into the live database |
| Live interface | Browser shows Stream connected, one discovered switch, roughly 140 Kbit/s of actual lab traffic, and measured rows that update over time; observed values vary with the running network |
| Controller response | A scoped temporary block was installed in the real switch and read back as enforced; deletion was read back as revoked. This validation command was a controlled test, not a fabricated attack incident |
| Machine learning | Model trained on cleaned, attributed public Mendeley measurements; SHA-256 verified on load; measured holdout metrics recorded in the model card and README |
| OpenRouter | Live authenticated provider request returned HTTP 200 and nonempty text; AI remains optional and is never an enforcement authority |
| Isolation | Application tables live in the sentinel schema. Integration tests use a different PostgreSQL database whose name must contain _test |
| Tests | 27 tests pass: validation, real counter deltas/resets, auth/roles/rate limits, batch idempotency, real model→incident grouping, real PostgreSQL persistence, one-use WebSocket tickets, mitigation states, model-integrity checks, rate/bucket units, TLS configuration, and retention |
| Audit/retention | Important actions are audited; automatic hourly retention has a cross-replica database lock; its deletion/preservation behavior is verified against PostgreSQL |
| Infrastructure | Reviewed Railway IaC config applies only safe updates to this project's API; secrets stay unmanaged; readiness healthcheck and US East placement are configured |
| Browser QA | Desktop and narrow viewport layouts inspected; sign-in, navigation, actual live rows, model information, and connection states verified; no browser warning/error logs were present in the inspected production session |

The test runner reports one dependency deprecation warning about Starlette's httpx test-client adapter; tests still pass. GitHub Actions is supplied but has not been run on a remote GitHub repository by this setup.

## Measured model limits

The source dataset contains 104,345 lab measurements. Cleaning retained 19,748 observations after invalid/idle-window and repeated flow/port-join removal. A bidirectional endpoint/protocol family holdout left 4,050 test rows. At the 0.90 threshold, attack precision is 99.00%, attack recall is 64.69%, ROC AUC is 0.9898, and accuracy is 85.04%.

These are public-lab holdout results, not an independent deployment-network evaluation. The original dataset lacks capture IDs, so flow-family grouping is explicitly a proxy. The model cannot be represented as production-validated. Both API and collector mitigation are disabled in the delivered running configuration. The real switch response mechanism was separately exercised in the isolated lab.

## Running environment and practical limits

- Frontend: https://sentinel-sdn.vercel.app/
- Backend readiness: https://api-production-5de58.up.railway.app/health/ready
- Railway project: https://railway.com/project/115fbbad-e7c9-448c-849c-aab8099ef0a0
- Database: Neon, TLS, dedicated sentinel schema; credentials are not recorded here.
- Live collector: local-mininet-lab inside the dedicated Colima sentinel-sdn VM on the development Mac.

The live feed requires that Mac/VM/lab to stay running. Stopping it causes collector status to age to offline. A physical or organizational SDN network has not been connected. The backend samples flow counters every 30 seconds; the UI subscribes to persisted snapshots with a three-second delay between polls plus execution/network time. This is flow-level monitoring, not packet-by-packet capture or physical link discovery.

No external load/capacity or enterprise security certification was performed. The single-workspace account model, free AI quota, public dataset generalization limits, and observed-switch throughput semantics are documented in README and OPERATIONS.md. Configure organization-specific identity, backups/restore, alerting, capacity, and independent model evaluation before using this as a production defense control.
