import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canAccessPool,
  getReefStatus,
  normalizePoolId,
  readEntitlement,
  readPassFromEvent,
  resolveEntitlementFromEvent,
  signPassToken,
  upsertEntitlement,
} = require("../netlify/functions/_reef.js");
const { getRedisRuntimeConfig } = require("../netlify/functions/_env.js");

class MockRedis {
  constructor() {
    this.hashes = new Map();
    this.values = new Map();
  }

  async hset(key, fields) {
    const existing = this.hashes.get(key) || {};
    this.hashes.set(key, { ...existing, ...fields });
    return 1;
  }

  async hgetall(key) {
    return this.hashes.get(key) || {};
  }

  async set(key, value) {
    this.values.set(key, String(value));
    return "OK";
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async expire() {
    return 1;
  }
}

class MockRedisReadError extends MockRedis {
  async hgetall() {
    throw new Error("fetch failed");
  }
}

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

test("getRedisRuntimeConfig sanitizes quoted env values", () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  process.env.UPSTASH_REDIS_REST_URL = "\"https://example.upstash.io\"";
  process.env.UPSTASH_REDIS_REST_TOKEN = "\"token123\"";

  const config = getRedisRuntimeConfig();
  assert.equal(config.ok, true);
  assert.equal(config.url, "https://example.upstash.io");
  assert.equal(config.token, "token123");

  process.env.UPSTASH_REDIS_REST_URL = originalUrl;
  process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
});

test("resolveEntitlementFromEvent allows active server-side entitlement", async () => {
  const originalSecret = process.env.PASS_SIGNING_SECRET;
  process.env.PASS_SIGNING_SECRET = "test-secret";

  const redis = new MockRedis();

  await upsertEntitlement(redis, {
    entitlementId: "ent_123",
    status: "active",
    scope: "all_pools",
    plan: "driftpass",
    expiresAt: Date.now() + 60_000,
    eventCreatedMs: Date.now(),
  });

  const token = signPassToken(
    {
      eid: "ent_123",
      exp: Date.now() + 60_000,
    },
    process.env.PASS_SIGNING_SECRET,
  );

  const result = await resolveEntitlementFromEvent(
    {
      headers: {
        cookie: `reeflux_pass=${token}`,
      },
    },
    redis,
  );

  assert.equal(result.allowed, true);
  assert.equal(result.payload.scope, "all_pools");

  process.env.PASS_SIGNING_SECRET = originalSecret;
});

test("resolveEntitlementFromEvent denies missing server-side entitlement", async () => {
  const originalSecret = process.env.PASS_SIGNING_SECRET;
  process.env.PASS_SIGNING_SECRET = "test-secret";

  const token = signPassToken(
    {
      eid: "missing_ent",
      exp: Date.now() + 60_000,
    },
    process.env.PASS_SIGNING_SECRET,
  );

  const result = await resolveEntitlementFromEvent(
    {
      headers: {
        cookie: `reeflux_pass=${token}`,
      },
    },
    new MockRedis(),
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "entitlement_not_found");

  process.env.PASS_SIGNING_SECRET = originalSecret;
});

test("resolveEntitlementFromEvent fails closed when entitlement store read errors", async () => {
  const originalSecret = process.env.PASS_SIGNING_SECRET;
  process.env.PASS_SIGNING_SECRET = "test-secret";

  const token = signPassToken(
    {
      eid: "ent_123",
      exp: Date.now() + 60_000,
    },
    process.env.PASS_SIGNING_SECRET,
  );

  const result = await resolveEntitlementFromEvent(
    {
      headers: {
        cookie: `reeflux_pass=${token}`,
      },
    },
    new MockRedisReadError(),
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "entitlement_store_unavailable");

  process.env.PASS_SIGNING_SECRET = originalSecret;
});

test("upsertEntitlement ignores stale webhook events", async () => {
  const redis = new MockRedis();

  await upsertEntitlement(redis, {
    entitlementId: "sub:123",
    status: "active",
    scope: "all_pools",
    plan: "driftpass",
    eventCreatedMs: 5_000,
  });

  const stale = await upsertEntitlement(redis, {
    entitlementId: "sub:123",
    status: "canceled",
    eventCreatedMs: 1_000,
  });

  assert.equal(stale.stale, true);

  const latest = await readEntitlement(redis, "sub:123");
  assert.equal(latest.status, "active");
});
