// netlify/functions/checkout.js
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Your prices (as you provided)
const PRICE_DRIFT = "price_1Sw8AYPSnae9DdPY6fG3zhH7";   // $1.25/mo (must be recurring)
const PRICE_SINGLE = "price_1Sw88QPSnae9DdPYz2kKFsFF";  // $0.50 one-time

function cleanSiteUrl(url) {
  return String(url || "https://reeflux.com").replace(/\/+$/, "");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // expected from app.js: { tier: "single"|"drift", pool: "tide-deck", next: "/tide-deck.html" }
    const tier = String(body.tier || "single").toLowerCase();
    const pool = String(body.pool || "");
    const nextPath = String(body.next || "/index.html");

    // Safety: only allow internal redirects
    if (!nextPath.startsWith("/")) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid next path" }) };
    }

    const siteUrl = cleanSiteUrl(process.env.SITE_URL);

    // IMPORTANT: send Stripe back to the Netlify SUCCESS function (not /success)
    const successUrl =
      `${siteUrl}/.netlify/functions/success` +
      `?session_id={CHECKOUT_SESSION_ID}` +
      `&next=${encodeURIComponent(nextPath)}` +
      `&tier=${encodeURIComponent(tier)}` +
      `&pool=${encodeURIComponent(pool)}`;

    const cancelUrl = `${siteUrl}${nextPath}?canceled=1`;

    // Pick price + mode
    const isDrift = tier === "drift";
    const priceId = isDrift ? PRICE_DRIFT : PRICE_SINGLE;
    const mode = isDrift ? "subscription" : "payment";

    // Guardrails: detect swapped prices / wrong mode early with a clear message
    const priceObj = await stripe.prices.retrieve(priceId);
    const recurring = !!priceObj.recurring;

    if (isDrift && !recurring) {
      throw new Error(
        `DRIFT is set to subscription but PRICE_DRIFT (${priceId}) is NOT recurring. ` +
        `Swap your PRICE_DRIFT / PRICE_SINGLE values.`
      );
    }
    if (!isDrift && recurring) {
      throw new Error(
        `SINGLE is set to payment but PRICE_SINGLE (${priceId}) IS recurring. ` +
        `Swap your PRICE_DRIFT / PRICE_SINGLE values.`
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      metadata: {
        tier,
        pool,
        next: nextPath,
      },

      allow_promotion_codes: true,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Checkout error:", err);

    // Return the REAL reason to the browser (so you can see it in DevTools)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Checkout failed",
        message: err?.message || String(err),
        type: err?.type,
        code: err?.code,
        param: err?.param,
        requestId: err?.requestId,
      }),
    };
  }
};
