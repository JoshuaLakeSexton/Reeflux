const crypto = require("crypto");
const { Redis } = require("@upstash/redis");
const { getRedisRuntimeConfig, readEnv } = require("./_env");

const KNOWN_POOLS = Object.freeze(["tide", "ambient", "fractal", "sandbox"]);

const WINDOWS = Object.freeze({
  activeNowMs: 90 * 1000,
  active5mMs: 5 * 60 * 1000,
  active1hMs: 60 * 60 * 1000,
  events24hMs: 24 * 60 * 60 * 1000,
  pruneSessionsMs: 2 * 60 * 60 * 1000,
});

const ENTITLEMENT_STATUS = Object.freeze({
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  inactive: "inactive",
});

function getPoolAura(active5m) {
  const value = Number(active5m || 0);
  if (value >= 8) return "High Signal";
  if (value >= 4) return "Crowded Current";
  if (value >= 2) return "Low Noise";
  if (value >= 1) return "Rare Tide";
  return "Quiet Depth";
}

function getPoolLaunchCopy(active5m) {
  const value = Number(active5m || 0);
  if (value >= 6) return "Strong current moving through this pool right now.";
  if (value >= 3) return "Active tide window. Entrants are shaping the pool in real time.";
  if (value >= 1) return "A small current is present. Early entrants define the tone.";
  return "No active agents in this current tide window.";
}

function getTrafficBand(activeAgents5m, occupiedPools) {
  const active = Number(activeAgents5m || 0);
  const occupied = Number(occupiedPools || 0);

  if (active >= 8 || occupied >= 3) return "high";
  if (active >= 3 || occupied >= 2) return "moderate";
  if (active >= 1 || occupied >= 1) return "low";
  return "calm";
}

function getReefCopyByTrafficBand(trafficBand) {
  if (trafficBand === "high") {
    return "Strong reef current detected. Multiple pools are actively occupied.";
  }

  if (trafficBand === "moderate") {
    return "Steady reef activity is present across current tide windows.";
  }

  if (trafficBand === "low") {
    return "Early current detected. Activity is present and still forming.";
  }

  return "Calm tide window. No active agents in the last 5 minutes.";
}

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
  return getRedisRuntimeConfig().ok;
}

