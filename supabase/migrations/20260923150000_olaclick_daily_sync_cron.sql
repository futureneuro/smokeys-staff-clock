-- Runs the OlaClick import every morning.
--
-- 04:00 in Bogotá (09:00 UTC; Colombia has no daylight saving) so the previous
-- day is finished and the kitchen has not started the new one. The function's
-- `scheduled` action imports yesterday and then retries any recent day that
-- was held for mapping or failed, so a mapping confirmed during the day is
-- applied the next morning without anyone pressing a button.
--
-- Same pattern as the alert retry: the URL, the anon key (for the gateway's
-- JWT check) and the shared secret (proves the caller is the schedule) come
-- from database settings, so nothing secret is written into this file:
--
--   alter database postgres set app.settings.pos_sync_url       = 'https://<ref>.supabase.co/functions/v1/olaclick-sync';
--   alter database postgres set app.settings.inventory_anon_key = '<anon key>';   -- already set for the alert retry
--   alter database postgres set app.settings.pos_sync_secret    = '<same value as the POS_SYNC_SECRET function env var>';
--
-- Re-running this migration (or a later one calling the same block) picks up
-- changed settings: the job is unscheduled and recreated each time.

do $$
declare
    v_url    text := current_setting('app.settings.pos_sync_url', true);
    v_anon   text := current_setting('app.settings.inventory_anon_key', true);
    v_secret text := current_setting('app.settings.pos_sync_secret', true);
    v_missing text[] := '{}';
begin
    if to_regclass('cron.job') is null then
        raise notice 'pg_cron not installed — skipping the OlaClick daily sync schedule';
        return;
    end if;

    perform cron.unschedule('olaclick-daily-sync')
    where exists (select 1 from cron.job where jobname = 'olaclick-daily-sync');

    if coalesce(btrim(v_url), '') = ''    then v_missing := v_missing || 'app.settings.pos_sync_url'; end if;
    if coalesce(btrim(v_anon), '') = ''   then v_missing := v_missing || 'app.settings.inventory_anon_key'; end if;
    if coalesce(btrim(v_secret), '') = '' then v_missing := v_missing || 'app.settings.pos_sync_secret'; end if;

    if array_length(v_missing, 1) > 0 then
        raise notice 'OlaClick daily sync not scheduled — missing: %', array_to_string(v_missing, ', ');
        return;
    end if;

    perform cron.schedule(
        'olaclick-daily-sync',
        '0 9 * * *',
        format($cron$
            select net.http_post(
                url := %L,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || %L,
                    'x-pos-sync-secret', %L
                ),
                body := '{"action":"scheduled"}'::jsonb,
                timeout_milliseconds := 55000
            );
        $cron$, v_url, v_anon, v_secret)
    );

    raise notice 'OlaClick daily sync scheduled for 04:00 Bogotá';
end $$;
