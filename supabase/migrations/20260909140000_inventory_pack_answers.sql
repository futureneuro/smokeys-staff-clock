-- Pack sizes the restaurant confirmed on 2026-09-09, after the catalog load.
--
-- Forward-only. The catalog migration is already applied; corrections go in a
-- new file rather than being edited into it.

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
-- Huevos: the paca is 30 or 60 depending on what the supplier has
-- ---------------------------------------------------------------------------

-- Two labels rather than one "Paca", deliberately. A single conversion would be
-- wrong half the time and nothing would say so: a 60-egg tray booked as 30 puts
-- thirty eggs of stock nowhere, and the next count reads it as theft.
--
-- Leaving the bare word "Paca" undefined is the point. A receipt that says only
-- "paca" fails to convert and lands in the review screen for a human to pick,
-- which is the correct outcome when the document genuinely does not say.
select pg_temp.pack('Huevos', 'Paca x30', 30);
select pg_temp.pack('Huevos', 'Paca x60', 60);

update public.inv_items
set notes = 'La paca viene de 30 o de 60 según disponibilidad — elegir "Paca x30" o "Paca x60" al registrar la compra',
    updated_at = now()
where lower(name) = 'huevos';

-- ---------------------------------------------------------------------------
-- Multi-unit packs, confirmed
-- ---------------------------------------------------------------------------

-- Both the single unit and the pack are registered: receipts print whichever
-- the supplier felt like that day.
select pg_temp.pack('Crema de leche', 'Paquete x8', 1440);   -- 8 x 180 g
select pg_temp.pack('Queso crema',    'Paquete x2', 700);    -- 2 x 350 g

-- Leche entera (caja de 12 x 1 100 ml) and Leche de almendras (caja de 6 x
-- 946 ml) were loaded correctly already; the restaurant confirmed both.

-- They call it "bebida de almendras", the sheet called it "leche de almendras".
-- Registered so a receipt printing either resolves to the one item.
insert into public.inv_item_aliases (item_id, alias_type, value, supplier_id)
select id, 'description', 'BEBIDA DE ALMENDRAS', null
from public.inv_items
where lower(name) = 'leche de almendras sin azúcar'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Ginger beer
-- ---------------------------------------------------------------------------

-- 976 ml is the total across the four bottles, not per bottle. The item is
-- counted in whole bottles so the pack (1 paquete = 4 unidades) is unaffected;
-- the per-bottle volume is recorded for any recipe written in ml.
update public.inv_items
set notes = 'Paquete de 4 botellas, 976 ML en total (244 ML por botella)',
    updated_at = now()
where lower(name) = 'ginger beer';
