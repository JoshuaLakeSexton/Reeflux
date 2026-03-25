const { getRedis, json, withTimeout } = require("./_reef");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  const redis = getRedis();
  if (!redis) {
    return json(200, {
      ok: true,
      degraded: true,
      reason: "telemetry_limited",
      reason_code: "telemetry_not_configured",
      events: [],
    });
  }

  try {
    const limit = Math.min(80, Math.max(10, Number.parseInt(event.queryStringParameters?.limit || "40", 10) || 40));
    const rawEvents = await withTimeout(
      redis.lrange("reef:events:feed", 0, limit - 1),
      1600,
      "activity_feed_timeout",
    );

    const events = (Array.isArray(rawEvents) ? rawEvents : [])
      .map((raw) => {
        if (typeof raw !== "string") return null;

        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return json(200, {
      ok: true,
      degraded: false,
      events,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("activity-feed error", error);
    return json(200, {
      ok: true,
      degraded: true,
      reason: "telemetry_limited",
      reason_code: error?.message || "feed_failed",
      events: [],
      generated_at: new Date().toISOString(),
    });
  }
};
