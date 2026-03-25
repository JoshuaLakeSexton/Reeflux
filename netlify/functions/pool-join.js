const {
  json,
  getRedis,
  parseJsonBody,
  normalizePoolId,
  canAccessPool,
  recordActivity,
  getPoolSnapshot,
  resolveEntitlementFromEvent,
  withTimeout,
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
    let entitlement;
    try {
      entitlement = await withTimeout(
        resolveEntitlementFromEvent(event, redis),
        1700,
        "pool_verify_timeout",
      );
    } catch (error) {
      if (error?.code === "pool_verify_timeout") {
        entitlement = { allowed: false, reason: "entitlement_store_unavailable" };
      } else {
        throw error;
      }
    }

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

    let degraded = !redis;

    try {
      await withTimeout(recordActivity(redis, {
        sessionId,
        actorType: body.actorType,
        actorId: body.actorId,
        poolId,
        eventType: "join",
        authenticated: true,
      }), 1800, "pool_activity_timeout");
    } catch (error) {
      degraded = true;
      console.error("pool-join activity degraded", {
        message: error?.message || String(error),
      });
    }

    let snapshot = null;
    if (redis) {
      try {
        snapshot = await withTimeout(getPoolSnapshot(redis, poolId), 1500, "pool_snapshot_timeout");
      } catch (error) {
        degraded = true;
        console.error("pool-join snapshot degraded", {
          message: error?.message || String(error),
        });
      }
    }

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
      degraded,
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
