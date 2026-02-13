// netlify/functions/success.js
const Stripe = require("stripe");

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY || !STRIPE_KEY.startsWith("sk_")) {
  throw new Error("Bad STRIPE_SECRET_KEY (expected sk_...)");
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

function safePath(p) {
  const s = String(p || "/index.html");
  return s.startsWith("/") ? s : "/index.html";
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
    body: "",
  };
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const sessionId = q.session_id;
    const next = safePath(q.next);
    const tier = String(q.tier || "single").toLowerCase();
    const pool = String(q.pool || "").toLowerCase();

    if (!sessionId) {
      return redirect(`/redeem.html?ok=0&reason=missing_session&next=${encodeURIComponent(next)}`);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paidOk =
      (session.mode === "payment" && session.payment_status === "paid") ||
      (session.mode === "subscription" && session.status === "complete");

    if (!paidOk) {
      return redirect(
        `/redeem.html?ok=0&reason=not_paid&next=${encodeURIComponent(next)}&tier=${encodeURIComponent(
          tier
        )}&pool=${encodeURIComponent(pool)}`
      );
    }

    return redirect(
      `/redeem.html?ok=1&next=${encodeURIComponent(next)}&tier=${encodeURIComponent(
        tier
      )}&pool=${encodeURIComponent(pool)}`
    );
  } catch (err) {
    console.error("success.js error:", err);
    return redirect(`/redeem.html?ok=0&reason=server_error`);
  }
};
