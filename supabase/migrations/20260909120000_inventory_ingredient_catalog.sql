-- Ingredient catalog, from the sheet the restaurant returned on 2026-09-09.
--
-- Source: ingredientes-smokeys.csv, 109 rows, filled in by Gloria. It gives the
-- pack size, the supplier and the unit for every raw material they buy. Before
-- this, only 30 items existed — the ones needed to seed the bowl recipes.
--
-- Two columns of that sheet are deliberately ignored:
--
--   "¿Correcto? (SI/NO)" was answered as "is this how we buy it", not "is this
--   how we measure it". Every "No" corrects g -> Kg or ml -> L, which is the
--   same dimension and already handled by inv_global_unit_conversions. Acting
--   on those answers would change nothing and lose the base unit.
--
--   "Correcciones / notas" restates the same thing.
--
-- Items whose pack size the sheet left ambiguous are created without a pack
-- conversion and carry a "Falta:" note naming exactly what is missing. A wrong
-- pack size is worse than none: it silently multiplies every future receipt.
--
-- Forward-only, like every correction in this feature. Editing an applied
-- migration silently reverted a newer definition once already.

-- ---------------------------------------------------------------------------
-- Where each item is bought
-- ---------------------------------------------------------------------------

-- Recorded on the item rather than only on purchases, so a low-stock item can
-- say who to call. No UI reads it yet.
alter table public.inv_items
    add column if not exists default_supplier_id uuid
        references public.inv_suppliers(id) on delete set null;

insert into public.inv_suppliers (name, default_payment_method, notes) values
    ('PriceSmart', 'card', null),
    ('Mercado', 'cash', 'Plaza / mercado local — sin factura itemizada'),
    ('D1', 'card', null),
    ('Padam', 'transfer', 'Pedir factura o remisión con ítems'),
    ('Vita Integral', 'transfer', 'Pedir factura o remisión con ítems'),
    ('Natupulpas', 'transfer', 'Pulpa de fruta congelada'),
    ('La Fournée', 'transfer', 'Panadería'),
    ('Berpa', 'transfer', null),
    ('Felipe', 'cash', 'Café en grano'),
    ('Gloria', 'cash', 'Yogurt artesanal')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Raw materials
-- ---------------------------------------------------------------------------

-- Storage area drives the count sheet filter: Carlos counts the kitchen,
-- Salomé the bar, and neither should be handed the other's list.
--
-- is_tracked = false on the spices. They are cheap, slow-moving and would add
-- eleven rows to a count that happens every three days; a count nobody
-- finishes reports no variance at all.
--
-- Three items deviate from the unit written on the sheet, in every case because
-- the sheet's own purchase column contradicts it:
--
--   Dátil and Tomate cherry were marked "unidad" but are bought by the kilo.
--   Counting them one by one is not something anyone will do, and a receipt in
--   kg cannot convert to a count of pieces without a weight per piece.
--
--   Miel de abejas was marked "ml" but the jar is sold as 370 gr. Grams is what
--   both the receipt and the scale report.
--
-- Limón, Cereza, Lychee and Jamón de pavo stay in "unidad": recipes call for
-- whole pieces. They need a pieces-per-pack figure, which is noted on each.

insert into public.inv_items
    (name, base_unit, category, is_tracked, track_priority, storage_area, notes)
