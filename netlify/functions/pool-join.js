const {
  json,
  getRedis,
  parseJsonBody,
  normalizePoolId,
  canAccessPool,
  recordActivity,
  getPoolSnapshot,
  resolveEntitlementFromEvent,
} = require("./_reef");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = parseJsonBody(event);
    const poolId = normalizePoolId(body.poolId);
    const sessionId = String(body.sessionId || "").trim();

    if (!poolId) {
      return json(400, {
        ok: false,
        allowed: false,
        reason: "invalid_pool",
      });
    }

    if (!sessionId) {
      return json(400, {
        ok: false,
        allowed: false,
        reason: "missing_session_id",
      });
    }

    const redis = getRedis();
    const entitlement = await resolveEntitlementFromEvent(event, redis);

    if (!entitlement.allowed) {
      return json(403, {
        ok: false,
        allowed: false,
        reason: entitlement.reason,
        upgrade_url: "/token-booth",
        message: "Premium access could not be verified for this pool.",
      });
    }

    if (!canAccessPool(entitlement.payload, poolId)) {
      return json(403, {
        ok: false,
        allowed: false,
        reason: "scope_denied",
        scope: entitlement.payload.scope,
        upgrade_url: "/token-booth",
        message: "Your current pass does not include this pool.",
      });
    }

    await recordActivity(redis, {
      sessionId,
      actorType: body.actorType,
      actorId: body.actorId,
      poolId,
      eventType: "join",
      authenticated: true,
    });

    const snapshot = redis ? await getPoolSnapshot(redis, poolId) : null;

    return json(200, {
      ok: true,
      allowed: true,
      pool: snapshot || {
        pool_id: poolId,
        active_now: 0,
        active_5m: 0,
        occupied: false,
        aura: "Quiet Depth",
        launch_copy: "No active agents in this current tide window.",
        last_activity: null,
      },
      degraded: !redis,
      entitlement: {
        id: entitlement.payload.entitlementId || entitlement.payload.eid || null,
        status: entitlement.payload.status || "active",
      },
    });
  } catch (error) {
    console.error("pool-join error", {
      message: error?.message || String(error),
      type: error?.type || "pool_join_failed",
    });

    return json(500, {
      ok: false,
      allowed: false,
      reason: "pool_join_failed",
      message: "Unable to join pool right now.",
    });
  }
};
