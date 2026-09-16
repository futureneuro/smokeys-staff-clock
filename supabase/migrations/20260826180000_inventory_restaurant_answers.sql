-- Loads what the restaurant confirmed on 2026-08-26/27.
--
-- Every ratio below was supplied by them and checked for internal consistency
-- across portion sizes before being loaded: rice 1.81x, quinoa 2.00x,
-- bolognesa 1.25x, spiced chicken 0.70x. Consistent ratios across sizes mean
-- these were computed rather than guessed.

-- ---------------------------------------------------------------------------
-- No alcohol on the menu
-- ---------------------------------------------------------------------------

-- "There's no alcohol on this menu." Deactivated rather than deleted: the
-- recipes are correct and cost nothing to keep, and a bar may come back.
update public.inv_menu_items
set active = false, updated_at = now()
where category = 'cocktail';

update public.inv_items
set is_tracked = false, archived = true
where name in ('Tequila', 'Ron blanco', 'Vodka', 'Blue curaçao', 'Vino blanco', 'Ginger beer');

-- ---------------------------------------------------------------------------
-- Confirmed pack sizes and doses
-- ---------------------------------------------------------------------------

insert into public.inv_items (name, base_unit, category, is_tracked, track_priority, storage_area, notes)
values
    ('Pechuga de pollo',   'g',  'ingredient', true, 3, 'fridge',    'Proteína — prioridad alta de conteo'),
    ('Carne molida',       'g',  'ingredient', true, 3, 'fridge',    'Proteína — prioridad alta de conteo'),
    ('Cerdo para chicharrón', 'g', 'ingredient', true, 3, 'fridge',  'Chicharrón se hace en casa'),
    ('Tocineta',           'g',  'ingredient', true, 3, 'fridge',    'Proteína — prioridad alta de conteo'),
    ('Arroz blanco',       'g',  'ingredient', true, 2, 'dry_store', null),
    ('Arroz integral',     'g',  'ingredient', true, 2, 'dry_store', null),
    ('Quinoa',             'g',  'ingredient', true, 2, 'dry_store', null),
    ('Pimentón amarillo',  'g',  'ingredient', true, 1, 'fridge',    null),
    ('Zanahoria',          'g',  'ingredient', true, 1, 'fridge',    null),
    ('Cebolla blanca',     'g',  'ingredient', true, 1, 'dry_store', null),
    ('Pimentón rojo',      'g',  'ingredient', true, 1, 'fridge',    null),
    ('Champiñones',        'g',  'ingredient', true, 2, 'fridge',    null),
    ('Crema de leche',     'g',  'ingredient', true, 2, 'fridge',    null),
    ('Pan brioche',        'g',  'ingredient', true, 2, 'dry_store', 'Molde de 500 G; se descartan los dos extremos'),
    ('Café en grano',      'g',  'ingredient', true, 2, 'dry_store', '18 G por extracción de espresso'),
    ('Limón',              'unidad', 'ingredient', true, 1, 'fridge', '1 limón de 60 G rinde 40 ML de jugo')
on conflict do nothing;

update public.inv_items set notes = '18 G por extracción de espresso', track_priority = 2
where lower(name) = 'café en grano';

update public.inv_items set notes = '1 limón de 60 G rinde 40 ML de jugo'
where lower(name) = 'limón';

update public.inv_items set notes = 'Molde de 500 G; se descartan los dos extremos'
where lower(name) in ('pan brioche', 'pan brioche / masa madre');

-- 1 lemon (60 G) yields 40 ML of juice, so recipes written in ML of juice can
-- be converted to whole lemons.
insert into public.inv_pack_conversions (item_id, pack_label, base_qty)
select id, 'limón', 1 from public.inv_items where lower(name) = 'limón'
on conflict do nothing;

insert into public.inv_pack_conversions (item_id, pack_label, base_qty)
select id, 'molde', 500 from public.inv_items where lower(name) = 'pan brioche'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Raw quantities per portion, as supplied
-- ---------------------------------------------------------------------------

-- Bowl components are their own menu items rather than 250 permutations:
-- OlaClick records a bowl as one product with the toppings chosen, so counting
-- the components is both simpler and closer to how sales actually arrive.
create or replace function pg_temp.seed_component(
    p_name text, p_size text, p_item text, p_raw_qty numeric, p_note text default null
)
returns void language plpgsql as $$
declare
    v_menu uuid;
    v_item uuid;
begin
    select id into v_item from public.inv_items where lower(name) = lower(p_item) and archived = false limit 1;
    if v_item is null then
        raise notice 'skipping %, raw material % not found', p_name, p_item;
        return;
    end if;

    select id into v_menu from public.inv_menu_items
    where lower(name) = lower(p_name) and coalesce(portion_label, '') = coalesce(p_size, '') limit 1;

    if v_menu is null then
        insert into public.inv_menu_items (name, category, portion_label, recipe_complete, notes)
        values (p_name, 'bowl', p_size, true, p_note)
        returning id into v_menu;
    else
        update public.inv_menu_items set recipe_complete = true, notes = coalesce(p_note, notes) where id = v_menu;
    end if;

    insert into public.inv_recipe_lines (menu_item_id, item_id, qty_base)
    values (v_menu, v_item, p_raw_qty)
    on conflict (menu_item_id, item_id) do update set qty_base = excluded.qty_base;
end $$;

