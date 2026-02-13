// netlify/functions/stats.js
const { Redis } = require("@upstash/redis");

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async () => {
  // If Upstash isn't configured, return stable fallback stats
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return json(200, {
      agents_inside: 0,
      current_drift: "Soft Coral Breeze",
      requests_queue: 0,
      last_updated: new Date().toISOString(),
      degraded: true,
      reason: 
::contentReference[oaicite:0]{index=0}
