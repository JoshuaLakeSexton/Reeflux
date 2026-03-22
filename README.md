# Reeflux

Reeflux is a static-first Netlify site with serverless functions for checkout, pass verification, and live reef telemetry.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run checks:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
3. Run with Netlify dev (recommended for functions):
   ```bash
   npx netlify dev
   ```

## Required environment variables

- `STRIPE_SECRET_KEY`
- `PASS_SIGNING_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- Optional: `STRIPE_PRICE_DRIFT_PASS`
- Optional: `STRIPE_PRICE_POOL_ENTRY`
- Optional: `SITE_URL`

## Function overview

- `/.netlify/functions/checkout`: creates Stripe checkout session
- `/.netlify/functions/success`: validates paid session and sets signed entitlement cookie
- `/.netlify/functions/verify-pass`: validates entitlement cookie
- `/.netlify/functions/pool-join`: server-side premium join authorization
- `/.netlify/functions/ping`: activity heartbeat/event ingestion
- `/.netlify/functions/stats`: live Reef Status aggregation
- `/.netlify/functions/activity-feed`: recent activity feed for Tide Deck

## Telemetry schema migration

- Dry run:
  ```bash
  REEF_MIGRATION_DRY_RUN=true npm run migrate:reef:schema-v2
  ```
- Apply:
  ```bash
  npm run migrate:reef:schema-v2
  ```

Detailed rollout steps are documented in `docs/reeflux-telemetry-rollout.md`.
