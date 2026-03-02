const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const PRICING = Object.freeze({
  driftpass: {
    amount: 500,
    name: "Reeflux Drift Pass",
    description: "Unlock Reeflux pool access on this device.",
  },
  poolentry: {
    amount: 50,
    name: "Reeflux Pool Entry",
    description: "Unlock one Reeflux pool session.",
  },
});

function parseBody(event) {
  if (event.httpMethod === "GET") {
    return event.queryStringParameters || {};
  }

  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return {};
  }
}

function sanitizePath(path, fallback) {
  if (typeof path !== "string") return fallback;
  return path.startsWith("/") ? path : fallback;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = parseBody(event);

    const plan = String(body.plan || "driftpass").toLowerCase();
    const selectedPlan = PRICING[plan] || PRICING.driftpass;

    const successPath = sanitizePath(body.success, "/success");
    const cancelPath = sanitizePath(body.cancel, "/token-booth");

    const siteUrl = (process.env.SITE_URL || process.env.URL || "https://reeflux.com").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: selectedPlan.name,
              description: selectedPlan.description,
            },
            unit_amount: selectedPlan.amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}${successPath}`,
      cancel_url: `${siteUrl}${cancelPath}`,
      metadata: {
        plan,
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
