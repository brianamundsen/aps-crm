// aps-webhook.js
// Handles Stripe webhook events
// Endpoint: /.netlify/functions/aps-webhook

const Stripe = require("stripe");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

function calcAge(dob) {
  if (!dob) return "";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age > 0 && age < 100 ? String(age) : "";
}

function mapGender(g) {
  if (!g) return "Boys";
  const l = g.toLowerCase();
  if (l === "female" || l === "f" || l === "girl" || l === "girls") return "Girls";
  return "Boys";
}

function blankResults() {
  return {
    "10 yd split": "", "20 yd split": "", "40 yd dash": "",
    "Vertical Jump": "", "Broad Jump": "", "5-10-5 Agility": "",
    "Chin up Hold": ""
  };
}

async function createAthlete(meta) {
  const athlete = {
    name: meta.athleteName || "Unknown",
    age: calcAge(meta.athleteDob),
    gender: mapGender(meta.athleteGender),
    height: "", weight: "", date: "", program: "", notes: "", goals: "",
    results: blankResults(),
    source: "aps_signup",
    email: meta.athleteEmail || "",
    phone: meta.athletePhone || "",
    dob: meta.athleteDob || "",
    evaluations: []
  };

  const res = await fetch(`${SB_URL}/rest/v1/aps_athletes`, {
    method: "POST",
    headers: SB_HEADERS,
    body: JSON.stringify({ location_id: parseInt(meta.locationId) || null, info: JSON.stringify(athlete) })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase insert failed: ${t}`);
  }

  const rows = await res.json();
  return rows[0];
}

async function convertLeadToActive(meta, athleteId) {
  var locationId = parseInt(meta.locationId) || null;
  var email = (meta.athleteEmail || "").trim();
  var phone = (meta.athletePhone || "").trim();

  if (!locationId || (!email && !phone)) return null;

  var filters = [];
  if (email) filters.push("email.eq." + encodeURIComponent(email));
  if (phone) filters.push("phone.eq." + encodeURIComponent(phone));
  var orFilter = "or=(" + filters.join(",") + ")";

  var lookupRes = await fetch(
    `${SB_URL}/rest/v1/aps_contacts?location_id=eq.${locationId}&${orFilter}&select=id,stage`,
    { headers: SB_HEADERS }
  );
  if (!lookupRes.ok) return null;

  var matches = await lookupRes.json();
  if (!matches.length) return null;

  var lead = matches[0];
  var updateRes = await fetch(`${SB_URL}/rest/v1/aps_contacts?id=eq.${lead.id}`, {
    method: "PATCH",
    headers: SB_HEADERS,
    body: JSON.stringify({ stage: "active", athlete_id: athleteId })
  });
  if (!updateRes.ok) return null;

  // Log the stage change in aps_activities, matching the existing activity pattern
  try {
    await fetch(`${SB_URL}/rest/v1/aps_activities`, {
      method: "POST",
      headers: SB_HEADERS,
      body: JSON.stringify({
        location_id: locationId,
        contact_id: lead.id,
        type: "stage_change",
        body: (lead.stage || "lead") + " -> active (payment completed)"
      })
    });
  } catch (e) {
    console.error("Activity log failed (non-fatal):", e.message);
  }

  return lead.id;
}

exports.handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const meta = session.metadata || {};

      const athlete = await createAthlete(meta);
      console.log("Athlete created from checkout session:", athlete && athlete.id);

      try {
        const linkedLeadId = await convertLeadToActive(meta, athlete.id);
        if (linkedLeadId) {
          console.log("Linked existing lead to new athlete:", linkedLeadId);
        }
      } catch (leadErr) {
        // Non-fatal: athlete was already created successfully, don't fail the whole webhook
        console.error("Lead conversion failed (non-fatal):", leadErr.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
