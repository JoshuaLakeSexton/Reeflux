const {
  json,
  getRedis,
  parseJsonBody,
  normalizePoolId,
  readPassFromEvent,
  recordActivity,
} = require("./_reef");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  const body = parseJsonBody(event);

  const sessionId = String(body.sessionId || "").trim();
  if (!sessionId) {
    return json(400, { ok: false, error: "Missing sessionId" });
  }

  const entitlement = readPassFromEvent(event);
  const redis = getRedis();

  try {
    const activity = await recordActivity(redis, {
      sessionId,
      actorType: body.actorType,
      actorId: body.actorId,
      poolId: normalizePoolId(body.poolId),
      eventType: body.eventType || "heartbeat",
      authenticated: entitlement.allowed || body.authenticated === true,
    });

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
    console.error("ping error", error);
    return json(200, {
      ok: true,
      recorded: false,
      degraded: true,
      reason: error?.message || "Ping failed",
      entitlement: {
        allowed: entitlement.allowed,
        reason: entitlement.reason,
      },
    });
  }
};
