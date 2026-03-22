const Stripe = require("stripe");
const { normalizePoolId } = require("./_reef");
const { getSiteUrl, readEnv, validateRequiredEnv } = require("./_env");

const STRIPE_API_VERSION = "2023-10-16";

const PLAN_CONFIG = Object.freeze({
  driftpass: {
    amount: 500,
    currency: "usd",
    name: "Reeflux Drift Pass",
    description: "Unlock all premium pools for 30 days.",
    scope: "all_pools",
    minutes: 30 * 24 * 60,
    priceEnv: "STRIPE_PRICE_DRIFT_PASS",
    legacyPriceEnv: "PRICE_DRIFT_PASS",
  },
  poolentry: {
    amount: 50,
    currency: "usd",
    name: "Reeflux Pool Entry",
    description: "Unlock one premium pool session.",
    scope: "any_pool",
    minutes: 3 * 60,
    priceEnv: "STRIPE_PRICE_POOL_ENTRY",
    legacyPriceEnv: "PRICE_SINGLE_POOL",
  },
});

function getStripeClient() {
  const secretKey = readEnv("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

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
  const envPriceId = readEnv(config.priceEnv) || readEnv(config.legacyPriceEnv);
  if (envPriceId) {
    return {
      lineItem: {
        price: envPriceId,
        quantity: 1,
      },
      usingEnvPriceId: true,
      envPriceId,
    };
  }

  return {
    lineItem: {
      price_data: {
        currency: config.currency,
        product_data: {
          name: config.name,
          description: config.description,
        },
        unit_amount: config.amount,
      },
      quantity: 1,
    },
    usingEnvPriceId: false,
    envPriceId: "",
  };
}

function buildInlineLineItem(config) {
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

function shouldRetryWithInlinePrice(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "resource_missing" || message.includes("no such price");
}

function buildSessionPayload({
  mode,
  lineItem,
  siteUrl,
  cancelPath,
  metadata,
  resolvedPlan,
  scope,
}) {
  const payload = {
    mode,
    line_items: [lineItem],
    success_url: `${siteUrl}/.netlify/functions/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}${cancelPath}`,
    metadata,
  };

  if (mode === "subscription") {
    payload.subscription_data = {
      metadata: {
        plan: resolvedPlan,
        scope,
      },
    };
    return payload;
  }

  payload.payment_method_types = ["card"];
  payload.customer_creation = "always";
  return payload;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    const envCheck = validateRequiredEnv(["STRIPE_SECRET_KEY"]);
    if (!envCheck.ok) {
      return json(500, {
        ok: false,
        error: "checkout_env_invalid",
        missing: envCheck.missing,
        unsafe: true,
      });
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return json(500, {
        ok: false,
        error: "stripe_unavailable",
        unsafe: true,
      });
    }

    const body = parseBody(event);
    const plan = String(body.plan || "driftpass").toLowerCase();
    const resolvedPlan = PLAN_CONFIG[plan] ? plan : "driftpass";
    const selectedPlan = PLAN_CONFIG[plan] || PLAN_CONFIG.driftpass;

    const nextPath = sanitizePath(body.success || body.next, "/success");
    const cancelPath = sanitizePath(body.cancel, "/token-booth");

    const requestedPool = normalizePoolId(body.poolId);
    const scope = selectedPlan.scope === "any_pool" && requestedPool
      ? `pool:${requestedPool}`
      : selectedPlan.scope;

    const siteUrl = getSiteUrl();

    const lineItemConfig = resolveLineItem(selectedPlan);
    const metadata = {
      plan: resolvedPlan,
      next: nextPath,
      scope,
      minutes: String(selectedPlan.minutes),
    };

    let mode = "payment";
    let chosenLineItem = lineItemConfig.lineItem;

    if (lineItemConfig.usingEnvPriceId) {
      try {
        const price = await stripe.prices.retrieve(lineItemConfig.envPriceId);
        mode = price?.recurring ? "subscription" : "payment";
      } catch (error) {
        if (!shouldRetryWithInlinePrice(error)) throw error;

        console.error("checkout env price invalid, falling back to inline price", {
          plan,
          resolvedPlan,
          priceEnv: selectedPlan.priceEnv,
          legacyPriceEnv: selectedPlan.legacyPriceEnv,
          priceId: lineItemConfig.envPriceId,
          message: error?.message || String(error),
        });

        mode = "payment";
        chosenLineItem = buildInlineLineItem(selectedPlan);
      }
    }

    let sessionPayload = buildSessionPayload({
      mode,
      lineItem: chosenLineItem,
      siteUrl,
      cancelPath,
      metadata,
      resolvedPlan,
      scope,
    });

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionPayload);
    } catch (error) {
      if (!lineItemConfig.usingEnvPriceId || !shouldRetryWithInlinePrice(error)) {
        throw error;
      }

      console.error("checkout env price invalid, falling back to inline price", {
        plan,
        resolvedPlan,
        priceEnv: selectedPlan.priceEnv,
        legacyPriceEnv: selectedPlan.legacyPriceEnv,
        priceId: lineItemConfig.envPriceId,
        message: error?.message || String(error),
      });

      sessionPayload = buildSessionPayload({
        mode: "payment",
        lineItem: buildInlineLineItem(selectedPlan),
        siteUrl,
        cancelPath,
        metadata,
        resolvedPlan,
        scope,
      });

      session = await stripe.checkout.sessions.create(sessionPayload);
    }

    return json(200, {
      ok: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    const errorType = String(error?.type || "").trim();
    const errorCode = String(error?.code || "").trim();

    let reason = "checkout_failed";
    if (errorType === "StripeAuthenticationError") reason = "stripe_auth_error";
    else if (errorType === "StripePermissionError") reason = "stripe_permission_error";
    else if (errorType === "StripeInvalidRequestError") reason = "stripe_invalid_request";
    else if (errorType === "StripeConnectionError" || errorType === "StripeAPIError") {
      reason = "stripe_unavailable";
    }

    console.error("checkout error", {
      message: error?.message || String(error),
      type: errorType || "checkout_failed",
      code: errorCode || null,
      reason,
    });

    return json(500, {
      ok: false,
      error: reason,
      unsafe: true,
    });
  }
};
