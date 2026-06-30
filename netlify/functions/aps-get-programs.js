// aps-get-programs.js
// Returns location info and available programs
// GET ?location=MISHAWAKA

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json"
};

exports.handler = async function(event) {
  const code = (event.queryStringParameters?.location || "").toUpperCase().trim();
  if (!code) return { statusCode: 400, body: "location required" };

  try {
    const [locRes, prodRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/aps_locations?code=eq.${code}&select=id,name,code,stripe_onboarded`, { headers: SB_HEADERS }),
      fetch(`${SB_URL}/rest/v1/aps_products?select=id,name,description,price_cents&order=price_cents.asc`, { headers: SB_HEADERS })
    ]);

    const locations = await locRes.json();
    const location = locations[0];
    if (!location) return { statusCode: 404, body: "Location not found" };

    const allProducts = await prodRes.json();
    const products = allProducts.filter(p => true);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ location, products })
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
