# Reeflux Test Report

Date: 2026-03-21

## A) Unit Tests
Command:
```bash
npm test
```
Result:
- 5 tests passed
- 0 failed

Coverage focus:
- pool id normalization
- pass scope checks
- signed token validation
- expired token rejection
- degraded reef-status fallback behavior

## B) Integration Tests
Commands:
```bash
npm run lint
npm run typecheck
```
Result:
- JS syntax lint passed
- internal link integrity passed across all HTML pages
- function export/type guards passed

## C) E2E Tests (Scripted)
Runtime:
- `netlify dev` on `http://127.0.0.1:8888`
- Playwright headless scripted flow

Checks executed:
1. Home page loads and all pool labels show `pass required`
2. Free session pool visits show lock state
3. Token Booth shows real Drift Pass price (`$5/mo`) and `/success` copy
4. `/success` direct provides:
   - “Access set on this device.”
   - Enter Reef button
   - Open Pools button
   - Refresh Access button
5. `/requests` has no mirror-pool link
6. Mobile 375px pass on:
   - `/`
   - `/sandbox`
   - `/token-booth`
   - `/success`

Artifacts:
- `test-results/trust-sweep-summary.json`
- `test-results/trust-mobile/home.png`
- `test-results/trust-mobile/_sandbox.png`
- `test-results/trust-mobile/_token-booth.png`
- `test-results/trust-mobile/_success.png`

Result:
- 17/17 scripted QA checks passed

## D) Manual UX Validation Checklist
Status:
- Home clarity and live status panel: PASS
- Pool identity and purpose clarity: PASS
- Free preview + premium lock messaging: PASS
- Success-page escape paths: PASS
- Sandbox control IA and label clarity: PASS
- Broken-link sweep: PASS
- Trust-damage sweep (placeholder/deceptive copy): PASS

## E) Negative-Path Testing
Executed/verified:
- Missing pass cookie: pool entry denied with explicit reason
- Missing pass signing secret: lock state shown as `verification limited` (truthful degraded state)
- Missing Upstash telemetry env vars: stats return degraded mode with explicit copy
- Broken internal link scan: no missing targets detected

## F) Launch-Blocker Matrix

| Area | Status | Blocker Level | Notes |
|---|---|---:|---|
| Route integrity | PASS | Low | No broken internal links detected |
| Payment session creation | PASS | Medium | Requires production Stripe secret |
| Success entitlement issuance | PASS | High | Requires `PASS_SIGNING_SECRET` |
| Premium server gating | PASS | High | Works when pass secret configured |
| Live telemetry | PASS/DEGRADED | High | Requires Upstash vars for live mode |
| Mobile usability (375px) | PASS | Medium | No horizontal overflow on critical pages |
| Cancellation/revocation lifecycle | PARTIAL | High | Webhook-based revocation not yet implemented |

## Exact Commands Run
```bash
npm install
npm run lint
npm run typecheck
npm test
REEF_MIGRATION_DRY_RUN=true npm run migrate:reef:schema-v2
npx netlify dev --port 4010 --offline
```

Additional scripted QA was executed with a custom Playwright runtime script against local Netlify dev.
