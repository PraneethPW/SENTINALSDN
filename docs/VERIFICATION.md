# Sentinel 1.1 verification — 1 November 2026

Verified path: actual isolated Mininet packets → three Open vSwitch switches → private OS-Ken counter and LLDP discovery API → persistent collector spool → Railway API → integrity-checked Extra Trees → Neon PostgreSQL → authenticated WebSocket → React on Vercel.

## Released targets

- Frontend: https://sentinel-sdn.vercel.app/
- Vercel deployment: `dpl_ETPYptgD3okLT5JwEwmnM28mDHSP`, READY, staged HTML verified before promotion.
- API: https://api-production-5de58.up.railway.app/health/ready
- Railway deployment: `f50171f9-bbc4-4f4e-81cb-ac54b2a31c25`, SUCCESS, liveness version `1.1.0`.
- Production database: Neon, TLS, dedicated `sentinel` schema.
- Cloud telemetry: `local-mininet-lab` on the development Mac's dedicated Colima profile, as requested.
- Independent local frontend/API: http://localhost:5180 / http://localhost:8100, own Docker PostgreSQL and collector.

## Results

| Area | Verification and result |
| --- | --- |
| Automated tests | **41 backend tests + 6 frontend component tests passed**, including real PostgreSQL integration; strict TypeScript and Vite production builds pass; Ruff passes |
| Auth and roles | Actual local administrator, viewer and operator sign-ins; viewer has no account-mutation controls; unauthorized writes return 403; duplicate/invalid account rejection, last-admin protection, session revocation and password validation covered by integration tests |
| Investigations | Browser operator assigned an investigator and acknowledged a historical real lab flag with notes; acknowledgement survived reload; optimistic revisions reject concurrent overwrites in integration tests |
| Historical evidence | Browser searched actual PostgreSQL flow history and loaded 100 rows across cursor pages; edited filters invalidate the previous cursor; literal wildcard handling and malformed cursors tested; CSV export returns real stored observations |
| Realtime | 20 concurrent authenticated WebSockets received snapshots; two-client integration test received committed investigation changes within three seconds; one-use tickets, disallowed origins and invalid ranges tested |
| Shared fanout | One revision poll per API process at 500 ms, shared consistent snapshot caches, five-second clock refresh. Actual counter sampling remains approximately 30 seconds |
| Recovery | Local API intentionally stopped and restarted; browser displayed reconnecting and resumed without another sign-in. PostgreSQL container restarted; API recovered. Collector retained and delivered queued measured batches after the API interruption. A separate collector shutdown aged to offline while the console stayed connected; topology switched to offline markers |
| Local independence | `npm run local:up` built and ran PostgreSQL, API, trained inference, frontend and real Mininet traffic without deployed URLs, Neon or OpenRouter keys. Separate persistent volumes and generated local credentials; repeat startup preserves data/accounts |
| Discovery | Both local and deployed snapshots/browser showed **3 switches, 2 undirected LLDP links, 3 observed hosts**, with actual per-port bytes, drops and errors; keyboard switch inspection verified |
| Model | Active `group-20261101T055935Z`, Extra Trees, verified SHA-256, threshold 0.525. Production and local APIs returned this version. Old verdicts preserve original model versions |
| Live classification | Production latest-100 sample had zero model flags for the configured benign lab workload. This bounded observation is not a false-positive-rate estimate for other traffic |
| OpenRouter | Actual `/api/intelligence/explain` against a historical measured local-lab flag returned HTTP 200 and nonempty provider text. A temporary native API used the local DB and the configured free provider; it was shut down afterward. The completed report appeared in the ordinary live local UI. Core local configuration remains independent, with AI unavailable by default |
| Presentation | Warm graphite/olive/champagne theme, scroll progress and motion, reconnect/load states, explicit empty states. Tested 390×844 mobile layout: page width stayed 390; measured topology scrolls internally. Mobile motion toggle works; keyboard inspection and reduced-motion preference verified |
| Browser runtime | Inspected local and production sessions reported no warning/error console entries during final workflows |
| Dependency audit | Frontend production dependency audit reported zero vulnerabilities at verification time; this is not a security certification |
| Persistence | Numbered additive migration, schema isolation, transactional audit and revision events; retention and batch idempotency covered in real PostgreSQL tests |

The backend test runner emits one Starlette deprecation warning about its httpx test-client adapter; all tests pass. CI configuration runs the suites on a dedicated PostgreSQL service. Current remote run status is available in the repository’s GitHub Actions tab.

## Measured local concurrency

Two runs exercised 20 simultaneous dashboard reads and 20 authenticated WebSocket connections. Local dashboard-read p95 was **139.1 ms** in one run and **394.2 ms** during final verification alongside build/release work. The latest machine-readable result is retained in development scratch records. These small local checks do not establish production throughput, tail latency at large volumes, or an SLA.

## Machine-learning evidence and limits

Public source: attributed Mendeley SDN dataset, DOI `10.17632/jxpfjc64kr.1`, CC BY 4.0. Cleaning retained 19,748 rows. Training uses 72 endpoint/protocol groups (13,710 rows), validation 18 groups (1,988 rows), testing 30 groups (4,050 rows). An additional 360 actually measured benign windows from the controlled local workload are training-only adaptation data. The restarted later lab run was reserved for live checking.

| Public group-test metric | Result |
| --- | ---: |
| Attack precision | 96.49% |
| Attack recall | 84.75% |
| Accuracy | 92.37% |
| False-positive rate | 2.20% |
| ROC AUC | 0.98954 |
| TN / FP / FN / TP | 2313 / 52 / 257 / 1428 |

The configured lab gate passed, but five training-group validation folds varied substantially: recall **47.29–94.99%**, precision **59.09–94.74%**. The UI exposes this variation. Endpoint/protocol grouping proxies missing original capture IDs. This public benchmark has been inspected across iterations; it must not be represented as an untouched independent external test. There is no independently labeled production-network evaluation or probability calibration.

**API and collector mitigation remain disabled.** A scoped block and removal were read back from a real isolated switch during the earlier 27 October verification; that is mechanism evidence, not detection efficacy or a new full mitigation retest for this release. Test fixtures and public training rows are never inserted into production telemetry. Historical local false positives remain visible and attributable to their earlier model.

## Operating boundary

The deployed feed requires the Mac, Colima and cloud collector container to remain awake/running. Both lab containers use restart policies and supervised child processes, but they cannot report while the host is asleep. `npm run local:up` starts the dedicated VM; `local:down` only stops the independent local stack and preserves its volumes. A full Colima shutdown also stops the cloud feed.

This is a hardened, deployed **single-workspace monitoring application with real lab telemetry**. Enterprise SSO/MFA, multi-tenant isolation, independent model acceptance, restore drills and large-scale capacity certification remain outside the verified release. Use a new independently labeled target-network dataset and staged switch tests before enabling defensive enforcement.
