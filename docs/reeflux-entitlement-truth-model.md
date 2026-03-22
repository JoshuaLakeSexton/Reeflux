# Reeflux Entitlement Truth Model

Date: 2026-03-22

## Authoritative access source
- Single source of truth: server-side entitlement record in Redis.
- Storage key: `reef:entitlement:<entitlement_id>`
- Client cookie (`reeflux_pass`) is only a signed pointer to entitlement identity and expected expiry; it is not authoritative by itself.

## Entitlement record shape

Stored fields (server):
- `entitlement_id`
- `status` (`active`, `past_due`, `canceled`, `inactive`)
- `plan`
- `scope` (`all_pools`, `any_pool`, or `pool:<id>`)
- `expires_at`
- `customer_id`
- `customer_email`
- `checkout_session_id`
- `subscription_id`
- `source_event_type`
- `source_event_id`
- `last_event_created`
- `updated_at`
- `updated_reason`

Indexes maintained:
- `reef:entitlement:index:checkout:<checkout_session_id>`
- `reef:entitlement:index:subscription:<subscription_id>`
- `reef:entitlement:index:customer:<customer_id>`
- `reef:entitlement:index:email:<customer_email>`

## Access resolution flow
1. Verify signed cookie using `PASS_SIGNING_SECRET`.
2. Extract entitlement id (`eid` / `pid`) from token payload.
3. Read entitlement record from Redis.
4. Enforce status and expiry server-side.
5. Return allow/deny reason to caller.

If any of steps 1-4 fail, access is denied (fail-closed).

## Payment -> entitlement lifecycle

### After payment success callback
- `/.netlify/functions/success` verifies Stripe Checkout session.
- Upserts entitlement record server-side.
- Issues signed cookie tied to entitlement id.
- Redirects to `/success` (or configured safe path).

### After webhook events
- `stripe-webhook` updates same entitlement model for:
  - subscription create/update/delete
  - invoice paid/payment_failed
  - checkout.session.completed (paid)

### Cancellation / failed billing behavior
- `invoice.payment_failed` and relevant subscription states map to `past_due`/`canceled`.
- `verify-pass` and `pool-join` deny access accordingly.

## Stale sessions / cookies handling
- Expired token (`exp` passed) => deny `expired`.
- Tampered token signature => deny `invalid_token`.
- Token points to missing entitlement => deny (`entitlement_not_found` or `entitlement_store_unavailable`).
- Runtime expiry check can transition stale active entitlement to `inactive`.
- Local browser storage flags are non-authoritative and cannot grant premium API access.

## Server-side enforcement points
- `/.netlify/functions/verify-pass`
- `/.netlify/functions/pool-join`
- `/.netlify/functions/ping` (auth telemetry truth)
- `/.netlify/functions/success` (issuance path)
- `/.netlify/functions/stripe-webhook` (lifecycle mutations)

## Migration/rollout requirements
- Presence/telemetry schema:
  - `npm run migrate:reef:schema-v2`
- Entitlement schema/index backfill:
  - `npm run migrate:entitlement:schema-v1`

Recommended execution:
1. `REEF_MIGRATION_DRY_RUN=true npm run migrate:reef:schema-v2`
2. `REEF_MIGRATION_DRY_RUN=true npm run migrate:entitlement:schema-v1`
3. Run both migrations without dry run.
4. Replay webhook events for recent successful checkouts.

## Current truth-model risk
- Model design is correct and fail-closed.
- Production Redis unavailability currently prevents authoritative reads/writes from operating, which blocks premium access confirmation despite payment.
