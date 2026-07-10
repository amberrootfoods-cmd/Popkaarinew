import { randomBytes } from "node:crypto";

const PRODUCTS = Object.freeze({
  "raw-makhana-100g": Object.freeze({
    sku: "raw-makhana-100g",
    name: "Raw Makhana",
    variant: "100g",
    pricePaise: 24900,
    inStock: true,
  }),
});

const COUPONS = Object.freeze({
  POPKAARI50: Object.freeze({ amountPaise: 5000, minimumSubtotalPaise: 24900 }),
});

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "https://popkaari.com",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", message: "Use POST to place an order." });

  if (String(event.body || "").length > 50000) {
    return json(413, { code: "PAYLOAD_TOO_LARGE", message: "Order payload is too large." });
  }

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { code: "INVALID_JSON", message: "The order request is not valid JSON." });
  }

  const validation = validateOrder(input);
  if (!validation.ok) return json(422, { code: "VALIDATION_ERROR", message: validation.message });

  const supabaseUrl = trimTrailingSlash(process.env.SUPABASE_URL || "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, {
      code: "STORAGE_NOT_CONFIGURED",
      message: "Permanent order storage is not configured yet. Please complete the order on WhatsApp.",
    });
  }

  const { order, publicResult } = buildOrder(validation.value);
  const saved = await insertOrder({ supabaseUrl, serviceRoleKey, order });
  if (!saved.ok) {
    if (saved.duplicate) {
      const existing = await findByClientOrderId({
        supabaseUrl,
        serviceRoleKey,
        clientOrderId: order.client_order_id,
      });
      if (existing) {
        return json(200, {
          orderNumber: existing.order_number,
          status: existing.status,
          productTotalPaise: existing.total_paise,
          duplicate: true,
        });
      }
    }
    console.error("[orders] Supabase insert failed", saved.status, saved.safeError);
    return json(502, {
      code: "ORDER_STORAGE_FAILED",
      message: "We could not save the order securely. Please try again or complete it on WhatsApp.",
    });
  }

  return json(201, publicResult);
}

export function validateOrder(input) {
  if (!input || typeof input !== "object") return invalid("Order details are required.");
  if (input.consent !== true) return invalid("Consent is required to process the order.");

  const clientOrderId = clean(input.clientOrderId, 80);
  if (!/^[a-z0-9-]{8,80}$/i.test(clientOrderId)) return invalid("The client order reference is invalid.");

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) {
    return invalid("Add at least one valid product to the cart.");
  }

  const combined = new Map();
  for (const requested of input.items) {
    const sku = clean(requested?.sku, 80);
    const product = PRODUCTS[sku];
    const quantity = Number(requested?.quantity);
    if (!product || !product.inStock) return invalid("One or more products are unavailable.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return invalid("Product quantity must be between 1 and 10.");
    combined.set(sku, (combined.get(sku) || 0) + quantity);
    if (combined.get(sku) > 10) return invalid("Product quantity must be between 1 and 10.");
  }

  const items = Array.from(combined, ([sku, quantity]) => {
    const product = PRODUCTS[sku];
    return {
      sku,
      name: product.name,
      variant: product.variant,
      quantity,
      unitPricePaise: product.pricePaise,
      lineTotalPaise: product.pricePaise * quantity,
    };
  });

  const customer = input.customer || {};
  const name = clean(customer.name, 80);
  const phone = normalisePhone(customer.phone);
  const email = clean(customer.email, 254).toLowerCase();
  const address1 = clean(customer.address1, 240);
  const city = clean(customer.city, 80);
  const state = clean(customer.state, 80);
  const pincode = clean(customer.pincode, 6);
  const notes = clean(customer.notes, 300);

  if (name.length < 2) return invalid("Enter the customer name.");
  if (!phone) return invalid("Enter a valid Indian mobile number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return invalid("Enter a valid email address.");
  if (address1.length < 8) return invalid("Enter a complete delivery address.");
  if (city.length < 2 || state.length < 2) return invalid("Enter the delivery city and state.");
  if (!/^[1-9][0-9]{5}$/.test(pincode)) return invalid("Enter a valid six-digit pincode.");

  const coupon = clean(input.coupon, 24).toUpperCase() || null;
  if (coupon && !COUPONS[coupon]) return invalid("The coupon is not valid.");

  return {
    ok: true,
    value: {
      clientOrderId,
      items,
      coupon,
      customer: { name, phone, email: email || null, address1, city, state, pincode, notes: notes || null },
      source: clean(input.source, 40) || "website_cart",
    },
  };
}

export function buildOrder(value) {
  const subtotalPaise = value.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  const coupon = value.coupon ? COUPONS[value.coupon] : null;
  const discountPaise = coupon && subtotalPaise >= coupon.minimumSubtotalPaise
    ? Math.min(coupon.amountPaise, subtotalPaise)
    : 0;
  const totalPaise = subtotalPaise - discountPaise;
  const orderNumber = createOrderNumber();

  const order = {
    client_order_id: value.clientOrderId,
    order_number: orderNumber,
    status: "pending_confirmation",
    source: value.source,
    customer_name: value.customer.name,
    customer_phone: value.customer.phone,
    customer_email: value.customer.email,
    address_line_1: value.customer.address1,
    city: value.customer.city,
    state: value.customer.state,
    pincode: value.customer.pincode,
    customer_notes: value.customer.notes,
    coupon_code: value.coupon,
    items: value.items,
    subtotal_paise: subtotalPaise,
    discount_paise: discountPaise,
    total_paise: totalPaise,
    currency: "INR",
    consent_at: new Date().toISOString(),
  };

  return {
    order,
    publicResult: { orderNumber, status: order.status, productTotalPaise: totalPaise },
  };
}

async function insertOrder({ supabaseUrl, serviceRoleKey, order }) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey, "return=minimal"),
      body: JSON.stringify(order),
    });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => ({}));
    return {
      ok: false,
      duplicate: response.status === 409,
      status: response.status,
      safeError: body.code || body.message || "unknown",
    };
  } catch (error) {
    return { ok: false, duplicate: false, status: 0, safeError: error?.name || "network" };
  }
}

async function findByClientOrderId({ supabaseUrl, serviceRoleKey, clientOrderId }) {
  try {
    const query = new URLSearchParams({
      client_order_id: `eq.${clientOrderId}`,
      select: "order_number,status,total_paise",
      limit: "1",
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/orders?${query}`, {
      headers: supabaseHeaders(serviceRoleKey),
    });
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
}

function supabaseHeaders(key, prefer) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function createOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `PK-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function normalisePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : "";
}

function clean(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function invalid(message) {
  return { ok: false, message };
}

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}
