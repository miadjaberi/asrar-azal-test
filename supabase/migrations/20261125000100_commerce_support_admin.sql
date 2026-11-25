-- Asrar-e Azal: independent online commerce, subscriptions and support backend.
-- Apply only to the dedicated Asrar Supabase project, never to the Cafe production project.

create table if not exists public.asrar_products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  price numeric(14,2) not null check (price >= 0),
  sale_price numeric(14,2) check (sale_price is null or sale_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asrar_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('AZ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.asrar_products(id),
  product_title text not null default '',
  unit_price numeric(14,2) not null default 0,
  quantity integer not null default 1 check (quantity between 1 and 50),
  total_amount numeric(14,2) not null default 0,
  discount_code text not null default '',
  discount_amount numeric(14,2) not null default 0,
  customer_name text not null default '',
  customer_phone text not null default '',
  shipping_address text not null default '',
  notes text not null default '',
  status text not null default 'new' check (status in ('new','reviewing','approved','rejected','completed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','refunded','rejected')),
  payment_method text not null default '',
  receipt_url text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asrar_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  price numeric(14,2) not null check (price >= 0),
  duration_days integer not null check (duration_days > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asrar_subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.asrar_subscription_plans(id),
  plan_title text not null default '',
  amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  payment_reference text not null default '',
  receipt_url text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asrar_user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.asrar_subscription_requests(id) on delete set null,
  plan_title text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_at timestamptz not null default now()
);

create table if not exists public.asrar_payment_settings (
  id boolean primary key default true check (id = true),
  payment_title text not null default 'پرداخت کارت به کارت',
  account_holder text not null default '',
  card_number text not null default '',
  iban text not null default '',
  instructions text not null default '',
  support_phone text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.asrar_discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(14,2) not null check (discount_value > 0),
  max_uses integer,
  used_count integer not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.asrar_support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null default 'پیام به مدیریت',
  status text not null default 'open' check (status in ('open','answered','closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asrar_support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.asrar_support_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists asrar_orders_user_created_idx on public.asrar_orders(user_id, created_at desc);
create index if not exists asrar_subscription_requests_user_created_idx on public.asrar_subscription_requests(user_id, created_at desc);
create index if not exists asrar_support_threads_user_updated_idx on public.asrar_support_threads(user_id, last_message_at desc);
create index if not exists asrar_support_messages_thread_created_idx on public.asrar_support_messages(thread_id, created_at);

create or replace function public.asrar_set_order_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.asrar_products%rowtype;
  d public.asrar_discount_codes%rowtype;
  base_amount numeric(14,2);
begin
  select * into p from public.asrar_products where id = new.product_id and is_active = true;
  if not found then raise exception 'محصول در دسترس نیست'; end if;
  if p.stock < new.quantity then raise exception 'موجودی محصول کافی نیست'; end if;
  new.product_title := p.title;
  new.unit_price := case when p.sale_price is not null and p.sale_price > 0 then p.sale_price else p.price end;
  base_amount := new.unit_price * new.quantity;
  new.discount_amount := 0;
  if nullif(trim(new.discount_code),'') is not null then
    select * into d from public.asrar_discount_codes
    where upper(code)=upper(trim(new.discount_code))
      and is_active=true
      and (starts_at is null or starts_at <= now())
      and (expires_at is null or expires_at > now())
      and (max_uses is null or used_count < max_uses)
    for update;
    if not found then raise exception 'کد تخفیف نامعتبر یا منقضی شده است'; end if;
    if d.discount_type='percent' then
      new.discount_amount := least(base_amount, round(base_amount*d.discount_value/100,2));
    else
      new.discount_amount := least(base_amount,d.discount_value);
    end if;
    update public.asrar_discount_codes set used_count=used_count+1 where id=d.id;
  end if;
  new.total_amount := greatest(0,base_amount-new.discount_amount);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.asrar_set_order_snapshot() from public;
grant execute on function public.asrar_set_order_snapshot() to authenticated;

drop trigger if exists asrar_order_snapshot_before_write on public.asrar_orders;
create trigger asrar_order_snapshot_before_write
before insert on public.asrar_orders
for each row execute function public.asrar_set_order_snapshot();

create or replace function public.asrar_set_subscription_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare p public.asrar_subscription_plans%rowtype;
begin
  select * into p from public.asrar_subscription_plans where id = new.plan_id and is_active = true;
  if not found then raise exception 'طرح اشتراک در دسترس نیست'; end if;
  new.plan_title := p.title;
  new.amount := p.price;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists asrar_subscription_snapshot_before_write on public.asrar_subscription_requests;
create trigger asrar_subscription_snapshot_before_write
before insert on public.asrar_subscription_requests
for each row execute function public.asrar_set_subscription_snapshot();

create or replace function public.asrar_touch_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  update public.asrar_support_threads
  set last_message_at = new.created_at, updated_at = now(),
      status = case when new.is_admin then 'answered' else 'open' end
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists asrar_support_message_touch_thread on public.asrar_support_messages;
create trigger asrar_support_message_touch_thread
after insert on public.asrar_support_messages
for each row execute function public.asrar_touch_thread();

alter table public.asrar_products enable row level security;
alter table public.asrar_orders enable row level security;
alter table public.asrar_subscription_plans enable row level security;
alter table public.asrar_subscription_requests enable row level security;
alter table public.asrar_user_subscriptions enable row level security;
alter table public.asrar_payment_settings enable row level security;
alter table public.asrar_discount_codes enable row level security;
alter table public.asrar_support_threads enable row level security;
alter table public.asrar_support_messages enable row level security;

grant select on public.asrar_products to anon, authenticated;
grant insert, update, delete on public.asrar_products to authenticated;
grant select, insert, update on public.asrar_orders to authenticated;
grant select on public.asrar_subscription_plans to anon, authenticated;
grant insert, select, update on public.asrar_subscription_requests to authenticated;
grant select on public.asrar_user_subscriptions to authenticated;
grant select on public.asrar_payment_settings to anon, authenticated;
grant insert, update, delete on public.asrar_payment_settings to authenticated;
grant select, insert, update, delete on public.asrar_discount_codes to authenticated;
grant select, insert, update on public.asrar_support_threads to authenticated;
grant select, insert, update on public.asrar_support_messages to authenticated;

drop policy if exists asrar_products_public_read on public.asrar_products;
create policy asrar_products_public_read on public.asrar_products
for select to anon, authenticated using (is_active = true or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_products_admin_write on public.asrar_products;
create policy asrar_products_admin_write on public.asrar_products
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_orders_owner_read on public.asrar_orders;
create policy asrar_orders_owner_read on public.asrar_orders
for select to authenticated using (user_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_orders_owner_insert on public.asrar_orders;
create policy asrar_orders_owner_insert on public.asrar_orders
for insert to authenticated
with check (user_id = (select auth.uid()) and status = 'new' and payment_status = 'unpaid');
drop policy if exists asrar_orders_admin_update on public.asrar_orders;
create policy asrar_orders_admin_update on public.asrar_orders
for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_orders_admin_delete on public.asrar_orders;
create policy asrar_orders_admin_delete on public.asrar_orders
for delete to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_plans_public_read on public.asrar_subscription_plans;
create policy asrar_plans_public_read on public.asrar_subscription_plans
for select to anon, authenticated using (is_active = true or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_plans_admin_write on public.asrar_subscription_plans;
create policy asrar_plans_admin_write on public.asrar_subscription_plans
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_subreq_owner_read on public.asrar_subscription_requests;
create policy asrar_subreq_owner_read on public.asrar_subscription_requests
for select to authenticated using (user_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_subreq_owner_insert on public.asrar_subscription_requests;
create policy asrar_subreq_owner_insert on public.asrar_subscription_requests
for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending');
drop policy if exists asrar_subreq_admin_update on public.asrar_subscription_requests;
create policy asrar_subreq_admin_update on public.asrar_subscription_requests
for update to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_user_subscriptions_owner_read on public.asrar_user_subscriptions;
create policy asrar_user_subscriptions_owner_read on public.asrar_user_subscriptions
for select to authenticated using (user_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_user_subscriptions_admin_write on public.asrar_user_subscriptions;
create policy asrar_user_subscriptions_admin_write on public.asrar_user_subscriptions
for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_payment_public_read on public.asrar_payment_settings;
create policy asrar_payment_public_read on public.asrar_payment_settings
for select to anon, authenticated using (true);
drop policy if exists asrar_payment_admin_write on public.asrar_payment_settings;
create policy asrar_payment_admin_write on public.asrar_payment_settings
for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_discounts_admin_only on public.asrar_discount_codes;
create policy asrar_discounts_admin_only on public.asrar_discount_codes
for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_threads_owner_read on public.asrar_support_threads;
create policy asrar_threads_owner_read on public.asrar_support_threads
for select to authenticated using (user_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists asrar_threads_owner_insert on public.asrar_support_threads;
create policy asrar_threads_owner_insert on public.asrar_support_threads
for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists asrar_threads_admin_update on public.asrar_support_threads;
create policy asrar_threads_admin_update on public.asrar_support_threads
for update to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists asrar_messages_thread_read on public.asrar_support_messages;
create policy asrar_messages_thread_read on public.asrar_support_messages
for select to authenticated using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or exists (select 1 from public.asrar_support_threads t where t.id = thread_id and t.user_id = (select auth.uid()))
);
drop policy if exists asrar_messages_owner_insert on public.asrar_support_messages;
create policy asrar_messages_owner_insert on public.asrar_support_messages
for insert to authenticated with check (
  sender_id = (select auth.uid()) and is_admin = false
  and exists (select 1 from public.asrar_support_threads t where t.id = thread_id and t.user_id = (select auth.uid()))
);
drop policy if exists asrar_messages_admin_insert on public.asrar_support_messages;
create policy asrar_messages_admin_insert on public.asrar_support_messages
for insert to authenticated with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  and sender_id = (select auth.uid()) and is_admin = true
);
drop policy if exists asrar_messages_admin_update on public.asrar_support_messages;
create policy asrar_messages_admin_update on public.asrar_support_messages
for update to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into public.asrar_payment_settings (id) values (true) on conflict (id) do nothing;

-- Private receipt storage: each user may upload/read only within their own UUID folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asrar-receipts','asrar-receipts',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists asrar_receipt_owner_read on storage.objects;
create policy asrar_receipt_owner_read on storage.objects
for select to authenticated using (
  bucket_id='asrar-receipts'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists asrar_receipt_owner_insert on storage.objects;
create policy asrar_receipt_owner_insert on storage.objects
for insert to authenticated with check (
  bucket_id='asrar-receipts'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists asrar_receipt_admin_read on storage.objects;
create policy asrar_receipt_admin_read on storage.objects
for select to authenticated using (
  bucket_id='asrar-receipts'
  and (auth.jwt() -> 'app_metadata' ->> 'role')='admin'
);
drop policy if exists asrar_receipt_admin_delete on storage.objects;
create policy asrar_receipt_admin_delete on storage.objects
for delete to authenticated using (
  bucket_id='asrar-receipts'
  and (auth.jwt() -> 'app_metadata' ->> 'role')='admin'
);

-- Authenticated customers may attach a receipt to their own order only.
-- The trigger blocks edits to price, owner, product, quantity and order status.
create or replace function public.asrar_guard_customer_order_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' then
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id
     or new.order_number is distinct from old.order_number
     or new.user_id is distinct from old.user_id
     or new.product_id is distinct from old.product_id
     or new.product_title is distinct from old.product_title
     or new.unit_price is distinct from old.unit_price
     or new.quantity is distinct from old.quantity
     or new.total_amount is distinct from old.total_amount
     or new.discount_code is distinct from old.discount_code
     or new.discount_amount is distinct from old.discount_amount
     or new.customer_name is distinct from old.customer_name
     or new.customer_phone is distinct from old.customer_phone
     or new.shipping_address is distinct from old.shipping_address
     or new.notes is distinct from old.notes
     or new.status is distinct from old.status
     or new.payment_method is distinct from old.payment_method
     or new.admin_note is distinct from old.admin_note
     or new.created_at is distinct from old.created_at
     or new.payment_status not in ('unpaid','pending') then
    raise exception 'Customers may only attach a payment receipt to their own order';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists asrar_guard_customer_order_update_trigger on public.asrar_orders;
create trigger asrar_guard_customer_order_update_trigger
before update on public.asrar_orders
for each row execute function public.asrar_guard_customer_order_update();

drop policy if exists asrar_orders_owner_receipt_update on public.asrar_orders;
create policy asrar_orders_owner_receipt_update on public.asrar_orders
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
