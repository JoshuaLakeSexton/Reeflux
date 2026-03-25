const { getRedis, getReefStatus, json, withTimeout } = require("./_reef");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const redis = getRedis();
    const status = await withTimeout(getReefStatus(redis), 1800, "stats_timeout");
    return json(200, status);
  } catch (error) {
    console.error("stats error", error);
    return json(200, {
      mode: "degraded",
      source: "stats_error",
      generated_at: new Date().toISOString(),
      active_agents_now: 0,
      active_agents_5m: 0,
      active_agents_1h: 0,
      connected_authenticated_users: 0,
      occupied_pools: 0,
      available_pools: 4,
      pool_join_events_24h: 0,
      interactions_24h: 0,
      system_uptime_seconds: 0,
      last_updated: new Date().toISOString(),
      pools: ["tide", "ambient", "fractal", "sandbox"].map((pool_id) => ({
        pool_id,
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
      degraded: true,
      reason: "telemetry_limited",
      reason_code: error?.message || "stats_failed",
      agents_inside: 0,
      current_drift: "Quiet Depth",
      requests_queue: 0,
    });
  }
};
