-- Third round of review fixes.
--
--  * inv_record_stock_event, inv_confirm_purchase and inv_confirm_count are
--    SECURITY DEFINER and were granted to anon with no actor check, so the key
--    that ships in the browser bundle could write anything into the ledger the
--    design calls append-only and client-unwritable.
--  * inv_settings was fully writable by anon; deleting that one row made every
--    threshold NULL and silently switched off alerting altogether.
--  * Two invocations could send the same alert email concurrently.

-- ---------------------------------------------------------------------------
-- 1. Ledger writes require an administrator
-- ---------------------------------------------------------------------------

-- inv_assert_admin already exists (20260826320000). Reused here so there is one
-- definition of "may change stock".
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
    perform public.inv_assert_admin(p_actor_id);

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

-- Guard the other two ledger writers the same way. Both already receive the
-- admin id from the client, so nothing else changes.
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
    perform public.inv_assert_admin(p_actor_id);

    select status, purchased_on into v_status, v_purchased_on
    from public.inv_purchases where id = p_purchase_id for update;

    if v_status is null then
        raise exception 'Purchase % not found', p_purchase_id;
    end if;
    if v_status <> 'draft' then
        raise exception 'Purchase % is %, only draft purchases can be confirmed', p_purchase_id, v_status;
    end if;

    select count(*) into v_bad_lines
    from public.inv_purchase_lines
    where purchase_id = p_purchase_id and (item_id is null or base_qty is null);

    if v_bad_lines > 0 then
        raise exception 'Purchase % has % line(s) that are unmapped or missing a base quantity', p_purchase_id, v_bad_lines;
    end if;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, occurred_at, created_by
    )
    select pl.item_id, pl.base_qty, 'purchase', 'inv_purchase_lines', pl.id,
           (v_purchased_on::timestamp at time zone 'America/Bogota'), p_actor_id
    from public.inv_purchase_lines pl
    where pl.purchase_id = p_purchase_id;

    update public.inv_items i
    set cost_per_base_unit = src.cost, updated_at = now()
    from (
        select pl.item_id, sum(pl.line_total_cop) / nullif(sum(pl.base_qty), 0) as cost
        from public.inv_purchase_lines pl
        where pl.purchase_id = p_purchase_id
          and pl.line_total_cop is not null and pl.base_qty is not null and pl.base_qty > 0
        group by pl.item_id
    ) src
    where i.id = src.item_id and src.cost is not null;

    update public.inv_purchases
    set status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_id
    where id = p_purchase_id;
end;
$$;

-- inv_confirm_sales_entry writes negative ledger rows too.
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
    perform public.inv_assert_admin(p_actor_id);

    select status, sold_on into v_status, v_sold_on
    from public.inv_sales_entries where id = p_entry_id for update;

    if v_status is null then
        raise exception 'Sales entry % not found', p_entry_id;
    end if;
    if v_status <> 'draft' then
        raise exception 'Sales entry % is %, only draft entries can be confirmed', p_entry_id, v_status;
    end if;

    select count(*) into v_incomplete
    from public.inv_sales_lines sl
    join public.inv_menu_items m on m.id = sl.menu_item_id
    where sl.sales_entry_id = p_entry_id and sl.qty_sold > 0 and m.recipe_complete = false;

    if v_incomplete > 0 then
        raise exception '% menu item(s) sold have an incomplete recipe. Finish those recipes or set their quantity to zero.', v_incomplete;
    end if;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, occurred_at, created_by
    )
    select r.item_id, -sum(sl.qty_sold * r.qty_base), 'sale', 'inv_sales_entries', p_entry_id,
           (v_sold_on::timestamp at time zone 'America/Bogota'), p_actor_id
    from public.inv_sales_lines sl
    join public.inv_recipe_lines r on r.menu_item_id = sl.menu_item_id
    join public.inv_items it on it.id = r.item_id and it.is_tracked = true
    where sl.sales_entry_id = p_entry_id and sl.qty_sold > 0 and r.is_tracked = true
    group by r.item_id
    having sum(sl.qty_sold * r.qty_base) > 0;

    get diagnostics v_rows = row_count;

    update public.inv_sales_entries
    set status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_id
    where id = p_entry_id;

    return v_rows;
end;
$$;

-- inv_confirm_count: same guard, everything else as in 20260826320000.
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
    v_alerting integer;
    v_shortfall numeric(14, 2);
    v_area text;
    v_summary jsonb;
