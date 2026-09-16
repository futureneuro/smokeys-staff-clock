-- OlaClick POS sync: daily sales come from the register instead of being typed.
--
-- Sales still flow through inv_sales_entries and inv_confirm_sales_entry. There
-- is deliberately no second path by which stock can move: the import writes a
-- sales entry exactly as the Sales screen does and confirms it with the same
-- function, so everything already verified about deductions still holds.
--
-- What this migration adds is the translation layer. OlaClick knows products
-- by its own ids and English names; the bowl arrives as one product whose
-- pieces are a " - "-joined modifier string. Both have to be mapped onto menu
-- items once, by a person. An AI may suggest, but nothing deducts on a
-- suggestion — only a confirmed mapping counts.
--
-- Forward-only, like every migration in this feature.

-- ---------------------------------------------------------------------------
-- 1. The scheduled import has no staff id
-- ---------------------------------------------------------------------------

-- inv_assert_admin requires an active admin's staff id, which a server job does
-- not have. The alternative — a separate confirm function for the import —
-- would be a second place ledger rows are written, and the first one took five
-- review rounds to get right.
--
-- A request carrying a verified service-role JWT is trusted instead. That key
-- exists only in edge function secrets and never reaches a browser; it already
-- bypasses row-level security entirely, so this grants nothing it lacked.
--
-- The claim is read from the request settings PostgREST sets per call, which
-- are unaffected by SECURITY DEFINER, so callers of definer functions cannot
-- borrow the owner's identity to pass this check.
create or replace function public.inv_is_service_role()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
    select coalesce(
        coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
            nullif(current_setting('request.jwt.claim.role', true), '')
        ) = 'service_role',
        false
    );
$$;

grant execute on function public.inv_is_service_role() to anon, authenticated, service_role;

create or replace function public.inv_assert_admin(p_actor_id uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
    if public.inv_is_service_role() then
        return;
    end if;

    if to_regclass('public.staff') is null then
        raise exception 'Cannot verify the administrator';
    end if;
    if p_actor_id is null or not exists (
        select 1 from public.staff
        where id = p_actor_id and role = 'admin' and active = true
    ) then
        raise exception 'Solo un administrador puede hacer este cambio / Only an administrator can make this change';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Where a day's sales came from
-- ---------------------------------------------------------------------------

alter table public.inv_sales_entries
    add column if not exists source text not null default 'manual';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'inv_sales_entries_source_check') then
        alter table public.inv_sales_entries
            add constraint inv_sales_entries_source_check check (source in ('manual', 'olaclick'));
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Product mapping
-- ---------------------------------------------------------------------------

-- One row per OlaClick product variant. Variants matter: "TOASTY BREAKFAST -
-- PAN BRIOCHE" and "- PAN DE MASA MADRE" are one product with two variant ids
-- and different bread, and "BOWL - MEDIUM" / "BOWL - BIG" are one product sold
-- at two portions.
create table if not exists public.inv_pos_product_map (
    id uuid primary key default gen_random_uuid(),
    pos_product_id text not null,
    pos_variant_id text not null default '',
    pos_name text not null,

    kind text check (kind is null or kind in ('menu_item', 'composite', 'ignore')),
    -- restrict: menu items are archived, never deleted, and a deleted target
    -- would otherwise null this out and break the check below.
    menu_item_id uuid references public.inv_menu_items(id) on delete restrict,
    portion_label text,

    confirmed boolean not null default false,
    confirmed_by uuid,
    confirmed_at timestamptz,

    -- AI output lives apart from the mapping itself so a suggestion can never
    -- be mistaken for a decision.
    suggested_kind text check (suggested_kind is null or suggested_kind in ('menu_item', 'composite', 'ignore')),
    suggested_menu_item_id uuid references public.inv_menu_items(id) on delete set null,
    suggested_portion_label text,
    suggestion_reason text,
    suggested_at timestamptz,

    last_seen_on date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint inv_pos_product_map_unique unique (pos_product_id, pos_variant_id),
    constraint inv_pos_product_map_confirmed_kind check (not confirmed or kind is not null),
    constraint inv_pos_product_map_item_needs_id check (kind is distinct from 'menu_item' or menu_item_id is not null),
    constraint inv_pos_product_map_composite_needs_portion check (kind is distinct from 'composite' or portion_label is not null)
);

