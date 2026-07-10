# Popkaari storefront

Static Popkaari website with a progressive D2C ordering foundation.

## Included in the first ordering milestone

- cart with quantity controls and `POPKAARI50` discount support;
- cart and delivery-draft persistence in browser storage;
- accessible mobile/desktop checkout drawer;
- server-validated Netlify order endpoint;
- Supabase schema for orders and consented leads;
- clear WhatsApp fallback when permanent storage is unavailable;
- ecommerce events for GA4/GTM.

## Local checks

```bash
npm test
npm run check
```

For the complete database and deployment instructions, read [`docs/d2c-ordering-setup.md`](docs/d2c-ordering-setup.md).

Use `netlify dev` when testing function-backed order storage locally. A plain static server can test the cart and checkout fallback, but it cannot save orders permanently.
