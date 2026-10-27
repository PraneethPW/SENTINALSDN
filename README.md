# Sentinel SDN

**Machine Learning-Based DDoS Attack Detection in Software Defined Networks.**

A React defense console backed by measured OpenFlow telemetry, PostgreSQL persistence, a trained Random Forest classifier, operator-controlled mitigation, and optional OpenRouter analysis. There is no seeded dashboard traffic, random alert generator, or invented model accuracy. The animated Three.js hero is explicitly decorative.

## Stack

| Layer | Implementation |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Three.js / React Three Fiber, Framer Motion |
| API | Python 3.12, FastAPI, psycopg 3 async pool, authenticated WebSockets |
| Database | Neon PostgreSQL in production; real PostgreSQL 17 for local verification |
| ML | scikit-learn Random Forest, five measured flow features, group-held-out evaluation |
| SDN | OpenFlow 1.3, Open vSwitch, controller-side collector; included OS-Ken controller and Mininet lab |
| AI | OpenRouter `openrouter/free`, optional, never in the detection or mitigation decision path |
| Deployment | Backend Docker image on Railway; frontend on Vercel |

## Repository

```text
Sentinel-SDN/
├── frontend/
│   ├── src/components/       # Three.js scene, measured charts, discovered switch membership
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

Requirements: Node 22+, Python 3.12, and PostgreSQL (Neon works locally too). Docker is only needed for the optional SDN lab.

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
pip install -e '.[dev]'
cp .env.example .env
```

Set `DATABASE_URL` to your own database, set a cryptographically random `COLLECTOR_TOKEN` of at least 32 characters, and set `MODEL_SHA256` to the actual artifact digest. Never commit `.env`. Generate the token and digest locally:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "import hashlib,pathlib; print(hashlib.sha256(pathlib.Path('artifacts/model.joblib').read_bytes()).hexdigest())"
python -m app.db
python -m app.admin your@email.com
uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log
```

The administrator command prompts securely for a password of at least 14 characters. There are no default production accounts. Create viewer/operator accounts with `--role viewer` or `--role operator`.

In another terminal:

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open the Vite URL and sign in. `VITE_API_URL` is public configuration; database credentials, collector secrets, and provider keys must never be put in a `VITE_*` variable.

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

On macOS, use a separate Colima profile (this project was verified using `sentinel-sdn`, 2 CPUs, 3 GiB RAM). Do not change an existing Docker context:

```bash
brew install colima docker
colima start sentinel-sdn --vm-type vz --cpus 2 --memory 3 --disk 12 --activate=false --ssh-config=false --mount none
cd backend
source .venv/bin/activate
python -m lab.manage build --context colima-sentinel-sdn
python -m lab.manage start --context colima-sentinel-sdn
python -m lab.manage logs --context colima-sentinel-sdn
```

For a cloud API, add `--api https://your-backend.up.railway.app` to the `start` command. On a Linux Docker host, use the appropriate context instead. Allow about 60 seconds for discovery, a baseline, and the first measured 30-second window. The frontend stream checks for changes every three seconds (plus database/network latency); this does not change the collector's sampling interval.

```bash
python -m lab.manage stop --context colima-sentinel-sdn
colima stop sentinel-sdn
```

## Dataset and actual model results

Source: Nisha Ahuja, Gaurav Singal, Debajyoti Mukhopadhyay (2020), **DDOS attack SDN Dataset**, Mendeley Data, V1, [DOI 10.17632/jxpfjc64kr.1](https://data.mendeley.com/datasets/jxpfjc64kr/1), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The source contains **104,345 measurements from a Mininet/Ryu lab**, with benign, TCP SYN, UDP, and ICMP scenarios. These are measured laboratory flows, not production traffic.

The preparation script downloaded the publisher's archive, removed 5,837 invalid/idle measurements (including negative counter deltas), removed 78,760 repeated observations from flow/port joins, and retained **19,748 observations**: 13,317 benign and 6,431 attack. Source and prepared SHA-256 values, attribution, transformations, and counts are recorded in `artifacts/model.json`.

Training held out 30 endpoint/protocol groups (4,050 rows); the other 90 groups (15,698 rows) were used for training. Both directions of an endpoint pair stay in the same group across all switches and timestamps. Original independent capture IDs are unavailable, so this is a **flow-family holdout**, not an independent-capture or production-generalization claim. IPs, timestamps, switch IDs, labels, and group IDs are not input features.

Measured at the configured **0.90 attack threshold**:

| Metric | Result |
| --- | ---: |
| ROC AUC | 0.9898 |
| Average precision | 0.9849 |
| Attack precision | 99.00% |
| Attack recall | 64.69% |
| Accuracy | 85.04% |
| Confusion matrix (TN, FP / FN, TP) | 2354, 11 / 595, 1090 |

The threshold trades recall for precision. Do not describe ROC AUC as accuracy. These results apply to the held-out public lab data; they do not establish production effectiveness. Mitigation stays disabled until the deployment network is independently validated. Model estimates are not calibrated certainties.

To reproduce the public dataset workflow:

```bash
python -m ml.prepare_mendeley
python -m ml.train data/windows.csv
```

Training prints the new artifact digest. Update `MODEL_SHA256` and restart the backend. Only trusted, operator-installed model artifacts may be loaded; joblib is not a safe format for untrusted uploads. There is no web model-upload endpoint.

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
- Operators can acknowledge/resolve incidents and save investigation notes. Viewers have read access only.
- Set `MITIGATION_ENABLED=true` on the API and `ALLOW_MITIGATION=true` on the collector only after validation. A block matches source IP, destination IP, protocol, and destination port when available. It uses a unique cookie, priority 50,000, and a 300-second hard timeout. It does not block an entire switch or network.
- Commands are queued in PostgreSQL with leases. The collector installs the rule and reads it back from the actual switch. Only then is it recorded as enforced. Revocation is also verified. Unconfirmed or failed commands are shown honestly. Commands over two minutes old are rejected by the collector.
- Optional `OPENROUTER_API_KEY` enables summaries through `openrouter/free`. Counts and model evidence are sent to OpenRouter; IPs, user identity, and investigation notes are excluded. Free providers have quotas and variable availability. AI failure never disables detection, and AI never executes a rule.

## Deployment and verification

See [deployment runbook](docs/DEPLOYMENT.md), [security and operations](docs/OPERATIONS.md), and [verification record](docs/VERIFICATION.md). Production activation requires a usable Neon URL, authenticated Railway access, and exact frontend/backend origins. The local PostgreSQL fallback is for development and is never substituted for Neon in production mode.

```bash
# backend unit/validation tests
cd backend && source .venv/bin/activate
pytest -q
# full integration suite: dedicated database whose name includes _test
TEST_DATABASE_URL=postgresql://user:password@localhost/sentinel_test pytest -q
# frontend strict TypeScript and production build
cd ../frontend && npm run build
```

Test fixtures exist only in the isolated test database. They are never used as product telemetry or bundled into the UI. GitHub Actions runs both build and real PostgreSQL integration tests. Database migrations use a dedicated sentinel schema, are idempotent, and are serialized with a transaction advisory lock. Retention runs automatically one minute after startup and hourly thereafter, with a database lock across replicas. Keep the provided v1 schema migration immutable when adding future numbered migrations.
