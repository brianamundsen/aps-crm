// aps-create-lead.js
// Creates a Pipeline lead (aps_contacts) once a parent has entered name + DOB,
// before they complete payment. Called from signup.html.
// Endpoint: /.netlify/functions/aps-create-lead

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_HEADERS = {
  "apikey": SB_KEY,
  "Authorization": "Bearer " + SB_KEY,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

function splitName(fullName) {
  var parts = (fullName || "").trim().split(/\s+/);
  var first = parts.shift() || "";
  var last = parts.join(" ") || "";
  return { first: first, last: last };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    var body = JSON.parse(event.body || "{}");
    var locationId = parseInt(body.locationId);
    var athleteName = (body.athleteName || "").trim();
    var email = (body.email || "").trim();
    var phone = (body.phone || "").trim();

    if (!locationId || !athleteName) {
      return { statusCode: 400, body: JSON.stringify({ error: "locationId and athleteName are required" }) };
    }

    var name = splitName(athleteName);

    // Avoid duplicate leads: check if a lead already exists for this location + email/phone
    if (email || phone) {
      var filters = [];
      if (email) filters.push("email.eq." + encodeURIComponent(email));
      if (phone) filters.push("phone.eq." + encodeURIComponent(phone));
      var orFilter = "or=(" + filters.join(",") + ")";

      var existingRes = await fetch(
        `${SB_URL}/rest/v1/aps_contacts?location_id=eq.${locationId}&${orFilter}&select=id,stage`,
        { headers: SB_HEADERS }
      );
      if (existingRes.ok) {
        var existing = await existingRes.json();
        if (existing.length) {
          // Lead already exists for this parent/location — don't create a duplicate
          return {
            statusCode: 200,
            body: JSON.stringify({ leadId: existing[0].id, existing: true })
          };
        }
      }
    }

    var insertRes = await fetch(`${SB_URL}/rest/v1/aps_contacts`, {
      method: "POST",
      headers: SB_HEADERS,
      body: JSON.stringify({
        location_id: locationId,
        first_name: name.first,
        last_name: name.last,
        email: email,
        phone: phone,
        relationship: "Parent",
        stage: "lead",
        source: "Web"
      })
    });

    if (!insertRes.ok) {
      var errText = await insertRes.text();
      throw new Error("Supabase insert failed: " + errText);
    }

    var rows = await insertRes.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ leadId: rows[0].id, existing: false })
    };
  } catch (err) {
    console.error("aps-create-lead error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
