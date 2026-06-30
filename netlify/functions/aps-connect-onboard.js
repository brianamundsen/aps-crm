// aps-connect-onboard.js
// Creates a Stripe Connect Express account and returns onboarding URL
// POST { locationCode, locationName, email }

const Stripe = require("stripe");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { locationCode, locationName, email } = body;
  if (!locationCode || !locationName) return { statusCode: 400, body: "locationCode and locationName required" };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: email || undefined,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: locationName, product_description: "Athletic performance training and evaluation" },
      metadata: { locationCode }
    });

    await fetch(`${SB_URL}/rest/v1/aps_locations?code=eq.${locationCode}`, {
      method: "PATCH",
      headers: SB_HEADERS,
      body: JSON.stringify({ stripe_account_id: account.id, stripe_onboarded: false })
    });

    const appUrl = event.headers.origin || "https://heroic-kelpie-182180.netlify.app";
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${appUrl}/?location=${locationCode}&stripe=refresh`,
      return_url: `${appUrl}/?location=${locationCode}&stripe=success`,
      type: "account_onboarding"
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: accountLink.url, accountId: account.id })
    };
  } catch (err) {
    console.error("Stripe onboard error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
