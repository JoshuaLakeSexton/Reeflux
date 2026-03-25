const { json, getRedis, resolveEntitlementFromEvent, withTimeout } = require("./_reef");
const { getRedisRuntimeConfig } = require("./_env");

async function getStoreReachable(redis) {
  if (!redis) return false;

  try {
    await withTimeout(redis.ping(), 900, "redis_ping_timeout");
    return true;
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const redis = getRedis();
    let entitlement;

    try {
      entitlement = await withTimeout(
        resolveEntitlementFromEvent(event, redis),
        1600,
        "verify_timeout",
      );
    } catch (error) {
      if (error?.code === "verify_timeout") {
        entitlement = { allowed: false, reason: "entitlement_store_unavailable" };
      } else {
        throw error;
      }
    }

    if (!entitlement.allowed) {
      const redisConfig = getRedisRuntimeConfig();
      const storeReachable = await getStoreReachable(redis);
      const storeHealthy = entitlement.reason === "entitlement_store_unavailable"
        ? false
        : storeReachable;

      return json(200, {
        allowed: false,
        reason: entitlement.reason,
        storeHealthy,
        storeConfigured: redisConfig.ok,
        storeReachable,
      });
    }

    return json(200, {
      allowed: true,
      reason: "ok",
      entitlementId: entitlement.payload.entitlementId || entitlement.payload.eid || null,
      scope: entitlement.payload.scope,
      plan: entitlement.payload.plan,
      status: entitlement.payload.status || "active",
      expiresAt: entitlement.payload.exp || entitlement.payload.expiresAt,
      issuedAt: entitlement.payload.updatedAtMs || entitlement.payload.issued_at || null,
      customerId: entitlement.payload.customerId || entitlement.payload.cid || null,
    });
  } catch (error) {
    console.error("verify-pass error", {
      message: error?.message || String(error),
      type: error?.type || "verify_failed",
    });

    return json(500, {
      allowed: false,
      reason: "verify_failed",
    });
  }
};
