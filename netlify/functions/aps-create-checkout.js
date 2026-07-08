// aps-create-checkout.js
// Creates a Stripe Checkout session for a program signup
// POST { locationCode, programId, athleteData: { name, dob, gender, email, phone } }

const Stripe = require("stripe");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

const PLATFORM_FEE_PERCENT = 2;

async function getLocation(code) {
  const res = await fetch(`${SB_URL}/rest/v1/aps_locations?code=eq.${code}&select=*`, { headers: SB_HEADERS });
  const rows = await res.json();
  return rows[0] || null;
}

async function getProgram(id) {
  const res = await fetch(`${SB_URL}/rest/v1/aps_products?id=eq.${id}&select=*`, { headers: SB_HEADERS });
  const rows = await res.json();
  return rows[0] || null;
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { locationCode, programId, athleteData, leadId } = body;
  if (!locationCode || !programId || !athleteData?.name) {
    return { statusCode: 400, body: "locationCode, programId, and athleteData.name required" };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = event.headers.origin || "https://heroic-kelpie-182180.netlify.app";

  try {
    const [location, program] = await Promise.all([getLocation(locationCode), getProgram(programId)]);

    if (!location) return { statusCode: 404, body: "Location not found" };
    if (!program) return { statusCode: 404, body: "Program not found" };
    if (!location.stripe_account_id) return { statusCode: 400, body: "Location has not connected Stripe yet" };

    const platformFee = Math.round(program.price_cents * PLATFORM_FEE_PERCENT / 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: program.name,
            description: program.description || `${location.name} — ${program.name}`
          },
          unit_amount: program.price_cents
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: `${appUrl}/signup-success?location=${locationCode}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/signup?location=${locationCode}`,
      customer_email: athleteData.email || undefined,
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: { destination: location.stripe_account_id }
      },
      metadata: {
        locationCode,
        locationId: String(location.id),
        programId: String(programId),
        athleteName: athleteData.name,
        athleteDob: athleteData.dob || "",
        athleteGender: athleteData.gender || "",
        athleteEmail: athleteData.email || "",
        athletePhone: athleteData.phone || "",
        leadId: leadId || ""
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };
  } catch (err) {
    console.error("Checkout error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
