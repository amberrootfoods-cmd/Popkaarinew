# Popkaari D2C ordering setup

This milestone adds a direct-order cart and checkout request to the existing static site without pretending that payment or delivery is confirmed.

## Customer flow

1. Add Raw Makhana to cart and change quantity.
2. Apply `POPKAARI50` for ₹50 off when the product subtotal is at least ₹249.
3. Enter delivery details. Cart and form draft are saved in the browser between visits.
4. The website sends only SKU and quantity to the server. The server recalculates price and discount from its own catalogue.
5. A confirmed database write returns an order number. Popkaari then confirms delivery and shares a secure payment link on WhatsApp.
6. If permanent storage is unavailable, the order is labelled as local-only and the customer receives a pre-filled WhatsApp fallback. The UI never claims that the database saved it.

## Permanent storage (recommended)

Use Supabase Postgres behind Netlify Functions. Customer data must not be written directly from browser JavaScript.

1. Create a Supabase project in the preferred India/nearby region.
2. Run [`supabase-schema.sql`](./supabase-schema.sql) in its SQL editor.
3. In Netlify, add server-only environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. Test one order and one email signup, then verify rows in `orders` and `leads`.

The service-role key bypasses row-level security and must never be placed in `index.html`, `assets/js/*`, GitHub Actions logs, screenshots, or any `PUBLIC_`/`VITE_` variable.

## What is saved where

| Data | Browser | Server database |
| --- | --- | --- |
| Cart | `popkaari_cart_v1` | Included inside a submitted order |
| Checkout draft | `popkaari_checkout_draft_v1` | Only after explicit order consent |
| Failed/pending order | Last five in `popkaari_pending_orders_v1` | No—customer is clearly routed to WhatsApp |
| Order | Cleared after confirmed save | `orders` table |
| Email signup | Used to avoid repeated prompts | `leads` table |

## Privacy and operations

- Publish real Privacy, Terms, Shipping, Returns and Cancellation pages before accepting production orders.
- Define who can access Supabase and remove access immediately when a team member leaves.
- Keep the current database backup policy documented and test a restore quarterly.
- Set a retention period for abandoned/local drafts and customer PII. The browser currently keeps drafts until successful order or manual site-data deletion.
- Use an approved payment provider for payment creation and webhook verification. Never collect card or UPI credentials in this checkout form.
- Add rate limiting or bot protection before paid traffic is sent to the direct checkout.

## Next engineering milestone

Add an India-supported payment gateway with server-created payment orders, signed webhook verification, payment status updates, customer confirmation messages, shipping-rate calculation and an internal order-management view.
