# One-click private research labs

Register or sign in, open **Network setup**, and click **Start my live lab**.
There is no collector download or terminal step for an end user. The trusted
research host starts an isolated Mininet/OVS network, an OS-Ken OpenFlow
controller, and a collector. Bounded ICMP and 64 Kbit/s UDP traffic runs between
its three hosts. Controller discovery and measured counter windows advance the
startup steps. Allow about 60–90 seconds after startup for the first flow.

Use **Live traffic** to inspect real flows, **Network topology** for discovered
switches and links, and **Intelligence** for the installed model's provenance.
**Stop lab** revokes ingestion immediately and requests container removal.
**Restart with a fresh network** creates a new network and collector identity;
persisted measurement and incident history stays in the same workspace.

## Host operation

The deployed API and frontend do not run Mininet. A private, outbound-only Python
host service on the research Mac reconciles authenticated desired state from the
API. No Docker socket or controller port is exposed publicly. Only the fixed
repository lab image can run; users cannot supply code, images, commands, or
controller addresses. Containers have no host mounts or published ports. The
privileged Mininet containers live inside the dedicated no-mount Colima Linux VM.
They share that trusted VM kernel; this is a bounded research service, not an
arbitrary untrusted-code execution platform.

The host service is installed automatically by `npm run local:up`. On macOS it
uses the `com.sentinel-sdn.lab-host` user LaunchAgent (starts at login, restarts on
failure); Linux uses a detached Python process (configure a service manager for
restart across reboots). Python 3.9+ stdlib, Node 22+, Docker and Compose are
required. The host only builds the trusted image after its source fingerprint
changes. Local core services and the local lab source work independently of
Railway, Neon, Vercel and OpenRouter. Initial image downloads require internet.

Private configuration: `backend/work/lab-host/config.json` (0600 in a 0700 folder).
It lists API endpoints, host tokens, Docker context and total capacity. Never
commit this file. `scripts/lab-host.mjs` restarts the configured service. Logs are
in the same private directory; image build output is in `image-build.log`.
The production endpoint must use the same long random `LAB_HOST_TOKEN` in Railway
and this private configuration; the local launcher generates its own independent
`LOCAL_LAB_HOST_TOKEN`. No cloud credential is needed for local labs.

The current Mac provides **two concurrent managed lab slots total**, shared by
local and deployed workspaces. Each lab is capped at 1 CPU, 512 MiB memory and
384 processes. Legacy owner lab containers are separate and remain untouched.
The host requires the Mac awake and Docker/Colima running. The console explicitly
shows host offline, preparing, or full; it does not manufacture a live feed.

## Lifecycle and boundaries

- PostgreSQL advisory locking reserves slots across API replicas. One active
  desired lab per workspace; request UUIDs make repeated starts/restarts safe.
- Actual Docker state marks network startup, an authenticated collector heartbeat
  marks controller discovery, and actual flow insertion marks measurements.
- Each run gets a separate, expiring, hash-stored collector credential bound to
  its workspace and exact collector ID. It cannot read another workspace, sign
  in, or impersonate a different collector. Manual collector keys are separate.
- Stop, restart, expiry and failure revoke that run's credential. A revision check
  rejects late startup reports; the worker removes a stale container on rejection.
- Sessions last at most 60 minutes, with a 15-minute idle limit when no console
  tab is visible. A visible console sends presence once per minute. Presence
  cannot extend the hard deadline or revive an expired session.
- The container also has a hard-deadline watchdog. The worker removes expired
  containers after wake/recovery; the API independently rejects expired uploads.
- A stop made while the host is offline shows cleanup pending. It cannot honestly
  promise immediate physical removal until the host acknowledges it.
- `npm run local:down` drains managed local labs before stopping the local API.
  It keeps production hosting active and retains database volumes.

The baseline lab generates ordinary bounded traffic. It does not capture the
user's home network, monitor arbitrary websites, or run an external DDoS attack.
The shared pretrained research model evaluates each real flow. Its public-data
holdout metrics are not an accuracy guarantee for this network. Automatic
mitigation stays disabled pending independent network validation.

## Verification

Lifecycle integration tests use a dedicated PostgreSQL test database; fabricated
test payloads never enter local or production application databases. The release
also verifies real browser Start → controller → measured flow → Restart → Stop,
container removal, tenant boundaries, mobile layout and independent local startup.
See the release verification record for the exact observed results.
