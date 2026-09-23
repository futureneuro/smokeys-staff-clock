-- Runs the OlaClick import every morning.
--
-- 04:00 in Bogotá (09:00 UTC; Colombia has no daylight saving) so the previous
-- day is finished and the kitchen has not started the new one. The function's
-- `scheduled` action imports yesterday and then retries any recent day that
-- was held for mapping or failed, so a mapping confirmed during the day is
-- applied the next morning without anyone pressing a button.
--
-- The URL, the anon key (for the gateway's JWT check) and the shared secret
-- (proves the caller is the schedule) are read from Supabase Vault at run
-- time, so nothing secret is written into this file or into the job itself.
-- Create them once, by name:
--
--   pos_sync_url         https://<ref>.supabase.co/functions/v1/olaclick-sync
--   inventory_anon_key   the project's anon key
--   pos_sync_secret      the same value as the POS_SYNC_SECRET function env var
--
-- `alter database ... set` was tried first and is not allowed for the postgres
-- role on hosted projects, which is why the alert retry's settings-based
-- schedule never actually ran.

do $$
begin
    if to_regclass('cron.job') is null then
        raise notice 'pg_cron not installed — skipping the OlaClick daily sync schedule';
        return;
    end if;

    perform cron.unschedule('olaclick-daily-sync')
    where exists (select 1 from cron.job where jobname = 'olaclick-daily-sync');

    perform cron.schedule(
        'olaclick-daily-sync',
        '0 9 * * *',
        $cron$
            select net.http_post(
                url := (select decrypted_secret from vault.decrypted_secrets where name = 'pos_sync_url'),
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'inventory_anon_key'),
                    'x-pos-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pos_sync_secret')
                ),
                body := '{"action":"scheduled"}'::jsonb,
                timeout_milliseconds := 55000
            )
            where (select count(*) from vault.decrypted_secrets
                   where name in ('pos_sync_url', 'inventory_anon_key', 'pos_sync_secret')) = 3;
        $cron$
    );

    raise notice 'OlaClick daily sync scheduled for 04:00 Bogotá (runs once the three vault secrets exist)';
end $$;
