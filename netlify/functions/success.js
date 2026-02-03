const Stripe = require("stripe");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

function b64url(str) {
  return Buffer.from(str).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sign(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${payload}.${sig}`;
}

exports.handler = async (event) => {
  try {
    const sessionId = event.queryStringParameters?.session_id;
    if (!sessionId) return { statusCode: 400, body: "Missing session_id" };

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return { statusCode: 403, body: "Payment not completed" };
    }

    const next = (session.metadata?.next || "/tide-deck.html");
    const scope = (session.metadata?.scope || "any_pool");
    const minutes = parseInt(session.metadata?.minutes || "30", 10);

    const safeNext = next.startsWith("/") ? next : "/tide-deck.html";

    const exp = Date.now() + minutes * 60 * 1000;

    const token = sign(
      { pid: sessionId, scope, exp },
      process.env.PASS_SIGNING_SECRET
    );

    const cookie = [
      `reeflux_pass=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${minutes * 60}`
    ].join("; ");

    return {
      statusCode: 302,
      headers: {
        "Set-Cookie": cookie,
        "Location": safeNext
      },
      body: ""
    };
  } catch (e) {
    console.error("success error:", e);
    return { statusCode: 500, body: "success failed" };
  }
};
