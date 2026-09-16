-- Inventory core: item catalog, suppliers, purchases, append-only stock ledger.
--
-- Everything here is additive and namespaced under inv_*. No existing table is
-- altered and no existing behaviour changes.
--
-- Deliberately no foreign keys into staff/admins: those tables were created
-- outside this migrations folder, so referencing them would make this file
-- unrunnable against a fresh database. actor_id columns hold the id without a
-- constraint.

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table if not exists public.inv_items (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    -- 'raw'  = bought as-is (arroz, tequila, aguacate)
    -- 'prep' = made in-house from other items (arroz premium, crema blanca)
    item_type text not null default 'raw' check (item_type in ('raw', 'prep')),
    category text not null default 'ingredient'
        check (category in ('ingredient', 'beverage', 'alcohol', 'supply', 'other')),
    -- Everything is stored in exactly one of these. No exceptions, no per-row units.
    base_unit text not null check (base_unit in ('g', 'ml', 'unidad')),
    -- Counted during stock takes. Untracked items still record purchases (for cost)
    -- but are excluded from variance checks.
    is_tracked boolean not null default true,
    -- Higher = counted more often / alerted on more aggressively.
    track_priority smallint not null default 1 check (track_priority between 0 and 3),
    -- Latest known cost, in COP per base unit. Maintained from purchase lines.
    cost_per_base_unit numeric(14, 6),
    notes text,
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists inv_items_name_unique_idx
    on public.inv_items (lower(name)) where archived = false;

create index if not exists inv_items_tracked_idx
    on public.inv_items (is_tracked, track_priority desc) where archived = false;

create table if not exists public.inv_suppliers (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    nit text,
    default_payment_method text
        check (default_payment_method is null or default_payment_method in ('transfer', 'cash', 'card', 'credit')),
    notes text,
    archived boolean not null default false,
    created_at timestamptz not null default now()
);

create unique index if not exists inv_suppliers_name_unique_idx
    on public.inv_suppliers (lower(name)) where archived = false;

-- Receipt descriptions and barcodes that resolve to an item.
-- This is the memory that makes repeat scans match automatically.
create table if not exists public.inv_item_aliases (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.inv_items(id) on delete cascade,
    alias_type text not null check (alias_type in ('barcode', 'description')),
    -- Barcodes verbatim. Descriptions normalised (upper, collapsed whitespace).
    value text not null,
    -- Descriptions are only meaningful within one supplier's printing: D1
    -- truncates to ~13 characters, so two unrelated products can share a label.
    -- Barcodes are globally unique by definition and leave this null.
    supplier_id uuid references public.inv_suppliers(id) on delete cascade,
    created_at timestamptz not null default now()
);

-- EAN codes identify a product worldwide, so one barcode maps to one item.
create unique index if not exists inv_item_aliases_barcode_unique_idx
    on public.inv_item_aliases (value)
    where alias_type = 'barcode';

-- Descriptions are scoped per supplier. Without this, the first supplier to
-- register a truncated label would own it catalog-wide and every other
-- supplier's product printing the same 13 characters would silently
-- auto-match to the wrong item.
create unique index if not exists inv_item_aliases_description_unique_idx
    on public.inv_item_aliases (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), value)
    where alias_type = 'description';

create index if not exists inv_item_aliases_item_idx
    on public.inv_item_aliases (item_id);

-- "1 bulto" of this item = 50000 g. Supplier pack sizes, spoon weights,
-- sachet weights all live here.
create table if not exists public.inv_pack_conversions (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.inv_items(id) on delete cascade,
    pack_label text not null,
    base_qty numeric(14, 4) not null check (base_qty > 0),
    created_at timestamptz not null default now()
);

create unique index if not exists inv_pack_conversions_unique_idx
    on public.inv_pack_conversions (item_id, lower(pack_label));

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------

