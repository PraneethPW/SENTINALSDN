# Workspace onboarding verification — Sentinel 1.3

Verified 1 November 2026. This section supersedes the shared-workspace registration behavior documented in the historical 1.2 record below.

- **59 backend tests passed** against a dedicated real PostgreSQL test database; **13 frontend tests passed**, TypeScript and the production build passed, and Ruff passed.
- Fresh email and verified Google registrations own separate empty workspaces. Existing approved research-lab membership stays intact. A never-approved public registration whose role was promoted without approval also migrates correctly; deliberately revoked team access remains restricted.
- Tests cover workspace-scoped collector ingestion, duplicate collector names, foreign batch-ID conflicts, history, CSV exports, users, assignment, incidents, mitigation commands, AI reports, WebSocket snapshots and cache keys. Scoped foreign keys protect related database records. Cross-workspace lookups/mutations return no foreign records.
- A fresh local account was registered through the actual API and then used through browser email sign-in. Its initial collectors, flows and incidents were empty. Its private setup bundle was downloaded, its included real Mininet lab was started, and measurements appeared only after actual counter windows arrived.
- Browser checks exercised workspace rename and persistence, live traffic, a genuine empty search result, stored-history search, CSV download, discovered switch inspection, and a member list containing only the workspace owner. The CSV contained its own collector ID and no original-lab collector ID.
- Stopping this workspace's collector produced an offline state, zero current rates and retained stored history. Revoking its key caused authentication rejection; a replacement self-contained bundle reconnected. Source labels distinguish an isolated Mininet lab from an existing SDN controller. The lab does not capture ordinary Mac traffic.
- The new Network setup layout fit a 390 × 844 viewport with no horizontal page overflow. Desktop and mobile screenshots are retained with the local verification artifacts. The test browser session was signed out.
- A private pre-migration Neon schema backup was restored to a separate local test database. Migration rehearsal preserved all **5,909** archived flow windows, migrated the one never-approved public account into a private workspace, and produced **zero inherited private flow windows**.
- The ML artifact and its published evaluation remain unchanged. They are shared pretrained research resources, not live accuracy estimates for new networks. Enforcement remains disabled. OpenRouter free-provider availability is external and was not represented as an invented success.

Production release verification is recorded after deployment. No test-only counter fixtures are inserted into the application databases.

---

# Sentinel 1.2 verification — 1 November 2026

Verified path: actual isolated Mininet packets → three Open vSwitch switches → private OS-Ken counter and LLDP discovery API → persistent collector spool → Railway API → integrity-checked Extra Trees → Neon PostgreSQL → authenticated WebSocket → React on Vercel.

## Released targets

- Frontend: https://sentinel-sdn.vercel.app/
- Vercel deployment: `dpl_29B8YmsKWYMmh6k7HxRnjnxLbSMb`, READY, staged HTML verified before promotion.
- API: https://api-production-5de58.up.railway.app/health/ready
- Railway deployment: `7164feaf-e1b8-4386-bd12-c75399663b96`, SUCCESS, liveness version `1.2.0`.
- Production database: Neon, TLS, dedicated `sentinel` schema.
- Cloud telemetry: `local-mininet-lab` on the development Mac's dedicated Colima profile, as requested.
- Independent local frontend/API: http://localhost:5180 / http://localhost:8100, own Docker PostgreSQL and collector.

## Results

| Area | Verification and result |
| --- | --- |
| Automated tests | **54 backend tests + 10 frontend component tests passed**, including real PostgreSQL integration; strict TypeScript and Vite production builds pass; Ruff passes |
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

The backend test runner emits one Starlette deprecation warning about its httpx test-client adapter; all tests pass. CI configuration runs the suites on a dedicated PostgreSQL service. The code release passed remote GitHub Actions: https://github.com/PraneethPW/SENTINALSDN/actions/runs/41285449536 (54 backend and 10 frontend checks, plus the production frontend build).

## Public entry and real identity verification

- `/` is a dedicated public landing page; `/auth/sign-in` and `/auth/register` are distinct email/Google entry routes. The console is at `/app`, protected before it mounts.
- The landing's animated numbers are fetched from the installed model's public metadata. No live flow, endpoint, collector, incident or account record is exposed by the anonymous facts endpoint.
- Desktop and 390×844 mobile landing/registration layouts were inspected. Scroll-linked movement, real model-value counters, glass cards, keyboard navigation, reduced motion and same-origin deep links were exercised.
- An account was registered through the actual independent local API. Browser email sign-in reached the pending-approval screen; telemetry and live-ticket requests returned 403. Administrator approval led to a viewer console with live measurements. Deactivation revoked the session and returned the browser to sign-in. This clearly labeled local QA account was then left inactive.
- The user completed **real Google registration locally**. Google's callback verified the identity and created a pending Google-only account in the local PostgreSQL database. The verified project owner's identity was then configured as a local administrator through the existing local administrator API; ordinary registrations remain pending viewers.
- The user authorized connecting Google to the **existing production administrator account**. The UI confirmed the persistent Google connection. A separate sign-out → Google sign-in → callback → authenticated live console flow was then completed successfully in production. A subsequent fresh Google sign-in also reached the independent local console.
- Google state-cookie, nonce, browser handoff, one-use exchange, origin restrictions, duplicate email protection and explicit authenticated account connection have PostgreSQL integration tests. Provider-boundary fixtures are confined to the isolated test runner; the browser verifications above used the actual Google provider and runtime credentials.
- A Google-page/browser log reported a transient MutationObserver error during OAuth; the real callback and subsequent authenticated console worked. This message is recorded rather than represented as a completely clean log across external provider navigation.

## Current live-model observation

The lab ran continuously through this release. Some long-running, low-packet ICMP windows were model-flagged despite the configured benign workload; they did not pass the minimum packet count for incident creation. This is additional evidence of domain/generalization limits, not a reason to relabel observations or claim production detection effectiveness. The landing displays the artifact's attributed public group-test metrics, not a live detection-accuracy estimate. Enforcement remains disabled.

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
