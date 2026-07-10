import test from "node:test";
import assert from "node:assert/strict";
import { buildOrder, handler, validateOrder } from "../netlify/functions/orders.mjs";

function validInput(overrides = {}) {
  return {
    clientOrderId: "54b2d4fd-a3b9-41de-bf3b-99cbc1812345",
    items: [{ sku: "raw-makhana-100g", quantity: 2 }],
    coupon: "POPKAARI50",
    customer: {
      name: "Aman Test",
      phone: "9910657383",
      email: "aman@example.com",
      address1: "12 Test Street, Sector 1",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110001",
      notes: "Call before delivery",
    },
    consent: true,
    source: "website_cart",
    ...overrides,
  };
}

test("validates and prices an order on the server", () => {
  const validation = validateOrder(validInput());
  assert.equal(validation.ok, true);
  const { order } = buildOrder(validation.value);
  assert.equal(order.subtotal_paise, 49800);
  assert.equal(order.discount_paise, 5000);
  assert.equal(order.total_paise, 44800);
  assert.equal(order.items[0].unitPricePaise, 24900);
  assert.match(order.order_number, /^PK-\d{8}-[A-F0-9]{6}$/);
});

test("does not trust a browser-supplied price", () => {
  const validation = validateOrder(validInput({
    items: [{ sku: "raw-makhana-100g", quantity: 1, pricePaise: 1 }],
  }));
  assert.equal(validation.ok, true);
  const { order } = buildOrder(validation.value);
  assert.equal(order.subtotal_paise, 24900);
  assert.equal(order.total_paise, 19900);
});

test("rejects unknown products", () => {
  const validation = validateOrder(validInput({ items: [{ sku: "fake-product", quantity: 1 }] }));
  assert.equal(validation.ok, false);
  assert.match(validation.message, /unavailable/i);
});

test("rejects invalid phone and pincode", () => {
  const validation = validateOrder(validInput({
    customer: { ...validInput().customer, phone: "123", pincode: "000000" },
  }));
  assert.equal(validation.ok, false);
  assert.match(validation.message, /mobile/i);
});

test("rejects an unapproved coupon", () => {
  const validation = validateOrder(validInput({ coupon: "NOTREAL" }));
  assert.equal(validation.ok, false);
  assert.match(validation.message, /coupon/i);
});

test("returns a clear fallback when permanent storage is not configured", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const response = await handler({ httpMethod: "POST", body: JSON.stringify(validInput()) });
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).code, "STORAGE_NOT_CONFIGURED");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