begin
    perform public.inv_assert_admin(p_actor_id);

    select status, counted_on, storage_area
    into v_status, v_counted_on, v_area
    from public.inv_counts where id = p_count_id for update;

    if v_status is null then
        raise exception 'Count % not found', p_count_id;
    end if;
    if v_status <> 'draft' then
        raise exception 'Count % is %, only draft counts can be confirmed', p_count_id, v_status;
    end if;

    with expected as (
        select cl.id as line_id,
               public.inv_stock_as_of(cl.item_id, v_counted_on, p_count_id) as expected_qty,
               i.cost_per_base_unit
        from public.inv_count_lines cl
        join public.inv_items i on i.id = cl.item_id
        where cl.count_id = p_count_id
    )
    update public.inv_count_lines cl
    set expected_qty = e.expected_qty,
        variance_qty = cl.counted_qty - e.expected_qty,
        variance_value_cop = round((cl.counted_qty - e.expected_qty) * coalesce(e.cost_per_base_unit, 0), 2)
    from expected e
    where cl.id = e.line_id;

    get diagnostics v_rows = row_count;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, note, occurred_at, created_by
    )
    select cl.item_id, cl.variance_qty, 'count', 'inv_count_lines', cl.id,
           'Ajuste por conteo físico',
           (v_counted_on::timestamp at time zone 'America/Bogota'), p_actor_id
    from public.inv_count_lines cl
    where cl.count_id = p_count_id and cl.variance_qty is not null and cl.variance_qty <> 0;

    update public.inv_counts
    set status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_id
    where id = p_count_id;

    select count(*), coalesce(sum(v.variance_value_cop), 0),
        coalesce(jsonb_agg(jsonb_build_object(
            'item', v.item_name, 'expected', v.expected_qty, 'counted', v.counted_qty,
            'missing', abs(v.variance_qty), 'unit', v.base_unit, 'pct', v.variance_pct,
            'value_cop', abs(v.variance_value_cop), 'priced', (v.cost_per_base_unit is not null)
        ) order by v.variance_value_cop), '[]'::jsonb)
    into v_alerting, v_shortfall, v_summary
    from public.inv_count_variance v
    where v.count_id = p_count_id and v.is_alert;

    if v_alerting > 0 then
        insert into public.inv_alerts (
            count_id, kind, severity, title, summary, items_alerting, shortfall_value_cop, email_status
        )
        values (
            p_count_id, 'count_variance',
            case when abs(v_shortfall) >= 200000 then 'critical' else 'warning' end,
            format('Conteo %s%s: %s producto(s) con faltante',
                   to_char(v_counted_on, 'DD/MM/YYYY'),
                   case when v_area is null then '' else ' — ' || v_area end, v_alerting),
            v_summary, v_alerting, abs(v_shortfall), 'pending'
        )
        on conflict (count_id) where count_id is not null do nothing;
    end if;

    return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Settings decide whether an alert fires, so they are not anon-writable
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.inv_settings from anon, authenticated;

drop policy if exists inv_settings_app_all on public.inv_settings;
drop policy if exists inv_settings_read on public.inv_settings;
create policy inv_settings_read on public.inv_settings
    for select to anon, authenticated using (true);

