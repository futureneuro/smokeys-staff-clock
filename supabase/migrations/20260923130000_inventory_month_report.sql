-- One call that answers "how did the month go?" for the Report tab.
--
-- Everything the screen shows comes from tables that already exist; this only
-- aggregates them for one calendar month (Bogotá dates, like the rest of the
-- feature) and returns a single JSON document so the browser and the AI
-- summary function read exactly the same numbers.
--
-- Sections:
--   sold       menu items sold (confirmed sales entries, typed or imported),
--              plus what the POS reported for the month
--   purchases  confirmed purchases and what they added to stock
--   usage      every stock movement by reason, and the losses per item
--   stock      what is on the shelf right now, its value, what is running low
--   alerts     variance alerts raised in the month

create or replace function public.inv_month_report(p_month date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with bounds as (
    select
        date_trunc('month', coalesce(p_month, (now() at time zone 'America/Bogota')::date))::date as from_on,
        (date_trunc('month', coalesce(p_month, (now() at time zone 'America/Bogota')::date)) + interval '1 month')::date as to_on
),
sold as (
    select
        l.menu_item_id,
        m.name,
        m.portion_label,
        m.category,
        sum(l.qty_sold)::numeric(12,2) as qty,
        round(sum(l.qty_sold * coalesce(m.sale_price_cop, 0)), 2) as revenue_cop,
        count(distinct e.sold_on) as days
    from inv_sales_lines l
    join inv_sales_entries e on e.id = l.sales_entry_id
    join inv_menu_items m on m.id = l.menu_item_id
    cross join bounds b
    where e.status = 'confirmed'
      and e.sold_on >= b.from_on and e.sold_on < b.to_on
    group by 1, 2, 3, 4
),
sales_days as (
    select
        count(*) as days,
        count(*) filter (where e.source = 'olaclick') as pos_days
    from inv_sales_entries e
    cross join bounds b
    where e.status = 'confirmed'
      and e.sold_on >= b.from_on and e.sold_on < b.to_on
),
pos as (
    select
        count(*) filter (where i.status = 'confirmed') as days_imported,
        count(*) filter (where i.status in ('pending_mapping', 'failed')) as days_held,
        coalesce(sum(i.revenue_cop) filter (where i.status in ('confirmed', 'pending_mapping', 'no_sales')), 0) as revenue_cop,
        coalesce(sum(i.item_count) filter (where i.status in ('confirmed', 'pending_mapping', 'no_sales')), 0) as item_count
    from inv_pos_imports i
    cross join bounds b
    where i.sold_on >= b.from_on and i.sold_on < b.to_on
),
purch as (
    select p.id
    from inv_purchases p
    cross join bounds b
    where p.status = 'confirmed'
      and p.purchased_on >= b.from_on and p.purchased_on < b.to_on
),
purch_lines as (
    select
        l.item_id,
        i.name,
        i.base_unit,
        sum(l.base_qty)::numeric(14,4) as base_qty,
        round(sum(coalesce(l.line_total_cop, 0)), 2) as cost_cop,
        count(distinct l.purchase_id) as purchases
    from inv_purchase_lines l
    join purch p on p.id = l.purchase_id
    join inv_items i on i.id = l.item_id
    group by 1, 2, 3
),
moves as (
    select
        l.item_id,
        i.name,
        i.base_unit,
        l.reason,
        sum(l.delta_base_qty)::numeric(14,4) as qty,
        round(sum(l.delta_base_qty) * coalesce(i.cost_per_base_unit, 0), 2) as value_cop
    from inv_stock_ledger l
    join inv_items i on i.id = l.item_id
    cross join bounds b
    where (l.occurred_at at time zone 'America/Bogota')::date >= b.from_on
      and (l.occurred_at at time zone 'America/Bogota')::date < b.to_on
    group by 1, 2, 3, 4, i.cost_per_base_unit
),
by_reason as (
    select reason, sum(qty) as qty, sum(value_cop) as value_cop, count(*) as items
    from moves
    group by reason
),
stock as (
    select *
    from inv_stock_overview
    where is_tracked
),
month_alerts as (
    select a.id, a.title, a.severity, a.status, a.items_alerting, a.shortfall_value_cop, a.created_at
    from inv_alerts a
    cross join bounds b
    where (a.created_at at time zone 'America/Bogota')::date >= b.from_on
      and (a.created_at at time zone 'America/Bogota')::date < b.to_on
)
select jsonb_build_object(
    'month', to_char(b.from_on, 'YYYY-MM'),
    'from_on', b.from_on,
    'to_on', (b.to_on - 1),
    'generated_at', now(),

    'sold', jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                'menu_item_id', s.menu_item_id,
                'name', s.name,
                'portion_label', s.portion_label,
                'category', s.category,
                'qty', s.qty,
                'revenue_cop', s.revenue_cop,
                'days', s.days
            ) order by s.qty desc, s.name)
            from sold s
        ), '[]'::jsonb),
        'total_qty', coalesce((select sum(qty) from sold), 0),
        'revenue_cop', coalesce((select sum(revenue_cop) from sold), 0),
        'days_with_sales', (select days from sales_days),
        'days_from_pos', (select pos_days from sales_days),
        'pos', (select jsonb_build_object(
            'days_imported', p.days_imported,
            'days_held', p.days_held,
            'revenue_cop', p.revenue_cop,
            'item_count', p.item_count
        ) from pos p)
    ),

    'purchases', jsonb_build_object(
        'count', (select count(*) from purch),
        'total_cop', coalesce((select sum(cost_cop) from purch_lines), 0),
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                'item_id', pl.item_id,
                'name', pl.name,
                'base_unit', pl.base_unit,
                'base_qty', pl.base_qty,
                'cost_cop', pl.cost_cop,
                'purchases', pl.purchases
            ) order by pl.cost_cop desc, pl.name)
            from purch_lines pl
        ), '[]'::jsonb)
    ),

    'usage', jsonb_build_object(
        'by_reason', coalesce((
            select jsonb_agg(jsonb_build_object(
                'reason', r.reason,
                'qty', r.qty,
                'value_cop', r.value_cop,
                'items', r.items
            ) order by r.value_cop)
            from by_reason r
        ), '[]'::jsonb),
        -- Everything that left the shelf without being sold. Count adjustments
        -- are the unexplained gap a stock count found.
        'losses', coalesce((
            select jsonb_agg(jsonb_build_object(
                'item_id', m.item_id,
                'name', m.name,
                'base_unit', m.base_unit,
                'reason', m.reason,
                'qty', m.qty,
                'value_cop', m.value_cop
            ) order by m.value_cop, m.name)
            from moves m
            where m.reason in ('waste', 'staff_meal', 'comp', 'transfer_out', 'count', 'adjustment')
              and m.qty < 0
        ), '[]'::jsonb),
        'loss_value_cop', coalesce((
            select -sum(value_cop) from moves
            where reason in ('waste', 'staff_meal', 'comp', 'transfer_out', 'count', 'adjustment') and qty < 0
        ), 0),
        -- Raw materials consumed by sales, per item.
        'consumed', coalesce((
            select jsonb_agg(jsonb_build_object(
                'item_id', m.item_id,
                'name', m.name,
                'base_unit', m.base_unit,
                'qty', -m.qty,
                'value_cop', -m.value_cop
            ) order by m.value_cop, m.name)
            from moves m
            where m.reason = 'sale'
        ), '[]'::jsonb)
    ),

    'stock', jsonb_build_object(
        'tracked', (select count(*) from stock),
        'total_value_cop', coalesce((select sum(stock_value_cop) from stock), 0),
        'negative', (select count(*) from stock where stock_base_qty < 0),
        'out', (select count(*) from stock where stock_base_qty <= 0),
        'low', coalesce((
            select jsonb_agg(jsonb_build_object(
                'item_id', s.item_id,
                'name', s.name,
                'base_unit', s.base_unit,
                'stock_base_qty', s.stock_base_qty,
                'days_left', s.days_left
            ) order by s.days_left nulls last, s.name)
            from stock s
            where s.days_left is not null and s.days_left <= 7
        ), '[]'::jsonb),
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                'item_id', s.item_id,
                'name', s.name,
                'base_unit', s.base_unit,
                'category', s.category,
                'stock_base_qty', s.stock_base_qty,
                'stock_value_cop', s.stock_value_cop,
                'days_left', s.days_left
            ) order by s.stock_value_cop desc, s.name)
            from stock s
        ), '[]'::jsonb)
    ),

    'alerts', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'severity', a.severity,
            'status', a.status,
            'items_alerting', a.items_alerting,
            'shortfall_value_cop', a.shortfall_value_cop,
            'created_at', a.created_at
        ) order by a.created_at desc)
        from month_alerts a
    ), '[]'::jsonb)
)
from bounds b;
$$;

grant execute on function public.inv_month_report(date) to anon, authenticated, service_role;
