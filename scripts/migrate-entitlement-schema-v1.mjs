import { Redis } from "@upstash/redis";

const ENTITLEMENT_SCHEMA_VERSION = "1";
const MIGRATION_ID = "2026-03-22-entitlement-schema-v1";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim().replace(/^['"]+|['"]+$/g, "");
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function entitlementIdFromKey(key) {
  const prefix = "reef:entitlement:";
  if (!String(key).startsWith(prefix)) return null;
  const suffix = String(key).slice(prefix.length).trim();
  if (!suffix || suffix.startsWith("index:")) return null;
  return suffix;
}

async function main() {
  const dryRun = process.env.REEF_MIGRATION_DRY_RUN === "true";

  const redis = new Redis({
    url: requireEnv("UPSTASH_REDIS_REST_URL"),
    token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  });

  const touched = [];
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(cursor, {
      match: "reef:entitlement:*",
      count: 200,
    });
    cursor = String(nextCursor || "0");

    for (const key of Array.isArray(keys) ? keys : []) {
      const entitlementId = entitlementIdFromKey(key);
      if (!entitlementId) continue;

      const raw = await redis.hgetall(key);
      if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) continue;

      const updates = {};
      if (!String(raw.entitlement_id || "").trim()) updates.entitlement_id = entitlementId;

      const checkoutSessionId = String(raw.checkout_session_id || "").trim();
      const subscriptionId = String(raw.subscription_id || "").trim();
      const customerId = String(raw.customer_id || "").trim();
      const customerEmail = normalizeEmail(raw.customer_email || "");

      if (!dryRun && Object.keys(updates).length > 0) {
        await redis.hset(key, updates);
      }

      if (!dryRun && checkoutSessionId) {
        await redis.set(`reef:entitlement:index:checkout:${checkoutSessionId}`, entitlementId);
      }
      if (!dryRun && subscriptionId) {
        await redis.set(`reef:entitlement:index:subscription:${subscriptionId}`, entitlementId);
      }
      if (!dryRun && customerId) {
        await redis.set(`reef:entitlement:index:customer:${customerId}`, entitlementId);
      }
      if (!dryRun && customerEmail) {
        await redis.set(`reef:entitlement:index:email:${customerEmail}`, entitlementId);
      }

      touched.push({
        key,
        entitlementId,
        checkoutSessionId: checkoutSessionId || null,
        subscriptionId: subscriptionId || null,
        customerId: customerId || null,
        customerEmail: customerEmail || null,
        updatedFields: Object.keys(updates),
      });
    }
  } while (cursor !== "0");

  if (!dryRun) {
    await redis.set("reef:entitlement:schema:version", ENTITLEMENT_SCHEMA_VERSION);
    await redis.hset("reef:migrations:applied", {
      [MIGRATION_ID]: new Date().toISOString(),
    });
  }

  const summary = {
    migration: MIGRATION_ID,
    dryRun,
    entitlementSchemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    touchedCount: touched.length,
    touched: touched.slice(0, 50),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[${MIGRATION_ID}] failed`);
  console.error(error?.message || error);
  process.exit(1);
});
