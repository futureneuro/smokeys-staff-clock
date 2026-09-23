-- The POS import is manual.
--
-- The manager wants to see what each import brought in and confirm the
-- matching before anything comes off stock, so the 04:00 job that pulled
-- yesterday automatically is removed. The Sales screen's Import button now
-- covers every day from the last one on record up to yesterday (or from a
-- chosen start date), so catching up is still one press.
--
-- The Vault entries the job used are left in place; they are harmless and
-- would be needed again if a schedule ever came back.

do $$
begin
    if to_regclass('cron.job') is null then
        return;
    end if;

    perform cron.unschedule('olaclick-daily-sync')
    where exists (select 1 from cron.job where jobname = 'olaclick-daily-sync');

    raise notice 'OlaClick daily sync removed — imports are manual from the Sales screen';
end $$;