create or replace function public.inv_update_settings(
    p_pct numeric,
    p_value numeric,
    p_blind boolean,
    p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.inv_assert_admin(p_actor_id);

    if p_pct is null or p_pct < 0 or p_pct > 100 then
        raise exception 'The percentage threshold must be between 0 and 100';
    end if;
    if p_value is null or p_value < 0 then
        raise exception 'The value threshold cannot be negative';
    end if;

    insert into public.inv_settings (id, variance_pct_threshold, variance_value_threshold_cop, blind_count, updated_at)
    values (true, p_pct, p_value, coalesce(p_blind, true), now())
    on conflict (id) do update
    set variance_pct_threshold = excluded.variance_pct_threshold,
        variance_value_threshold_cop = excluded.variance_value_threshold_cop,
        blind_count = excluded.blind_count,
        updated_at = now();
end;
$$;

grant execute on function public.inv_update_settings(numeric, numeric, boolean, uuid) to anon, authenticated;

-- Missing settings must not silently disable alerting. Without a row every
-- comparison went NULL, is_alert was NULL, and no alert was ever raised.
create or replace view public.inv_count_variance
with (security_invoker = true) as
select
    c.id as count_id, c.counted_on, c.storage_area, c.status,
    cl.id as line_id, cl.item_id, i.name as item_name, i.category, i.base_unit,
    i.cost_per_base_unit, cl.counted_qty, cl.expected_qty, cl.variance_qty,
    cl.variance_value_cop,
    case
        when coalesce(cl.expected_qty, 0) = 0 then null
        else round(abs(cl.variance_qty) / abs(cl.expected_qty) * 100, 1)
    end as variance_pct,
    (
        cl.variance_qty is not null
        and cl.variance_qty < 0
        and coalesce(cl.expected_qty, 0) <> 0
        and abs(cl.variance_qty) / abs(cl.expected_qty) * 100
            >= coalesce((select variance_pct_threshold from public.inv_settings), 10)
        and (
            i.cost_per_base_unit is null
            or abs(coalesce(cl.variance_value_cop, 0))
                >= coalesce((select variance_value_threshold_cop from public.inv_settings), 20000)
        )
    ) as is_alert
from public.inv_counts c
join public.inv_count_lines cl on cl.count_id = c.id
join public.inv_items i on i.id = cl.item_id;

grant select on public.inv_count_variance to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. An alert must not be sent twice
-- ---------------------------------------------------------------------------

do $$
begin
    alter table public.inv_alerts drop constraint if exists inv_alerts_email_status_check;
    alter table public.inv_alerts
        add constraint inv_alerts_email_status_check check (email_status in (
            'pending', 'sending', 'sent', 'failed', 'skipped'
        ));
end $$;

-- Claims a batch atomically. Two dispatchers racing — the browser after a count
-- and the 30-minute retry — would otherwise both select the same row and both
-- mail every recipient.
create or replace function public.inv_claim_alerts(p_alert_id uuid default null, p_limit integer default 20)
returns setof public.inv_alerts
language sql
volatile
set search_path = public, pg_temp
as $$
    update public.inv_alerts a
    set email_status = 'sending'
    where a.id in (
        select id from public.inv_alerts
        where email_status in ('pending', 'skipped', 'failed')
          and (p_alert_id is null or id = p_alert_id)
        order by created_at
        limit greatest(p_limit, 1)
        for update skip locked
    )
    returning a.*;
$$;

grant execute on function public.inv_claim_alerts(uuid, integer) to service_role;

-- Anything left 'sending' for over an hour is a dispatcher that died mid-flight.
-- Returned to pending so the retry picks it up rather than stranding it.
create or replace function public.inv_release_stale_alert_claims()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_rows integer;
begin
    update public.inv_alerts
    set email_status = 'pending'
    where email_status = 'sending' and created_at < now() - interval '1 hour';
    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

grant execute on function public.inv_release_stale_alert_claims() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Requiring a photo on an already-completed task must not be refused
-- ---------------------------------------------------------------------------

-- The rule protects the moment a task becomes complete, not every write to a
-- completed row. Ticking "needs a photo" on a task finished last month was
-- being rejected with a message about uploading a photo, which reads as
-- nonsense and made historical tasks impossible to flag.
create or replace function public.enforce_task_photo_requirement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_requires boolean;
    v_completing boolean;
    v_status_changed boolean;
    v_proof_removed boolean;
begin
    v_status_changed := TG_OP = 'INSERT' or (old.status is distinct from new.status);
    v_proof_removed := TG_OP = 'UPDATE'
        and coalesce(btrim(old.proof_url), '') <> ''
        and coalesce(btrim(new.proof_url), '') = '';

    -- Only these two moments are guarded: becoming complete, and having the
    -- proof taken away while complete.
    if not v_status_changed and not v_proof_removed then
        return new;
    end if;

    -- Clearing the flag in the same statement as the status change must not
    -- get past the rule.
    v_requires := coalesce(new.requires_photo, false);
    if TG_OP = 'UPDATE' and coalesce(old.requires_photo, false) and v_status_changed then
        v_requires := true;
    end if;

    if not v_requires then
        return new;
    end if;

    v_completing := public.task_status_is_complete(new.status);

    if v_completing and coalesce(btrim(new.proof_url), '') = '' then
        raise exception 'Esta tarea necesita una foto antes de poder completarse / This task needs a photo before it can be completed'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;
