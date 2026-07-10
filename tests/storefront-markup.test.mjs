import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("storefront includes the cart, checkout, storage hooks and scripts", () => {
  for (const marker of [
    'id="cartDrawer"',
    'id="checkoutForm"',
    'data-add-to-cart="raw-makhana-100g"',
    'src="assets/js/store.js"',
    'href="assets/css/store.css"',
    'emailEndpoint: "/.netlify/functions/leads"',
  ]) {
    assert.ok(html.includes(marker), `missing ${marker}`);
  }
});

test("HTML ids are unique", () => {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});
