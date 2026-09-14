-- Menu, recipes, manual sales entry, and the stock overview.
--
-- There is no POS integration. Sales are typed in: an admin picks a date, enters
-- how many of each menu item was sold, and confirming that deducts the raw
-- materials from stock.
--
-- Recipes map a menu item straight to RAW materials, not to preparations. The
-- restaurant is being asked for raw grams per portion ("a 150 G serving of rice
-- is how much uncooked rice?"), so the raw/cooked conversion is done once at
-- data entry instead of on every calculation.

-- ---------------------------------------------------------------------------
-- Menu and recipes
-- ---------------------------------------------------------------------------

create table if not exists public.inv_menu_items (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    category text not null default 'plate' check (category in (
        'cocktail', 'juice', 'soda', 'coffee', 'shake',
        'brunch', 'bowl', 'plate', 'dessert', 'side', 'other'
    )),
    -- Bowls are sold in two sizes with different portions, so each size is its
    -- own menu item rather than a modifier.
    portion_label text,
    sale_price_cop numeric(14, 2),
    active boolean not null default true,
    -- Set while the raw quantities for this dish are still being collected.
    -- Incomplete items are excluded from stock deduction and from the capacity
    -- view, so a half-entered recipe cannot quietly under-report consumption.
    recipe_complete boolean not null default false,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Name plus size: a bowl is sold Regular and Grande with different portions, so
-- both are menu items under one name.
create unique index if not exists inv_menu_items_name_unique_idx
    on public.inv_menu_items (lower(name), coalesce(portion_label, '')) where active = true;

create index if not exists inv_menu_items_category_idx
    on public.inv_menu_items (category, name) where active = true;

create table if not exists public.inv_recipe_lines (
    id uuid primary key default gen_random_uuid(),
    menu_item_id uuid not null references public.inv_menu_items(id) on delete cascade,
    item_id uuid not null references public.inv_items(id) on delete restrict,
    -- Always in the raw item's base unit (g, ml, unidad). This is the number the
    -- restaurant supplies: uncooked weight, not plated weight.
    qty_base numeric(14, 4) not null check (qty_base > 0),
    -- Garnishes and "sal y pimienta" that are real but not worth tracking.
    -- Kept for documentation; excluded from deduction.
    is_tracked boolean not null default true,
    note text,
    created_at timestamptz not null default now()
);

create unique index if not exists inv_recipe_lines_unique_idx
    on public.inv_recipe_lines (menu_item_id, item_id);

create index if not exists inv_recipe_lines_item_idx
    on public.inv_recipe_lines (item_id);

-- ---------------------------------------------------------------------------
-- Sales entry
-- ---------------------------------------------------------------------------

create table if not exists public.inv_sales_entries (
    id uuid primary key default gen_random_uuid(),
    sold_on date not null,
    status text not null default 'draft' check (status in ('draft', 'confirmed', 'void')),
    note text,
    created_by uuid,
    created_at timestamptz not null default now(),
    confirmed_by uuid,
    confirmed_at timestamptz
);

-- One confirmed entry per day: entering the same day twice would double-deduct.
create unique index if not exists inv_sales_entries_one_per_day_idx
    on public.inv_sales_entries (sold_on) where status = 'confirmed';

create index if not exists inv_sales_entries_date_idx
    on public.inv_sales_entries (sold_on desc);

create table if not exists public.inv_sales_lines (
    id uuid primary key default gen_random_uuid(),
    sales_entry_id uuid not null references public.inv_sales_entries(id) on delete cascade,
    menu_item_id uuid not null references public.inv_menu_items(id) on delete restrict,
    qty_sold numeric(12, 2) not null check (qty_sold >= 0),
    created_at timestamptz not null default now()
);

create unique index if not exists inv_sales_lines_unique_idx
    on public.inv_sales_lines (sales_entry_id, menu_item_id);

-- Sales consume stock, so the ledger needs a reason for it.
do $$
begin
    alter table public.inv_stock_ledger drop constraint if exists inv_stock_ledger_reason_check;
    alter table public.inv_stock_ledger
        add constraint inv_stock_ledger_reason_check check (reason in (
            'purchase', 'opening', 'count', 'sale',
            'waste', 'staff_meal', 'comp', 'transfer_out', 'adjustment'
        ));
end $$;

-- One ledger row per sales entry per item, so re-confirming cannot double-deduct.
create unique index if not exists inv_stock_ledger_sales_unique_idx
    on public.inv_stock_ledger (ref_id, item_id)
    where ref_table = 'inv_sales_entries';

-- ---------------------------------------------------------------------------
-- Confirming a day's sales
-- ---------------------------------------------------------------------------

-- Expands the sold quantities through the recipes, sums per raw material, and
-- writes one negative ledger row per material. Security definer because the
-- browser role has no insert policy on the ledger.
create or replace function public.inv_confirm_sales_entry(
    p_entry_id uuid,
    p_actor_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
    v_sold_on date;
    v_incomplete integer;
    v_rows integer;
begin
    select status, sold_on into v_status, v_sold_on
    from public.inv_sales_entries where id = p_entry_id for update;

    if v_status is null then
        raise exception 'Sales entry % not found', p_entry_id;
    end if;
    if v_status <> 'draft' then
        raise exception 'Sales entry % is %, only draft entries can be confirmed', p_entry_id, v_status;
    end if;

    -- A dish whose recipe is still being filled in would silently under-deduct.
    select count(*) into v_incomplete
    from public.inv_sales_lines sl
    join public.inv_menu_items m on m.id = sl.menu_item_id
    where sl.sales_entry_id = p_entry_id
      and sl.qty_sold > 0
      and m.recipe_complete = false;

    if v_incomplete > 0 then
        raise exception '% menu item(s) sold have an incomplete recipe. Finish those recipes or set their quantity to zero.', v_incomplete;
    end if;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, occurred_at, created_by
    )
    select
        r.item_id,
        -sum(sl.qty_sold * r.qty_base),
        'sale',
        'inv_sales_entries',
        p_entry_id,
        (v_sold_on::timestamp at time zone 'America/Bogota'),
        p_actor_id
    from public.inv_sales_lines sl
    join public.inv_recipe_lines r on r.menu_item_id = sl.menu_item_id
    -- Untracked materials (ice, salt) are never bought into stock, so deducting
    -- them would drive them permanently negative and add nothing.
    join public.inv_items it on it.id = r.item_id and it.is_tracked = true
    where sl.sales_entry_id = p_entry_id
      and sl.qty_sold > 0
      and r.is_tracked = true
    group by r.item_id
    having sum(sl.qty_sold * r.qty_base) > 0;

    get diagnostics v_rows = row_count;

    update public.inv_sales_entries
    set status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_id
    where id = p_entry_id;

    return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overview: what one plate costs, how many we can still make, how long stock lasts
-- ---------------------------------------------------------------------------

-- Raw material cost of one serving, plus how many of its ingredients are priced.
create or replace view public.inv_menu_item_cost
with (security_invoker = true) as
select
    m.id as menu_item_id,
    m.name,
    m.category,
    m.sale_price_cop,
    m.recipe_complete,
    count(r.id) as ingredient_count,
    count(r.id) filter (where i.cost_per_base_unit is not null) as priced_ingredient_count,
    sum(r.qty_base * coalesce(i.cost_per_base_unit, 0))::numeric(14, 2) as raw_cost_cop
from public.inv_menu_items m
left join public.inv_recipe_lines r on r.menu_item_id = m.id and r.is_tracked = true
left join public.inv_items i on i.id = r.item_id
where m.active = true
group by m.id, m.name, m.category, m.sale_price_cop, m.recipe_complete;

-- How many of each dish current stock supports, and which ingredient runs out
-- first. distinct on picks the lowest row per menu item, which is both the
-- limit and the name of the ingredient causing it.
create or replace view public.inv_menu_item_capacity
with (security_invoker = true) as
select distinct on (m.id)
    m.id as menu_item_id,
    m.name,
    m.category,
    -- Clamped: a negative stock means purchases are missing, and "you can make
    -- minus forty" tells nobody anything. Zero is the honest answer. The
    -- ordering below still uses the raw value, so the true limiter is picked.
    greatest(floor(coalesce(s.stock_base_qty, 0) / r.qty_base), 0)::bigint as makeable,
    i.name as limiting_item,
    coalesce(s.stock_base_qty, 0) as limiting_stock,
    i.base_unit as limiting_unit,
    r.qty_base as limiting_qty_per_serving
from public.inv_menu_items m
join public.inv_recipe_lines r on r.menu_item_id = m.id and r.is_tracked = true
-- Only counted materials can limit production. Ice and salt sit at zero stock
-- because they are never bought in, and would otherwise make every dish report
-- that nothing can be made.
join public.inv_items i on i.id = r.item_id and i.is_tracked = true
left join public.inv_item_stock s on s.item_id = r.item_id
where m.active = true and m.recipe_complete = true
order by m.id, floor(coalesce(s.stock_base_qty, 0) / r.qty_base) asc, i.name;

-- Average daily consumption per raw material, from confirmed sales entries in
-- the last 30 days. Divided by the number of days actually entered, not by 30,
-- so a few days of data still give a sensible rate.
create or replace view public.inv_item_daily_usage
with (security_invoker = true) as
with window_days as (
    select count(distinct sold_on)::numeric as days
    from public.inv_sales_entries
    where status = 'confirmed' and sold_on >= current_date - interval '30 days'
)
select
    r.item_id,
    (sum(sl.qty_sold * r.qty_base) / nullif((select days from window_days), 0))::numeric(14, 4) as avg_daily_qty,
    (select days from window_days)::integer as days_of_data
from public.inv_sales_entries e
join public.inv_sales_lines sl on sl.sales_entry_id = e.id
join public.inv_recipe_lines r on r.menu_item_id = sl.menu_item_id and r.is_tracked = true
join public.inv_items it on it.id = r.item_id and it.is_tracked = true
where e.status = 'confirmed'
  and e.sold_on >= current_date - interval '30 days'
group by r.item_id;

-- The main inventory table: stock, value, burn rate, days left.
create or replace view public.inv_stock_overview
with (security_invoker = true) as
select
    s.item_id,
    s.name,
    s.category,
    s.base_unit,
    s.is_tracked,
    s.stock_base_qty,
    s.cost_per_base_unit,
    (s.stock_base_qty * coalesce(s.cost_per_base_unit, 0))::numeric(14, 2) as stock_value_cop,
    u.avg_daily_qty,
    u.days_of_data,
    case
        when u.avg_daily_qty is null or u.avg_daily_qty <= 0 then null
        else round(s.stock_base_qty / u.avg_daily_qty, 1)
    end as days_left,
    s.last_movement_at
from public.inv_item_stock s
left join public.inv_item_daily_usage u on u.item_id = s.item_id;

-- ---------------------------------------------------------------------------
-- Access control — mirrors the inventory core migration
-- ---------------------------------------------------------------------------

alter table public.inv_menu_items enable row level security;
alter table public.inv_recipe_lines enable row level security;
alter table public.inv_sales_entries enable row level security;
alter table public.inv_sales_lines enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array['inv_menu_items', 'inv_recipe_lines', 'inv_sales_entries', 'inv_sales_lines']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
        execute format(
            'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
            t || '_app_all', t
        );
    end loop;
end $$;

grant select, insert, update, delete on
    public.inv_menu_items,
    public.inv_recipe_lines,
    public.inv_sales_entries,
    public.inv_sales_lines
to anon, authenticated;

grant select on
    public.inv_menu_item_cost,
    public.inv_menu_item_capacity,
    public.inv_item_daily_usage,
    public.inv_stock_overview
to anon, authenticated;

grant execute on function public.inv_confirm_sales_entry(uuid, uuid) to anon, authenticated;