create index if not exists inv_pos_product_map_unconfirmed_idx
    on public.inv_pos_product_map (confirmed) where confirmed = false;

-- ---------------------------------------------------------------------------
-- 4. Bowl piece mapping
-- ---------------------------------------------------------------------------

-- Keyed on a normalised form (lowercase, accents and extra spaces removed) so
-- "Maíz dulce" and "Maiz dulce" are one piece. The component is stored by name
-- rather than id because it resolves to a different menu item per portion:
-- "Base: Quinoa · Regular" in a medium bowl, "· Grande" in a big one.
create table if not exists public.inv_pos_modifier_map (
    id uuid primary key default gen_random_uuid(),
    token_key text not null,
    token_display text not null,

    kind text check (kind is null or kind in ('component', 'ignore')),
    component_name text,

    confirmed boolean not null default false,
    confirmed_by uuid,
    confirmed_at timestamptz,

    suggested_kind text check (suggested_kind is null or suggested_kind in ('component', 'ignore')),
    suggested_component_name text,
    suggestion_reason text,
    suggested_at timestamptz,

    last_seen_on date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint inv_pos_modifier_map_unique unique (token_key),
    constraint inv_pos_modifier_map_confirmed_kind check (not confirmed or kind is not null),
    constraint inv_pos_modifier_map_component_needs_name check (kind is distinct from 'component' or component_name is not null)
);

-- ---------------------------------------------------------------------------
-- 5. One import per business day
-- ---------------------------------------------------------------------------

-- pending_mapping  something sold that nobody has mapped yet; nothing deducted
-- confirmed        sales entry written and confirmed, stock moved
-- skipped_manual   that day was already typed in on the Sales screen
-- no_sales         OlaClick reported nothing sold
-- failed           the fetch or the confirmation errored; see error
create table if not exists public.inv_pos_imports (
    id uuid primary key default gen_random_uuid(),
    sold_on date not null,
    status text not null check (status in ('pending_mapping', 'confirmed', 'skipped_manual', 'no_sales', 'failed')),
    sales_entry_id uuid references public.inv_sales_entries(id) on delete set null,

    item_count numeric(12, 2) not null default 0,
    revenue_cop numeric(14, 2) not null default 0,
    deducted_count integer not null default 0,
    not_deducted_count integer not null default 0,
    held_count integer not null default 0,
    freehand_count integer not null default 0,

    -- What was deducted, what was not and why, what held the day, comps, and
    -- the bowl piece tally. Written once per run so the screen never has to
    -- re-derive a past day from mappings that may since have changed.
    summary jsonb not null default '{}'::jsonb,
    -- The report as OlaClick returned it, kept for audit. products-sold carries
    -- quantities and product ids only, no customer data.
    raw_products jsonb,
    raw_freehand jsonb,

    error text,
    triggered_by text not null default 'schedule' check (triggered_by in ('schedule', 'admin')),
    triggered_admin uuid,
    fetched_at timestamptz,
    confirmed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint inv_pos_imports_one_per_day unique (sold_on)
);

create index if not exists inv_pos_imports_recent_idx
    on public.inv_pos_imports (sold_on desc);

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------

-- Readable by the app, like every inventory table. Writable only by the edge
-- function (service role) and by the admin-checked functions below — never
-- directly from the browser, since a mapping decides what comes off stock.
do $$
declare
    t text;
begin
    foreach t in array array['inv_pos_product_map', 'inv_pos_modifier_map', 'inv_pos_imports']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_read', t);
        execute format(
            'create policy %I on public.%I for select to anon, authenticated using (true)',
            t || '_read', t);
        execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
        execute format('grant select on public.%I to anon, authenticated', t);
        -- Explicit: default privileges on this project have not always covered
        -- service_role, and a missing grant shows up as a silent 42501.
        execute format('grant select, insert, update, delete on public.%I to service_role', t);
    end loop;
end $$;

