// netlify/functions/ping.js
export default async (req) => {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return new Response("Missing Upstash env vars", { status: 500 });

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "");
    const drift = Number(body.drift || 0);

    if (!sessionId) return new Response("Missing sessionId", { status: 400 });

    const key = `reef:sess:${sessionId}`;
    const ttlSeconds = 180; // "inside" if seen in last 3 minutes

    // Store session heartbeat with TTL
    await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: JSON.stringify({ t: Date.now(), drift }), ex: ttlSeconds }),
    });

    // Track sessions in a set (for counting)
    await fetch(`${url}/sadd/reef:sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ members: [key] }),
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
};
