const Stripe = require("stripe");
const {
  buildPassCookie,
  clearPassCookie,
  signPassToken,
  upsertEntitlement,
  getRedis,
  ENTITLEMENT_STATUS,
  withTimeout,
} = require("./_reef");
const { readEnv, validateRequiredEnv } = require("./_env");

const STRIPE_API_VERSION = "2023-10-16";

function getStripeClient() {
  const secretKey = readEnv("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

function safePath(path, fallback = "/success") {
  if (typeof path !== "string") return fallback;
  return path.startsWith("/") ? path : fallback;
}

function clampMinutes(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 60 * 24 * 45);
}

function resolveEntitlementId(session) {
  const subscriptionId = String(session?.subscription || "").trim();
  if (subscriptionId) return `sub:${subscriptionId}`;
  return String(session?.id || "").trim();
}

function pendingRedirect(reason) {
  const encoded = encodeURIComponent(reason || "entitlement_sync_pending");
  return {
    statusCode: 302,
    headers: {
      "Set-Cookie": clearPassCookie(),
      Location: `/success?status=pending&reason=${encoded}`,
      "Cache-Control": "no-store",
    },
    body: "",
  };
}

exports.handler = async (event) => {
  try {
    const envCheck = validateRequiredEnv([
      "STRIPE_SECRET_KEY",
      "PASS_SIGNING_SECRET",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
    ]);

    if (!envCheck.ok) {
      console.error("success env invalid", { missing: envCheck.missing });
      return pendingRedirect("env_invalid");
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return pendingRedirect("stripe_unavailable");
    }

    const sessionId = event.queryStringParameters?.session_id;
    if (!sessionId) {
      return pendingRedirect("missing_session_id");
    }

    const session = await withTimeout(
      stripe.checkout.sessions.retrieve(sessionId, { expand: ["customer"] }),
      4000,
      "stripe_retrieve_timeout",
    );

    if (!session || session.payment_status !== "paid") {
      return pendingRedirect("payment_not_completed");
    }

    const redis = getRedis();
    if (!redis) {
      return pendingRedirect("entitlement_store_unavailable");
    }

    const metadata = session.metadata || {};
    const nextPath = safePath(metadata.next, "/success");
    const scope = String(metadata.scope || "all_pools");
    const plan = String(metadata.plan || "driftpass");
    const minutes = clampMinutes(metadata.minutes, 60);
    const entitlementId = resolveEntitlementId(session);

    if (!entitlementId) {
      return pendingRedirect("entitlement_write_failed");
    }

    const now = Date.now();
    const expiresAt = now + minutes * 60 * 1000;

    const customerId = typeof session.customer === "string"
      ? session.customer
      : String(session.customer?.id || "").trim() || null;

    const customerEmail = String(
      session.customer_details?.email || session.customer_email || session.customer?.email || "",
    ).trim().toLowerCase() || null;

    const entitlementResult = await withTimeout(upsertEntitlement(redis, {
      entitlementId,
      status: ENTITLEMENT_STATUS.active,
      plan,
      scope,
      expiresAt,
      customerId,
      customerEmail,
      checkoutSessionId: session.id,
      subscriptionId: String(session.subscription || "").trim() || null,
      sourceEventType: "success.session_paid",
      sourceEventId: session.id,
      eventCreatedMs: Number(session.created || Math.floor(now / 1000)) * 1000,
      updatedReason: "success_callback",
    }), 2200, "entitlement_upsert_timeout");

    if (!entitlementResult.entitlement) {
      return pendingRedirect("entitlement_write_failed");
    }

    const passSecret = readEnv("PASS_SIGNING_SECRET");
    const token = signPassToken(
      {
        eid: entitlementId,
        pid: entitlementId,
        plan,
        scope,
        exp: expiresAt,
        issued_at: now,
        cid: customerId || undefined,
      },
      passSecret,
    );

    const cookie = buildPassCookie(token, minutes * 60);

    return {
      statusCode: 302,
      headers: {
        "Set-Cookie": cookie,
        Location: nextPath,
        "Cache-Control": "no-store",
      },
      body: "",
    };
  } catch (error) {
    const errorType = String(error?.type || "").trim();
    const errorMessage = String(error?.message || "").toLowerCase();

    console.error("success error", {
      message: error?.message || String(error),
      type: errorType || "success_failed",
    });

    if (errorType === "StripeInvalidRequestError" || errorMessage.includes("no such checkout.session")) {
      return pendingRedirect("invalid_session_id");
    }

    if (errorType === "StripeAPIError" || errorType === "StripeConnectionError") {
      return pendingRedirect("stripe_unavailable");
    }

    if (error?.code === "stripe_retrieve_timeout") {
      return pendingRedirect("stripe_unavailable");
    }

    if (error?.code === "entitlement_upsert_timeout") {
      return pendingRedirect("entitlement_store_unavailable");
    }

    return pendingRedirect("entitlement_sync_pending");
  }
};
