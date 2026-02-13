// netlify/functions/checkout.js
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Your Stripe Price IDs (you provided these)
const PRICE_DRIFT = "price_1Sw8AYPSnae9DdPY6fG3zhH7";   // monthly
const PRICE_SINGLE = "price_1Sw88QPSnae9DdPYz2kKFsFF";  // one-time

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");

    const tier = String(body.tier || "single").toLowerCase(); // "single" | "drift"
    const pool = String(body.pool || "unknown").toLowerCase(); // ambient/sandbox/tide-deck/etc
    const nextPath = String(body.next || "/index.html");

    // Safety: only allow internal redirects
    if (!nextPath.startsWith("/")) {
      return { statusCode: 400, body: "Invalid redirect path" };
    }

    const siteUrl = process.env.SITE_URL || "https://reeflux.com";

    const mode = tier === "drift" ? "subscription" : "payment";
    const price = tier === "drift" ? PRICE_DRIFT : PRICE_SINGLE;

    const successUrl =
      `${siteUrl}/success` +
      `?session_id={CHECKOUT_SESSION_ID}` +
      `&tier=${encodeURIComponent(tier)}` +
      `&pool=${encodeURIComponent(pool)}` +
      `&next=${encodeURIComponent(nextPath)}`;

    const cancelUrl = `${siteUrl}${nextPath}?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode,
      payment_method_types: ["card"],
      line_items: [{ price, quantity: 1 }],

      success_url: successUrl,
      cancel_url: cancelUrl,

      metadata: {
        tier,
        pool,
        next: nextPath,
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
      body: JSON.stringify({ error: "Checkout failed" }),
    };
  }
};
