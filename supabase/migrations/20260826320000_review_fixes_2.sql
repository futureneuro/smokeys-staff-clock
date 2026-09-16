-- Second round of review fixes.
--
--  * inv_stock_as_of excluded EVERY count adjustment, not just the one being
--    confirmed, so each count re-reported the previous count's shortfall as a
--    fresh one — forever.
--  * The photo trigger read only NEW.requires_photo, so clearing the flag and
--    completing in one statement walked straight past it.
--  * A status explicitly marked is_complete = false still hit the word-list
--    fallback, and the client disagreed with the database about it.
--  * Anyone with the public anon key could add their own address to the alert
--    recipients and receive the shortfall reports.

-- ---------------------------------------------------------------------------
-- 1. Expected stock: exclude only THIS count's own adjustment
-- ---------------------------------------------------------------------------

drop function if exists public.inv_stock_as_of(uuid, date);

-- Other counts' adjustments are real reconciliations and must be counted.
-- Only the rows written by the count being confirmed are excluded, so
-- re-confirming cannot compound.
create or replace function public.inv_stock_as_of(
    p_item_id uuid,
    p_on date,
    p_exclude_count_id uuid default null
)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
    select coalesce(sum(l.delta_base_qty), 0)::numeric
    from public.inv_stock_ledger l
    where l.item_id = p_item_id
      and l.occurred_at < ((p_on + 1)::timestamp at time zone 'America/Bogota')
      and (
          p_exclude_count_id is null
          or l.ref_table is distinct from 'inv_count_lines'
          or l.ref_id not in (
              select cl.id from public.inv_count_lines cl where cl.count_id = p_exclude_count_id
          )
      );
$$;

grant execute on function public.inv_stock_as_of(uuid, date, uuid) to anon, authenticated, service_role;

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

    -- The expected figure is computed once per line and the other two columns
    -- derive from it. Calling the aggregate three times per line meant three
    -- full ledger scans for every item counted.
    with expected as (
        select
            cl.id as line_id,
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
            'item', v.item_name, 'expected', v.expected_qty, 'counted', v.counted_qty,
            'missing', abs(v.variance_qty), 'unit', v.base_unit, 'pct', v.variance_pct,
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
-- 2. The photo rule must survive clearing the flag in the same statement
-- ---------------------------------------------------------------------------

create or replace function public.enforce_task_photo_requirement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_completing boolean;
    v_flag boolean;
    v_requires boolean;
begin
    -- Clearing requires_photo and setting a completing status in one UPDATE
    -- would otherwise pass the check, because only the new row was inspected.
    -- Clearing the flag on its own is still allowed; doing it while changing
    -- the status is not.
    v_requires := coalesce(new.requires_photo, false);
    if TG_OP = 'UPDATE'
       and coalesce(old.requires_photo, false)
       and old.status is distinct from new.status
    then
        v_requires := true;
    end if;

    if not v_requires then
        return new;
    end if;

    -- An explicit is_complete = false must win over the word list. bool_or
    -- returned false both for "no such status" and for "marked not complete",
    -- so an admin's deliberate choice was overridden.
    select ts.is_complete into v_flag
    from public.task_statuses ts
    where lower(btrim(ts.label)) = lower(btrim(new.status))
    limit 1;

    if found then
        v_completing := coalesce(v_flag, false);
    else
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

-- Shared definition of "this status means finished", so the client and the
-- database cannot drift apart.
create or replace function public.task_status_is_complete(p_status text)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
    v_flag boolean;
begin
    select ts.is_complete into v_flag
    from public.task_statuses ts
    where lower(btrim(ts.label)) = lower(btrim(p_status))
    limit 1;

    if found then
        return coalesce(v_flag, false);
    end if;

    return lower(btrim(coalesce(p_status, ''))) in
        ('completed', 'complete', 'completado', 'completada', 'hecho', 'hecha', 'done', 'finalizado', 'finalizada');
end;
$$;

grant execute on function public.task_status_is_complete(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Alert recipients must not be writable with the public anon key
-- ---------------------------------------------------------------------------

-- The anon key ships in the browser bundle. With a blanket write policy anyone
-- who has it could subscribe their own address and receive every shortfall
-- report — item names, quantities and values — or quietly remove the real
-- recipients so nobody is told at all.
revoke insert, update, delete on public.inv_alert_recipients from anon, authenticated;

drop policy if exists inv_alert_recipients_app_all on public.inv_alert_recipients;
drop policy if exists inv_alert_recipients_read on public.inv_alert_recipients;
create policy inv_alert_recipients_read on public.inv_alert_recipients
    for select to anon, authenticated using (true);

create or replace function public.inv_assert_admin(p_actor_id uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
    if to_regclass('public.staff') is null then
        raise exception 'Cannot verify the administrator';
    end if;
    if p_actor_id is null or not exists (
        select 1 from public.staff
        where id = p_actor_id and role = 'admin' and active = true
    ) then
        raise exception 'Solo un administrador puede hacer este cambio / Only an administrator can make this change';
    end if;
end;
$$;

create or replace function public.inv_add_alert_recipient(
    p_email text, p_label text, p_actor_id uuid
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

    insert into public.inv_alert_recipients (email, label)
    values (btrim(p_email), nullif(btrim(coalesce(p_label, '')), ''))
    returning id into v_id;

    return v_id;
end;
$$;

create or replace function public.inv_set_alert_recipient_active(
    p_id uuid, p_active boolean, p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.inv_assert_admin(p_actor_id);
    update public.inv_alert_recipients set active = p_active where id = p_id;
end;
$$;

create or replace function public.inv_delete_alert_recipient(p_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.inv_assert_admin(p_actor_id);
    delete from public.inv_alert_recipients where id = p_id;
end;
$$;

grant execute on function public.inv_assert_admin(uuid) to anon, authenticated;
grant execute on function public.inv_add_alert_recipient(text, text, uuid) to anon, authenticated;
grant execute on function public.inv_set_alert_recipient_active(uuid, boolean, uuid) to anon, authenticated;
grant execute on function public.inv_delete_alert_recipient(uuid, uuid) to anon, authenticated;
