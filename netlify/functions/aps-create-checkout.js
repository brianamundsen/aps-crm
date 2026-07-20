// aps-create-checkout.js
// Creates a Stripe Checkout Session for an aps_products row, billed to a contact.
// Uses the location's connected Stripe account if onboarded, else falls back to
// the platform's own test account so checkout still works pre-onboarding.
// POST { productId, contactId }

const Stripe = require("stripe");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json"
};

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error("Supabase GET failed: " + (await r.text()));
  return r.json();
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { productId, contactId } = body;
  if (!productId || !contactId) return { statusCode: 400, body: "productId and contactId required" };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const products = await sbGet(`aps_products?id=eq.${productId}&select=*`);
    if (!products.length) return { statusCode: 404, body: "Product not found" };
    const product = products[0];

    const contacts = await sbGet(`aps_contacts?id=eq.${contactId}&select=*`);
    if (!contacts.length) return { statusCode: 404, body: "Contact not found" };
    const contact = contacts[0];

    const locations = await sbGet(`aps_locations?id=eq.${product.location_id}&select=code,stripe_account_id,stripe_onboarded`);
    const location = locations[0] || {};

    const isRecurring = !!product.billing_interval;
    const appUrl = event.headers.origin || "https://aps-crm.netlify.app";
    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Contact";

    const priceData = {
      currency: "usd",
      unit_amount: product.price_cents,
      product_data: { name: product.name, description: product.description || undefined }
    };
    if (isRecurring) priceData.recurring = { interval: product.billing_interval };

    const sessionParams = {
      mode: isRecurring ? "subscription" : "payment",
      line_items: [{ price_data: priceData, quantity: 1 }],
      customer_email: contact.email || undefined,
      client_reference_id: String(contactId),
      success_url: `${appUrl}/?location=${location.code || ""}&stripe=success&contact=${contactId}`,
      cancel_url: `${appUrl}/?location=${location.code || ""}&stripe=cancel&contact=${contactId}`,
      metadata: {
        contactId: String(contactId),
        productId: String(productId),
        locationId: String(product.location_id),
        productName: product.name,
        priceCents: String(product.price_cents),
        billingInterval: product.billing_interval || "",
        contactName
      }
    };
    // Subscriptions need the metadata on the subscription itself too, for the webhook.
    if (isRecurring) sessionParams.subscription_data = { metadata: sessionParams.metadata };

    const useConnected = location.stripe_onboarded && location.stripe_account_id;
    const session = useConnected
      ? await stripe.checkout.sessions.create(sessionParams, { stripeAccount: location.stripe_account_id })
      : await stripe.checkout.sessions.create(sessionParams);

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url, routedToConnectedAccount: !!useConnected })
    };
  } catch (err) {
    console.error("Checkout create error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