create table if not exists public.inv_purchases (
    id uuid primary key default gen_random_uuid(),
    supplier_id uuid references public.inv_suppliers(id) on delete set null,
    -- Business date of the purchase (Bogota), not the row's insert time.
    purchased_on date not null,
    -- receipt_scan = AI read an itemised receipt
    -- transfer     = bank screenshot, amount only, lines typed by a human
    -- manual       = no document at all
    source text not null default 'manual'
        check (source in ('receipt_scan', 'transfer', 'manual')),
    payment_method text
        check (payment_method is null or payment_method in ('transfer', 'cash', 'card', 'credit')),
    -- Total as printed on the document, for reconciliation against line sums.
    document_total_cop numeric(14, 2),
    document_number text,
    image_path text,
    -- Raw model output, kept verbatim so a bad extraction can be audited later.
    ai_raw jsonb,
    ai_warnings text[],
    status text not null default 'draft' check (status in ('draft', 'confirmed', 'void')),
    note text,
    created_by uuid,
    created_at timestamptz not null default now(),
    confirmed_by uuid,
    confirmed_at timestamptz
);

create index if not exists inv_purchases_date_idx
    on public.inv_purchases (purchased_on desc, created_at desc);

create index if not exists inv_purchases_status_idx
    on public.inv_purchases (status) where status = 'draft';

create table if not exists public.inv_purchase_lines (
    id uuid primary key default gen_random_uuid(),
    purchase_id uuid not null references public.inv_purchases(id) on delete cascade,
    -- Null until a human maps the line to a catalog item. Confirmation is blocked
    -- while any line on the purchase is still unmapped.
    item_id uuid references public.inv_items(id) on delete restrict,
    line_no smallint,
    -- Exactly as printed. D1 truncates to ~13 chars; never expand or guess.
    raw_description text,
    raw_barcode text,
    -- Barcodes starting 29 are in-store price-embedded codes that change with
    -- weight, so they must not be stored as a reusable alias.
    barcode_unreliable boolean not null default false,
    -- Quantity as written on the document, in whatever unit the document used.
    qty numeric(14, 4),
    unit_label text,
    -- qty converted into the item's base unit. Null while unmapped.
    base_qty numeric(14, 4),
    unit_cost_cop numeric(14, 4),
    line_total_cop numeric(14, 2),
    created_at timestamptz not null default now()
);

create index if not exists inv_purchase_lines_purchase_idx
    on public.inv_purchase_lines (purchase_id, line_no);

create index if not exists inv_purchase_lines_item_idx
    on public.inv_purchase_lines (item_id);

-- ---------------------------------------------------------------------------
-- Stock ledger
-- ---------------------------------------------------------------------------

-- Append-only. Stock is derived by summing deltas, never stored as a mutable
-- number. A system whose job is detecting theft must not expose a stock field
-- that can be quietly overwritten.
--
-- Enforced below by RLS: the anon role the browser uses may read this table but
-- has no insert, update or delete policy. Rows arrive only through
-- inv_confirm_purchase, which is security definer.
create table if not exists public.inv_stock_ledger (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.inv_items(id) on delete restrict,
    -- Positive = stock in, negative = stock out. Always in the item's base unit.
    delta_base_qty numeric(14, 4) not null,
    reason text not null check (reason in (
        'purchase',      -- confirmed purchase line
        'opening',       -- day-one baseline count
        'count',         -- reconciliation after a physical count
        'waste',         -- spoilage, burnt, dropped
        'staff_meal',
        'comp',          -- comped or remade for a customer
        'transfer_out',  -- moved to another location
        'adjustment'     -- manual correction, requires a note
    )),
    -- Where this entry came from, e.g. ('inv_purchase_lines', <uuid>).
    ref_table text,
    ref_id uuid,
    note text,
    occurred_at timestamptz not null default now(),
    created_by uuid,
    created_at timestamptz not null default now()
);

create index if not exists inv_stock_ledger_item_time_idx
    on public.inv_stock_ledger (item_id, occurred_at desc);

create index if not exists inv_stock_ledger_ref_idx
    on public.inv_stock_ledger (ref_table, ref_id);

-- One ledger row per purchase line, so re-confirming cannot double-count.
create unique index if not exists inv_stock_ledger_purchase_line_unique_idx
    on public.inv_stock_ledger (ref_id)
    where ref_table = 'inv_purchase_lines';

