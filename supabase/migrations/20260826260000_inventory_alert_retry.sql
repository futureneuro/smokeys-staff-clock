-- Retry undelivered alert emails.
--
-- Dispatch is triggered by the browser when a count is confirmed. If that call
-- fails — the tab was closed, the network dropped, ACS was briefly down — the
-- alert sits pending and nobody is told. This retries anything still pending.
--
-- Uses pg_cron and pg_net where they are available (they are on Supabase). The
-- whole block is guarded so the migration is a no-op on a plain Postgres, and
-- the app still works without it: alerts always appear in the UI, and the
-- Alerts screen has a "try sending" button.

do $$
declare
    v_url text := current_setting('app.settings.inventory_alert_url', true);
begin
    if to_regclass('cron.job') is null then
        raise notice 'pg_cron not installed — skipping the alert retry schedule';
        return;
    end if;

    if v_url is null or btrim(v_url) = '' then
        raise notice 'app.settings.inventory_alert_url not set — skipping the alert retry schedule';
        return;
    end if;

    perform cron.unschedule('inventory-alert-retry')
    where exists (select 1 from cron.job where jobname = 'inventory-alert-retry');

    -- Every 30 minutes: often enough that a failure is not sat on for a day,
    -- rare enough that it costs nothing. The function itself only acts on
    -- alerts still marked pending, so an extra run is a no-op.
    perform cron.schedule(
        'inventory-alert-retry',
        '*/30 * * * *',
        format($cron$
            select net.http_post(
                url := %L,
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := '{}'::jsonb
            )
            where exists (select 1 from public.inv_alerts where email_status = 'pending');
        $cron$, v_url)
    );
end $$;

-- Anything left pending for over a day is not going to send on its own —
-- something is misconfigured. Surfaced as a view so the Alerts screen can say
-- so rather than letting it rot silently.
create or replace view public.inv_alerts_stuck
with (security_invoker = true) as
select
    id,
    title,
    created_at,
    email_status,
    email_error,
    round(extract(epoch from (now() - created_at)) / 3600)::integer as hours_waiting
from public.inv_alerts
where email_status in ('pending', 'failed')
  and created_at < now() - interval '24 hours';

grant select on public.inv_alerts_stuck to anon, authenticated;
