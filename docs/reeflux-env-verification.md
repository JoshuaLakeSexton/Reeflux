# Reeflux Environment Verification

Date: 2026-03-22
Environment audited: Netlify production (`https://reeflux.com`)

## Verification summary
- Required billing/access env vars are present in production.
- Runtime validation and sanitization is now enforced in checkout/success/webhook paths.
- Remaining launch blocker is not missing env keys; it is backend connectivity to Upstash (`fetch failed`).

## Evidence captured

### Presence checks
- `npx netlify env:list --context production` shows required keys exist:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `PASS_SIGNING_SECRET`
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

### Value-shape checks (non-secret)
- `SITE_URL=https://reeflux.com`
- `UPSTASH_REDIS_REST_URL="https://dynamic-bedbug-54789.upstash.io"` (stored with quotes)
  - Runtime sanitization now strips surrounding quotes before use.

## Env var matrix

| Env var | Where used | If missing/wrong | Fallback safety | Live/test confusion risk | Naming consistency |
|---|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | `checkout.js`, `success.js`, `stripe-webhook.js` | Checkout/session verification/webhooks fail | Safe fail (explicit 500 reason; no fake unlock) | High if test key used with live prices/domains | Consistent |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook.js` signature verify | Webhook events rejected/unsafe | Safe fail (400/500, no entitlement mutation) | Medium (wrong endpoint secret) | Consistent |
| `PASS_SIGNING_SECRET` | `_reef.js` token verify, `success.js` token issue | Pass cannot be trusted/issued | Safe fail-closed (`missing_pass_secret` or pending) | Low | Consistent |
| `UPSTASH_REDIS_REST_URL` | `_env.js`, `_reef.js`, `success.js`, `stripe-webhook.js`, `upstash-test.js` | Entitlement + telemetry persistence unavailable | Safe fail-closed (no false unlock; degraded telemetry) | Low | Consistent |
| `UPSTASH_REDIS_REST_TOKEN` | Same as URL above | Same as above | Safe fail-closed | Low | Consistent |
| `SITE_URL` (fallback `URL`) | `checkout.js` success/cancel URL creation | Wrong return domain/path if incorrect | Safe-ish: defaults to `https://reeflux.com`; still must match Stripe allowlist | Medium | Consistent |
| `STRIPE_PRICE_DRIFT_PASS` / legacy `PRICE_DRIFT_PASS` | `checkout.js` line-item pricing | Invalid price can break checkout create | Now safer: fallback to inline price when price missing/invalid | High (live/test price mismatch) | Mixed (new + legacy alias) |
| `STRIPE_PRICE_POOL_ENTRY` / legacy `PRICE_SINGLE_POOL` | `checkout.js` line-item pricing | Same as above | Same as above | High (live/test mismatch) | Mixed (new + legacy alias) |

## Startup/runtime validation added

### Added
- `netlify/functions/_env.js`
  - `sanitizeEnvValue`
  - `readEnv`
  - `validateRequiredEnv`
  - `getRedisRuntimeConfig`
- Function-level required-env checks:
  - `checkout.js` requires `STRIPE_SECRET_KEY`
  - `success.js` requires Stripe + pass-signing + Redis envs
  - `stripe-webhook.js` requires Stripe secret + webhook secret + Redis envs
  - `upstash-test.js` validates Redis envs and emits structured errors

### Behavioral guarantees now
- Misconfigured billing/access env no longer silently grants access.
- Premium access remains fail-closed on entitlement uncertainty.
- Failures emit structured reason codes rather than ambiguous generic output.

## Current production issue that remains
- Even with env keys present and sanitized, runtime Redis operations fail (`fetch failed`).
- This indicates network/connectivity/auth mismatch beyond simple key presence.
- Result:
  - Webhook lifecycle persistence fails.
  - Success callback entitlement sync cannot complete reliably.
  - Telemetry remains degraded.

## Required production remediation steps
1. In Upstash console, verify the REST URL and token pair belongs to the same database and has active REST access.
2. Ensure Netlify functions egress can reach `dynamic-bedbug-54789.upstash.io`.
3. Re-save `UPSTASH_REDIS_REST_URL` without quotes to reduce human error (runtime already sanitizes, but source should be clean).
4. Re-run probes:
   - `/.netlify/functions/upstash-test`
   - `/.netlify/functions/stats`
   - Signed webhook POST to `/.netlify/functions/stripe-webhook`
