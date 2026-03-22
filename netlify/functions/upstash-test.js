const { Redis } = require("@upstash/redis");
const { getRedisRuntimeConfig } = require("./_env");

exports.handler = async () => {
  try {
    const redisConfig = getRedisRuntimeConfig();
    if (!redisConfig.ok) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({
          ok: false,
          error: "redis_env_invalid",
          missing: redisConfig.errors,
          unsafe: true,
        }),
      };
    }

    const redis = new Redis({
      url: redisConfig.url,
      token: redisConfig.token,
    });

    await redis.set("rf:test", { ok: true, at: new Date().toISOString() });
    const val = await redis.get("rf:test");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        ok: true,
        value: val,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        ok: false,
        error: "redis_probe_failed",
        reason_code: e?.message || "redis_probe_failed",
      }),
    };
  }
};
