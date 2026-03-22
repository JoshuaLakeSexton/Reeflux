# Reef Schema Migration v2

Date: 2026-03-21
Migration ID: `2026-03-21-reef-schema-v2`

## Purpose
- Formalize the live telemetry schema marker used by Reef Status and pool telemetry.
- Ensure known pool IDs are seeded in Redis so low-traffic launch states stay complete.
- Ensure service first-seen timestamp exists for uptime reporting.

## Keys Touched
- `reef:schema:version` set to `2`
- `reef:pools:known` seeded with:
  - `tide`
  - `ambient`
  - `fractal`
  - `sandbox`
- `reef:service:first_seen_at` set if absent
- `reef:migrations:applied[2026-03-21-reef-schema-v2]` set to ISO timestamp

## Execution
```bash
npm run migrate:reef:schema-v2
```

Dry-run:
```bash
REEF_MIGRATION_DRY_RUN=true npm run migrate:reef:schema-v2
```

## Rollback
- This migration is additive/idempotent.
- Rollback normally means redeploying previous app code; no destructive key deletes are required.
