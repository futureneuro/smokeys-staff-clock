-- Alerts raised by a stock count, and the record of what was done about them.
--
-- An alert nobody acts on is worse than no alert: it teaches people to ignore
-- the app. So an alert is not just a notification — it has to be acknowledged
-- with a reason, and those reasons are how the thresholds get tuned and how
-- genuine patterns become visible.

create table if not exists public.inv_alerts (
    id uuid primary key default gen_random_uuid(),
    count_id uuid references public.inv_counts(id) on delete cascade,
    kind text not null default 'count_variance' check (kind in ('count_variance')),
    severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
    title text not null,
    -- Frozen at creation. The underlying count can be superseded later, but the
    -- alert should still say what it said when it fired.
    summary jsonb,
    items_alerting integer not null default 0,
    shortfall_value_cop numeric(14, 2) not null default 0,
    status text not null default 'new' check (status in ('new', 'acknowledged', 'dismissed')),
    acknowledged_by uuid,
    acknowledged_at timestamptz,
    -- Why the shortfall happened. This is the field that makes the system
    -- smarter over time; an acknowledgement without one explains nothing.
    acknowledge_note text,
    email_status text not null default 'pending'
        check (email_status in ('pending', 'sent', 'failed', 'skipped')),
    email_error text,
    email_sent_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists inv_alerts_status_idx
    on public.inv_alerts (status, created_at desc);

create index if not exists inv_alerts_email_pending_idx
    on public.inv_alerts (email_status) where email_status = 'pending';

create unique index if not exists inv_alerts_count_unique_idx
    on public.inv_alerts (count_id) where count_id is not null;

-- ---------------------------------------------------------------------------
-- Raise an alert when a confirmed count crosses the thresholds
-- ---------------------------------------------------------------------------

-- Replaces the version in 20260826170000. Same behaviour, plus it raises an
-- alert when the count finds shortfalls worth looking at.
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

    update public.inv_count_lines cl
    set expected_qty = coalesce(s.stock_base_qty, 0),
        variance_qty = cl.counted_qty - coalesce(s.stock_base_qty, 0),
        variance_value_cop = round(
            (cl.counted_qty - coalesce(s.stock_base_qty, 0)) * coalesce(i.cost_per_base_unit, 0), 2)
    from public.inv_items i
    left join public.inv_item_stock s on s.item_id = i.id
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

    -- Which items crossed both thresholds, and what they are worth.
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
            'value_cop', abs(v.variance_value_cop)
        ) order by v.variance_value_cop), '[]'::jsonb)
    into v_alerting, v_shortfall, v_summary
    from public.inv_count_variance v
    where v.count_id = p_count_id and v.is_alert;

    if v_alerting > 0 then
        insert into public.inv_alerts (
            count_id, kind, severity, title, summary, items_alerting, shortfall_value_cop, email_status
        )
        values (
            p_count_id,
            'count_variance',
            case when abs(v_shortfall) >= 200000 then 'critical' else 'warning' end,
            format('Conteo %s%s: %s producto(s) con faltante',
                   to_char(v_counted_on, 'DD/MM/YYYY'),
                   case when v_area is null then '' else ' — ' || v_area end,
                   v_alerting),
            v_summary,
            v_alerting,
            abs(v_shortfall),
            'pending'
        )
        on conflict (count_id) where count_id is not null do nothing;
    end if;

    return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Acknowledging
-- ---------------------------------------------------------------------------

-- An acknowledgement needs a reason. "Seen" teaches nobody anything; "the
-- freezer failed on Sunday" is what lets the next shortfall be read correctly.
create or replace function public.inv_acknowledge_alert(
    p_alert_id uuid,
    p_note text,
    p_actor_id uuid default null,
    p_dismiss boolean default false
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if coalesce(btrim(p_note), '') = '' then
        raise exception 'Explain what caused the difference before closing the alert';
    end if;

    update public.inv_alerts
    set status = case when p_dismiss then 'dismissed' else 'acknowledged' end,
        acknowledged_by = p_actor_id,
        acknowledged_at = now(),
        acknowledge_note = btrim(p_note)
    where id = p_alert_id;
end;
$$;

alter table public.inv_alerts enable row level security;

drop policy if exists inv_alerts_app_all on public.inv_alerts;
create policy inv_alerts_app_all on public.inv_alerts
    for all to anon, authenticated using (true) with check (true);

grant select, insert, update on public.inv_alerts to anon, authenticated;
grant execute on function public.inv_acknowledge_alert(uuid, text, uuid, boolean) to anon, authenticated;

-- The alert edge function runs as service_role and reads the recipient from
-- settings before updating the delivery status. Granted explicitly rather than
-- relying on Supabase's default privileges, which differ between a project
-- created through the dashboard and one built from these migrations.
grant select, update on public.inv_alerts to service_role;
grant select on public.inv_settings to service_role;
