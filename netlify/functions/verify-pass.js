const crypto = require("crypto");

function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || "").split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

function decodeB64UrlToJson(b64url) {
  let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}

function verify(token, secret) {
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  if (sig !== expected) return null;
  return decodeB64UrlToJson(payloadB64);
}

exports.handler = async (event) => {
  try {
    const cookies = parseCookies(event.headers.cookie);
    const token = cookies.reeflux_pass;

    if (!token) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed: false, reason: "no_pass" }) };
    }

    const payload = verify(token, process.env.PASS_SIGNING_SECRET);
    if (!payload) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed: false, reason: "invalid_token" }) };
    }

    if (!payload.exp || Date.now() > payload.exp) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed: false, reason: "expired" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed: true, scope: payload.scope, expiresAt: payload.exp })
    };
  } catch (e) {
    console.error("verify-pass error:", e);
    return { statusCode: 500, body: "verify-pass failed" };
  }
};
