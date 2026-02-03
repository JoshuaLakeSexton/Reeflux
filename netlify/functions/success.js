// netlify/functions/success.js

const Stripe = require("stripe");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/**
 * Minimal "DB" for MVP:
 * Netlify serverless functions have no persistent filesystem.
 * For real Option A, you need persistence (Supabase recommended).
 *
 * This version still sets a signed cookie after verifying Stripe payment,
 * and encodes the expiration time in the token itself.
 *
 * Next step: we can add Supabase to persist pass records.
 */

// --- Token signing helpers (HMAC) ---
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signToken(payloadObj, secret) {
  const payloadJson = JSON.stringify(payloadObj);
  const payload = base64url(payloadJson);
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64");
  const signature = sig.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${payload}.${signature}`;
}

exports.handler = async (event) => {
  try {
    const sessionId = event.queryStringParameters?.session_id;
    if (!sessionId) {
      return { statusCode: 400, body: "Missing session_id" };
    }

    // 1) Verify payment with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== "paid") {
      return { statusCode: 403, body: "Payment not completed" };
    }

    // 2) Pull metadata we set in checkout.js
    const nextPath = (session.metadata && session.metadata.next) || "/tide-deck.html";
    const scope = (session.metadata && session.metadata.scope) || "any_pool";
    const minutes = parseInt((session.metadata && session.metadata.minutes) || "30", 10);

    // Safety: only allow internal redirects
    const safeNext = nextPath.startsWith("/") ? nextPath : "/tide-deck.html";

    // 3) Create a signed pass token (MVP)
    const now = Date.now();
    const exp = now + minutes * 60 * 1000;

    const token = signToken(
      {
        pid: sessionId,     // using sessionId as unique id for MVP
        scope,
        exp,                // expiry in ms epoch
      },
      process.env.PASS_SIGNING_SECRET
    );

    // 4) Set httpOnly cookie and redirect to destination
    const cookie = [
      `reeflux_pass=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      // Max-Age in seconds
      `Max-Age=${minutes * 60}`,
    ].join("; ");

    return {
      statusCode: 302,
      headers: {
        "Set-Cookie": cookie,
        Location: safeNext,
      },
      body: "",
    };
  } catch (err) {
    console.error("success.js error:", err);
    return { statusCode: 500, body: "Success handler failed" };
  }
};
