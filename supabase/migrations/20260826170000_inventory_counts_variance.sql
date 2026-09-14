-- Physical stock counts, variance, waste logging and alert thresholds.
--
-- This is the part the feature exists for: every few days somebody counts what
-- is physically there, the system compares it against what the ledger says
-- should be there, and the difference is the signal.
--
-- A difference only means something once the legitimate reasons for stock
-- leaving are recordable. OlaClick has nowhere to log waste, so waste, comps
-- and staff meals are recorded here — otherwise every spoiled tomato reads as
-- theft and the alerts get ignored within a fortnight.

-- ---------------------------------------------------------------------------
-- Where things are stored
-- ---------------------------------------------------------------------------

-- Stock is split across bar, kitchen, fridge and freezer, and different people
-- count different areas (Carlos the kitchen, Salomé the bar), so a count sheet
-- has to be filterable by area.
alter table public.inv_items
    add column if not exists storage_area text
        check (storage_area is null or storage_area in ('kitchen', 'bar', 'fridge', 'freezer', 'dry_store', 'other'));

create index if not exists inv_items_storage_area_idx
    on public.inv_items (storage_area) where archived = false;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- Single-row config. Both thresholds must be crossed before an item is flagged:
-- a 40% swing on parsley is noise, a 4% swing on beef is money.
create table if not exists public.inv_settings (
    id boolean primary key default true check (id),
    variance_pct_threshold numeric(6, 2) not null default 10,
    variance_value_threshold_cop numeric(14, 2) not null default 20000,
    alert_email text,
    -- Hiding the expected figure during entry keeps counts honest; showing it
    -- invites "just type what it says".
    blind_count boolean not null default true,
    updated_at timestamptz not null default now()
);

insert into public.inv_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Counts
-- ---------------------------------------------------------------------------

create table if not exists public.inv_counts (
    id uuid primary key default gen_random_uuid(),
    counted_on date not null,
    -- Null means the whole business was counted in one go.
    storage_area text
        check (storage_area is null or storage_area in ('kitchen', 'bar', 'fridge', 'freezer', 'dry_store', 'other')),
    status text not null default 'draft' check (status in ('draft', 'confirmed', 'void')),
    note text,
    counted_by uuid,
    created_at timestamptz not null default now(),
    confirmed_by uuid,
    confirmed_at timestamptz
);

create index if not exists inv_counts_date_idx
    on public.inv_counts (counted_on desc, created_at desc);

create table if not exists public.inv_count_lines (
    id uuid primary key default gen_random_uuid(),
    count_id uuid not null references public.inv_counts(id) on delete cascade,
    item_id uuid not null references public.inv_items(id) on delete restrict,
    -- What the person actually found, in the item's base unit.
    counted_qty numeric(14, 4) not null check (counted_qty >= 0),
    -- Frozen at confirmation time. Kept rather than recomputed so a later
    -- purchase backdated into the period cannot rewrite history.
    expected_qty numeric(14, 4),
    variance_qty numeric(14, 4),
    variance_value_cop numeric(14, 2),
    note text,
    created_at timestamptz not null default now()
);

create unique index if not exists inv_count_lines_unique_idx
    on public.inv_count_lines (count_id, item_id);

create index if not exists inv_count_lines_item_idx
    on public.inv_count_lines (item_id);

-- ---------------------------------------------------------------------------
-- Confirming a count
-- ---------------------------------------------------------------------------

-- Freezes the expected figure, records the variance, and writes a ledger entry
-- that brings stock to what was actually found. After this the ledger and
-- reality agree, so the next period's variance measures only that period.
create or replace function public.inv_confirm_count(
    p_count_id uuid,
    p_actor_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
    v_counted_on date;
    v_rows integer;
begin
    select status, counted_on into v_status, v_counted_on
    from public.inv_counts where id = p_count_id for update;

    if v_status is null then
        raise exception 'Count % not found', p_count_id;
    end if;
    if v_status <> 'draft' then
        raise exception 'Count % is %, only draft counts can be confirmed', p_count_id, v_status;
    end if;

    -- Snapshot expected vs found.
    update public.inv_count_lines cl
    set expected_qty = coalesce(s.stock_base_qty, 0),
        variance_qty = cl.counted_qty - coalesce(s.stock_base_qty, 0),
        variance_value_cop = round(
            (cl.counted_qty - coalesce(s.stock_base_qty, 0)) * coalesce(i.cost_per_base_unit, 0), 2)
    from public.inv_items i
    left join public.inv_item_stock s on s.item_id = i.id
    where cl.count_id = p_count_id and i.id = cl.item_id;

    get diagnostics v_rows = row_count;

    -- Bring the ledger in line with what was found. Only where it actually
    -- differs, so a correct count leaves no noise behind.
    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, note, occurred_at, created_by
    )
    select
        cl.item_id,
        cl.variance_qty,
        'count',
        'inv_count_lines',
        cl.id,
        'Ajuste por conteo físico',
        (v_counted_on::timestamp at time zone 'America/Bogota'),
        p_actor_id
    from public.inv_count_lines cl
    where cl.count_id = p_count_id
      and cl.variance_qty is not null
      and cl.variance_qty <> 0;

    update public.inv_counts
    set status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_id
    where id = p_count_id;

    return v_rows;
end;
$$;

