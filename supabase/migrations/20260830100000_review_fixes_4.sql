-- Fourth round of review fixes.
--
-- Everything is in this one file. Re-applying an earlier migration to make a
-- small change silently reverted a newer function definition once already, so
-- corrections go forward rather than being edited in place.
--
--  * Stale alert claims were released on the alert's age, not the claim's, so a
--    day-old alert was un-claimed while it was still being sent.
--  * Claims ignored inv_alerts.status, so an alert already explained and closed
--    could still be emailed as a fresh alarm.
--  * inv_alerts was writable with the anon key, so a shortfall could be closed
--    without the mandatory explanation, or its figures rewritten.
--  * Deleting a confirmed count cascaded its alert away while leaving the
--    ledger adjustment behind.

-- ---------------------------------------------------------------------------
-- 1. Claim time must be recorded on the claim
-- ---------------------------------------------------------------------------

alter table public.inv_alerts
    add column if not exists claimed_at timestamptz;

create or replace function public.inv_claim_alerts(p_alert_id uuid default null, p_limit integer default 20)
returns setof public.inv_alerts
language sql
volatile
set search_path = public, pg_temp
as $$
    update public.inv_alerts a
    set email_status = 'sending',
        claimed_at = now()
    where a.id in (
        select id from public.inv_alerts
        where email_status in ('pending', 'skipped', 'failed')
          -- An alert that has been explained and closed must not be mailed as
          -- a fresh alarm just because its email never went out.
          and status = 'new'
          and (p_alert_id is null or id = p_alert_id)
        order by created_at
        limit greatest(p_limit, 1)
        for update skip locked
    )
    returning a.*;
$$;

-- Released on how long the claim has been held, not on how old the alert is.
-- Using created_at meant any alert older than an hour was handed to a second
-- dispatcher while the first was still talking to ACS.
create or replace function public.inv_release_stale_alert_claims()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_rows integer;
begin
    update public.inv_alerts
    set email_status = 'pending', claimed_at = null
    where email_status = 'sending'
      and coalesce(claimed_at, created_at) < now() - interval '15 minutes';
    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

grant execute on function public.inv_claim_alerts(uuid, integer) to service_role;
grant execute on function public.inv_release_stale_alert_claims() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Alerts are the record of a shortfall, so the browser may only read them
-- ---------------------------------------------------------------------------

-- With insert/update granted, the anon key could close an alert without the
-- explanation inv_acknowledge_alert insists on, zero its figures, or mark it
-- 'sent' so the dispatcher never mails it. Somebody could erase the record of a
-- shortfall they caused.
revoke insert, update, delete on public.inv_alerts from anon, authenticated;

drop policy if exists inv_alerts_app_all on public.inv_alerts;
drop policy if exists inv_alerts_read on public.inv_alerts;
create policy inv_alerts_read on public.inv_alerts
    for select to anon, authenticated using (true);

-- Acknowledging now goes through an admin check, like every other write that
-- matters. The explanation stays mandatory.
create or replace function public.inv_acknowledge_alert(
    p_alert_id uuid,
    p_note text,
    p_actor_id uuid default null,
    p_dismiss boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.inv_assert_admin(p_actor_id);

    if coalesce(btrim(p_note), '') = '' then
        raise exception 'Explique qué causó la diferencia antes de cerrar la alerta / Explain what caused the difference before closing the alert';
    end if;

    update public.inv_alerts
    set status = case when p_dismiss then 'dismissed' else 'acknowledged' end,
        acknowledged_by = p_actor_id,
        acknowledged_at = now(),
        acknowledge_note = btrim(p_note)
    where id = p_alert_id;
end;
$$;

grant execute on function public.inv_acknowledge_alert(uuid, text, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A confirmed record may not be deleted from the browser
-- ---------------------------------------------------------------------------

-- DELETE is kept, because saving a count, purchase or sales entry rolls itself
-- back by deleting the draft it just created. It is confined to drafts: a
-- confirmed count cascades its alert away while leaving the ledger adjustment
-- in place, so stock still reads as reconciled with no record of why.
do $$
declare
    t text;
begin
    foreach t in array array['inv_counts', 'inv_purchases', 'inv_sales_entries']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_app_all', t);
        execute format('drop policy if exists %I on public.%I', t || '_rw', t);
        execute format('drop policy if exists %I on public.%I', t || '_delete_draft_only', t);

        execute format(
            'create policy %I on public.%I for select to anon, authenticated using (true)',
            t || '_read', t);
        execute format(
            'create policy %I on public.%I for insert to anon, authenticated with check (true)',
            t || '_insert', t);
        execute format(
            'create policy %I on public.%I for update to anon, authenticated using (true) with check (true)',
            t || '_update', t);
        -- Only a draft can be removed.
        execute format(
            'create policy %I on public.%I for delete to anon, authenticated using (status = ''draft'')',
            t || '_delete_draft_only', t);
    end loop;
end $$;

-- Count lines follow their parent; deleting a confirmed count's lines would
-- strip the evidence just as effectively.
drop policy if exists inv_count_lines_app_all on public.inv_count_lines;
drop policy if exists inv_count_lines_read on public.inv_count_lines;
drop policy if exists inv_count_lines_insert on public.inv_count_lines;
drop policy if exists inv_count_lines_update on public.inv_count_lines;
drop policy if exists inv_count_lines_delete_draft_only on public.inv_count_lines;

create policy inv_count_lines_read on public.inv_count_lines
    for select to anon, authenticated using (true);
create policy inv_count_lines_insert on public.inv_count_lines
    for insert to anon, authenticated with check (true);
create policy inv_count_lines_update on public.inv_count_lines
    for update to anon, authenticated using (true) with check (true);
create policy inv_count_lines_delete_draft_only on public.inv_count_lines
    for delete to anon, authenticated
    using (exists (select 1 from public.inv_counts c where c.id = count_id and c.status = 'draft'));
