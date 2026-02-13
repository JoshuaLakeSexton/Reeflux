// netlify/functions/checkout.js
const Stripe = require("stripe");

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY || !(STRIPE_KEY.startsWith("sk_") || STRIPE_KEY.startsWith("rk_"))) {
  throw new Error("Bad STRIPE_SECRET_KEY (expected sk_... or rk_...)");
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

// Prices
const PRICE_DRIFT = process.env.PRICE_DRIFT || "price_1Sw8AYPSnae9DdPY6fG3zhH7"; // recurring
const PRICE_SINGLE = process.env.PRICE_SINGLE || "price_1Sw88QPSnae9DdPYz2kKFsFF"; // one-time

function cleanSiteUrl(url) {
  return String(url || "https://reeflux.com").replace(/\/+$/, "");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const tier = String(body.tier || "single").toLowerCase(); // "single" | "drift"
    const pool = String(body.pool || "").toLowerCase();
    const nextPath = String(body.next || "/index.html");

    if (!nextPath.startsWith("/")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid next path" }),
      };
    }

    const siteUrl = cleanSiteUrl(process.env.SITE_URL);

    // send Stripe back to the Netlify SUCCESS function
    const successUrl =
      `${siteUrl}/.netlify/functions/success` +
      `?session_id={CHECKOUT_SESSION_ID}` +
      `&next=${encodeURIComponent(nextPath)}` +
      `&tier=${encodeURIComponent(tier)}` +
      `&pool=${encodeURIComponent(pool)}`;

    const cancelUrl = `${siteUrl}${nextPath}?canceled=1`;

    const isDrift = tier === "drift";
    const priceId = isDrift ? PRICE_DRIFT : PRICE_SINGLE;
    const mode = isDrift ? "subscription" : "payment";

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tier, pool, next: nextPath },
      allow_promotion_codes: true,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Checkout error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Checkout failed",
        message: err && err.message ? err.message : String(err),
        type: err && err.type ? err.type : undefined,
      }),
    };
  }
};