create or replace function public.inv_pos_set_product_map(
    p_map_id uuid,
    p_kind text,
    p_menu_item_id uuid,
    p_portion_label text,
    p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.inv_assert_admin(p_actor_id);

    if p_kind is null or p_kind not in ('menu_item', 'composite', 'ignore') then
        raise exception 'Choose what this product is: a menu item, a bowl, or not inventory';
    end if;

    if p_kind = 'menu_item' and (
        p_menu_item_id is null
        or not exists (select 1 from public.inv_menu_items where id = p_menu_item_id and active = true)
    ) then
        raise exception 'Choose an active menu item for this product';
    end if;

    if p_kind = 'composite' and coalesce(btrim(p_portion_label), '') = '' then
        raise exception 'Choose the size this product sells (Regular or Grande)';
    end if;

    update public.inv_pos_product_map
    set kind = p_kind,
        menu_item_id = case when p_kind = 'menu_item' then p_menu_item_id end,
        portion_label = case when p_kind = 'composite' then btrim(p_portion_label) end,
        confirmed = true,
        confirmed_by = p_actor_id,
        confirmed_at = now(),
        updated_at = now()
    where id = p_map_id;

    if not found then
        raise exception 'POS product mapping % not found', p_map_id;
    end if;
end;
$$;

create or replace function public.inv_pos_set_modifier_map(
    p_map_id uuid,
    p_kind text,
    p_component_name text,
    p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.inv_assert_admin(p_actor_id);

    if p_kind is null or p_kind not in ('component', 'ignore') then
        raise exception 'Choose whether this bowl piece is a component or not inventory';
    end if;

    if p_kind = 'component' and not exists (
        select 1 from public.inv_menu_items
        where active = true and lower(name) = lower(btrim(coalesce(p_component_name, '')))
    ) then
        raise exception 'Choose an existing bowl component for this piece';
    end if;

    update public.inv_pos_modifier_map
    set kind = p_kind,
        component_name = case when p_kind = 'component' then btrim(p_component_name) end,
        confirmed = true,
        confirmed_by = p_actor_id,
        confirmed_at = now(),
        updated_at = now()
    where id = p_map_id;

    if not found then
        raise exception 'Bowl piece mapping % not found', p_map_id;
    end if;
end;
$$;

grant execute on function public.inv_pos_set_product_map(uuid, text, uuid, text, uuid) to anon, authenticated;
grant execute on function public.inv_pos_set_modifier_map(uuid, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Bowl pieces the register sells that had no component yet
-- ---------------------------------------------------------------------------

-- The register offers these, so a bowl containing one would hold its day with
-- nowhere to map the piece. They are created empty: recipe_complete = false and
-- no recipe lines, so they deduct nothing until someone enters raw quantities.
--
-- The note carries the menu card's figure as a starting point, but it is the
-- plated weight, not the raw one. For anything cooked the two differ — 150 G
-- of cooked rice is about 83 G dry — so the card number must not simply be
-- typed in.
do $$
declare
    rec record;
begin
    for rec in
        select * from (values
            ('Base: Lechuga',                     'Regular', 'Falta: cantidad en crudo · carta 35 G'),
            ('Base: Lechuga',                     'Grande',  'Falta: cantidad en crudo · carta 45 G'),
            ('Proteína: Chicharrón',              'Grande',  'Falta: cantidad en crudo · carta 100 G'),
            ('Topping: Pimentón amarillo salteado','Grande', 'Falta: cantidad en crudo · carta 40 G (caramelizado)'),
            ('Topping: Plátano maduro',           'Regular', 'Falta: cantidad en crudo · carta 50 G'),
            ('Topping: Plátano maduro',           'Grande',  'Falta: cantidad en crudo · carta 65 G'),
            ('Topping: Zanahoria rayada',         'Regular', 'Falta: cantidad en crudo · carta 25 G'),
            ('Topping: Zanahoria rayada',         'Grande',  'Falta: cantidad en crudo · carta 35 G'),
            ('Topping: Remolacha cocida',         'Regular', 'Falta: cantidad en crudo · carta 40 G'),
            ('Topping: Remolacha cocida',         'Grande',  'Falta: cantidad en crudo · carta 50 G'),
            ('Topping: Maíz dulce',               'Regular', 'Falta: cantidad en crudo · carta 50 G'),
            ('Topping: Maíz dulce',               'Grande',  'Falta: cantidad en crudo · carta 65 G'),
            ('Topping: Crotones',                 'Regular', 'Falta: cantidad en crudo · carta 18 G'),
            ('Topping: Crotones',                 'Grande',  'Falta: cantidad en crudo · carta 25 G'),
            ('Topping: Maíz tostado',             'Regular', 'Falta: cantidad en crudo · carta 15 G'),
            ('Topping: Maíz tostado',             'Grande',  'Falta: cantidad en crudo · carta 20 G'),
            ('Topping: Aguacate',                 'Regular', 'Falta: cantidad en crudo · carta 50 G'),
            ('Topping: Aguacate',                 'Grande',  'Falta: cantidad en crudo · carta 65 G'),
            ('Topping: Champiñones',              'Regular', 'Falta: cantidad en crudo · carta 30 G'),
            ('Topping: Champiñones',              'Grande',  'Falta: cantidad en crudo · carta 40 G'),
            ('Topping: Cebolla caramelizada',     'Regular', 'Falta: cantidad en crudo · carta 20 G'),
            ('Topping: Cebolla caramelizada',     'Grande',  'Falta: cantidad en crudo · carta 25 G'),
            ('Topping: Tomates cherry',           'Regular', 'Falta: cantidad en crudo · carta 22 G (3 unidades)'),
            ('Topping: Tomates cherry',           'Grande',  'Falta: cantidad en crudo · carta 30 G (4 unidades)'),
            ('Salsa: Parmesano',                  'Regular', 'Falta: cantidad — no aparece en la carta'),
            ('Salsa: Parmesano',                  'Grande',  'Falta: cantidad — no aparece en la carta'),
            ('Salsa: Salsa blanca',               'Regular', 'Falta: cantidad — no aparece en la carta'),
            ('Salsa: Salsa blanca',               'Grande',  'Falta: cantidad — no aparece en la carta')
        ) as v(name, portion, note)
    loop
        -- Checked by hand rather than relying on ON CONFLICT: the uniqueness
        -- index is partial, and the restaurant is editing recipes in parallel
        -- and may already have created one of these.
        if not exists (
            select 1 from public.inv_menu_items
            where active = true
              and lower(name) = lower(rec.name)
              and coalesce(portion_label, '') = rec.portion
        ) then
            insert into public.inv_menu_items (name, category, portion_label, recipe_complete, notes)
            values (rec.name, 'bowl', rec.portion, false, rec.note);
        end if;
    end loop;
end $$;

-- The two "Bowl Arroz premium + Pollo champiñones" rows were a setup example.
-- A bowl is sold as pieces, and these made it look like a bowl is two parts —
-- which is exactly what confused the person entering recipes. Archived, not
-- deleted: archiving leaves any reference intact.
update public.inv_menu_items
set active = false, updated_at = now()
where name = 'Bowl Arroz premium + Pollo champiñones' and active = true;

-- ---------------------------------------------------------------------------
-- 8. Daily schedule
-- ---------------------------------------------------------------------------

do $$
begin
    begin
        create extension if not exists pg_net with schema extensions;
    exception when others then
        raise notice 'pg_net could not be enabled: %', sqlerrm;
    end;

    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron could not be enabled: %', sqlerrm;
    end;
end $$;

-- 09:00 UTC is 04:00 in Bogotá. The digital menu closes at 16:30, so the
-- previous day is complete by then.
--
-- The URL, the anon key and the shared secret are read from Vault when the job
-- runs, so none of them is written into this file or into cron.job. The job
-- does nothing until all three exist. The earlier alert-retry schedule relied
-- on database settings instead and never ran for that reason.
do $$
begin
    if to_regclass('cron.job') is null then
        raise notice 'pg_cron not available — daily OlaClick sync not scheduled';
        return;
    end if;

    perform cron.unschedule('olaclick-daily-sync')
    where exists (select 1 from cron.job where jobname = 'olaclick-daily-sync');

    perform cron.schedule(
        'olaclick-daily-sync',
        '0 9 * * *',
        $cron$
        select net.http_post(
            url := s.url,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || s.anon_key,
                'x-pos-sync-secret', s.secret
            ),
            body := jsonb_build_object('action', 'scheduled'),
            timeout_milliseconds := 120000
        )
        from (
            select
                (select decrypted_secret from vault.decrypted_secrets where name = 'olaclick_sync_url') as url,
                (select decrypted_secret from vault.decrypted_secrets where name = 'olaclick_sync_anon_key') as anon_key,
                (select decrypted_secret from vault.decrypted_secrets where name = 'olaclick_sync_secret') as secret
        ) s
        where s.url is not null and s.anon_key is not null and s.secret is not null;
        $cron$
    );

    raise notice 'OlaClick sync scheduled daily at 09:00 UTC';
end $$;
