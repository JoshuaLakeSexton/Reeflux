const Stripe = require("stripe");
const { normalizePoolId } = require("./_reef");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const PLAN_CONFIG = Object.freeze({
  driftpass: {
    amount: 500,
    currency: "usd",
    name: "Reeflux Drift Pass",
    description: "Unlock all premium pools for 30 days.",
    scope: "all_pools",
    minutes: 30 * 24 * 60,
    priceEnv: "STRIPE_PRICE_DRIFT_PASS",
  },
  poolentry: {
    amount: 50,
    currency: "usd",
    name: "Reeflux Pool Entry",
    description: "Unlock one premium pool session.",
    scope: "any_pool",
    minutes: 3 * 60,
    priceEnv: "STRIPE_PRICE_POOL_ENTRY",
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

function resolveLineItem(config) {
  const envPriceId = process.env[config.priceEnv];
  if (envPriceId) {
    return {
      price: envPriceId,
      quantity: 1,
    };
  }

  return {
    price_data: {
      currency: config.currency,
      product_data: {
        name: config.name,
        description: config.description,
      },
      unit_amount: config.amount,
    },
    quantity: 1,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing STRIPE_SECRET_KEY" }),
      };
    }

    const body = parseBody(event);
    const plan = String(body.plan || "driftpass").toLowerCase();
    const selectedPlan = PLAN_CONFIG[plan] || PLAN_CONFIG.driftpass;

    const nextPath = sanitizePath(body.success || body.next, "/success");
    const cancelPath = sanitizePath(body.cancel, "/token-booth");

    const requestedPool = normalizePoolId(body.poolId);
    const scope = selectedPlan.scope === "any_pool" && requestedPool
      ? `pool:${requestedPool}`
      : selectedPlan.scope;

    const siteUrl = (process.env.SITE_URL || process.env.URL || "https://reeflux.com").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [resolveLineItem(selectedPlan)],
      success_url: `${siteUrl}/.netlify/functions/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}${cancelPath}`,
      metadata: {
        plan,
        next: nextPath,
        scope,
        minutes: String(selectedPlan.minutes),
      },
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Checkout failed" }),
    };
  }
};