values
    ('Vino blanco', 'ml', 'alcohol', false, 0, 'bar', null),
    ('Jamón de pavo (loncha)', 'unidad', 'ingredient', true, 2, 'fridge', 'Falta: cuántas lonchas trae el paquete de 340 G'),
    ('Huevos', 'unidad', 'ingredient', true, 3, 'fridge', 'Falta: si la paca trae 30 o 60 unidades'),
    ('Yogurt griego', 'g', 'ingredient', true, 2, 'fridge', null),
    ('Yogurt artesanal sin azúcar', 'g', 'ingredient', true, 2, 'fridge', 'Falta: cuántos gramos son los 5 L del tarro'),
    ('Crema agria', 'g', 'ingredient', true, 2, 'fridge', null),
    ('Leche condensada', 'g', 'ingredient', true, 1, 'dry_store', 'Falta: presentación y cuánto trae — quedó vacío en la lista'),
    ('Queso parmesano', 'g', 'ingredient', true, 3, 'fridge', null),
    ('Queso crema', 'g', 'ingredient', true, 2, 'fridge', null),
    ('Queso costeño', 'g', 'ingredient', true, 3, 'fridge', null),
    ('Mantequilla', 'g', 'ingredient', true, 2, 'fridge', 'Falta: cuántos kg trae el tarro'),
    ('Leche de almendras sin azúcar', 'ml', 'ingredient', true, 2, 'fridge', null),
    ('Aguacate papelillo', 'g', 'ingredient', true, 2, 'fridge', 'Falta: peso promedio de un aguacate — se compra por unidad'),
    ('Banano', 'g', 'ingredient', true, 1, 'kitchen', 'Congelado es el mismo banano, empacado en casa en bolsas de 100 G'),
    ('Mango tommy', 'g', 'ingredient', true, 2, 'fridge', 'Falta: peso promedio de un mango — se compra por unidad'),
    ('Piña congelada', 'g', 'ingredient', true, 2, 'freezer', 'Falta: peso promedio de una piña — se compra por unidad'),
    ('Arándanos', 'g', 'ingredient', true, 3, 'fridge', null),
    ('Dátil', 'g', 'ingredient', true, 2, 'dry_store', null),
    ('Lychee', 'unidad', 'ingredient', true, 2, 'dry_store', 'Falta: cuántos lychees trae el tarro de 240 G'),
    ('Tomate', 'g', 'ingredient', true, 1, 'kitchen', null),
    ('Remolacha', 'g', 'ingredient', true, 1, 'kitchen', null),
    ('Espinaca', 'g', 'ingredient', true, 1, 'fridge', null),
    ('Lechuga crespa', 'g', 'ingredient', true, 1, 'fridge', 'Falta: peso promedio de una lechuga — se compra por unidad'),
    ('Papa nevada', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Plátano maduro (maduritos)', 'g', 'ingredient', true, 1, 'kitchen', null),
    ('Ajo', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Jengibre', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Tomate cherry', 'g', 'ingredient', true, 1, 'fridge', null),
    ('Avena molida', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Avena en hojuelas', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Almidón de yuca', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Harina de trigo', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Maicena', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Hojuelas de maíz sin azúcar', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Galleta tipo María', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Granola', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Crotones', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Maíz tostado', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Maíz dulce', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Bagel', 'unidad', 'ingredient', true, 1, 'dry_store', null),
    ('Aceite de oliva', 'ml', 'ingredient', true, 2, 'dry_store', null),
    ('Aceite de coco', 'g', 'ingredient', true, 2, 'dry_store', null),
    ('Azúcar', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Panela', 'g', 'ingredient', true, 1, 'dry_store', 'Falta: cuántos gramos pesa una panela'),
    ('Edulcorante / endulzante', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Miel de abejas', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Miel de maple', 'ml', 'ingredient', true, 2, 'dry_store', null),
    ('Salsa de maracuyá', 'ml', 'ingredient', true, 1, 'dry_store', null),
    ('Salsa de soya', 'ml', 'ingredient', true, 1, 'dry_store', null),
    ('Vainilla / esencia de vainilla', 'ml', 'ingredient', true, 1, 'dry_store', null),
    ('Pasta de tomate', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Pimienta negra', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Pimienta cayena', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Comino', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Paprika', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Canela', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Tomillo', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Perejil', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Gelatina sin sabor', 'g', 'ingredient', false, 0, 'dry_store', null),
    ('Salsa base boloñesa (sobre)', 'unidad', 'ingredient', true, 1, 'dry_store', null),
    ('Café liofilizado', 'g', 'ingredient', true, 2, 'dry_store', null),
    ('Matcha', 'g', 'ingredient', true, 3, 'dry_store', null),
    ('Golden mix', 'g', 'ingredient', true, 3, 'dry_store', null),
    ('Pink glow', 'g', 'ingredient', true, 3, 'dry_store', null),
    ('Flor de jamaica', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Sobre jugo de mandarina', 'unidad', 'ingredient', true, 2, 'freezer', null),
    ('Sobre jugo de mango', 'unidad', 'ingredient', true, 2, 'freezer', null),
    ('Sobre limonada de coco', 'unidad', 'ingredient', true, 2, 'freezer', null),
    ('Sobre limonada de hierbabuena', 'unidad', 'ingredient', true, 2, 'freezer', null),
    ('Sobre piña colada', 'unidad', 'ingredient', true, 2, 'freezer', null),
    ('Pistachos', 'g', 'ingredient', true, 3, 'dry_store', null),
    ('Mantequilla de maní', 'g', 'ingredient', true, 2, 'dry_store', null),
    ('Coco rayado', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Nibs de chocolate', 'g', 'ingredient', true, 2, 'dry_store', null),
    ('Cacao en polvo', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Semillas de sésamo', 'g', 'ingredient', true, 1, 'dry_store', null),
    ('Proteína whey', 'g', 'ingredient', true, 3, 'dry_store', null)
on conflict do nothing;

-- Alcohol stays archived: "there's no alcohol on this menu". The sheet lists
-- bottle sizes anyway, so the conversions are loaded and the items stay hidden
-- until somebody says the bar is back.
update public.inv_items
set archived = true, is_tracked = false
where lower(name) = 'vino blanco';

-- Made in-house, not bought. item_type = 'prep' keeps them out of any
-- "what do we need to order" reading of the catalog.
update public.inv_items
set item_type = 'prep',
    notes = 'Se hace en casa: agua y azúcar 1:2'
where lower(name) = 'sirope de azúcar';

update public.inv_items
set item_type = 'prep',
    notes = 'Se hace en casa'
where lower(name) = 'agua carbonatada';

-- Pending answers on items that already existed.
update public.inv_items
set notes = 'Falta: confirmar si el bulto trae 15 kg'
where lower(name) = 'arroz blanco';

update public.inv_items
set notes = 'Falta: cuántas cerezas trae el tarro de 2,1 kg'
where lower(name) = 'cereza';

-- ---------------------------------------------------------------------------
-- Pack sizes
-- ---------------------------------------------------------------------------

-- "1 bolsa" means 500 g of oats and 5 000 g of chicken, so this is per item.
-- Loose purchases by the kilo need nothing here — kg -> g is global.

create or replace function pg_temp.pack(
    p_item text, p_label text, p_qty numeric
) returns void
language plpgsql
as $$
declare
    v_item uuid;
begin
    -- Archived items can share a name with a live one: the uniqueness index is
    -- partial on archived = false. Prefer the live row.
    select id into v_item from public.inv_items
    where lower(name) = lower(p_item)
    order by archived asc, created_at asc
    limit 1;
    if v_item is null then
        raise exception 'pack(): no item named %', p_item;
    end if;
    insert into public.inv_pack_conversions (item_id, pack_label, base_qty)
    values (v_item, p_label, p_qty)
    on conflict (item_id, lower(pack_label)) do update set base_qty = excluded.base_qty;
end;
$$;

do $$
begin
    perform pg_temp.pack('Tequila', 'Botella', 750);
    perform pg_temp.pack('Ron blanco', 'Botella', 1750);
    perform pg_temp.pack('Vodka', 'Botella', 1000);
    perform pg_temp.pack('Blue curaçao', 'Botella', 1000);
    perform pg_temp.pack('Vino blanco', 'Botella', 750);
    perform pg_temp.pack('Ginger beer', 'Paquete', 4);
    perform pg_temp.pack('Pechuga de pollo', 'Bolsa', 5000);
    perform pg_temp.pack('Yogurt griego', 'Tarro', 907);
    perform pg_temp.pack('Crema agria', 'Bolsa', 400);
    perform pg_temp.pack('Crema de leche', 'Bolsa', 180);
    perform pg_temp.pack('Queso parmesano', 'Bolsa', 2270);
    perform pg_temp.pack('Queso crema', 'Tarro', 350);
    perform pg_temp.pack('Leche entera', 'Unidad', 1100);
    perform pg_temp.pack('Leche entera', 'Caja', 13200);
    perform pg_temp.pack('Leche de almendras sin azúcar', 'Unidad', 946);
    perform pg_temp.pack('Leche de almendras sin azúcar', 'Caja', 5676);
    perform pg_temp.pack('Fresa', 'Caja', 1000);
    perform pg_temp.pack('Arándanos', 'Caja', 400);
    perform pg_temp.pack('Dátil', 'Bolsa', 1130);
    perform pg_temp.pack('Jugo de naranja', 'Tarro', 2000);
    perform pg_temp.pack('Champiñones', 'Caja', 1000);
    perform pg_temp.pack('Ajo', 'Bolsa', 500);
    perform pg_temp.pack('Jengibre', 'Bolsa', 500);
    perform pg_temp.pack('Avena molida', 'Bolsa', 500);
    perform pg_temp.pack('Avena en hojuelas', 'Bolsa', 500);
    perform pg_temp.pack('Almidón de yuca', 'Bolsa', 500);
    perform pg_temp.pack('Harina de trigo', 'Bolsa', 500);
    perform pg_temp.pack('Maicena', 'Bolsa', 500);
    perform pg_temp.pack('Hojuelas de maíz sin azúcar', 'Bolsa', 340);
    perform pg_temp.pack('Galleta tipo María', 'Paquete', 241);
    perform pg_temp.pack('Granola', 'Paquete', 500);
    perform pg_temp.pack('Crotones', 'Paquete', 250);
    perform pg_temp.pack('Maíz tostado', 'Bolsa', 300);
    perform pg_temp.pack('Maíz dulce', 'Bolsa', 2000);
    perform pg_temp.pack('Bagel', 'Paquete', 5);
    perform pg_temp.pack('Aceite de oliva', 'Tarro', 2980);
    perform pg_temp.pack('Aceite de coco', 'Tarro', 180);
    perform pg_temp.pack('Azúcar', 'Bolsa', 1000);
    perform pg_temp.pack('Edulcorante / endulzante', 'Tarro', 180);
    perform pg_temp.pack('Miel de abejas', 'Tarro', 370);
    perform pg_temp.pack('Miel de maple', 'Tarro', 1890);
    perform pg_temp.pack('Sirope de cereza', 'Tarro', 1000);
    perform pg_temp.pack('Salsa de maracuyá', 'Tarro', 1000);
    perform pg_temp.pack('Salsa de soya', 'Tarro', 1000);
    perform pg_temp.pack('Vainilla / esencia de vainilla', 'Tarro', 155);
    perform pg_temp.pack('Pasta de tomate', 'Bolsa', 1000);
    perform pg_temp.pack('Sal', 'Bolsa', 1000);
    perform pg_temp.pack('Pimienta negra', 'Bolsa', 500);
    perform pg_temp.pack('Pimienta cayena', 'Bolsa', 500);
    perform pg_temp.pack('Comino', 'Bolsa', 500);
    perform pg_temp.pack('Paprika', 'Bolsa', 500);
    perform pg_temp.pack('Canela', 'Bolsa', 500);
    perform pg_temp.pack('Tomillo', 'Bolsa', 500);
    perform pg_temp.pack('Perejil', 'Bolsa', 500);
    perform pg_temp.pack('Gelatina sin sabor', 'Bolsa', 500);
    perform pg_temp.pack('Salsa base boloñesa (sobre)', 'Bolsa', 50);
    perform pg_temp.pack('Café en grano', 'Bolsa', 2500);
    perform pg_temp.pack('Café liofilizado', 'Tarro', 320);
    perform pg_temp.pack('Matcha', 'Bolsa', 250);
    perform pg_temp.pack('Golden mix', 'Bolsa', 500);
    perform pg_temp.pack('Pink glow', 'Bolsa', 500);
    perform pg_temp.pack('Flor de jamaica', 'Bolsa', 250);
    perform pg_temp.pack('Sobre jugo de mandarina', 'Paquete', 10);
    perform pg_temp.pack('Sobre jugo de mango', 'Paquete', 10);
    perform pg_temp.pack('Sobre limonada de coco', 'Paquete', 7);
    perform pg_temp.pack('Sobre limonada de hierbabuena', 'Paquete', 10);
    perform pg_temp.pack('Sobre piña colada', 'Paquete', 10);
    perform pg_temp.pack('Pan brioche', 'Molde', 500);
    perform pg_temp.pack('Pan brioche', 'Bloque', 500);
    perform pg_temp.pack('Pistachos', 'Paquete', 680);
    perform pg_temp.pack('Mantequilla de maní', 'Tarro', 1130);
    perform pg_temp.pack('Coco rayado', 'Bolsa', 500);
    perform pg_temp.pack('Nibs de chocolate', 'Bolsa', 180);
    perform pg_temp.pack('Cacao en polvo', 'Bolsa', 350);
    perform pg_temp.pack('Semillas de sésamo', 'Bolsa', 500);
    perform pg_temp.pack('Proteína whey', 'Tarro', 2270);
end;
$$;

-- One lemon weighs 60 G, so a kilo is about 16-17 lemons. Lets a receipt
-- printed in kg land on an item counted in whole lemons.
select pg_temp.pack('Limón', 'kg', 16.6667);

-- ---------------------------------------------------------------------------
-- Supplier per item
-- ---------------------------------------------------------------------------

create or replace function pg_temp.supplier_of(
    p_item text, p_supplier text
) returns void
language plpgsql
as $$
declare
    v_supplier uuid;
begin
    select id into v_supplier from public.inv_suppliers
    where lower(name) = lower(p_supplier) and archived = false;
    if v_supplier is null then
        raise exception 'supplier_of(): no supplier named %', p_supplier;
    end if;
    update public.inv_items
    set default_supplier_id = v_supplier, updated_at = now()
    where lower(name) = lower(p_item);
end;
$$;

do $$
begin
    perform pg_temp.supplier_of('Aceite de coco', 'D1');
    perform pg_temp.supplier_of('Aceite de oliva', 'PriceSmart');
    perform pg_temp.supplier_of('Aguacate papelillo', 'Mercado');
    perform pg_temp.supplier_of('Ajo', 'Mercado');
    perform pg_temp.supplier_of('Almidón de yuca', 'Vita Integral');
    perform pg_temp.supplier_of('Arroz blanco', 'PriceSmart');
    perform pg_temp.supplier_of('Arroz integral', 'Mercado');
    perform pg_temp.supplier_of('Arándanos', 'Mercado');
    perform pg_temp.supplier_of('Avena en hojuelas', 'Mercado');
    perform pg_temp.supplier_of('Avena molida', 'Mercado');
    perform pg_temp.supplier_of('Azúcar', 'Mercado');
    perform pg_temp.supplier_of('Bagel', 'La Fournée');
    perform pg_temp.supplier_of('Banano', 'Mercado');
    perform pg_temp.supplier_of('Blue curaçao', 'Berpa');
    perform pg_temp.supplier_of('Cacao en polvo', 'Mercado');
    perform pg_temp.supplier_of('Café en grano', 'Felipe');
    perform pg_temp.supplier_of('Café liofilizado', 'PriceSmart');
    perform pg_temp.supplier_of('Canela', 'Mercado');
    perform pg_temp.supplier_of('Carne molida', 'Mercado');
    perform pg_temp.supplier_of('Cebolla blanca', 'Mercado');
    perform pg_temp.supplier_of('Cerdo para chicharrón', 'Mercado');
    perform pg_temp.supplier_of('Cereza', 'PriceSmart');
    perform pg_temp.supplier_of('Champiñones', 'Mercado');
    perform pg_temp.supplier_of('Coco rayado', 'Mercado');
    perform pg_temp.supplier_of('Comino', 'Mercado');
    perform pg_temp.supplier_of('Crema agria', 'PriceSmart');
    perform pg_temp.supplier_of('Crema de leche', 'PriceSmart');
    perform pg_temp.supplier_of('Crotones', 'PriceSmart');
    perform pg_temp.supplier_of('Dátil', 'PriceSmart');
    perform pg_temp.supplier_of('Edulcorante / endulzante', 'D1');
    perform pg_temp.supplier_of('Espinaca', 'Mercado');
    perform pg_temp.supplier_of('Flor de jamaica', 'Mercado');
    perform pg_temp.supplier_of('Fresa', 'Mercado');
    perform pg_temp.supplier_of('Galleta tipo María', 'D1');
    perform pg_temp.supplier_of('Gelatina sin sabor', 'Mercado');
    perform pg_temp.supplier_of('Golden mix', 'Padam');
    perform pg_temp.supplier_of('Granola', 'Mercado');
    perform pg_temp.supplier_of('Harina de trigo', 'Mercado');
    perform pg_temp.supplier_of('Hojuelas de maíz sin azúcar', 'Mercado');
    perform pg_temp.supplier_of('Huevos', 'PriceSmart');
    perform pg_temp.supplier_of('Jamón de pavo (loncha)', 'PriceSmart');
    perform pg_temp.supplier_of('Jengibre', 'Mercado');
    perform pg_temp.supplier_of('Jugo de naranja', 'Mercado');
    perform pg_temp.supplier_of('Leche de almendras sin azúcar', 'PriceSmart');
    perform pg_temp.supplier_of('Leche entera', 'PriceSmart');
    perform pg_temp.supplier_of('Lechuga crespa', 'Mercado');
    perform pg_temp.supplier_of('Limón', 'Mercado');
    perform pg_temp.supplier_of('Lychee', 'PriceSmart');
    perform pg_temp.supplier_of('Maicena', 'Mercado');
    perform pg_temp.supplier_of('Mango tommy', 'Mercado');
    perform pg_temp.supplier_of('Mantequilla', 'PriceSmart');
    perform pg_temp.supplier_of('Mantequilla de maní', 'PriceSmart');
    perform pg_temp.supplier_of('Matcha', 'Mercado');
    perform pg_temp.supplier_of('Maíz dulce', 'PriceSmart');
    perform pg_temp.supplier_of('Maíz tostado', 'Mercado');
    perform pg_temp.supplier_of('Miel de abejas', 'Mercado');
    perform pg_temp.supplier_of('Miel de maple', 'PriceSmart');
    perform pg_temp.supplier_of('Nibs de chocolate', 'Mercado');
    perform pg_temp.supplier_of('Pan brioche', 'La Fournée');
    perform pg_temp.supplier_of('Panela', 'Mercado');
    perform pg_temp.supplier_of('Papa nevada', 'Mercado');
    perform pg_temp.supplier_of('Paprika', 'Mercado');
    perform pg_temp.supplier_of('Pasta de tomate', 'Mercado');
    perform pg_temp.supplier_of('Pechuga de pollo', 'Mercado');
    perform pg_temp.supplier_of('Perejil', 'Mercado');
    perform pg_temp.supplier_of('Pimentón amarillo', 'Mercado');
    perform pg_temp.supplier_of('Pimentón rojo', 'Mercado');
    perform pg_temp.supplier_of('Pimienta cayena', 'Mercado');
    perform pg_temp.supplier_of('Pimienta negra', 'Mercado');
    perform pg_temp.supplier_of('Pink glow', 'Padam');
    perform pg_temp.supplier_of('Pistachos', 'PriceSmart');
    perform pg_temp.supplier_of('Piña congelada', 'Mercado');
    perform pg_temp.supplier_of('Plátano maduro (maduritos)', 'Mercado');
    perform pg_temp.supplier_of('Proteína whey', 'PriceSmart');
    perform pg_temp.supplier_of('Queso costeño', 'PriceSmart');
    perform pg_temp.supplier_of('Queso crema', 'PriceSmart');
    perform pg_temp.supplier_of('Queso parmesano', 'PriceSmart');
    perform pg_temp.supplier_of('Quinoa', 'Mercado');
    perform pg_temp.supplier_of('Remolacha', 'Mercado');
    perform pg_temp.supplier_of('Ron blanco', 'PriceSmart');
    perform pg_temp.supplier_of('Sal', 'Mercado');
    perform pg_temp.supplier_of('Salsa base boloñesa (sobre)', 'Mercado');
    perform pg_temp.supplier_of('Salsa de maracuyá', 'Mercado');
    perform pg_temp.supplier_of('Salsa de soya', 'Mercado');
    perform pg_temp.supplier_of('Semillas de sésamo', 'Mercado');
    perform pg_temp.supplier_of('Sirope de cereza', 'Mercado');
    perform pg_temp.supplier_of('Sobre jugo de mandarina', 'Natupulpas');
    perform pg_temp.supplier_of('Sobre jugo de mango', 'Natupulpas');
    perform pg_temp.supplier_of('Sobre limonada de coco', 'Natupulpas');
    perform pg_temp.supplier_of('Sobre limonada de hierbabuena', 'Natupulpas');
    perform pg_temp.supplier_of('Sobre piña colada', 'Natupulpas');
    perform pg_temp.supplier_of('Tequila', 'PriceSmart');
    perform pg_temp.supplier_of('Tocineta', 'PriceSmart');
    perform pg_temp.supplier_of('Tomate', 'Mercado');
    perform pg_temp.supplier_of('Tomate cherry', 'Mercado');
    perform pg_temp.supplier_of('Tomillo', 'Mercado');
    perform pg_temp.supplier_of('Vainilla / esencia de vainilla', 'D1');
    perform pg_temp.supplier_of('Vino blanco', 'PriceSmart');
    perform pg_temp.supplier_of('Vodka', 'PriceSmart');
    perform pg_temp.supplier_of('Yogurt artesanal sin azúcar', 'Gloria');
    perform pg_temp.supplier_of('Yogurt griego', 'PriceSmart');
    perform pg_temp.supplier_of('Zanahoria', 'Mercado');
end;
$$;

-- ---------------------------------------------------------------------------
-- Same material under two names
-- ---------------------------------------------------------------------------

-- The sheet lists "Fresa" and "Fresa yumbo" as separate rows and then says they
-- are the same; likewise banano vs banano congelado, which is banano the
-- restaurant bags at 100 G itself. Two rows for one material means stock splits
-- in half and every count reports a shortfall on one and a surplus on the other.
--
-- Registered as description aliases so a receipt printing either spelling
-- resolves to the one item.

create or replace function pg_temp.alias_of(
    p_item text, p_value text
) returns void
language plpgsql
as $$
declare
    v_item uuid;
begin
    select id into v_item from public.inv_items
    where lower(name) = lower(p_item)
    order by archived asc, created_at asc
    limit 1;
    if v_item is null then
        raise exception 'alias_of(): no item named %', p_item;
    end if;
    insert into public.inv_item_aliases (item_id, alias_type, value, supplier_id)
    values (v_item, 'description', p_value, null)
    on conflict do nothing;
end;
$$;

do $$
begin
    perform pg_temp.alias_of('Fresa', 'FRESA YUMBO');
    perform pg_temp.alias_of('Fresa', 'FRESA');
    perform pg_temp.alias_of('Banano', 'BANANO CONGELADO');
    perform pg_temp.alias_of('Yogurt artesanal sin azúcar', 'YOGURT NATURAL SIN AZUCAR');
    perform pg_temp.alias_of('Cerdo para chicharrón', 'CHICHARRON');
    perform pg_temp.alias_of('Arroz blanco', 'ARROZ BLANCO (PREMIUM)');
    perform pg_temp.alias_of('Arroz blanco', 'ARROZ PREMIUM');
    perform pg_temp.alias_of('Pan brioche', 'PAN BRIOCHE / MASA MADRE');
    perform pg_temp.alias_of('Pan brioche', 'MASA MADRE');
    perform pg_temp.alias_of('Cereza', 'CEREZA EN ALMIBAR');
    perform pg_temp.alias_of('Sirope de azúcar', 'SIROPE DE AZUCAR (AGAVE)');
end;
$$;


-- ---------------------------------------------------------------------------
-- How long the count sheet is allowed to be
-- ---------------------------------------------------------------------------

-- Areas the earlier seed left blank. A tracked item with no area appears on
-- every filtered count sheet and belongs to nobody, so it gets counted twice
-- or not at all.
update public.inv_items set storage_area = 'dry_store'
where storage_area is null and lower(name) in ('café en grano', 'cereza');

update public.inv_items set storage_area = 'fridge'
where storage_area is null
  and lower(name) in ('fresa', 'jugo de limón', 'jugo de naranja', 'leche entera');

update public.inv_items set storage_area = 'bar'
where storage_area is null
  and lower(name) in ('agua carbonatada', 'sirope de azúcar', 'sirope de cereza');

-- Loading the sheet made 92 items tracked, which is a count sheet nobody
-- finishes in one shift — and an unfinished count reports no variance at all,
-- so the whole feature quietly stops working.
--
-- Tracked now means track_priority >= 2: proteins, dairy, coffee, matcha,
-- nuts, oils, pulp sachets, whey. Roughly forty items, split across areas so
-- one person's list is about twenty.
--
-- What drops off is priority 1 — tomatoes, onions, potatoes, flour, sugar. A
-- kilo of tomato is about 4 000 COP, so even a total loss sits far below the
-- 20 000 COP alert threshold and would never have raised an alert anyway.
-- They still carry stock and still show days-left; they are simply not counted
-- by hand every three days.
--
-- This is only the starting point. The Items tab has a COUNTED checkbox per
-- item, and the restaurant is expected to move things on and off it.
update public.inv_items
set is_tracked = (track_priority >= 2), updated_at = now()
where archived = false;
