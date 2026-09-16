-- Stop the Gemini API key being readable from the browser.
--
-- settings.gemini_api_key was selectable with the anon key, which ships inside
-- the public JavaScript bundle. The key could be read from outside the app with
-- no login at all, and spent against the Google account.
--
-- Nothing actually needed the browser to read it. The admin page fetched the
-- key only to forward it to the generate-tasks edge function, and that function
-- already falls back to reading it server-side with the service role. The
-- receipt scanner does the same. So the column can be closed to clients without
-- changing how either feature works.
--
-- The settings table was created outside this migrations folder, so every
-- statement is guarded and this file is a no-op where it does not exist.

do $$
begin
    if to_regclass('public.settings') is null then
        raise notice 'public.settings not present — skipping';
        return;
    end if;

    -- A table-level grant covers every column, and revoking one column from it
    -- does nothing. The grant has to be dropped and re-issued per column.
    revoke select on public.settings from anon, authenticated;

    grant select (
        id,
        restaurant_name,
        restaurant_lat,
        restaurant_lng,
        radius_meters,
        default_break_short,
        default_break_medium,
        default_break_long
    ) on public.settings to anon, authenticated;

    -- INSERT and UPDATE are deliberately untouched: the Settings screen still
    -- has to be able to save a new key, and a write does not return the value.
end $$;

-- The Settings screen shows an "API key configured" tick. That only needs a
-- yes/no, so it gets one rather than the key itself.
create or replace function public.gemini_key_is_set()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.settings
        where gemini_api_key is not null and btrim(gemini_api_key) <> ''
    );
$$;

grant execute on function public.gemini_key_is_set() to anon, authenticated;
