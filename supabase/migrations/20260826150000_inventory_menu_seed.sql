-- Seeds the menu from RECETAS SMOKEYS EL POBLADO.
--
-- Drinks are seeded with complete recipes: the document gives them in ML and G
-- of the raw ingredient already, so no raw/cooked conversion is involved and
-- they work from day one.
--
-- Food items are seeded by name only, with recipe_complete = false. Their
-- portions are written in cooked weight, so each needs the raw quantity from
-- the restaurant before it can deduct stock. Until then they appear in the UI
-- as "recipe incomplete" and are excluded from stock deduction.
--
-- Re-runnable: every insert is guarded on the item name.

-- ---------------------------------------------------------------------------
-- Raw materials used by the drink recipes
-- ---------------------------------------------------------------------------

insert into public.inv_items (name, base_unit, category, is_tracked, track_priority)
values
    ('Tequila',              'ml', 'alcohol',   true, 3),
    ('Ron blanco',           'ml', 'alcohol',   true, 3),
    ('Vodka',                'ml', 'alcohol',   true, 3),
    ('Blue curaçao',         'ml', 'alcohol',   true, 3),
    ('Ginger beer',          'unidad', 'beverage', true, 2),
    ('Sirope de azúcar',     'ml', 'ingredient', true, 1),
    ('Sirope de cereza',     'ml', 'ingredient', true, 1),
    ('Jugo de limón',        'ml', 'ingredient', true, 1),
    ('Jugo de naranja',      'ml', 'ingredient', true, 1),
    ('Fresa',                'g',  'ingredient', true, 1),
    ('Cereza',               'unidad', 'ingredient', true, 1),
    ('Hielo',                'g',  'ingredient', false, 0),
    ('Sal',                  'g',  'ingredient', false, 0),
    ('Café en grano',        'g',  'ingredient', true, 2),
    ('Leche entera',         'ml', 'ingredient', true, 1),
    ('Agua carbonatada',     'ml', 'ingredient', true, 1)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helper: attach one recipe line by names
-- ---------------------------------------------------------------------------

create or replace function pg_temp.seed_line(p_menu text, p_item text, p_qty numeric)
returns void language plpgsql as $$
begin
    insert into public.inv_recipe_lines (menu_item_id, item_id, qty_base)
    select m.id, i.id, p_qty
    from public.inv_menu_items m, public.inv_items i
    where lower(m.name) = lower(p_menu) and lower(i.name) = lower(p_item)
    on conflict (menu_item_id, item_id) do update set qty_base = excluded.qty_base;
end $$;

-- ---------------------------------------------------------------------------
-- Cocktails — exact quantities, recipes complete
-- ---------------------------------------------------------------------------

insert into public.inv_menu_items (name, category, recipe_complete) values
    ('Margarita Classic',        'cocktail', true),
    ('Margarita Blue',           'cocktail', true),
    ('Margarita Fresca Cerezas', 'cocktail', true),
    ('Daiquiri Clásico',         'cocktail', true),
    ('Daiquiri de Fresa',        'cocktail', true),
    ('Moscow Mule',              'cocktail', true),
    ('Paloma',                   'cocktail', true)
on conflict do nothing;

do $$
begin
    -- Margarita base: 60ML tequila, 30ML sirope, 15ML limón, 60G hielo
    perform pg_temp.seed_line('Margarita Classic', 'Tequila', 60);
    perform pg_temp.seed_line('Margarita Classic', 'Sirope de azúcar', 45);  -- 30 + 15 classic
    perform pg_temp.seed_line('Margarita Classic', 'Jugo de limón', 30);     -- 15 + 15 classic
    perform pg_temp.seed_line('Margarita Classic', 'Hielo', 60);

    perform pg_temp.seed_line('Margarita Blue', 'Tequila', 60);
    perform pg_temp.seed_line('Margarita Blue', 'Sirope de azúcar', 30);
    perform pg_temp.seed_line('Margarita Blue', 'Jugo de limón', 15);
    perform pg_temp.seed_line('Margarita Blue', 'Blue curaçao', 30);
    perform pg_temp.seed_line('Margarita Blue', 'Hielo', 60);

    perform pg_temp.seed_line('Margarita Fresca Cerezas', 'Tequila', 60);
    perform pg_temp.seed_line('Margarita Fresca Cerezas', 'Sirope de azúcar', 30);
    perform pg_temp.seed_line('Margarita Fresca Cerezas', 'Jugo de limón', 15);
    perform pg_temp.seed_line('Margarita Fresca Cerezas', 'Sirope de cereza', 30);
    perform pg_temp.seed_line('Margarita Fresca Cerezas', 'Cereza', 1);
    perform pg_temp.seed_line('Margarita Fresca Cerezas', 'Hielo', 60);

    -- Daiquiri: 60ML ron, 45ML sirope, 15ML limón, 60G hielo
    perform pg_temp.seed_line('Daiquiri Clásico', 'Ron blanco', 60);
    perform pg_temp.seed_line('Daiquiri Clásico', 'Sirope de azúcar', 60);   -- 45 + 15 clásico
    perform pg_temp.seed_line('Daiquiri Clásico', 'Jugo de limón', 30);      -- 15 + 15 clásico
    perform pg_temp.seed_line('Daiquiri Clásico', 'Hielo', 60);

    perform pg_temp.seed_line('Daiquiri de Fresa', 'Ron blanco', 60);
    perform pg_temp.seed_line('Daiquiri de Fresa', 'Sirope de azúcar', 45);
    perform pg_temp.seed_line('Daiquiri de Fresa', 'Jugo de limón', 15);
    perform pg_temp.seed_line('Daiquiri de Fresa', 'Fresa', 30);
    perform pg_temp.seed_line('Daiquiri de Fresa', 'Hielo', 60);

    -- Moscow mule: 80ML vodka, 30ML limón, 30ML azúcar, 1 ginger beer, 100G hielo
    perform pg_temp.seed_line('Moscow Mule', 'Vodka', 80);
    perform pg_temp.seed_line('Moscow Mule', 'Jugo de limón', 30);
    perform pg_temp.seed_line('Moscow Mule', 'Sirope de azúcar', 30);
    perform pg_temp.seed_line('Moscow Mule', 'Ginger beer', 1);
    perform pg_temp.seed_line('Moscow Mule', 'Hielo', 100);

    -- Paloma: 60G tequila, 120G jugo naranja, 50G hielo, 15G limón, 15G sirope, 1G sal
    perform pg_temp.seed_line('Paloma', 'Tequila', 60);
    perform pg_temp.seed_line('Paloma', 'Jugo de naranja', 120);
    perform pg_temp.seed_line('Paloma', 'Jugo de limón', 15);
    perform pg_temp.seed_line('Paloma', 'Sirope de azúcar', 15);
    perform pg_temp.seed_line('Paloma', 'Sal', 1);
    perform pg_temp.seed_line('Paloma', 'Hielo', 50);
