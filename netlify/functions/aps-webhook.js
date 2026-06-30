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
