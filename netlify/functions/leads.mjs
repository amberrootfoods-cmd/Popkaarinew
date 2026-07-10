const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "https://popkaari.com",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", message: "Use POST to save a lead." });

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { code: "INVALID_JSON", message: "The signup request is not valid JSON." });
  }

  const email = String(input.email || "").trim().toLowerCase().slice(0, 254);
  const interest = clean(input.interest, 120);
  const source = clean(input.source, 80) || "website";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json(422, { code: "VALIDATION_ERROR", message: "Enter a valid email address." });
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { code: "STORAGE_NOT_CONFIGURED", message: "Permanent lead storage is not configured." });
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/leads?on_conflict=email`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        email,
        interest: interest || null,
        source,
        consent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error("[leads] Supabase upsert failed", response.status, body.code || body.message || "unknown");
      return json(502, { code: "LEAD_STORAGE_FAILED", message: "We could not save the signup securely." });
    }
    return json(201, { saved: true });
  } catch (error) {
    console.error("[leads] Storage request failed", error?.name || "network");
    return json(502, { code: "LEAD_STORAGE_FAILED", message: "We could not save the signup securely." });
  }
}

function clean(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}
