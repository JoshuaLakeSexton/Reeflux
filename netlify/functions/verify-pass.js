const { json, readPassFromEvent } = require("./_reef");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const entitlement = readPassFromEvent(event);

    if (!entitlement.allowed) {
      return json(200, {
        allowed: false,
        reason: entitlement.reason,
      });
    }

    return json(200, {
      allowed: true,
      reason: "ok",
      scope: entitlement.payload.scope,
      plan: entitlement.payload.plan,
      expiresAt: entitlement.payload.exp,
      issuedAt: entitlement.payload.issued_at,
    });
  } catch (error) {
    console.error("verify-pass error:", error);
    return json(500, {
      allowed: false,
      reason: "verify_failed",
    });
  }
};