-- One ledger row per count line, so re-confirming cannot double-adjust.
create unique index if not exists inv_stock_ledger_count_unique_idx
    on public.inv_stock_ledger (ref_id)
    where ref_table = 'inv_count_lines';

-- ---------------------------------------------------------------------------
-- Waste, staff meals and comps
-- ---------------------------------------------------------------------------

-- The honest reasons stock disappears. Without these every spoiled tomato and
-- remade plate lands in the variance and the alerts become noise.
create or replace function public.inv_record_stock_event(
    p_item_id uuid,
    p_qty numeric,
    p_reason text,
    p_note text default null,
    p_occurred_on date default null,
    p_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
begin
    if p_reason not in ('waste', 'staff_meal', 'comp', 'adjustment', 'opening', 'transfer_out') then
        raise exception 'Reason % is not allowed here', p_reason;
    end if;
    if p_qty is null or p_qty <= 0 then
        raise exception 'Quantity must be greater than zero';
    end if;
    if p_reason = 'adjustment' and coalesce(btrim(p_note), '') = '' then
        raise exception 'A manual adjustment needs a note explaining it';
    end if;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, note, occurred_at, created_by
    )
    values (
        p_item_id,
        -- 'opening' adds stock; everything else here removes it.
        case when p_reason = 'opening' then p_qty else -p_qty end,
        p_reason,
        p_note,
        (coalesce(p_occurred_on, (now() at time zone 'America/Bogota')::date)::timestamp
            at time zone 'America/Bogota'),
        p_actor_id
    )
    returning id into v_id;

    return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Variance reporting
-- ---------------------------------------------------------------------------

-- One row per counted item, with everything needed to judge it: what moved in
-- the period, what was explained by waste, and what is left over.
create or replace view public.inv_count_variance
with (security_invoker = true) as
select
    c.id as count_id,
    c.counted_on,
    c.storage_area,
    c.status,
    cl.id as line_id,
    cl.item_id,
    i.name as item_name,
    i.category,
    i.base_unit,
    i.cost_per_base_unit,
    cl.counted_qty,
    cl.expected_qty,
    cl.variance_qty,
    cl.variance_value_cop,
    case
        when coalesce(cl.expected_qty, 0) = 0 then null
        else round(abs(cl.variance_qty) / abs(cl.expected_qty) * 100, 1)
    end as variance_pct,
    -- Flagged only when both thresholds are crossed.
    (
        cl.variance_qty is not null
        and cl.variance_qty < 0
        and abs(coalesce(cl.variance_value_cop, 0)) >= (select variance_value_threshold_cop from public.inv_settings)
        and (
            coalesce(cl.expected_qty, 0) <> 0
            and abs(cl.variance_qty) / abs(cl.expected_qty) * 100 >= (select variance_pct_threshold from public.inv_settings)
        )
    ) as is_alert
from public.inv_counts c
join public.inv_count_lines cl on cl.count_id = c.id
join public.inv_items i on i.id = cl.item_id;

-- Headline figures per count, for the alert email and the dashboard.
create or replace view public.inv_count_summary
with (security_invoker = true) as
select
    c.id as count_id,
    c.counted_on,
    c.storage_area,
    c.status,
    c.note,
    c.confirmed_at,
    count(cl.id) as items_counted,
    count(*) filter (where v.is_alert) as items_alerting,
    coalesce(sum(cl.variance_value_cop) filter (where cl.variance_qty < 0), 0)::numeric(14, 2) as shortfall_value_cop,
    coalesce(sum(cl.variance_value_cop) filter (where cl.variance_qty > 0), 0)::numeric(14, 2) as surplus_value_cop
from public.inv_counts c
left join public.inv_count_lines cl on cl.count_id = c.id
left join public.inv_count_variance v on v.line_id = cl.id
group by c.id, c.counted_on, c.storage_area, c.status, c.note, c.confirmed_at;

-- What was consumed between two dates and why, per item. This is what turns a
-- shortfall into a conversation: sold 8.4 kg, wasted 0.3 kg, 1.1 kg unexplained.
create or replace view public.inv_movement_by_reason
with (security_invoker = true) as
select
    l.item_id,
    i.name as item_name,
    i.base_unit,
    (l.occurred_at at time zone 'America/Bogota')::date as occurred_on,
    l.reason,
    sum(l.delta_base_qty)::numeric(14, 4) as qty,
    round(sum(l.delta_base_qty) * coalesce(i.cost_per_base_unit, 0), 2) as value_cop
from public.inv_stock_ledger l
join public.inv_items i on i.id = l.item_id
group by l.item_id, i.name, i.base_unit, (l.occurred_at at time zone 'America/Bogota')::date,
         l.reason, i.cost_per_base_unit;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.inv_counts enable row level security;
alter table public.inv_count_lines enable row level security;
alter table public.inv_settings enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array['inv_counts', 'inv_count_lines', 'inv_settings']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
        execute format(
            'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
            t || '_app_all', t
        );
    end loop;
end $$;

grant select, insert, update, delete on
    public.inv_counts, public.inv_count_lines, public.inv_settings
to anon, authenticated;

grant select on
    public.inv_count_variance, public.inv_count_summary, public.inv_movement_by_reason
to anon, authenticated;

grant execute on function public.inv_confirm_count(uuid, uuid) to anon, authenticated;
grant execute on function public.inv_record_stock_event(uuid, numeric, text, text, date, uuid) to anon, authenticated;
