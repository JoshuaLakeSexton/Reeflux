const crypto = require("crypto");
const { Redis } = require("@upstash/redis");

const KNOWN_POOLS = Object.freeze(["tide", "ambient", "fractal", "sandbox"]);

const WINDOWS = Object.freeze({
  activeNowMs: 90 * 1000,
  active5mMs: 5 * 60 * 1000,
  active1hMs: 60 * 60 * 1000,
  events24hMs: 24 * 60 * 60 * 1000,
  pruneSessionsMs: 2 * 60 * 60 * 1000,
});

function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function parseJsonBody(event) {
  if (!event || typeof event.body !== "string") return {};

  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function normalizePoolId(poolId) {
  if (typeof poolId !== "string") return null;
  const value = poolId.trim().toLowerCase();
  return KNOWN_POOLS.includes(value) ? value : null;
}

function sanitizeActorType(actorType) {
  if (typeof actorType !== "string") return "agent";
  const value = actorType.trim().toLowerCase();
  if (value === "agent" || value === "human" || value === "system") return value;
  return "agent";
}

function hasRedisConfig() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function getRedis() {
  if (!hasRedisConfig()) return null;
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

function parseCookies(headers = {}) {
  const cookieHeader = headers.cookie || headers.Cookie || "";
  const out = {};

  cookieHeader.split(";").forEach((item) => {
    const [key, ...rest] = item.trim().split("=");
    if (!key) return;
    out[key] = decodeURIComponent(rest.join("=") || "");
  });

  return out;
}

function b64urlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(value) {
  let normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  return Buffer.from(normalized, "base64").toString("utf8");
}

function signPassToken(payload, secret) {
  const serialized = JSON.stringify(payload);
  const encodedPayload = b64urlEncode(serialized);

  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${encodedPayload}.${signature}`;
}

function verifyPassToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const [payloadPart, providedSignature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payloadPart)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (providedSignature !== expectedSignature) return null;

  try {
    return JSON.parse(b64urlDecode(payloadPart));
  } catch {
    return null;
  }
}

function readPassFromEvent(event) {
  const secret = process.env.PASS_SIGNING_SECRET;
  if (!secret) {
    return { allowed: false, reason: "missing_pass_secret", payload: null };
  }

  const cookies = parseCookies(event?.headers || {});
  const token = cookies.reeflux_pass;
  if (!token) {
    return { allowed: false, reason: "no_pass", payload: null };
  }

  const payload = verifyPassToken(token, secret);
  if (!payload) {
    return { allowed: false, reason: "invalid_token", payload: null };
  }

  if (!payload.exp || Date.now() > Number(payload.exp)) {
    return { allowed: false, reason: "expired", payload };
  }

  return { allowed: true, reason: "ok", payload };
}

function canAccessPool(payload, poolId) {
  const scope = String(payload?.scope || "");

  if (scope === "all_pools" || scope === "any_pool") return true;
  if (scope.startsWith("pool:") && scope.replace("pool:", "") === poolId) return true;

  return false;
}

async function recordActivity(redis, activity) {
  if (!redis) return { recorded: false, degraded: true };

  const now = Date.now();
  const sessionId = String(activity.sessionId || "").trim();
  if (!sessionId) {
    return { recorded: false, degraded: true, reason: "missing_session_id" };
  }

  const actorType = sanitizeActorType(activity.actorType);
  const actorId = String(activity.actorId || "anon").slice(0, 64);
  const poolId = normalizePoolId(activity.poolId);
  const eventType = String(activity.eventType || "heartbeat").trim().toLowerCase();
  const authenticated = Boolean(activity.authenticated);

  const sessionKey = `reef:session:${sessionId}`;
  const sessionSet = "reef:sessions:last_seen";
  const actorSet = `reef:sessions:actor:${actorType}:last_seen`;
  const authSet = "reef:sessions:auth:last_seen";

  const eventSuffix = Math.random().toString(36).slice(2, 8);
  const eventMember = `${now}:${sessionId}:${eventType}:${eventSuffix}`;

  await redis.hset(sessionKey, {
    session_id: sessionId,
    actor_type: actorType,
    actor_id: actorId,
    event_type: eventType,
    pool_id: poolId || "",
    authenticated: authenticated ? "true" : "false",
    last_seen_at: String(now),
  });
  await redis.expire(sessionKey, Math.floor(WINDOWS.pruneSessionsMs / 1000));

  await redis.zadd(sessionSet, { score: now, member: sessionId });
  await redis.zadd(actorSet, { score: now, member: sessionId });
  if (authenticated) {
    await redis.zadd(authSet, { score: now, member: sessionId });
  } else {
    await redis.zrem(authSet, sessionId);
  }

  if (poolId) {
    await redis.sadd("reef:pools:known", poolId);
    await redis.zadd(`reef:pool:${poolId}:last_seen`, { score: now, member: sessionId });
    await redis.hset("reef:pools:last_activity", { [poolId]: String(now) });
  }

  await redis.zadd("reef:events:all", { score: now, member: eventMember });
  if (eventType === "join") {
    await redis.zadd("reef:events:joins", { score: now, member: eventMember });
  }
  if (eventType !== "heartbeat") {
    await redis.zadd("reef:events:interactions", { score: now, member: eventMember });
  }

  await redis.lpush(
    "reef:events:feed",
    JSON.stringify({
      at: now,
      session_id: sessionId,
      actor_type: actorType,
      pool_id: poolId || null,
      event_type: eventType,
      authenticated,
    }),
  );
  await redis.ltrim("reef:events:feed", 0, 199);

  await redis.zremrangebyscore("reef:sessions:last_seen", 0, now - WINDOWS.pruneSessionsMs);
  await redis.zremrangebyscore("reef:sessions:actor:agent:last_seen", 0, now - WINDOWS.pruneSessionsMs);
  await redis.zremrangebyscore("reef:sessions:actor:human:last_seen", 0, now - WINDOWS.pruneSessionsMs);
  await redis.zremrangebyscore("reef:sessions:actor:system:last_seen", 0, now - WINDOWS.pruneSessionsMs);
  await redis.zremrangebyscore("reef:sessions:auth:last_seen", 0, now - WINDOWS.pruneSessionsMs);

  await redis.zremrangebyscore("reef:events:all", 0, now - WINDOWS.events24hMs);
  await redis.zremrangebyscore("reef:events:joins", 0, now - WINDOWS.events24hMs);
  await redis.zremrangebyscore("reef:events:interactions", 0, now - WINDOWS.events24hMs);

  const firstSeen = await redis.get("reef:service:first_seen_at");
  if (!firstSeen) {
    await redis.set("reef:service:first_seen_at", String(now));
  }

  return {
    recorded: true,
    at: now,
    pool_id: poolId,
  };
}

async function getPoolSnapshot(redis, poolId, now = Date.now()) {
  const normalized = normalizePoolId(poolId);
  if (!normalized) return null;

  const activeNow = await redis.zcount(`reef:pool:${normalized}:last_seen`, now - WINDOWS.activeNowMs, now);
  const active5m = await redis.zcount(`reef:pool:${normalized}:last_seen`, now - WINDOWS.active5mMs, now);
  const lastActivityRaw = await redis.hget("reef:pools:last_activity", normalized);
  const lastActivity = lastActivityRaw ? new Date(Number(lastActivityRaw)).toISOString() : null;

  let activityLabel = "Quiet pool";
  if (active5m >= 8) activityLabel = "High Signal";
  else if (active5m >= 4) activityLabel = "Crowded Current";
  else if (active5m >= 2) activityLabel = "Low Noise";
  else if (active5m >= 1) activityLabel = "Rare Tide";

  return {
    pool_id: normalized,
    active_now: Number(activeNow || 0),
    active_5m: Number(active5m || 0),
    last_activity: lastActivity,
    aura: activityLabel,
    occupied: Number(active5m || 0) > 0,
  };
}

async function getReefStatus(redis) {
  const now = Date.now();

  if (!redis) {
    return {
      mode: "degraded",
      source: "no_redis",
      generated_at: new Date(now).toISOString(),
      active_agents_now: 0,
      active_agents_5m: 0,
      active_agents_1h: 0,
      connected_authenticated_users: 0,
      occupied_pools: 0,
      available_pools: KNOWN_POOLS.length,
      pool_join_events_24h: 0,
      interactions_24h: 0,
      system_uptime_seconds: 0,
      last_updated: new Date(now).toISOString(),
      pools: KNOWN_POOLS.map((poolId) => ({
        pool_id: poolId,
        active_now: 0,
        active_5m: 0,
        occupied: false,
        aura: "Quiet pool",
        last_activity: null,
      })),
      copy_state: "Telemetry unavailable. Configure Upstash for live reef status.",
      // Backward-compatible keys
      agents_inside: 0,
      current_drift: "Telemetry Offline",
      requests_queue: 0,
      degraded: true,
      reason: "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing",
    };
  }

  await redis.sadd("reef:pools:known", ...KNOWN_POOLS);

  const activeAgentsNow = await redis.zcount(
    "reef:sessions:actor:agent:last_seen",
    now - WINDOWS.activeNowMs,
    now,
  );

  const activeAgents5m = await redis.zcount(
    "reef:sessions:actor:agent:last_seen",
    now - WINDOWS.active5mMs,
    now,
  );

  const activeAgents1h = await redis.zcount(
    "reef:sessions:actor:agent:last_seen",
    now - WINDOWS.active1hMs,
    now,
  );

  const connectedAuthenticatedUsers = await redis.zcount(
    "reef:sessions:auth:last_seen",
    now - WINDOWS.active1hMs,
    now,
  );

  const poolIds = await redis.smembers("reef:pools:known");
  const sortedPools = Array.from(
    new Set([...(Array.isArray(poolIds) ? poolIds : []), ...KNOWN_POOLS]),
  ).filter((poolId) => KNOWN_POOLS.includes(poolId));

  const pools = [];
  for (const poolId of sortedPools) {
    const snapshot = await getPoolSnapshot(redis, poolId, now);
    if (snapshot) pools.push(snapshot);
  }

  const occupiedPools = pools.filter((pool) => pool.occupied).length;
  const availablePools = Math.max(0, sortedPools.length - occupiedPools);

  const poolJoinEvents24h = await redis.zcount("reef:events:joins", now - WINDOWS.events24hMs, now);
  const interactions24h = await redis.zcount("reef:events:interactions", now - WINDOWS.events24hMs, now);

  const firstSeenRaw = await redis.get("reef:service:first_seen_at");
  const firstSeen = Number(firstSeenRaw || now);
  const systemUptimeSeconds = Math.max(0, Math.floor((now - firstSeen) / 1000));

  const lastUpdated = new Date(now).toISOString();

  return {
    mode: "live",
    source: "upstash",
    generated_at: lastUpdated,
    active_agents_now: Number(activeAgentsNow || 0),
    active_agents_5m: Number(activeAgents5m || 0),
    active_agents_1h: Number(activeAgents1h || 0),
    connected_authenticated_users: Number(connectedAuthenticatedUsers || 0),
    occupied_pools: occupiedPools,
    available_pools: availablePools,
    pool_join_events_24h: Number(poolJoinEvents24h || 0),
    interactions_24h: Number(interactions24h || 0),
    system_uptime_seconds: systemUptimeSeconds,
    last_updated: lastUpdated,
    pools,
    copy_state:
      occupiedPools > 0
        ? "Reef activity detected in the current tide window."
        : "This reef is calm right now. First entrants shape the atmosphere.",
    // Backward-compatible keys
    agents_inside: Number(activeAgentsNow || 0),
    current_drift: occupiedPools > 0 ? "High Signal" : "Quiet Depth",
    requests_queue: 0,
    degraded: false,
  };
}

module.exports = {
  KNOWN_POOLS,
  WINDOWS,
  canAccessPool,
  getPoolSnapshot,
  getReefStatus,
  getRedis,
  hasRedisConfig,
  json,
  normalizePoolId,
  parseJsonBody,
  readPassFromEvent,
  recordActivity,
  signPassToken,
};