-- Item-independent unit facts: kg is 1000 g everywhere.
create table if not exists public.inv_global_unit_conversions (
    id uuid primary key default gen_random_uuid(),
    unit_label text not null,
    base_unit text not null check (base_unit in ('g', 'ml', 'unidad')),
    base_qty numeric(14, 4) not null check (base_qty > 0),
    note text
);

create unique index if not exists inv_global_unit_conversions_unique_idx
    on public.inv_global_unit_conversions (lower(unit_label), base_unit);

-- Current stock per item, derived.
-- security_invoker so the view is subject to the caller's RLS rather than the
-- owner's, keeping it consistent with direct table access.
create or replace view public.inv_item_stock
with (security_invoker = true) as
select
    i.id as item_id,
    i.name,
    i.base_unit,
    i.category,
    i.is_tracked,
    i.track_priority,
    i.cost_per_base_unit,
    coalesce(sum(l.delta_base_qty), 0)::numeric(14, 4) as stock_base_qty,
    max(l.occurred_at) as last_movement_at
from public.inv_items i
left join public.inv_stock_ledger l on l.item_id = i.id
where i.archived = false
group by i.id, i.name, i.base_unit, i.category, i.is_tracked, i.track_priority, i.cost_per_base_unit;

-- ---------------------------------------------------------------------------
-- Confirming a purchase
-- ---------------------------------------------------------------------------

-- Moves a draft purchase to confirmed and writes its lines into the ledger,
-- atomically. Refuses if any line is unmapped or missing a base quantity,
-- which is what keeps the catalog clean.
--
-- security definer because it is the only sanctioned way to write the ledger;
-- the calling role has no insert policy on inv_stock_ledger.
create or replace function public.inv_confirm_purchase(
    p_purchase_id uuid,
    p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
    v_bad_lines integer;
    v_purchased_on date;
begin
    select status, purchased_on
    into v_status, v_purchased_on
    from public.inv_purchases
    where id = p_purchase_id
    for update;

    if v_status is null then
        raise exception 'Purchase % not found', p_purchase_id;
    end if;

    if v_status <> 'draft' then
        raise exception 'Purchase % is %, only draft purchases can be confirmed', p_purchase_id, v_status;
    end if;

    select count(*)
    into v_bad_lines
    from public.inv_purchase_lines
    where purchase_id = p_purchase_id
      and (item_id is null or base_qty is null);

    if v_bad_lines > 0 then
        raise exception 'Purchase % has % line(s) that are unmapped or missing a base quantity', p_purchase_id, v_bad_lines;
    end if;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, occurred_at, created_by
    )
    select
        pl.item_id,
        pl.base_qty,
        'purchase',
        'inv_purchase_lines',
        pl.id,
        -- Anchor to midnight in Bogota, not in the server's timezone. Casting a
        -- date straight to timestamptz resolves in the session zone (UTC on
        -- Supabase), which would file every purchase on the previous local day
        -- and skew the daily variance report this feature exists to produce.
        (v_purchased_on::timestamp at time zone 'America/Bogota'),
        p_actor_id
    from public.inv_purchase_lines pl
    where pl.purchase_id = p_purchase_id;

    -- Refresh last known cost from this purchase. Aggregated because one
    -- document can list the same item on several lines (a 500 g pack and a 1 kg
    -- pack); joining un-aggregated would pick a row non-deterministically.
    update public.inv_items i
    set cost_per_base_unit = src.cost,
        updated_at = now()
    from (
        select
            pl.item_id,
            sum(pl.line_total_cop) / nullif(sum(pl.base_qty), 0) as cost
        from public.inv_purchase_lines pl
        where pl.purchase_id = p_purchase_id
          and pl.line_total_cop is not null
          and pl.base_qty is not null
          and pl.base_qty > 0
        group by pl.item_id
    ) src
    where i.id = src.item_id
      and src.cost is not null;

    update public.inv_purchases
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = p_actor_id
    where id = p_purchase_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remembering how a reviewer mapped a receipt line
-- ---------------------------------------------------------------------------

