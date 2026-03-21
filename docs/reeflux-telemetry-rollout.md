# Reeflux Telemetry Rollout (Schema v2)

Date: 2026-03-21

## Why this rollout exists
Reef Status and pool telemetry now rely on an explicit Redis schema marker and seeded pool registry. This rollout ensures production data is prepared without fabricating activity.

## Preconditions
- Netlify env vars are configured:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- App branch deployed with latest telemetry code.

## Step-by-step rollout
1. Run dry-run migration:
```bash
cd /Users/cultureofelan/Desktop/Reeflux
REEF_MIGRATION_DRY_RUN=true npm run migrate:reef:schema-v2
```
2. Validate output contains:
   - target schema version `2`
   - known pool IDs in `after.knownPools`
3. Execute migration:
```bash
cd /Users/cultureofelan/Desktop/Reeflux
npm run migrate:reef:schema-v2
```
4. Deploy site/functions.
5. Verify production endpoints:
```bash
curl -s https://reeflux.com/.netlify/functions/stats | jq '.mode,.traffic_band,.active_agents_now,.pools|length'
curl -s 'https://reeflux.com/.netlify/functions/activity-feed?limit=5' | jq '.degraded,.events|length'
```

## Expected launch behavior at low traffic
- No fabricated counts.
- `active_agents_*`, join, and interaction metrics remain zero until real events are recorded.
- Reef Status presents truthful calm/limited copy.
- Pool cards/pages show intentional low-traffic states:
  - `quiet window`
  - `last activity: awaiting first event`
  - `No active agents in this current tide window.`

## Failure handling
- If migration fails, fix env access first and rerun (migration is idempotent).
- If Redis is unavailable, app remains accessible in limited telemetry mode with explicit copy.
