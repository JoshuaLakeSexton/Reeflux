// netlify/functions/checkout.js

const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");

    // product: "single" | "drift"
    const product = body.product || "single";
    // pool slug for single-pool purchases (optional but recommended)
    const pool = body.pool || null;

    const siteUrl = process.env.SITE_URL || "https://reeflux.com";

    const PRICE_SINGLE = process.env.PRICE_SINGLE_POOL;
    const PRICE_DRIFT = process.env.PRICE_DRIFT_PASS;

    if (!PRICE_SINGLE || !PRICE_DRIFT) {
      return {
        statusCode: 500,
        body: "Missing PRICE_SINGLE_POOL or PRICE_DRIFT_PASS env vars",
      };
    }

    const isDrift = product === "drift";
    const price = isDrift ? PRICE_DRIFT : PRICE_SINGLE;

    // Drift is a subscription, Single is a one-time payment
    const mode = isDrift ? "subscription" : "payment";

    // Where to send them after Stripe finishes
    // We'll send them to a success handler that can verify session_id
    const successUrl = `${siteUrl}/.netlify/functions/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${siteUrl}/pools?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      // Helpful metadata for your webhook / entitlement logic later
      metadata: {
        product,
        pool: pool || "",
      },
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Checkout failed" }),
    };
  }
};