-- Both alias uniqueness rules are enforced by partial indexes, and PostgREST
-- cannot name a partial index as an ON CONFLICT arbiter, so the upsert lives
-- here where the index predicate can be stated explicitly.
--
-- The newest mapping always wins: if a description was previously bound to the
-- wrong item, confirming a correction has to rebind it, or every future scan
-- would keep suggesting the wrong item.
create or replace function public.inv_remember_aliases(p_rows jsonb)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
    r jsonb;
    v_written integer := 0;
begin
    for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
    loop
        if (r->>'item_id') is null or (r->>'value') is null or btrim(r->>'value') = '' then
            continue;
        end if;

        if r->>'alias_type' = 'barcode' then
            insert into public.inv_item_aliases (item_id, alias_type, value, supplier_id)
            values ((r->>'item_id')::uuid, 'barcode', btrim(r->>'value'), null)
            on conflict (value) where alias_type = 'barcode'
            do update set item_id = excluded.item_id;
            v_written := v_written + 1;

        elsif r->>'alias_type' = 'description' and (r->>'supplier_id') is not null then
            insert into public.inv_item_aliases (item_id, alias_type, value, supplier_id)
            values ((r->>'item_id')::uuid, 'description', btrim(r->>'value'), (r->>'supplier_id')::uuid)
            on conflict (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), value)
                where alias_type = 'description'
            do update set item_id = excluded.item_id;
            v_written := v_written + 1;
        end if;
    end loop;

    return v_written;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

-- This project authenticates staff with its own edge function and a
-- localStorage session rather than Supabase Auth, so there is no JWT identity
-- for a policy to inspect: the browser always presents the anon role. Policies
-- below therefore mirror the access the rest of the app already has, with one
-- deliberate exception — the stock ledger is read-only to the browser, so the
-- audit trail cannot be edited or deleted from the client.

alter table public.inv_items enable row level security;
alter table public.inv_suppliers enable row level security;
alter table public.inv_item_aliases enable row level security;
alter table public.inv_pack_conversions enable row level security;
alter table public.inv_purchases enable row level security;
alter table public.inv_purchase_lines enable row level security;
alter table public.inv_global_unit_conversions enable row level security;
alter table public.inv_stock_ledger enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array[
        'inv_items', 'inv_suppliers', 'inv_item_aliases', 'inv_pack_conversions',
        'inv_purchases', 'inv_purchase_lines', 'inv_global_unit_conversions'
    ] loop
        execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
        execute format(
            'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
            t || '_app_all', t
        );
    end loop;
end $$;

-- Ledger: readable, never writable from the browser.
drop policy if exists inv_stock_ledger_read on public.inv_stock_ledger;
create policy inv_stock_ledger_read
    on public.inv_stock_ledger
    for select to anon, authenticated
    using (true);

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
    public.inv_items,
    public.inv_suppliers,
    public.inv_item_aliases,
    public.inv_pack_conversions,
    public.inv_purchases,
    public.inv_purchase_lines,
    public.inv_global_unit_conversions
to anon, authenticated;

grant select on public.inv_stock_ledger to anon, authenticated;
grant select on public.inv_item_stock to anon, authenticated;

-- The view is security_invoker, so reading it still requires select on the
-- underlying tables; both are granted above.
grant execute on function public.inv_confirm_purchase(uuid, uuid) to anon, authenticated;
grant execute on function public.inv_remember_aliases(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: unit facts that hold regardless of item.
-- Item-specific packs (1 bulto de arroz, 1 sobre de mango) are entered in the UI.
-- ---------------------------------------------------------------------------

insert into public.inv_global_unit_conversions (unit_label, base_unit, base_qty, note)
values
    ('kg', 'g', 1000, null),
    ('g', 'g', 1, null),
    ('gr', 'g', 1, 'appears as GR in some recipes'),
    ('libra', 'g', 500, 'Colombian libra'),
    ('arroba', 'g', 12500, '25 libras'),
    ('l', 'ml', 1000, null),
    ('lt', 'ml', 1000, null),
    ('ml', 'ml', 1, null),
    ('oz', 'ml', 29.5735, 'fluid ounce, used in cappuccino recipe'),
    ('unidad', 'unidad', 1, null),
    ('un', 'unidad', 1, 'D1 receipts print UN'),
    ('u', 'unidad', 1, null),
    ('docena', 'unidad', 12, null)
on conflict do nothing;
