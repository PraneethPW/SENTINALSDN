# Sentinel Railway infrastructure

This file targets the single API service in the Sentinel-SDN project. Variables are unmanaged: secrets stay in Railway. It configures the Dockerfile builder, /health/ready, restart policy, and one US East Metal replica near Neon. Existing generated domains remain platform-managed.

From the repository root, install `npm ci`. `npm run infra:plan` previews changes; review them before `npm run infra:apply`. Source uploads run from backend with `npx --yes @railway/cli@5.71.0 up --service api`.

The platform configuration was applied and reviewed during setup. There is no deprecated railway.json. Do not point this whole-project configuration at an unrelated project; omitted resources can be removed by an infrastructure apply.
