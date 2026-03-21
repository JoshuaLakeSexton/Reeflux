import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canAccessPool,
  getReefStatus,
  normalizePoolId,
  readPassFromEvent,
  signPassToken,
} = require("../netlify/functions/_reef.js");

test("normalizePoolId accepts known pool ids", () => {
  assert.equal(normalizePoolId("ambient"), "ambient");
  assert.equal(normalizePoolId("FRACTAL"), "fractal");
  assert.equal(normalizePoolId("unknown"), null);
});

test("canAccessPool respects scopes", () => {
  assert.equal(canAccessPool({ scope: "all_pools" }, "ambient"), true);
  assert.equal(canAccessPool({ scope: "any_pool" }, "sandbox"), true);
  assert.equal(canAccessPool({ scope: "pool:fractal" }, "fractal"), true);
  assert.equal(canAccessPool({ scope: "pool:fractal" }, "ambient"), false);
});

test("readPassFromEvent validates signed token", () => {
  const originalSecret = process.env.PASS_SIGNING_SECRET;
  process.env.PASS_SIGNING_SECRET = "test-secret";

  const token = signPassToken(
    {
      pid: "sess_123",
      plan: "driftpass",
      scope: "all_pools",
      exp: Date.now() + 60_000,
      issued_at: Date.now(),
    },
    process.env.PASS_SIGNING_SECRET,
  );

  const result = readPassFromEvent({
    headers: {
      cookie: `reeflux_pass=${token}`,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.payload.scope, "all_pools");

  process.env.PASS_SIGNING_SECRET = originalSecret;
});

test("readPassFromEvent rejects expired token", () => {
  const originalSecret = process.env.PASS_SIGNING_SECRET;
  process.env.PASS_SIGNING_SECRET = "test-secret";

  const token = signPassToken(
    {
      pid: "sess_123",
      plan: "poolentry",
      scope: "any_pool",
      exp: Date.now() - 1_000,
      issued_at: Date.now() - 2_000,
    },
    process.env.PASS_SIGNING_SECRET,
  );

  const result = readPassFromEvent({
    headers: {
      cookie: `reeflux_pass=${token}`,
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "expired");

  process.env.PASS_SIGNING_SECRET = originalSecret;
});

test("getReefStatus returns degraded status without redis", async () => {
  const status = await getReefStatus(null);
  assert.equal(status.mode, "degraded");
  assert.equal(Array.isArray(status.pools), true);
  assert.equal(status.pools.length >= 4, true);
  assert.equal(status.active_agents_now, 0);
});
