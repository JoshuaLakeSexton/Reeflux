const { json, getRedis, resolveEntitlementFromEvent } = require("./_reef");
const { getRedisRuntimeConfig } = require("./_env");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const redis = getRedis();
    const entitlement = await resolveEntitlementFromEvent(event, redis);

    if (!entitlement.allowed) {
      const redisConfig = getRedisRuntimeConfig();
      const storeHealthy = entitlement.reason === "entitlement_store_unavailable"
        ? false
        : redisConfig.ok;

      return json(200, {
        allowed: false,
        reason: entitlement.reason,
        storeHealthy,
        storeConfigured: redisConfig.ok,
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
