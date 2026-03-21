const {
  json,
  getRedis,
  parseJsonBody,
  normalizePoolId,
  readPassFromEvent,
  canAccessPool,
  recordActivity,
  getPoolSnapshot,
} = require("./_reef");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

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

  const entitlement = readPassFromEvent(event);
  if (!entitlement.allowed) {
    return json(403, {
      ok: false,
      allowed: false,
      reason: entitlement.reason,
      upgrade_url: "/token-booth",
      message: "Premium access required for this pool.",
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

  const redis = getRedis();

  try {
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
        aura: "Quiet pool",
        last_activity: null,
      },
      degraded: !redis,
    });
  } catch (error) {
    console.error("pool-join error", error);
    return json(500, {
      ok: false,
      allowed: false,
      reason: "pool_join_failed",
      message: error?.message || "Unable to join pool",
    });
  }
};