end $$;

-- ---------------------------------------------------------------------------
-- Coffee — the espresso dose is still unknown, so these stay incomplete
-- ---------------------------------------------------------------------------

insert into public.inv_menu_items (name, category, recipe_complete, notes) values
    ('Espresso',     'coffee', false, 'Falta: gramos de café por extracción'),
    ('Americano',    'coffee', false, 'Falta: gramos de café por extracción'),
    ('Cappuccino',   'coffee', false, 'Falta: gramos de café por extracción; leche 5oz = 148 ml'),
    ('Citrus Brew',  'coffee', false, 'Falta: gramos de café por extracción'),
    ('Citrus Tonic', 'coffee', false, 'Falta: gramos de café por extracción')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Juices, lemonades and sodas — sachets are counted per unit
-- ---------------------------------------------------------------------------

insert into public.inv_menu_items (name, category, recipe_complete, notes) values
    ('Jugo de mandarina',        'juice', false, 'Falta: confirmar 1 sobre por jugo'),
    ('Jugo de mango',            'juice', false, 'Falta: confirmar 1 sobre por jugo'),
    ('Limonada de coco',         'juice', false, 'Falta: confirmar 1 sobre por vaso'),
    ('Limonada de hierbabuena',  'juice', false, 'Media bolsa por vaso'),
    ('Piña colada',              'juice', false, 'Falta: confirmar 1 sobre por vaso'),
    ('Limonada natural',         'juice', false, null),
    ('Limonada de guandolo',     'juice', false, null),
    ('Limonada de flor de jamaica', 'juice', false, null),
    ('Soda italiana de cereza',    'soda', false, null),
    ('Soda italiana de fresa',     'soda', false, null),
    ('Soda italiana de lychee',    'soda', false, null),
    ('Soda italiana de maracuyá',  'soda', false, null),
    ('Soda italiana maracumango',  'soda', false, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Brunch, plates and desserts — portions are in cooked weight, so each needs
-- the raw quantity from the restaurant before it can deduct stock.
-- ---------------------------------------------------------------------------

insert into public.inv_menu_items (name, category, recipe_complete, notes) values
    ('Batido proteico Cappuccino',  'shake',  false, null),
    ('Batido proteico Matcha',      'shake',  false, null),
    ('Batido proteico Golden',      'shake',  false, null),
    ('Smoothie Tropical',           'shake',  false, null),
    ('Smoothie Mantequilla de maní','shake',  false, null),
    ('Smoothie Pink',               'shake',  false, null),
    ('Parfait Smokeys',             'brunch', false, null),
    ('Desayuno con tostadas',       'brunch', false, null),
    ('Desayuno de la casa',         'brunch', false, 'Waffles de yuca: falta cantidad cruda'),
    ('Desayuno solo más fuerte',    'brunch', false, 'Crepes de avena: falta cantidad cruda'),
    ('Desayuno café de la mañana',  'brunch', false, null),
    ('Desayuno mediterráneo',       'brunch', false, null),
    ('Bagel vegetariano',           'brunch', false, null),
    ('Bagel americano',             'brunch', false, null),
    ('Sueño bolognesa',             'plate',  false, 'Falta: arroz y carne en crudo'),
    ('Pollo para mí',               'plate',  false, 'Falta: arroz y pollo en crudo'),
    ('Ensalada Caesar',             'plate',  false, 'Falta: pechuga en crudo'),
    ('Papas a la francesa',         'side',   false, null),
    ('Cheesecake de pistacho',      'dessert',false, 'Falta: porciones por molde'),
    ('Cheesecake Smokeys',          'dessert',false, 'Falta: porciones por molde')
on conflict do nothing;

-- Bowls: each base/protein combination is sold in two sizes with different
-- portions, so sizes are separate menu items rather than a modifier.
insert into public.inv_menu_items (name, category, portion_label, recipe_complete, notes) values
    ('Bowl Arroz premium + Pollo champiñones',  'bowl', 'Regular', false, 'Falta: arroz y pollo en crudo'),
    ('Bowl Arroz premium + Pollo champiñones',  'bowl', 'Grande',  false, 'Falta: arroz y pollo en crudo')
on conflict do nothing;

-- The remaining bowl combinations are built in the UI once the raw quantities
-- for the bases and proteins are known; seeding every permutation up front
-- would create 250 half-empty rows.
