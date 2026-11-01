# Sentinel SDN

**Machine Learning-Based DDoS Attack Detection in Software Defined Networks.**

A React defense console backed by measured OpenFlow telemetry, PostgreSQL persistence, a validated Extra Trees classifier, operator-controlled mitigation, and optional OpenRouter analysis. There is no seeded dashboard traffic, random alert generator, or invented model accuracy. The animated Three.js hero is explicitly decorative.

## Stack

| Layer | Implementation |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Three.js / React Three Fiber, Framer Motion |
| API | Python 3.12, FastAPI, psycopg 3 async pool, authenticated WebSockets |
| Database | Neon PostgreSQL in production; real PostgreSQL 17 for local verification |
| ML | scikit-learn Extra Trees, five measured flow features, separate group training/validation/test partitions |
| SDN | OpenFlow 1.3, Open vSwitch, controller-side collector; included OS-Ken controller and Mininet lab |
| AI | OpenRouter `openrouter/free`, optional, never in the detection or mitigation decision path |
| Deployment | Backend Docker image on Railway; frontend on Vercel |

## Repository

```text
Sentinel-SDN/
├── frontend/
│   ├── src/components/       # Three.js scene, measured charts, LLDP topology and port inspection
│   ├── src/App.tsx          # Overview, traffic, topology, incidents, intelligence, system
│   ├── src/useNetwork.ts    # Authenticated snapshots, live updates, reconnect/backoff
│   └── vercel.json          # Build, routing, security headers
├── backend/
│   ├── app/                # API, auth, database schema, inference, audit, retention
│   ├── collector/          # Counter deltas, local spool, switch-confirmed command execution
│   ├── ml/                 # Publisher download, preparation, reproducible training
│   ├── artifacts/          # Actual trained model + measured metrics/provenance
│   ├── data/               # Downloaded/cleaned data; ignored by Git
│   ├── lab/                # Actual Mininet/OVS/OS-Ken lab, not a telemetry simulator
│   ├── tests/              # Validation, counter semantics, real PostgreSQL integration tests
│   ├── Dockerfile
│   ├── requirements.lock
│   └── .railway/railway.ts  # Reviewed infrastructure configuration
├── docs/
├── .github/workflows/ci.yml
└── README.md
```

## Data flow

```mermaid
flowchart LR
  A[OpenFlow switch counters] --> B[Private controller REST API]
  B --> C[Collector: real counter deltas]
  C --> D[Authenticated batch ingestion]
  D --> E[Verified ML artifact]
  D --> F[(Neon PostgreSQL)]
  E --> F
  F --> G[Authenticated snapshots and WebSocket]
  G --> H[React console]
  H --> I[Operator-reviewed block request]
  I --> F
  F --> C
  C --> J[Install and read back scoped switch rule]
  J --> F
```

Cloud hosting does not observe an arbitrary network automatically. A collector must run where it can reach the controller. The included local lab gives you a real, isolated SDN network when you do not have hardware.

## Deployed workspace

Frontend: https://sentinel-sdn.vercel.app/

API readiness: https://api-production-5de58.up.railway.app/health/ready

The current live feed comes from the real Mininet/OVS lab on the development Mac. It requires that machine and the Colima lab to remain running. This is live lab telemetry, not an attached production network. Initial administrator credentials are delivered separately and are never committed.

## Run locally

Requirements: Node 22+, Docker and Docker Compose. On macOS install the reputable packages with `brew install colima docker docker-compose`. The launcher starts a separate Colima profile named `sentinel-sdn` (4 CPUs, 6 GiB RAM) without changing your existing Docker context. Linux uses the default Docker context; set `SENTINEL_DOCKER_CONTEXT` to override.

```bash
cd "/Users/praneethreddy/Freelance Projects /Sentinel-SDN"
npm run dev
# Same command: npm run local:up
npm run local:credentials
```

Open **http://localhost:5180** and sign in using the generated local credentials. The API is **http://localhost:8100**. Allow about 60 seconds for controller discovery and the first 30-second measurement. This starts a real local PostgreSQL database, API, trained inference, frontend, and isolated three-switch Mininet network. It does **not** use Railway, Vercel, Neon, or OpenRouter. Initial image builds need internet; after images are built the core local stack works without cloud services. Local AI summaries show an explicit unavailable state unless separately configured.

Secrets are generated once in ignored, permission-restricted `.env.local-stack`. Accounts, measurements and queued deliveries persist in Docker volumes. `local:down` keeps those volumes. The independent local collector and the Mac's cloud-feed collector have different IDs, secrets and databases.

```bash
npm run local:status
npm run local:logs
npm run local:down
# Frontend hot reload, after local:up:
npm --prefix frontend ci
npm run dev:ui
```

