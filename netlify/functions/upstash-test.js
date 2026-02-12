const { Redis } = require("@upstash/redis");

exports.handler = async () => {
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    await redis.set("rf:test", { ok: true, at: new Date().toISOString() });
    const val = await redis.get("rf:test");

    return { statusCode: 200, body: JSON.stringify(val) };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
