// netlify/functions/success.js

const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const sessionId = params.session_id;

    if (!sessionId) {
      return {
        statusCode: 302,
        headers: { Location: "/success.html?ok=0&reason=missing_session" },
        body: "",
      };
    }

    // Verify the checkout session with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const mode = session.mode; // "payment" or "subscription"
    const status = session.status; // usually "complete" when done
    const paymentStatus = session.payment_status; // "paid" for one-time

    const paidOk =
      (mode === "payment" && paymentStatus === "paid") ||
      (mode === "subscription" && status === "complete");

    const pool = (session.metadata && session.metadata.pool) ? session.metadata.pool : "";
    const product = (session.metadata && session.metadata.product) ? session.metadata.product : mode;

    if (!paidOk) {
      return {
        statusCode: 302,
        headers: {
          Location: `/success.html?ok=0&reason=not_paid&mode=${encodeURIComponent(
            mode || ""
          )}&status=${encodeURIComponent(status || "")}`,
        },
        body: "",
      };
    }

    // MVP cookie (optional but helpful). success.html will also set localStorage.
    // 30 days:
    const cookie = `reefpass=true; Max-Age=2592000; Path=/; SameSite=Lax; Secure`;

    return {
      statusCode: 302,
      headers: {
        "Set-Cookie": cookie,
        Location: `/success.html?ok=1&mode=${encodeURIComponent(
          mode || ""
        )}&product=${encodeURIComponent(product || "")}&pool=${encodeURIComponent(pool || "")}`,
      },
      body: "",
    };
  } catch (err) {
    console.error("success.js error:", err);
    return {
      statusCode: 302,
      headers: { Location: "/success.html?ok=0&reason=server_error" },
      body: "",
    };
  }
};