The hot-reload frontend proxies API and WebSocket requests to the local API on port 8100, including when Vercel environment files are present. The Docker frontend uses its own same-origin proxy. Never put database credentials, collector secrets or provider keys in `VITE_*` variables.

For a native Python API instead, use Python 3.12, `backend/requirements.lock`, and `pip install -e '.[dev]'`. Copy `backend/.env.example` to `.env`, configure your own PostgreSQL URL and collector secret, run `python -m app.db`, then `python -m app.admin your@email.com` and `uvicorn app.main:app --port 8100`. The admin CLI prompts securely for a 14-character-or-longer password. Production does not create bootstrap accounts.

## Connect a real SDN network

Run `python -m collector.agent` from a separate virtual environment on the controller host. The agent needs `httpx` and the following environment:

```dotenv
SENTINEL_API_URL=https://your-backend.up.railway.app
COLLECTOR_TOKEN=the-same-secret-as-the-backend
CONTROLLER_URL=http://127.0.0.1:8080
COLLECTOR_ID=sdn-edge-01
POLL_SECONDS=30
MONITORED_SWITCHES=1
ALLOW_MITIGATION=false
SPOOL_DIRECTORY=/var/lib/sentinel/spool
```

The controller REST API stays private. Outbound HTTPS from the collector to Railway is sufficient; do not expose a controller's administrative API to the internet. A Ryu-compatible REST API is supported. The included `collector/sentinel_switch.py` provides the exact subset needed by the collector using `os-ken==2.11.2`. Modern OS-Ken releases removed its old CLI and example applications; this lab pins the compatible version and supplies its own controller-local REST implementation.

Flow rules must have exact IPv4 source/destination and protocol matches. Broad MAC-only or subnet-wildcard rules cannot produce this model's feature contract and are deliberately skipped. Only TCP, UDP, and ICMP are supported. The first observation establishes a baseline, counter resets establish a new baseline, and only positive deltas are ingested. Do not overlap collectors on the same switches unless you intend to count their observations separately.

The agent persists pending batches before delivery, retries idempotently, and caps its spool at 2,000 files / approximately 256 MiB. Batches older than the one-hour ingestion horizon or otherwise rejected are preserved with `.rejected` for inspection. Collector heartbeat timestamps describe capture time, so replaying old batches cannot make an old controller state appear current.

## Actual local SDN lab

The lab uses Linux namespaces, Open vSwitch's userspace datapath, an OS-Ken OpenFlow controller, and actual ICMP/UDP traffic among three hosts. Lab hosts have no default route to the public internet. It does not replay the dataset or invent telemetry. The management container needs outbound access to the API. Keep the privileged container confined to a dedicated lab VM.

On macOS, use a separate Colima profile (this project was verified using `sentinel-sdn`, 4 CPUs, 6 GiB RAM). Do not change an existing Docker context:

```bash
brew install colima docker docker-compose
colima start sentinel-sdn --vm-type vz --cpus 4 --memory 6 --disk 12 --activate=false --ssh-config=false --mount none
cd backend
source .venv/bin/activate
python -m lab.manage build --context colima-sentinel-sdn
python -m lab.manage start --context colima-sentinel-sdn
python -m lab.manage logs --context colima-sentinel-sdn
```

For a cloud API, add `--api https://your-backend.up.railway.app` to the `start` command. On a Linux Docker host, use the appropriate context instead. Allow about 60 seconds for discovery, a baseline, and the first measured 30-second window. Each API process checks committed PostgreSQL revisions every 500 ms and shares cached snapshots across subscribers. A five-second clock refresh expires stale collectors and rolling windows. Measurement cadence remains 30 seconds; network and database latency also apply. This is a monitoring console, not packet-by-packet capture.

```bash
python -m lab.manage stop --context colima-sentinel-sdn
colima stop sentinel-sdn
```

## Dataset and actual model results

