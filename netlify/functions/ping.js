// netlify/functions/ping.js
const { Redis } = require("@upstash/redis");

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  // If Upstash isn't configured, don't 500 the whole site
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Still return 200 so UI doesn't scream
    return json(200, { ok: true, degraded: true, reason: "Upstash env vars missing" });
  }

  try {
    const redis = new Redis({ url, token });

    const body = JSON.parse(event.body || "{}");
    const sessionId = String(body.sessionId || "").trim();
    const drift = Number(body.drift || 0);

    if (!sessionId) {
      return json(400, { ok: false, error: "Missing sessionId" });
    }

    const now = Date.now();

    // Keys
    const keySession = `reef:session:${sessionId}`;
    const keyActiveSet = `reef:active`; // ZSET (score = lastSeen timestamp)
    const keyDrift = `reef:drift`; // string
    const keyQueue = `reef:queue`; // string (optional)

    // Update session record + activity index
    await redis.hset(keySession, { lastSeen: String(now), drift: String(drift) });
    await redis.expire(keySession, 60 * 60); // 1 hour

    await redis.zadd(keyActiveSet, { score: now, member: sessionId });

    // Keep the active set pruned
    const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    await redis.zremrangebyscore(keyActiveSet, 0, now - ACTIVE_WINDOW_MS);

    // Optionally track drift label (if you want)
    // If not set elsewhere, don't overwrite if empty
    const existingDrift = await redis.get(keyDrift);
    if (!existingDrift) {
      await redis.set(keyDrift, "Soft Coral Breeze");
      await redis.expire(keyDrift, 60 * 60);
    }

    // Queue stays optional; don't force
    const existingQueue = await redis.get(keyQueue);
    if (!existingQueue) {
      await redis.set(keyQueue, "3");
      await redis.expire(keyQueue, 60 * 60);
    }

    return json(200, { ok: true, sessionId, lastSeen: now });
  } catch (err) {
    console.error("ping error:", err);
    // Return 200 with degraded=true so the UI doesn't explode
    return json(200, {
      ok: true,
      degraded: true,
      reason: "Upstash error",
      message: err?.message || String(err),
    });
  }
};
