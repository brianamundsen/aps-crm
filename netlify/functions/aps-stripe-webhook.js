// aps-stripe-webhook.js
// Verifies incoming Stripe webhook events and syncs aps_memberships / aps_payments.
// Configure this URL as a webhook endpoint in the Stripe Dashboard (test mode):
//   https://YOUR-SITE.netlify.app/.netlify/functions/aps-stripe-webhook
// Copy the resulting signing secret into the Netlify env var STRIPE_WEBHOOK_SECRET.

const Stripe = require("stripe");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: SB_HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Supabase POST failed: " + (await r.text()));
  return r.json();
}
async function sbPatch(table, filter, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: SB_HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Supabase PATCH failed: " + (await r.text()));
  return r.json();
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        const md = session.metadata || {};
        if (!md.contactId) break; // not one of ours

        if (session.mode === "subscription") {
          await sbPost("aps_memberships", {
            location_id: parseInt(md.locationId),
            contact_id: parseInt(md.contactId),
            plan_name: md.productName || "Membership",
            status: "active",
            price_cents: parseInt(md.priceCents) || null,
            billing_interval: md.billingInterval || null,
            stripe_subscription_id: session.subscription,
            started_at: new Date().toISOString().slice(0, 10)
          });
        } else {
          await sbPost("aps_payments", {
            location_id: parseInt(md.locationId),
            contact_id: parseInt(md.contactId),
            stripe_payment_intent: session.payment_intent,
            amount_cents: parseInt(md.priceCents) || session.amount_total,
            status: "succeeded"
          });
        }
        break;
      }
      case "invoice.paid": {
        const invoice = stripeEvent.data.object;
        if (invoice.subscription) {
          await sbPatch("aps_memberships", `stripe_subscription_id=eq.${invoice.subscription}`, {
            status: "active",
            renews_at: invoice.lines?.data?.[0]?.period?.end
              ? new Date(invoice.lines.data[0].period.end * 1000).toISOString().slice(0, 10)
              : null
          });
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = stripeEvent.data.object;
        if (invoice.subscription) {
          await sbPatch("aps_memberships", `stripe_subscription_id=eq.${invoice.subscription}`, { status: "past_due" });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;
        await sbPatch("aps_memberships", `stripe_subscription_id=eq.${sub.id}`, {
          status: "cancelled",
          cancelled_at: new Date().toISOString().slice(0, 10)
        });
        break;
      }
      default:
        break; // ignore anything we don't handle
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error("Webhook handling error:", err);
    // Return 200 anyway so Stripe doesn't hammer retries on a Supabase hiccup we've already logged.
    return { statusCode: 200, body: JSON.stringify({ received: true, warning: err.message }) };
  }
};
