-- Products and bowl pieces OlaClick reported between 2026-08-16 and 2026-09-14.
--
-- Unconfirmed on purpose: this only makes them appear on the POS screen so they
-- can be mapped before the first automatic sync runs. Nothing deducts until a
-- person confirms each mapping. The daily sync discovers new products the same
-- way, so this list does not need maintaining.
--
-- Product ids and names only. No customer or staff data.

insert into public.inv_pos_product_map (pos_product_id, pos_variant_id, pos_name, last_seen_on)
select v.product_id, v.variant_id, v.name, date '2026-09-14'
from (values
    ('a2a0b3e4-dc53-40fb-9678-1b8050a04988', 'a2a0b3e4-e0c6-4250-b213-f95daac18064', 'AÇAÍ SMOKEYS'),
    ('a2aca968-4c68-4c19-b186-a0744a9c3026', 'a2aca968-4e32-40a9-8ab2-cc52f5675cf3', 'Adición de huevos'),
    ('a2aca225-6eae-49b4-bf96-6f8afeb65590', 'a2aca225-7039-4b78-87d9-b2501817a2ef', 'Adición de pan'),
    ('a2aca7f9-0815-4ea5-847d-d45e86d7111a', 'a2aca7f9-0a77-47a5-85a8-9138ab9cbb44', 'Adición de pan brioche'),
    ('a1c5ab95-9a70-4255-ba09-d103f308f939', 'a1c5ab95-9c13-4e56-a9ac-f5d5d8b268cf', 'AGUA SABORIZADA DE MANZANA'),
    ('a26e700e-0ea7-4597-a2f9-8022dc3e7f0f', 'a26e700e-1178-4b9b-987d-f0489b5c03fa', 'AMERICAN BAGEL'),
    ('a21623e7-d30f-4ebe-a50f-02f80c2b4ee8', 'a21623e7-d697-4846-8e07-184f130faa4a', 'AMERICANO'),
    ('a1c5832b-ccb8-43ee-8c6e-3788402e9194', 'a1c5832b-cf07-4833-9626-ad2f0dd1f0ff', 'BOLOGNESE DREAM'),
    ('a2162953-dbf4-4d28-b1e5-9ef68c6048a3', 'a21629b7-2348-46b9-8796-982a083d0e2f', 'BOWL - BIG'),
    ('a2162953-dbf4-4d28-b1e5-9ef68c6048a3', 'a2162953-dd63-4942-903a-f5a695db4001', 'BOWL - MEDIUM'),
    ('a2161836-7363-4bad-9bee-e17cbfc8ea06', 'a2161836-7632-414a-8d8a-f46b46d45d1c', 'CAFÉ DA MANHÃ - PAN BRIOCHE'),
    ('a2161836-7363-4bad-9bee-e17cbfc8ea06', 'a2161836-778e-46d3-a040-2dc0a219fde7', 'CAFÉ DA MANHÃ - PAN DE MASA MADRE'),
    ('a2162452-cbdc-4cc3-a061-5647a4440276', 'a2162452-ceb3-4dec-8d5e-316d8d4385b5', 'CAPPUCCINO'),
    ('a26e9d2c-19a4-403b-b5f8-54749fe1d545', 'a26e9d2c-1be1-4d19-8ba4-6faf8c7c0e17', 'CAPPUCCINO PROTEIN SHAKE'),
    ('a1c5a4fa-1342-4a42-ae4e-26856d08054e', 'a1c5a4fa-1539-4ba1-b6ee-5021e2b13bd1', 'CERVEZA AGUILA'),
    ('a1c5a2eb-926a-4ed3-b6d6-44d844fa07f1', 'a1c5a2eb-95af-41a9-b870-64fe7293d4dd', 'CERVEZA CLUB COLOMBIA DORADA'),
    ('a1c581fa-d53a-41d0-bdf4-a3bc537a9b67', 'a1c581fa-d706-4740-8a84-6db697e06bd2', 'CHICKEN FOR ME'),
    ('a21626de-cf1d-419b-8241-f65a1bff28f9', 'a21626de-d190-488c-a366-22f1887d8ddc', 'CITRUS BREW'),
    ('a1c5edd5-d95e-42c4-9da2-542ab5f57b90', 'a1c5edd5-dd25-4950-8dab-7e10f6a1e211', 'COCA COLA'),
    ('a1c5ac67-a288-4ad7-a1b1-e44b817a4916', 'a1c5ac67-a4c5-42cb-98d9-113c4ca83969', 'COCA COLA ZERO'),
    ('a2162745-3f35-4a4d-84f8-e6e778268c71', 'a2162745-411d-4d24-9d06-4a747ce763cf', 'COOKIES LATTE'),
    ('a1ab729a-5fec-4156-9272-21a22c06f6cc', 'a1c57c43-6f11-4b8d-a02b-eed6be663ad7', 'ENSALADA CÉSAR'),
    ('a26e6b4a-4a69-402b-b7de-94d6d5c85f32', 'a26e6b4a-4dc9-4dcd-bef6-71ac4d9cdbad', 'ESPRESSO'),
    ('a26e9d89-6634-408c-98fb-f819e43a9873', 'a26e9d89-6837-4627-9f35-6e7228e50ce8', 'GOLDEN PROTEIN SHAKE'),
    ('a27284e4-d645-4f15-961d-d09323dab51e', 'a27284e4-d942-4583-a84f-7ad19672b7b8', 'GUANDOLO'),
    ('a2161820-e3e6-4897-a774-9dac724afe1c', 'a2161820-e702-4efe-bf9e-3aec5ded5217', 'HOUSE BREAKFAST'),
    ('a2161854-f96b-4d17-8bc5-5a36b19d2d11', 'a2161854-fb6e-4481-82ac-2918154ec43f', 'HUEVOS MEDITERRÁNEOS - PAN BRIOCHE'),
    ('a2161854-f96b-4d17-8bc5-5a36b19d2d11', 'a2161854-fc3b-4175-8a77-298323bd5177', 'HUEVOS MEDITERRÁNEOS - PAN DE MASA MADRE'),
    ('a1c5f1a6-dcaf-4846-80ab-52704960da99', 'a1c5f1a6-def0-46cd-a16b-84f78d1e2e28', 'JUGO GRANIZADO DE MANGO - EN AGUA'),
    ('a1c5f1a0-117a-4f8d-a4cb-6ea4c5afe745', 'a1c5f1a0-13ef-4af6-adbd-dbd6ab079978', 'JUGO GRANIZADO DE MARACUYA - EN AGUA'),
    ('a2161843-ba4c-4acd-b459-f28401b85d99', 'a2161843-bc48-40ac-ad1b-e918b96e8a6f', 'JUST STRONGER BREAKFAST'),
    ('a27c7ea7-a588-40ad-90da-c67e6c1758da', 'a27c7ea7-a928-4226-aa14-44e1204e27b3', 'LIMONADA DE FLOR DE JAMAICA'),
    ('a1c5a90d-f105-41d2-aac6-14360402a47c', 'a1c5a90d-f23e-45a9-8f25-b81de67c5bd9', 'LIMONADA DE HIERBA BUENA'),
    ('a1c588da-30ea-4bb3-bcbc-ea0b8f79af60', 'a1c588da-36d1-4ae8-80a7-b9f6aec46e48', 'PARFAIT SMOKEYS'),
    ('a1c5ad6e-7943-480f-8cf4-35e5de0887b1', 'a1c5ad6e-7b1e-4ee6-aa4a-3f82092cabd9', 'QUATRO'),
    ('a26e9996-8bf8-4dbe-a982-974e17202db5', 'a26e9996-8fef-4bfc-800c-bfeae16a9309', 'SMOOTHIE DE CREMA DE MANÍ'),
    ('a26e9996-8bf8-4dbe-a982-974e17202db5', 'a26e9a81-8877-48d7-8d39-6a4879dcb286', 'SMOOTHIE DE CREMA DE MANÍ - Extra de proteína'),
    ('a26e9bfb-dde9-4bd7-b667-be43f6416d51', 'a26e9bfb-e000-423d-b1ce-8939b72d6bfb', 'SMOOTHIE TROPICAL'),
    ('a1c5a638-65fe-44f4-a369-9ca90389f027', 'a1c5a638-6751-4d8e-b795-13deee4e6301', 'SODA ITALIANA DE CEREZA'),
    ('a1c5abfe-0635-48de-b2b7-1fcf0c8f52a1', 'a1c5abfe-08eb-402a-946c-f3dffe1fee8c', 'SODA ITALIANA DE LYCHEES'),
    ('a1c5a726-f785-42b9-85e1-fa4808b27cb7', 'a1c5a726-f939-46a2-80ea-05c40c730c2c', 'SODA ITALIANA DE MARACUMANGO'),
    ('a1a13ece-a6e8-4292-91ae-1becb92ed208', 'a1a13ece-ad6e-4751-87a3-ae5db1a6b815', 'SODA ITALIANA DE MARACUYA'),
    ('a1c59bb6-6d01-4efe-96bc-be3acca69029', 'a1c59bb6-6ef8-4f15-874c-d931ef145d61', 'SPRITE'),
    ('a216182e-9f17-4b80-b41a-bffe8fd28179', 'a216182e-a1ef-4464-9d9c-350023f07d19', 'TOASTY BREAKFAST - PAN BRIOCHE'),
    ('a216182e-9f17-4b80-b41a-bffe8fd28179', 'a216182e-a2ea-4fae-a59f-2e96405c07d4', 'TOASTY BREAKFAST - PAN DE MASA MADRE'),
    ('a1c57d87-c87b-41ed-bc4e-9a937392dda6', 'a1c57d87-cb79-4353-a1d7-3a2b0b3a2e69', 'VEGETARIAN BAGEL')
) as v(product_id, variant_id, name)
on conflict (pos_product_id, pos_variant_id) do nothing;

