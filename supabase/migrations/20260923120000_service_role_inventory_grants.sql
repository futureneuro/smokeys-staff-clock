-- Let the edge functions read the inventory.
--
-- On this project the default privileges for new tables do not include
-- service_role (only anon and authenticated), so every inventory table created
-- since 2026-08-26 is invisible to the edge functions unless a migration grants
-- access explicitly. Only inv_alerts, inv_settings, inv_alert_recipients and
-- the three inv_pos_* tables ever got that grant.
--
-- The result: olaclick-sync fails with "permission denied for table
-- inv_menu_items" the moment it tries to resolve a day or ask Gemini for
-- mapping suggestions, so neither the daily POS import nor the "Suggest
-- matches with AI" button can work.
--
-- Fix: grant service_role SELECT on every inventory table and view, and the
-- writes olaclick-sync performs directly (a draft sales entry and its lines;
-- the deduction itself goes through inv_confirm_sales_entry). Written as a
-- loop over the catalogue so a table added later by hand is covered too.

do $$
declare
    rel record;
begin
    for rel in
        select c.relname, c.relkind
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'v', 'p')
          and c.relname like 'inv\_%'
    loop
        execute format('grant select on public.%I to service_role', rel.relname);
    end loop;
end $$;

-- olaclick-sync inserts the draft sales entry and its lines itself, and deletes
-- the draft again when the confirmation RPC refuses it.
grant insert, delete on public.inv_sales_entries to service_role;
grant insert on public.inv_sales_lines to service_role;

-- New inventory tables created from here on get the same treatment without a
-- follow-up migration. Scoped to objects created by the migration role.
alter default privileges for role postgres in schema public
    grant select on tables to service_role;
