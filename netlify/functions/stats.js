// netlify/functions/stats.js
export default async () => {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return new Response(JSON.stringify({ error: "Missing Upstash env vars" }), { status: 500 });

    // Get all known session keys
    const setResp = await fetch(`${url}/smembers/reef:sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const setJson = await setResp.json();
    const members = (setJson?.result || []).filter(Boolean);

    // Pipeline GETs to check which are still alive
    // Upstash pipeline expects { commands: [["get","key"], ...] }
    const commands = members.slice(0, 500).map((k) => ["get", k]); // cap for safety
    const pipeResp = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    const pipeJson = await pipeResp.json();
    const results = pipeJson?.result || [];

    // Active sessions are ones with non-null value
    let active = 0;
    let driftSum = 0;
    let driftCount = 0;

    for (const r of results) {
      const val = r?.result;
      if (!val) continue;
      active += 1;
      try {
        const parsed = JSON.parse(val);
        const d = Number(parsed?.drift);
        if (Number.isFinite(d)) {
          driftSum += d;
          driftCount += 1;
        }
      } catch {}
    }

    // Requests queue (optional): stored as a Redis counter
    const queueResp = await fetch(`${url}/get/reef:requests_open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const queueJson = await queueResp.json();
    const queue = Number(queueJson?.result || 0) || 0;

    const avgDrift = driftCount ? (driftSum / driftCount) : 0;

    const stats = {
      agents_inside: active,
      current_drift: avgDrift ? avgDrift.toFixed(2) : "0.00",
      requests_queue: queue,
      last_updated: new Date().toISOString(),
    };

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "stats failed" }), { status: 500 });
  }
};