Source: Nisha Ahuja, Gaurav Singal, Debajyoti Mukhopadhyay (2020), **DDOS attack SDN Dataset**, Mendeley Data, V1, [DOI 10.17632/jxpfjc64kr.1](https://data.mendeley.com/datasets/jxpfjc64kr/1), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The source contains **104,345 measurements from a Mininet/Ryu lab**, with benign, TCP SYN, UDP, and ICMP scenarios. These are measured laboratory flows, not production traffic.

The preparation script downloaded the publisher's archive, removed 5,837 invalid/idle measurements (including negative counter deltas), removed 78,760 repeated observations from flow/port joins, and retained **19,748 observations**: 13,317 benign and 6,431 attack. Source and prepared SHA-256 values, attribution, transformations, and counts are recorded in `artifacts/model.json`.

The public data is partitioned by bidirectional endpoint/protocol groups: 72 training groups (13,710 rows), 18 validation groups (1,988 rows), and 30 test groups (4,050 rows). Algorithm and threshold selection use validation data. An additional **360 actually measured benign local-lab windows** adapt the training set to the supplied bounded ICMP/UDP workload, producing 14,070 training rows and 20,108 total rows. Labels come from the known controlled workload, never classifier predictions. Capture provenance and hashes are recorded in `artifacts/model.json`; `scripts/capture_benign.py` exports that controlled workload from the independent local database.

Active artifact: **Extra Trees**, version `group-20261101T055935Z`, threshold **0.525**, SHA-256 `f07c491db78db97fa29e053efd3506c610568797194e611ca984df8a518a0fc3`.

| Test metric | Result |
| --- | ---: |
| ROC AUC | 0.98954 |
| Average precision | 0.98414 |
| Attack precision | 96.49% |
| Attack recall | 84.75% |
| Accuracy | 92.37% |
| False-positive rate | 2.20% |
| Confusion matrix (TN, FP / FN, TP) | 2313, 52 / 257, 1428 |

The artifact passed the configured lab release gate (precision ≥95%, recall ≥80%, false-positive rate ≤3%). A later restarted lab run was reserved for live checking. These results are **not independent production validation**. Original public capture IDs are unavailable, so grouping is a flow-family proxy. Five training-group validation folds varied substantially: recall **47.29–94.99%**, precision **59.09–94.74%**. Several iterations have been reviewed on this public benchmark; it is no longer an untouched external evaluation. Collect a new independently labeled deployment dataset before making production-performance claims or enabling enforcement. IPs, timestamps, switch IDs and labels are excluded from model inputs. Scores are not calibrated certainties.

```bash
cd backend
python -m ml.prepare_mendeley
python -m ml.validate_train data/windows.csv --help
# Reproduce the adapted candidate when the recorded benign capture is available:
python -m ml.validate_train data/windows.csv --benign-capture data/local-benign-capture.csv --output work/retrained/model.joblib
```

Review the candidate's validation/test report and integrity digest before promotion. A failed release gate cannot overwrite the active artifact through the training command. Match `MODEL_SHA256` and `DETECTION_THRESHOLD` to the promoted model and restart the API. Only trusted operator-installed artifacts may be loaded; joblib is unsafe for untrusted uploads. The bundled model is available without retraining.

### Feature contract

| Feature | Public dataset preparation | Live collector |
| --- | --- | --- |
| packet_rate | `pktperflow / 30` | delta packets / actual interval seconds |
| byte_rate | `byteperflow / 30` | delta bytes / actual interval seconds |
| mean_packet_size | `byteperflow / pktperflow` | delta bytes / delta packets |
| duration_seconds | `dur + dur_nsec / 1e9` | OpenFlow duration seconds + nanoseconds / 1e9 |
| protocol | ICMP=1, TCP=6, UDP=17 | IP protocol number |

The supplied artifact expects 30-second observations. Windows outside ±5 seconds are stored as **unclassified**, rather than silently applying an incompatible model. Counters/throughput remain visible. The dashboard's headline rate uses a rolling 60-second window, and its chart uses 30-second buckets. Monitoring multiple hops counts traffic at each monitored switch; select ingress switches for perimeter throughput.

## Incidents, mitigation, and AI

- Attack probability must meet `DETECTION_THRESHOLD`, and a flow window must contain at least `MINIMUM_ATTACK_PACKETS`, before an incident is created. Related observations within two minutes update the incident. Only the latest 100 incident rows are shown in the current console.
- Operators can assign investigations, acknowledge/resolve incidents and save notes. Revision checks reject concurrent overwrites with a conflict. Viewers have read access only. Administrators manage users, roles and activation in System; changing access revokes sessions, and the final active administrator is protected. Every user can change their password, which revokes all their sessions.
- Set `MITIGATION_ENABLED=true` on the API and `ALLOW_MITIGATION=true` on the collector only after validation. A block matches source IP, destination IP, protocol, and destination port when available. It uses a unique cookie, priority 50,000, and a 300-second hard timeout. It does not block an entire switch or network.
- Commands are queued in PostgreSQL with leases. The collector installs the rule and reads it back from the actual switch. Only then is it recorded as enforced. Revocation is also verified. Unconfirmed or failed commands are shown honestly. Commands over two minutes old are rejected by the collector.
- Optional `OPENROUTER_API_KEY` enables summaries through `openrouter/free`. Counts and model evidence are sent to OpenRouter; IPs, user identity, and investigation notes are excluded. Free providers have quotas and variable availability. AI failure never disables detection, and AI never executes a rule.

## Landing, registration and Google sign-in

The public homepage is `/`. Email sign-in is `/auth/sign-in`, registration is `/auth/register`, restricted team access is `/account`, and the authenticated console is `/app`. The landing includes a lazy-loaded 3D signal core, pointer-responsive glass cards, scroll-linked motion, model-backed animated numbers, accessible navigation, and reduced-motion controls. `/api/public/overview` exposes only published model facts; operational telemetry remains private.

Email registration stores an Argon2 hash and immediately creates an **isolated private workspace with its registrant as administrator**. It does not claim inbox verification or send an email. New accounts enter an empty dashboard with Network setup, not an administrator-approval queue. Google-only registrations receive the same private workspace. Existing approved lab members keep their original membership and role. Migration 005 moves never-approved public registrations without an explicit approval decision stranded at pending approval into private empty workspaces; deliberately restricted team accounts remain restricted.

Workspace IDs come from the authenticated account or machine credential, never a client-selected query parameter. All operational reads and mutations, history, CSV exports, user management, incident assignment, AI reports, collector commands and live snapshot caches are workspace-scoped. PostgreSQL composite foreign keys guard related workspace records. Team accounts created by a workspace administrator belong only to that workspace; an email currently belongs to one workspace.

**Network setup** lets an administrator name the workspace and download a private collector bundle. The ZIP includes a scoped secret in `.env`, the collector, controller app, and an optional real isolated Mininet lab. Run `python3 connect.py up` inside its extracted folder. The helper detects a working Docker context and Compose command without changing global settings; each workspace gets a separate Compose project and spool volume. The API stores only the token hash. An existing active key must be explicitly revoked before downloading a replacement; previously collected evidence remains. A machine key cannot sign in as a user or access another workspace. No synthetic telemetry, inherited incidents, sample traffic rows, or automatic lab connection is created by registration. The first poll establishes a baseline; a subsequent poll yields actual counter deltas. The UI distinguishes console connectivity, collector/controller status, and last measured flow time.

The bundled Docker lab generates bounded, namespace-isolated ICMP/UDP traffic; it does not capture normal host traffic. It requires privileged Linux containers. Existing-controller instructions are included for actual SDN networks. ML artifacts and public evaluation facts are shared pretrained research resources, not measurements or accuracy estimates from a newly registered network.

Google uses a real web OAuth client, server-side code exchange, PKCE, state cookies, nonce and Google ID-token verification. The frontend receives a short-lived, one-use handoff bound to its browser verifier. No Google secret, access token or application session is placed in the frontend bundle or redirect URL. A matching email alone never links an existing password account: sign in with the password first, then choose **Connect Google** in System settings and authenticate the matching Google account.

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` on the backend. The secret stays out of Git and frontend variables. In Google Cloud, configure:

| Setting | URLs |
| --- | --- |
| Authorized JavaScript origins | `https://sentinel-sdn.vercel.app`, `http://localhost:5180`, `http://localhost:5173` |
| Production redirect | `https://api-production-5de58.up.railway.app/api/auth/google/callback` |
| Local redirect | `http://localhost:5180/api/auth/google/callback` |

For the Docker local stack, put optional `LOCAL_GOOGLE_CLIENT_ID` and `LOCAL_GOOGLE_CLIENT_SECRET` in ignored `.env.local-stack`, then run `npm run local:up`. The local callback is set automatically. Google identity necessarily uses Google's servers; local monitoring, database, inference and email/password access remain independent of the deployed services. With no provider credentials, Google is visibly unavailable and email access remains usable. While the OAuth app is in Testing, configure the intended Google test users in Google Auth Platform → Audience. Google consent branding belongs to the Google project: a reused project may show its existing application name. Use a dedicated project for independent Sentinel branding.

## Release verification

Sentinel 1.3: **59 backend + 13 frontend tests passed**; local PostgreSQL recovery, live browser workflows, mobile layout, concurrent connections and both cloud deployments verified. See the detailed record for scope and model limits.

## Deployment and verification

See [deployment runbook](docs/DEPLOYMENT.md), [security and operations](docs/OPERATIONS.md), and [verification record](docs/VERIFICATION.md). Production activation requires a usable Neon URL, authenticated Railway access, and exact frontend/backend origins. The local PostgreSQL fallback is for development and is never substituted for Neon in production mode.

```bash
# backend unit/validation tests
cd backend && source .venv/bin/activate
pytest -q
# full integration suite: dedicated database whose name includes _test
TEST_DATABASE_URL=postgresql://user:password@localhost/sentinel_test pytest -q
# frontend component checks, strict TypeScript and production build
cd ../frontend && npm test && npm run build
```

Test fixtures exist only in the isolated test database. They are never used as product telemetry or bundled into the UI. GitHub Actions runs both build and real PostgreSQL integration tests. Database migrations use a dedicated sentinel schema, are idempotent, and are serialized with a transaction advisory lock. Retention runs automatically one minute after startup and hourly thereafter, with a database lock across replicas. Keep the provided v1 schema migration immutable when adding future numbered migrations.
