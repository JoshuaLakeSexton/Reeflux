// netlify/functions/checkout.js

const Stripe = require("stripe");

// Stripe secret key is set in Netlify environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed",
      };
    }

    const body = JSON.parse(event.body || "{}");

    // Where the user should go after successful payment
    const nextPath = body.next || "/tide-deck.html";

    // MVP defaults
    const scope = body.scope || "any_pool";
    const minutes = body.minutes || 30;

    // Safety: only allow internal redirects
    if (!nextPath.startsWith("/")) {
      return {
        statusCode: 400,
        body: "Invalid redirect path",
      };
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Reeflux Drift Pass",
              description: `Unlock Reeflux pool access for ${minutes} minutes.`,
            },
            unit_amount: 500, // $5.00 — change later if you want
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.SITE_URL}/.netlify/functions/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/token-booth.html?canceled=1`,

      metadata: {
        next: nextPath,
        scope: scope,
        minutes: String(minutes),
      },
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Stripe checkout error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Checkout failed" }),
    };
  }
};
