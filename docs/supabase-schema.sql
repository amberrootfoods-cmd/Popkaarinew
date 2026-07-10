-- Popkaari D2C order and lead storage.
-- Run in the Supabase SQL editor, then configure SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY only in Netlify environment variables.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  client_order_id text not null unique,
  order_number text not null unique,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'confirmed', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded')),
  source text not null default 'website_cart',
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  address_line_1 text not null,
  city text not null,
  state text not null,
  pincode text not null,
  customer_notes text,
  coupon_code text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  subtotal_paise integer not null check (subtotal_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  total_paise integer not null check (total_paise >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_customer_phone_idx on public.orders (customer_phone);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  interest text,
  source text not null default 'website',
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- Browser clients must never read or write customer/order data directly.
alter table public.orders enable row level security;
alter table public.leads enable row level security;

-- No anon/authenticated policies are intentionally created. Netlify Functions
-- use the service role on the server and bypass RLS. Never expose that key in JS.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();
