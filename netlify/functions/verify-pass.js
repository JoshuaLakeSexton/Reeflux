// netlify/functions/verify-pass.js

const crypto = require("crypto");

function decodeBase64Url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  // pad
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString("utf8");
}

function verifyToken(token, secret) {
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (sig !== expectedSig) return null;

  const payloadJson = decodeBase64Url(payloadB64);
  return JSON.parse(payloadJson);
}

function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || "").split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

exports.handler = async (event) => {
  try {
    const cookies = parseCookies(event.headers.cookie);
    const token = cookies.reeflux_pass;

    if (!token) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: false, reason: "no_pass" }),
      };
    }

    const payload = verifyToken(token, process.env.PASS_SIGNING_SECRET);
    if (!payload) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: false, reason: "invalid_token" }),
      };
    }

    const now = Date.now();
    if (!payload.exp || now > payload.exp) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: false, reason: "expired" }),
      };
    }

    // Optional scope enforcement (MVP: any_pool)
    // If you ever make pool-specific, pass ?pool=mirror or infer from page.
    // Example:
    // const pool = event.queryStringParameters?.pool;
    // if (payload.scope !== "any_pool" && payload.scope !== `${pool}_pool`) ...

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed: true,
        scope: payload.scope,
        expiresAt: payload.exp,
      }),
    };
  } catch (err) {
    console.error("verify-pass error:", err);
    return { statusCode: 500, body: "verify-pass failed" };
  }
};
