-- Fixes the scheduled alert retry.
--
-- The previous version POSTed with only a Content-Type header. Edge functions
-- verify the JWT by default, so every retry was rejected 401 and no pending
-- alert was ever re-sent — the schedule existed but never did anything.
--
-- Two headers are needed now:
--   Authorization      — the anon key, to satisfy the gateway's JWT check
--   x-inventory-secret — proves the caller is the schedule, since the function
--                        otherwise requires an admin id
--
-- Both come from database settings, so no secret is written into this file:
--   alter database postgres set app.settings.inventory_alert_url    = 'https://<ref>.supabase.co/functions/v1/inventory-alert';
--   alter database postgres set app.settings.inventory_anon_key     = '<anon key>';
--   alter database postgres set app.settings.inventory_alert_secret = '<same value as the INVENTORY_ALERT_SECRET function env var>';

do $$
declare
    v_url    text := current_setting('app.settings.inventory_alert_url', true);
    v_anon   text := current_setting('app.settings.inventory_anon_key', true);
    v_secret text := current_setting('app.settings.inventory_alert_secret', true);
    v_missing text[] := '{}';
begin
    if to_regclass('cron.job') is null then
        raise notice 'pg_cron not installed — skipping the alert retry schedule';
        return;
    end if;

    -- Removed first, unconditionally. The previous migration scheduled a job
    -- that sends no Authorization header; leaving it in place while returning
    -- early meant it kept POSTing and being rejected 401 every 30 minutes.
    perform cron.unschedule('inventory-alert-retry')
    where exists (select 1 from cron.job where jobname = 'inventory-alert-retry');

    if coalesce(btrim(v_url), '') = ''    then v_missing := v_missing || 'app.settings.inventory_alert_url'; end if;
    if coalesce(btrim(v_anon), '') = ''   then v_missing := v_missing || 'app.settings.inventory_anon_key'; end if;
    if coalesce(btrim(v_secret), '') = '' then v_missing := v_missing || 'app.settings.inventory_alert_secret'; end if;

    if array_length(v_missing, 1) > 0 then
        raise notice 'Alert retry not scheduled — missing: %', array_to_string(v_missing, ', ');
        return;
    end if;

    -- Every 30 minutes, and only when something is actually undelivered.
    -- 'skipped' was never sent because configuration was missing; 'failed' is
    -- a send that errored. Both still need to go out.
    perform cron.schedule(
        'inventory-alert-retry',
        '*/30 * * * *',
        format($cron$
            select net.http_post(
                url := %L,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || %L,
                    'x-inventory-secret', %L
                ),
                body := '{}'::jsonb
            )
            where exists (
                select 1 from public.inv_alerts
                where email_status in ('pending', 'skipped', 'failed')
            );
        $cron$, v_url, v_anon, v_secret)
    );

    raise notice 'Alert retry scheduled every 30 minutes';
end $$;

-- Widened to match: an alert stuck as 'skipped' is just as undelivered as a
-- pending one, and the screen should say so.
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
where email_status in ('pending', 'failed', 'skipped')
  and created_at < now() - interval '24 hours';

grant select on public.inv_alerts_stuck to anon, authenticated;
