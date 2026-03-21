const Stripe = require("stripe");
const { signPassToken } = require("./_reef");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

function safePath(path, fallback = "/success") {
  if (typeof path !== "string") return fallback;
  return path.startsWith("/") ? path : fallback;
}

function clampMinutes(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 60 * 24 * 45);
}

exports.handler = async (event) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return { statusCode: 500, body: "Missing STRIPE_SECRET_KEY" };
    }

    if (!process.env.PASS_SIGNING_SECRET) {
      return { statusCode: 500, body: "Missing PASS_SIGNING_SECRET" };
    }

    const sessionId = event.queryStringParameters?.session_id;
    if (!sessionId) {
      return { statusCode: 400, body: "Missing session_id" };
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return { statusCode: 403, body: "Payment not completed" };
    }

    const metadata = session.metadata || {};
    const nextPath = safePath(metadata.next, "/success");
    const scope = String(metadata.scope || "all_pools");
    const plan = String(metadata.plan || "driftpass");
    const minutes = clampMinutes(metadata.minutes, 60);

    const expiresAt = Date.now() + minutes * 60 * 1000;

    const token = signPassToken(
      {
        pid: session.id,
        plan,
        scope,
        exp: expiresAt,
        issued_at: Date.now(),
      },
      process.env.PASS_SIGNING_SECRET,
    );

    const cookie = [
      `reeflux_pass=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${minutes * 60}`,
    ].join("; ");

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
    console.error("success error:", error);
    return { statusCode: 500, body: "success failed" };
  }
};
