const {
  json,
  getRedis,
  parseJsonBody,
  normalizePoolId,
  recordActivity,
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

  let entitlement = { allowed: false, reason: "entitlement_unknown" };

  try {
    const body = parseJsonBody(event);

    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      return json(400, { ok: false, error: "Missing sessionId" });
    }

    const redis = getRedis();
    try {
      entitlement = await withTimeout(
        resolveEntitlementFromEvent(event, redis),
        1500,
        "ping_verify_timeout",
      );
    } catch (error) {
      if (error?.code === "ping_verify_timeout") {
        entitlement = { allowed: false, reason: "entitlement_store_unavailable" };
      } else {
        throw error;
      }
    }

    const activity = await withTimeout(recordActivity(redis, {
      sessionId,
      actorType: body.actorType,
      actorId: body.actorId,
      poolId: normalizePoolId(body.poolId),
      eventType: body.eventType || "heartbeat",
      authenticated: entitlement.allowed,
    }), 1600, "ping_activity_timeout");

    return json(200, {
      ok: true,
      recorded: activity.recorded,
      session_id: sessionId,
      at: activity.at || Date.now(),
      pool_id: activity.pool_id || null,
      degraded: !redis,
      entitlement: {
        allowed: entitlement.allowed,
        reason: entitlement.reason,
      },
    });
  } catch (error) {
    console.error("ping error", {
      message: error?.message || String(error),
      type: error?.type || "ping_failed",
    });

    return json(200, {
      ok: true,
      recorded: false,
      degraded: true,
      reason: "ping_failed",
      reason_code: error?.message || "ping_failed",
      entitlement: {
        allowed: entitlement.allowed,
        reason: entitlement.reason,
      },
    });
  }
};