insert into public.inv_pos_modifier_map (token_key, token_display, last_seen_on)
select v.token_key, v.token_display, date '2026-09-14'
from (values
    ('aguacate', 'Aguacate'),
    ('arroz blanco', 'Arroz blanco'),
    ('arroz integral', 'Arroz integral'),
    ('carne bolonesa', 'Carne boloñesa'),
    ('cebolla caramelizada', 'Cebolla caramelizada'),
    ('champinones', 'Champiñones'),
    ('cruotones', 'Cruotones'),
    ('cubitos de platano maduro', 'Cubitos de plátano maduro'),
    ('lechuga', 'Lechuga'),
    ('maiz dulce', 'Maíz dulce'),
    ('maiz tostado', 'Maíz tostado'),
    ('parmesano', 'Parmesano'),
    ('pimenton amarillo caramelizado en miel', 'Pimentón amarillo caramelizado en miel'),
    ('pollo en especias', 'Pollo en especias'),
    ('pollo en salsa de champinones', 'Pollo en salsa de champiñones'),
    ('pollo en salsa de tocineta', 'Pollo en salsa de tocineta'),
    ('quinoa', 'Quinoa'),
    ('remolacha', 'Remolacha'),
    ('salsa blanca', 'Salsa blanca'),
    ('sin salsa', 'Sin salsa'),
    ('vegetales salteados', 'Vegetales salteados'),
    ('zanahoria', 'Zanahoria')
) as v(token_key, token_display)
on conflict (token_key) do nothing;
