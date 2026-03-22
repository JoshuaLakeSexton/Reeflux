# Reeflux Webhook Lifecycle Verification

Date: 2026-03-22
Endpoint: `POST /.netlify/functions/stripe-webhook`

## Implementation verified in code

### Signature verification
- Uses Stripe SDK `constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`.
- Rejects missing signature (`missing_stripe_signature`).
- Rejects invalid signature (`invalid_signature`).

### Event coverage (required)
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### Idempotency and ordering safety
- Idempotency key: `reef:webhook:processed:<event_id>`.
- Uses `setnx` reservation + TTL to avoid duplicate successful processing.
- On processing failure, reservation key is deleted to allow retry.
- Stale event protection in entitlement writes uses `last_event_created` guard (`upsertEntitlement`).

### Entitlement transition mapping
- Checkout completed (paid): sets entitlement `active`.
- Subscription created/updated/deleted: maps Stripe status -> entitlement status.
- Invoice paid: sets `active`.
- Invoice payment failed: sets `past_due`.

## Live verification results (production)

### Signature path checks
- No signature:
  - Response: `400 {"ok":false,"error":"missing_stripe_signature"}`
- Invalid signature:
  - Response: `400 {"ok":false,"error":"invalid_signature"}`

### Signed lifecycle probes executed
Signed test payloads were sent for all required event types. Results:
- `checkout.session.completed` -> `500 webhook_processing_failed`
- `customer.subscription.created` -> `500 webhook_processing_failed`
- `customer.subscription.updated` -> `500 webhook_processing_failed`
- `customer.subscription.deleted` -> `500 webhook_processing_failed`
- `invoice.paid` -> `500 webhook_processing_failed`
- `invoice.payment_failed` -> `500 webhook_processing_failed`

Root cause aligns with Redis backend outage (`fetch failed`), preventing entitlement persistence.

## Lifecycle integrity status

### What is now correct
- Event coverage is complete.
- Signature verification is enforced.
- Duplicate event handling is safe on successful writes.
- Retry behavior is safe on partial failure (reservation cleared on error).
- Stale/out-of-order events cannot overwrite newer entitlement state.

### What blocks true operational integrity today
- Entitlement store unavailable in production means lifecycle transitions are not being persisted.
- Webhook endpoint behavior is fail-safe (no false state), but not operationally complete.

## Required to mark webhook lifecycle “launch-ready”
1. Restore Redis connectivity from Netlify functions.
2. Re-run signed lifecycle probes for all six event types and confirm `200 ok:true` for each.
3. Verify duplicate replay behavior:
   - Send same `event.id` twice.
   - Confirm second response is `duplicate:true`.
4. Verify out-of-order safety:
   - Send newer status event then older timestamp event.
   - Confirm older event is ignored (stale) and does not roll back entitlement.