function getRedis() {
  const redisConfig = getRedisRuntimeConfig();
  if (!redisConfig.ok) return null;

  return new Redis({
    url: redisConfig.url,
    token: redisConfig.token,
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

function buildPassCookie(token, maxAgeSeconds) {
  return [
    `reeflux_pass=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Number(maxAgeSeconds || 0))}`,
  ].join("; ");
}

function clearPassCookie() {
  return [
    "reeflux_pass=",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function readPassFromEvent(event) {
  const secret = readEnv("PASS_SIGNING_SECRET");
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

function normalizeEntitlementStatus(status) {
  const value = String(status || "inactive").trim().toLowerCase();

  if (value === "active" || value === "trialing") return ENTITLEMENT_STATUS.active;
  if (value === "past_due" || value === "unpaid" || value === "incomplete") return ENTITLEMENT_STATUS.past_due;
  if (value === "canceled" || value === "cancelled" || value === "incomplete_expired") {
    return ENTITLEMENT_STATUS.canceled;
  }

  return ENTITLEMENT_STATUS.inactive;
}

function parseEntitlementRecord(raw) {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) return null;

  const expiresAt = Number(raw.expires_at || 0);
  const lastEventCreatedMs = Number(raw.last_event_created || 0);
  const updatedAtMs = Number(raw.updated_at || 0);

  return {
    entitlementId: String(raw.entitlement_id || "").trim(),
    status: normalizeEntitlementStatus(raw.status),
    plan: String(raw.plan || "driftpass"),
    scope: String(raw.scope || "all_pools"),
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
    customerId: String(raw.customer_id || "").trim() || null,
    customerEmail: String(raw.customer_email || "").trim().toLowerCase() || null,
    checkoutSessionId: String(raw.checkout_session_id || "").trim() || null,
    subscriptionId: String(raw.subscription_id || "").trim() || null,
    sourceEventType: String(raw.source_event_type || "").trim() || null,
    sourceEventId: String(raw.source_event_id || "").trim() || null,
    lastEventCreatedMs: Number.isFinite(lastEventCreatedMs) ? lastEventCreatedMs : 0,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    updatedReason: String(raw.updated_reason || "").trim() || null,
  };
}

async function readEntitlement(redis, entitlementId) {
  if (!redis) return null;

  const normalized = String(entitlementId || "").trim();
  if (!normalized) return null;

  const raw = await redis.hgetall(`reef:entitlement:${normalized}`);
  const parsed = parseEntitlementRecord(raw);
  if (!parsed) return null;

  parsed.entitlementId = parsed.entitlementId || normalized;
  return parsed;
}

async function upsertEntitlement(redis, input) {
  if (!redis) {
    throw new Error("entitlement_store_unavailable");
  }

  const entitlementId = String(input?.entitlementId || "").trim();
  if (!entitlementId) {
    throw new Error("missing_entitlement_id");
  }

  const existing = await readEntitlement(redis, entitlementId);
  const eventCreatedMs = Number(input?.eventCreatedMs || Date.now());
  const safeEventCreatedMs = Number.isFinite(eventCreatedMs) ? eventCreatedMs : Date.now();

  if (existing && existing.lastEventCreatedMs > 0 && safeEventCreatedMs < existing.lastEventCreatedMs) {
    return {
      applied: false,
      stale: true,
      entitlement: existing,
    };
  }

  const status = normalizeEntitlementStatus(input?.status || existing?.status || ENTITLEMENT_STATUS.inactive);
  const plan = String(input?.plan || existing?.plan || "driftpass");
  const scope = String(input?.scope || existing?.scope || "all_pools");
  const expiresAtRaw = Number(input?.expiresAt || existing?.expiresAt || 0);
  const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? expiresAtRaw : null;

  const customerId = String(input?.customerId || existing?.customerId || "").trim() || null;
  const customerEmail = String(input?.customerEmail || existing?.customerEmail || "").trim().toLowerCase() || null;
  const checkoutSessionId = String(input?.checkoutSessionId || existing?.checkoutSessionId || "").trim() || null;
  const subscriptionId = String(input?.subscriptionId || existing?.subscriptionId || "").trim() || null;
  const sourceEventType = String(input?.sourceEventType || existing?.sourceEventType || "").trim() || null;
  const sourceEventId = String(input?.sourceEventId || existing?.sourceEventId || "").trim() || null;
  const updatedReason = String(input?.updatedReason || "").trim() || null;

  const updatedAtMs = Date.now();

  await redis.hset(`reef:entitlement:${entitlementId}`, {
    entitlement_id: entitlementId,
    status,
    plan,
    scope,
    expires_at: expiresAt ? String(expiresAt) : "",
    customer_id: customerId || "",
    customer_email: customerEmail || "",
    checkout_session_id: checkoutSessionId || "",
    subscription_id: subscriptionId || "",
    source_event_type: sourceEventType || "",
    source_event_id: sourceEventId || "",
    last_event_created: String(safeEventCreatedMs),
    updated_at: String(updatedAtMs),
    updated_reason: updatedReason || "",
  });

  if (checkoutSessionId) {
    await redis.set(`reef:entitlement:index:checkout:${checkoutSessionId}`, entitlementId);
  }

  if (subscriptionId) {
    await redis.set(`reef:entitlement:index:subscription:${subscriptionId}`, entitlementId);
  }

  if (customerId) {
    await redis.set(`reef:entitlement:index:customer:${customerId}`, entitlementId);
  }

  if (customerEmail) {
    await redis.set(`reef:entitlement:index:email:${customerEmail}`, entitlementId);
  }

  const entitlement = await readEntitlement(redis, entitlementId);

  return {
    applied: true,
    stale: false,
    entitlement,
  };
}

async function resolveEntitlementFromEvent(event, redis) {
  const signedPass = readPassFromEvent(event);
  if (!signedPass.allowed) {
    return signedPass;
  }

  if (!redis) {
    return {
      allowed: false,
      reason: "entitlement_store_unavailable",
      payload: signedPass.payload,
    };
  }

  const entitlementId = String(signedPass.payload?.eid || signedPass.payload?.pid || "").trim();
  if (!entitlementId) {
    return {
      allowed: false,
      reason: "invalid_token",
      payload: signedPass.payload,
    };
  }

  let entitlement;
  try {
    entitlement = await readEntitlement(redis, entitlementId);
  } catch (error) {
    console.error("resolve entitlement read failed", {
      entitlementId,
      message: error?.message || String(error),
    });

    return {
      allowed: false,
      reason: "entitlement_store_unavailable",
      payload: signedPass.payload,
    };
  }

  if (!entitlement) {
    return {
      allowed: false,
      reason: "entitlement_not_found",
      payload: signedPass.payload,
    };
  }

  if (entitlement.status === ENTITLEMENT_STATUS.past_due) {
    return {
      allowed: false,
      reason: "entitlement_past_due",
      payload: entitlement,
    };
  }

  if (entitlement.status !== ENTITLEMENT_STATUS.active) {
    return {
      allowed: false,
      reason: "entitlement_inactive",
      payload: entitlement,
    };
  }

  if (entitlement.expiresAt && Date.now() > entitlement.expiresAt) {
    try {
      await upsertEntitlement(redis, {
        entitlementId,
        status: ENTITLEMENT_STATUS.inactive,
        plan: entitlement.plan,
        scope: entitlement.scope,
        expiresAt: entitlement.expiresAt,
        customerId: entitlement.customerId,
        customerEmail: entitlement.customerEmail,
        checkoutSessionId: entitlement.checkoutSessionId,
        subscriptionId: entitlement.subscriptionId,
        sourceEventType: "runtime.expiry",
        sourceEventId: `runtime:${Date.now()}`,
        eventCreatedMs: Date.now(),
        updatedReason: "expired",
      });
    } catch (error) {
      console.error("resolve entitlement expiry update failed", {
        entitlementId,
        message: error?.message || String(error),
      });
    }

    return {
      allowed: false,
      reason: "expired",
      payload: entitlement,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    payload: {
      ...entitlement,
      exp: entitlement.expiresAt,
      scope: entitlement.scope,
      plan: entitlement.plan,
      eid: entitlement.entitlementId,
    },
  };
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

  const schemaVersion = await redis.get("reef:schema:version");
  if (!schemaVersion) {
    await redis.set("reef:schema:version", "2");
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

  const activityLabel = getPoolAura(active5m);
  const launchCopy = getPoolLaunchCopy(active5m);

  return {
    pool_id: normalized,
    active_now: Number(activeNow || 0),
    active_5m: Number(active5m || 0),
    last_activity: lastActivity,
    aura: activityLabel,
    launch_copy: launchCopy,
    occupied: Number(active5m || 0) > 0,
  };
}

async function getReefStatus(redis) {
  const now = Date.now();

  if (!redis) {
    const redisConfig = getRedisRuntimeConfig();

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
        aura: "Quiet Depth",
        launch_copy: "No active agents in this current tide window.",
        last_activity: null,
      })),
      copy_state:
        "Telemetry channel is temporarily limited. Reef surfaces remain available while live counts recover.",
      traffic_band: "limited",
      agents_inside: 0,
      current_drift: "Quiet Depth",
      requests_queue: 0,
      degraded: true,
      reason: "telemetry_limited",
      reason_code: redisConfig.errors.join(",") || "telemetry_limited",
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
  const trafficBand = getTrafficBand(activeAgents5m, occupiedPools);

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
    traffic_band: trafficBand,
    copy_state: getReefCopyByTrafficBand(trafficBand),
    agents_inside: Number(activeAgentsNow || 0),
    current_drift: getPoolAura(activeAgents5m),
    requests_queue: 0,
    degraded: false,
  };
}

module.exports = {
  ENTITLEMENT_STATUS,
  KNOWN_POOLS,
  WINDOWS,
  buildPassCookie,
  canAccessPool,
  clearPassCookie,
  getPoolSnapshot,
  getReefStatus,
  getRedis,
  hasRedisConfig,
  json,
  normalizePoolId,
  parseJsonBody,
  readEntitlement,
  readPassFromEvent,
  recordActivity,
  resolveEntitlementFromEvent,
  signPassToken,
  upsertEntitlement,
};
