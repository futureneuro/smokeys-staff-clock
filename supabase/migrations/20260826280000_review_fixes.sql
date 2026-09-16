-- Fixes from code review.
--
--  * The photo requirement was gated on the literal status 'Completed', so any
--    admin-defined status ("Hecho", "Done") closed the task with no proof.
--  * A back-dated count compared against stock as of today, not as of the day
--    it was counted, so a correct count could read as a full period short.
--  * An item with no purchase price could never raise an alert, because its
--    variance value was always zero.

-- ---------------------------------------------------------------------------
-- 1. Photo requirement must hold for ANY completing status
-- ---------------------------------------------------------------------------

do $$
begin
    if to_regclass('public.task_statuses') is not null then
        -- Which statuses mean "this task is finished". Custom statuses are
        -- added by admins at will, so the set has to be data, not a literal.
        alter table public.task_statuses
            add column if not exists is_complete boolean not null default false;

        update public.task_statuses
        set is_complete = true
        where lower(btrim(label)) in ('completed', 'complete', 'completado', 'completada', 'hecho', 'hecha', 'done', 'finalizado', 'finalizada')
          and is_complete = false;
    end if;
end $$;

-- A CHECK constraint cannot consult another table, so the rule moves to a
-- trigger. The old constraint is dropped: it only knew about 'Completed' and
-- would now be both redundant and misleading.
do $$
begin
    if to_regclass('public.tasks') is not null then
        alter table public.tasks
            drop constraint if exists tasks_photo_required_before_complete_chk;
    end if;
end $$;

create or replace function public.enforce_task_photo_requirement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_completing boolean := false;
begin
    if coalesce(new.requires_photo, false) = false then
        return new;
    end if;

    -- Treat as completing if the status is flagged complete in task_statuses,
    -- or matches one of the known completion words. The literal fallback keeps
    -- the rule working even if task_statuses has not been maintained.
    select coalesce(bool_or(ts.is_complete), false)
    into v_completing
    from public.task_statuses ts
    where lower(btrim(ts.label)) = lower(btrim(new.status));

    if not v_completing then
        v_completing := lower(btrim(coalesce(new.status, ''))) in
            ('completed', 'complete', 'completado', 'completada', 'hecho', 'hecha', 'done', 'finalizado', 'finalizada');
    end if;

    if v_completing and (new.proof_url is null or btrim(new.proof_url) = '') then
        raise exception 'Esta tarea necesita una foto antes de poder completarse / This task needs a photo before it can be completed'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

do $$
begin
    if to_regclass('public.tasks') is not null then
        drop trigger if exists trg_task_photo_requirement on public.tasks;
        create trigger trg_task_photo_requirement
            before insert or update on public.tasks
            for each row execute function public.enforce_task_photo_requirement();
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Expected stock must be as of the count date, not as of now
-- ---------------------------------------------------------------------------

-- Stock for one item at the end of a given Bogota day, ignoring adjustments
-- written by the count itself so re-confirming cannot compound.
create or replace function public.inv_stock_as_of(p_item_id uuid, p_on date)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
    select coalesce(sum(l.delta_base_qty), 0)::numeric
    from public.inv_stock_ledger l
    where l.item_id = p_item_id
      and l.occurred_at < ((p_on + 1)::timestamp at time zone 'America/Bogota')
      and l.reason <> 'count';
$$;

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
    select status, counted_on, storage_area
    into v_status, v_counted_on, v_area
    from public.inv_counts where id = p_count_id for update;

    if v_status is null then
        raise exception 'Count % not found', p_count_id;
    end if;
    if v_status <> 'draft' then
        raise exception 'Count % is %, only draft counts can be confirmed', p_count_id, v_status;
    end if;

    -- Expected as of the day counted. Using today's total would charge a
    -- back-dated count with every sale made since.
    update public.inv_count_lines cl
    set expected_qty = public.inv_stock_as_of(cl.item_id, v_counted_on),
        variance_qty = cl.counted_qty - public.inv_stock_as_of(cl.item_id, v_counted_on),
        variance_value_cop = round(
            (cl.counted_qty - public.inv_stock_as_of(cl.item_id, v_counted_on))
            * coalesce(i.cost_per_base_unit, 0), 2)
    from public.inv_items i
    where cl.count_id = p_count_id and i.id = cl.item_id;

    get diagnostics v_rows = row_count;

    insert into public.inv_stock_ledger (
        item_id, delta_base_qty, reason, ref_table, ref_id, note, occurred_at, created_by
    )
    select
        cl.item_id, cl.variance_qty, 'count', 'inv_count_lines', cl.id,
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

    select
        count(*),
        coalesce(sum(v.variance_value_cop), 0),
        coalesce(jsonb_agg(jsonb_build_object(
            'item', v.item_name,
            'expected', v.expected_qty,
            'counted', v.counted_qty,
            'missing', abs(v.variance_qty),
            'unit', v.base_unit,
            'pct', v.variance_pct,
            'value_cop', abs(v.variance_value_cop),
            'priced', (v.cost_per_base_unit is not null)
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
                   case when v_area is null then '' else ' — ' || v_area end,
                   v_alerting),
            v_summary, v_alerting, abs(v_shortfall), 'pending'
        )
        on conflict (count_id) where count_id is not null do nothing;
    end if;

    return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. An unpriced item must still be able to raise an alert
-- ---------------------------------------------------------------------------

-- The value threshold exists to silence noise on cheap items. When the cost is
-- unknown the value is always zero, which silenced everything — including a
-- product that has never been through a confirmed purchase. Where there is no
-- price to judge, the percentage decides alone.
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
    (
        cl.variance_qty is not null
        and cl.variance_qty < 0
        and coalesce(cl.expected_qty, 0) <> 0
        and abs(cl.variance_qty) / abs(cl.expected_qty) * 100
            >= (select variance_pct_threshold from public.inv_settings)
        and (
            -- No price recorded: percentage alone decides.
            i.cost_per_base_unit is null
            or abs(coalesce(cl.variance_value_cop, 0))
                >= (select variance_value_threshold_cop from public.inv_settings)
        )
    ) as is_alert
from public.inv_counts c
join public.inv_count_lines cl on cl.count_id = c.id
join public.inv_items i on i.id = cl.item_id;

grant select on public.inv_count_variance to anon, authenticated;
grant execute on function public.inv_stock_as_of(uuid, date) to anon, authenticated, service_role;