do $$
begin
    -- Bases. Recipe portions are cooked; these are the raw equivalents.
    perform pg_temp.seed_component('Base: Arroz premium',   'Regular', 'Arroz blanco',   83);
    perform pg_temp.seed_component('Base: Arroz premium',   'Grande',  'Arroz blanco',   105);
    perform pg_temp.seed_component('Base: Arroz integral',  'Regular', 'Arroz integral', 87);
    perform pg_temp.seed_component('Base: Arroz integral',  'Grande',  'Arroz integral', 110);
    perform pg_temp.seed_component('Base: Quinoa',          'Regular', 'Quinoa',         65);
    perform pg_temp.seed_component('Base: Quinoa',          'Grande',  'Quinoa',         80);

    -- Sautéed vegetables, as a base. 105 G raw yields the 90 G served.
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Regular', 'Zanahoria',       47);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Regular', 'Pimentón rojo',   23);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Regular', 'Pimentón amarillo', 23);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Regular', 'Cebolla blanca',  23);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Grande',  'Zanahoria',       57);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Grande',  'Pimentón rojo',   28);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Grande',  'Pimentón amarillo', 28);
    perform pg_temp.seed_component('Base: Vegetales salteados', 'Grande',  'Cebolla blanca',  28);

    -- Proteins. The plated weight includes 10 G of sauce, which is why the raw
    -- chicken figure is higher than the portion figure.
    perform pg_temp.seed_component('Proteína: Pollo con salsa de champiñones', 'Regular', 'Pechuga de pollo', 125,
        'La porción de 90 G incluye 10 G de salsa');
    perform pg_temp.seed_component('Proteína: Pollo con salsa de champiñones', 'Regular', 'Champiñones', 30);
    perform pg_temp.seed_component('Proteína: Pollo con salsa de champiñones', 'Grande',  'Pechuga de pollo', 155,
        'La porción de 115 G incluye 10 G de salsa');
    perform pg_temp.seed_component('Proteína: Pollo con salsa de champiñones', 'Grande',  'Champiñones', 38);

    perform pg_temp.seed_component('Proteína: Pollo con salsa de tocineta', 'Regular', 'Pechuga de pollo', 125,
        'La porción de 90 G incluye 10 G de salsa');
    perform pg_temp.seed_component('Proteína: Pollo con salsa de tocineta', 'Regular', 'Tocineta', 18);
    perform pg_temp.seed_component('Proteína: Pollo con salsa de tocineta', 'Grande',  'Pechuga de pollo', 155,
        'La porción de 115 G incluye 10 G de salsa');
    perform pg_temp.seed_component('Proteína: Pollo con salsa de tocineta', 'Grande',  'Tocineta', 23);

    perform pg_temp.seed_component('Proteína: Pechuga con especias', 'Regular', 'Pechuga de pollo', 115);
    perform pg_temp.seed_component('Proteína: Pechuga con especias', 'Grande',  'Pechuga de pollo', 144);

    perform pg_temp.seed_component('Proteína: Carne a la boloñesa', 'Regular', 'Carne molida', 64);
    perform pg_temp.seed_component('Proteína: Carne a la boloñesa', 'Grande',  'Carne molida', 80);

    -- 200 G was given without a size; applied to the regular portion and
    -- flagged so it gets confirmed before anyone trusts the large one.
    perform pg_temp.seed_component('Proteína: Chicharrón', 'Regular', 'Cerdo para chicharrón', 200,
        'PENDIENTE CONFIRMAR: dieron 200 G sin especificar si es la porción de 80 G o la de 100 G');

    -- Topping.
    perform pg_temp.seed_component('Topping: Pimentón amarillo salteado', 'Regular', 'Pimentón amarillo', 55);
end $$;

-- The plate version of bolognesa (110 G served = 88 G raw) is not a bowl.
do $$
declare
    v_menu uuid;
    v_item uuid;
begin
    select id into v_item from public.inv_items where lower(name) = 'carne molida' and archived = false limit 1;
    select id into v_menu from public.inv_menu_items where lower(name) = 'sueño bolognesa' limit 1;
    if v_menu is not null and v_item is not null then
        insert into public.inv_recipe_lines (menu_item_id, item_id, qty_base)
        values (v_menu, v_item, 88)
        on conflict (menu_item_id, item_id) do update set qty_base = 88;

        update public.inv_menu_items
        set notes = 'Falta el arroz y los demás ingredientes en crudo'
        where id = v_menu;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Made in-house, so they are preparations rather than purchases
-- ---------------------------------------------------------------------------

update public.inv_items set item_type = 'prep', notes = 'Se hace en casa — falta la receta'
where lower(name) in ('chicharrón', 'maduritos', 'plátano maduro (maduritos)');

-- Bought ready-made, confirmed by the restaurant.
update public.inv_items set item_type = 'raw'
where lower(name) in ('crotones', 'granola', 'maíz tostado', 'queso costeño', 'jamón de pavo');

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------

insert into public.inv_suppliers (name, default_payment_method, notes) values
    ('PriceSmart',    'card',     null),
    ('D1',            'card',     null),
    ('Padam',         'transfer', 'Pedir factura o remisión con ítems'),
    ('Deinar',        'transfer', 'Pedir factura o remisión con ítems'),
    ('Vita Integral', 'transfer', 'Pedir factura o remisión con ítems')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Desserts
-- ---------------------------------------------------------------------------

update public.inv_menu_items
set notes = 'PENDIENTE CONFIRMAR: dieron 12 porciones sin decir de cuál cheesecake'
where category = 'dessert';
