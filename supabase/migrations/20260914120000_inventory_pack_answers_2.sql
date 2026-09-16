-- Pack sizes the restaurant confirmed on 2026-09-14.
--
-- Forward-only, like the two catalog migrations before it.

create or replace function pg_temp.pack(
    p_item text, p_label text, p_qty numeric
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
        raise exception 'pack(): no item named %', p_item;
    end if;
    insert into public.inv_pack_conversions (item_id, pack_label, base_qty)
    values (v_item, p_label, p_qty)
    on conflict (item_id, lower(pack_label)) do update set base_qty = excluded.base_qty;
end;
$$;

-- ---------------------------------------------------------------------------
-- Weights
-- ---------------------------------------------------------------------------

select pg_temp.pack('Mantequilla', 'Tarro', 1000);
select pg_temp.pack('Yogurt artesanal sin azúcar', 'Tarro', 5000);

-- One panela weighs 380 G and the sheet says they come two to a pack, so both
-- labels are registered: receipts print either.
select pg_temp.pack('Panela', 'Unidad', 380);
select pg_temp.pack('Panela', 'Paquete x2', 760);

-- The bulto is 15 one-kilo bags, not 15 kg loose. Registering the bag as well
-- means a receipt listing bags converts without anyone doing the division.
select pg_temp.pack('Arroz blanco', 'Bolsa', 1000);
select pg_temp.pack('Arroz blanco', 'Bulto', 15000);

-- ---------------------------------------------------------------------------
-- Items counted as whole pieces
-- ---------------------------------------------------------------------------

-- These are measured in "unidad" because recipes call for whole pieces, but
-- they are bought by weight. The pieces-per-pack figure is what bridges the
-- receipt to the count.
select pg_temp.pack('Jamón de pavo (loncha)', 'Paquete', 24);  -- 340 G = 24 lonchas

select pg_temp.pack('Lychee', 'Tarro', 14);                    -- 240 G = 14 lychees
select pg_temp.pack('Lychee', 'Paquete x3', 42);

-- "Aprox 120" — their word. Good enough here: Cereza sits at track_priority 1,
-- so it is not on the count sheet and the estimate never feeds a variance
-- figure. It only converts a purchase into stock. If cherries ever go on the
-- sheet, this number needs counting properly first.
select pg_temp.pack('Cereza', 'Tarro', 120);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

update public.inv_items
set notes = null, updated_at = now()
where lower(name) in (
    'mantequilla', 'panela', 'yogurt artesanal sin azúcar',
    'jamón de pavo (loncha)', 'lychee'
);

update public.inv_items
set notes = 'Bulto de 15 bolsas de 1 000 G', updated_at = now()
where lower(name) = 'arroz blanco';

update public.inv_items
set notes = 'Tarro de 2,1 kg ≈ 120 cerezas (aproximado, no contado)', updated_at = now()
where lower(name) = 'cereza';

-- Leche condensada and the four average piece weights (aguacate, mango, piña,
-- lechuga) are still outstanding; their "Falta:" notes stay as they are.
