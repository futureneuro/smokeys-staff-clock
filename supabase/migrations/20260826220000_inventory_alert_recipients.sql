-- Alert recipients as a managed list rather than one email in settings.
--
-- Who should hear about a shortfall changes with staff and with holidays, and
-- it should never need a developer. Each recipient can also be switched off
-- without being deleted, so somebody on leave stops receiving reports without
-- losing their place in the list.

create table if not exists public.inv_alert_recipients (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    -- Who it is, for the UI. The address alone is a poor label.
    label text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

-- Case-insensitive: nobody should be able to add the same person twice by
-- capitalising differently.
create unique index if not exists inv_alert_recipients_email_unique_idx
    on public.inv_alert_recipients (lower(email));

create index if not exists inv_alert_recipients_active_idx
    on public.inv_alert_recipients (active) where active = true;

-- Basic shape check. Real validation is the message arriving.
alter table public.inv_alert_recipients
    drop constraint if exists inv_alert_recipients_email_chk;
alter table public.inv_alert_recipients
    add constraint inv_alert_recipients_email_chk
        check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- Carry across whatever the single-field version held.
insert into public.inv_alert_recipients (email, label)
select btrim(alert_email), 'Migrado de Ajustes'
from public.inv_settings
where alert_email is not null and btrim(alert_email) <> ''
on conflict do nothing;

alter table public.inv_settings drop column if exists alert_email;

alter table public.inv_alert_recipients enable row level security;

drop policy if exists inv_alert_recipients_app_all on public.inv_alert_recipients;
create policy inv_alert_recipients_app_all on public.inv_alert_recipients
    for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.inv_alert_recipients to anon, authenticated;

-- The alert function runs as service_role and reads the list before sending.
grant select on public.inv_alert_recipients to service_role;
