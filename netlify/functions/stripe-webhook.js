const Stripe = require("stripe");
const { ENTITLEMENT_STATUS, getRedis, json, upsertEntitlement } = require("./_reef");
const { readEnv, validateRequiredEnv } = require("./_env");

const STRIPE_API_VERSION = "2023-10-16";

function getStripeClient() {
  const secretKey = readEnv("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

function mapSubscriptionStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "active" || value === "trialing") return ENTITLEMENT_STATUS.active;
  if (value === "past_due" || value === "unpaid" || value === "incomplete") {
    return ENTITLEMENT_STATUS.past_due;
  }
  if (value === "canceled" || value === "incomplete_expired") return ENTITLEMENT_STATUS.canceled;
  return ENTITLEMENT_STATUS.inactive;
}

function getEventCreatedMs(stripeEvent) {
  return Number(stripeEvent?.created || Math.floor(Date.now() / 1000)) * 1000;
}

function parseWebhookBody(event) {
  if (!event || typeof event.body !== "string") return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

async function processCheckoutCompleted(stripeEvent, redis) {
  const session = stripeEvent.data.object || {};
  if (session.payment_status !== "paid") {
    return { action: "ignored_not_paid" };
  }

  const metadata = session.metadata || {};
  const plan = String(metadata.plan || "driftpass");
  const scope = String(metadata.scope || "all_pools");
  const minutes = Number.parseInt(String(metadata.minutes || "0"), 10);

  const now = Date.now();
  const expiresAt = Number.isFinite(minutes) && minutes > 0
    ? now + minutes * 60 * 1000
    : null;

  const customerId = String(session.customer || "").trim() || null;
  const customerEmail = String(
    session.customer_details?.email || session.customer_email || "",
  ).trim().toLowerCase() || null;

  const subscriptionId = String(session.subscription || "").trim() || null;
  const entitlementId = subscriptionId ? `sub:${subscriptionId}` : String(session.id || "").trim();

  if (!entitlementId) {
    throw new Error("missing_entitlement_id_from_checkout");
  }

  const result = await upsertEntitlement(redis, {
    entitlementId,
    status: ENTITLEMENT_STATUS.active,
    plan,
    scope,
    expiresAt,
    customerId,
    customerEmail,
    checkoutSessionId: String(session.id || "").trim() || null,
    subscriptionId,
    sourceEventType: stripeEvent.type,
    sourceEventId: stripeEvent.id,
    eventCreatedMs: getEventCreatedMs(stripeEvent),
    updatedReason: "checkout_completed",
  });

  return {
    action: result.stale ? "ignored_stale_checkout" : "entitlement_upserted_checkout",
    entitlementId,
  };
}

async function processSubscriptionEvent(stripeEvent, redis) {
  const subscription = stripeEvent.data.object || {};
  const subscriptionId = String(subscription.id || "").trim();
  if (!subscriptionId) {
    throw new Error("missing_subscription_id");
  }

  const entitlementId = `sub:${subscriptionId}`;
  const status = mapSubscriptionStatus(subscription.status);
  const plan = String(subscription.metadata?.plan || "driftpass");
  const scope = String(subscription.metadata?.scope || "all_pools");

  const expiresAt = Number(subscription.current_period_end || 0) > 0
    ? Number(subscription.current_period_end) * 1000
    : null;

  const customerId = String(subscription.customer || "").trim() || null;

  const result = await upsertEntitlement(redis, {
    entitlementId,
    status,
    plan,
    scope,
    expiresAt,
    customerId,
    subscriptionId,
    sourceEventType: stripeEvent.type,
    sourceEventId: stripeEvent.id,
    eventCreatedMs: getEventCreatedMs(stripeEvent),
    updatedReason: `subscription_${status}`,
  });

  return {
    action: result.stale ? "ignored_stale_subscription" : "entitlement_upserted_subscription",
    entitlementId,
    status,
  };
}

async function processInvoiceEvent(stripeEvent, redis) {
  const invoice = stripeEvent.data.object || {};
  const subscriptionId = String(invoice.subscription || "").trim();

  if (!subscriptionId) {
    return { action: "ignored_invoice_without_subscription" };
  }

  const entitlementId = `sub:${subscriptionId}`;
  const status = stripeEvent.type === "invoice.paid"
    ? ENTITLEMENT_STATUS.active
    : ENTITLEMENT_STATUS.past_due;

  const periodEnd = Number(
    invoice.lines?.data?.[0]?.period?.end || invoice.period_end || 0,
  );

  const expiresAt = periodEnd > 0 ? periodEnd * 1000 : null;
  const customerId = String(invoice.customer || "").trim() || null;

  const result = await upsertEntitlement(redis, {
    entitlementId,
    status,
    expiresAt,
    customerId,
    subscriptionId,
    sourceEventType: stripeEvent.type,
    sourceEventId: stripeEvent.id,
    eventCreatedMs: getEventCreatedMs(stripeEvent),
    updatedReason: stripeEvent.type === "invoice.paid" ? "invoice_paid" : "invoice_payment_failed",
  });

  return {
    action: result.stale ? "ignored_stale_invoice" : "entitlement_upserted_invoice",
    entitlementId,
    status,
  };
}

async function processStripeEvent(stripeEvent, redis) {
  switch (stripeEvent.type) {
    case "checkout.session.completed":
      return processCheckoutCompleted(stripeEvent, redis);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return processSubscriptionEvent(stripeEvent, redis);

    case "invoice.paid":
    case "invoice.payment_failed":
      return processInvoiceEvent(stripeEvent, redis);

    default:
      return { action: "ignored_event_type" };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  const envCheck = validateRequiredEnv([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);

  if (!envCheck.ok) {
    return json(500, {
      ok: false,
      error: "webhook_env_invalid",
      missing: envCheck.missing,
      unsafe: true,
    });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return json(500, { ok: false, error: "stripe_unavailable", unsafe: true });
  }

  const signature = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"];
  if (!signature) {
    return json(400, { ok: false, error: "missing_stripe_signature" });
  }

  const webhookSecret = readEnv("STRIPE_WEBHOOK_SECRET");
  const rawBody = parseWebhookBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("stripe-webhook signature verification failed", {
      message: error?.message || String(error),
    });

    return json(400, {
      ok: false,
      error: "invalid_signature",
    });
  }

  const redis = getRedis();
  if (!redis) {
    return json(500, {
      ok: false,
      error: "entitlement_store_unavailable",
      unsafe: true,
    });
  }

  const processedKey = `reef:webhook:processed:${stripeEvent.id}`;

  try {
    const reserved = await redis.setnx(processedKey, `processing:${Date.now()}`);
    if (!reserved) {
      return json(200, {
        ok: true,
        duplicate: true,
        eventId: stripeEvent.id,
        eventType: stripeEvent.type,
      });
    }

    await redis.expire(processedKey, 60 * 60 * 24 * 45);

    const result = await processStripeEvent(stripeEvent, redis);

    await redis.set(processedKey, `done:${Date.now()}:${stripeEvent.type}`);
    await redis.expire(processedKey, 60 * 60 * 24 * 45);

    console.log("stripe-webhook processed", {
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
      action: result.action,
      entitlementId: result.entitlementId || null,
    });

    return json(200, {
      ok: true,
      duplicate: false,
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
      action: result.action,
      entitlementId: result.entitlementId || null,
    });
  } catch (error) {
    try {
      await redis.del(processedKey);
    } catch (cleanupError) {
      console.error("stripe-webhook cleanup failed", {
        eventId: stripeEvent.id,
        eventType: stripeEvent.type,
        message: cleanupError?.message || String(cleanupError),
      });
    }

    console.error("stripe-webhook processing failed", {
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
      message: error?.message || String(error),
    });

    return json(500, {
      ok: false,
      error: "webhook_processing_failed",
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
    });
  }
};
