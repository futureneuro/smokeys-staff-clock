// Turns an OlaClick products-sold report into sales lines for the inventory.
//
// Pure: no network, no database, no Deno or Node APIs. The edge function feeds
// it what it fetched and what the database holds, and gets back exactly what to
// deduct and what to hold. Keeping it free of runtime imports is what lets the
// same file be exercised against real OlaClick payloads outside the edge
// runtime.
//
// The one rule everything here serves: a product or bowl piece the system does
// not recognise holds the day. It is never skipped. A skipped product silently
// stops deducting, the ledger overstates stock, and two counts later the gap
// reads as theft with nothing pointing at the real cause.

export interface PosModifierRow {
  modifier_name: string;
  modifier_quantity: number;
  total_sales?: number;
}

export interface PosProductRow {
  product_name: string;
  product_quantity: number;
  average_price?: number;
  total_sales?: number;
  product_id: string;
  variant_id?: string | null;
  modifiers?: PosModifierRow[];
}

export interface PosFreehandRow {
  product_name: string;
  product_quantity: number;
  total_sales?: number;
}

// menu_item: the POS product is one of our menu items.
// composite: a container (the bowl) whose pieces arrive as modifiers and are
//            each a menu item of their own, at the portion this variant sells.
// ignore:    not inventory at all.
export type ProductMapKind = 'menu_item' | 'composite' | 'ignore';
export type ModifierMapKind = 'component' | 'ignore';

export interface ProductMapping {
  pos_product_id: string;
  pos_variant_id: string;
  kind: ProductMapKind | null;
  menu_item_id: string | null;
  portion_label: string | null;
  confirmed: boolean;
}

export interface ModifierMapping {
  token_key: string;
  kind: ModifierMapKind | null;
  component_name: string | null;
  confirmed: boolean;
}

export interface MenuItemRef {
  id: string;
  name: string;
  portion_label: string | null;
  recipe_complete: boolean;
  active: boolean;
}

export interface DeductedLine {
  menu_item_id: string;
  name: string;
  portion_label: string | null;
  qty: number;
}

export interface NotDeductedLine {
  name: string;
  portion_label: string | null;
  qty: number;
  reason: string;
}

export interface UnmappedProduct {
  pos_product_id: string;
  pos_variant_id: string;
  pos_name: string;
  qty: number;
}

export interface UnmappedToken {
  token_key: string;
  token_display: string;
  qty: number;
}

export interface UnresolvedComponent {
  component_name: string;
  portion_label: string;
  qty: number;
}

export interface BowlPiece {
  token_display: string;
  qty: number;
}

export interface DayResolution {
  deducted: DeductedLine[];
  not_deducted: NotDeductedLine[];
  unmapped_products: UnmappedProduct[];
  unmapped_tokens: UnmappedToken[];
  unresolved_components: UnresolvedComponent[];
  ignored: { name: string; qty: number }[];
  bowl_pieces: BowlPiece[];
  item_count: number;
  revenue_cop: number;
  held: boolean;
}

// Tokens are matched loosely on purpose. The register prints "Maíz dulce" one
// week and "Maiz dulce" the next depending on who edited the menu, and those
// must not become two things someone has to map.
export function normaliseToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// The register joins a bowl's choices with " - ". Splitting on the bare hyphen
// would break names that contain one, so only the spaced separator counts.
export function splitModifier(modifierName: string): string[] {
  return modifierName
    .split(' - ')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

export function productKey(productId: string, variantId: string | null | undefined): string {
  return `${productId}::${variantId ?? ''}`;
}

const NO_MODIFIER = 'no_modifier';

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function resolveDay(
  products: PosProductRow[],
  productMaps: ProductMapping[],
  modifierMaps: ModifierMapping[],
  menuItems: MenuItemRef[],
): DayResolution {
  const productByKey = new Map(productMaps.map(m => [productKey(m.pos_product_id, m.pos_variant_id), m]));
  const modifierByKey = new Map(modifierMaps.map(m => [m.token_key, m]));
  const menuById = new Map(menuItems.map(m => [m.id, m]));

  // Components are looked up by name and portion, the same pair the menu's
  // uniqueness index enforces, so the lookup cannot be ambiguous.
  const componentByNameAndPortion = new Map<string, MenuItemRef>();
  for (const item of menuItems) {
    if (!item.active) continue;
    componentByNameAndPortion.set(`${normaliseToken(item.name)}::${item.portion_label ?? ''}`, item);
  }

  const deducted = new Map<string, DeductedLine>();
  const notDeducted = new Map<string, NotDeductedLine>();
  const unmappedProducts = new Map<string, UnmappedProduct>();
  const unmappedTokens = new Map<string, UnmappedToken>();
  const unresolved = new Map<string, UnresolvedComponent>();
  const ignored = new Map<string, { name: string; qty: number }>();
  const bowlPieces = new Map<string, BowlPiece>();

  let itemCount = 0;
  let revenue = 0;

  const addDeducted = (item: MenuItemRef, qty: number) => {
    const existing = deducted.get(item.id);
    if (existing) existing.qty += qty;
    else deducted.set(item.id, { menu_item_id: item.id, name: item.name, portion_label: item.portion_label, qty });
  };

  const addNotDeducted = (name: string, portion: string | null, qty: number, reason: string) => {
    const key = `${name}::${portion ?? ''}::${reason}`;
    const existing = notDeducted.get(key);
    if (existing) existing.qty += qty;
    else notDeducted.set(key, { name, portion_label: portion, qty, reason });
  };

  // A menu item the mapping points at, or a reason it cannot take stock off.
  const deductOrExplain = (item: MenuItemRef | undefined, qty: number, fallbackName: string, portion: string | null) => {
    if (!item || !item.active) {
      return false;
    }
    if (!item.recipe_complete) {
      // Known item, unknown quantities. Recorded rather than held: holding
      // would block every day until the last recipe is finished.
      addNotDeducted(item.name || fallbackName, item.portion_label ?? portion, qty, 'recipe not finished');
      return true;
    }
    addDeducted(item, qty);
    return true;
  };

  for (const product of products) {
    const qty = toNumber(product.product_quantity);
    if (qty <= 0) continue;

    itemCount += qty;
    revenue += toNumber(product.total_sales);

    const variantId = product.variant_id ?? '';
    const key = productKey(product.product_id, variantId);
    const mapping = productByKey.get(key);

    const holdProduct = () => {
      const existing = unmappedProducts.get(key);
      if (existing) existing.qty += qty;
      else unmappedProducts.set(key, {
        pos_product_id: product.product_id,
        pos_variant_id: variantId,
        pos_name: product.product_name,
        qty,
      });
    };

    if (!mapping || !mapping.confirmed || !mapping.kind) {
      holdProduct();
      continue;
    }

    if (mapping.kind === 'ignore') {
      const existing = ignored.get(product.product_name);
      if (existing) existing.qty += qty;
      else ignored.set(product.product_name, { name: product.product_name, qty });
      continue;
    }

    if (mapping.kind === 'menu_item') {
      const item = mapping.menu_item_id ? menuById.get(mapping.menu_item_id) : undefined;
      // A mapping pointing at a removed menu item is a broken mapping, so it
      // holds like an unmapped one instead of quietly deducting nothing.
      if (!deductOrExplain(item, qty, product.product_name, null)) holdProduct();
      continue;
    }

    // Composite: the product itself carries no recipe; its pieces do.
    const portion = mapping.portion_label;
    if (!portion) {
      holdProduct();
      continue;
    }

    const modifiers = product.modifiers ?? [];
    let explained = 0;

    for (const modifier of modifiers) {
      const modQty = toNumber(modifier.modifier_quantity);
      if (modQty <= 0) continue;
      explained += modQty;

      if (modifier.modifier_name === NO_MODIFIER) {
        addNotDeducted(product.product_name, portion, modQty, 'sold without its pieces');
        continue;
      }

      for (const token of splitModifier(modifier.modifier_name)) {
        const tokenKey = normaliseToken(token);

        const piece = bowlPieces.get(tokenKey);
        if (piece) piece.qty += modQty;
        else bowlPieces.set(tokenKey, { token_display: token, qty: modQty });

        const tokenMap = modifierByKey.get(tokenKey);
        if (!tokenMap || !tokenMap.confirmed || !tokenMap.kind) {
          const existing = unmappedTokens.get(tokenKey);
          if (existing) existing.qty += modQty;
          else unmappedTokens.set(tokenKey, { token_key: tokenKey, token_display: token, qty: modQty });
          continue;
        }

        if (tokenMap.kind === 'ignore') continue;

        const componentName = tokenMap.component_name ?? '';
        const component = componentByNameAndPortion.get(`${normaliseToken(componentName)}::${portion}`);
        if (!component) {
          // Mapped, but there is no such piece at this size — typically a
          // component that only exists as Regular being sold in a large bowl.
          const uKey = `${normaliseToken(componentName)}::${portion}`;
          const existing = unresolved.get(uKey);
          if (existing) existing.qty += modQty;
          else unresolved.set(uKey, { component_name: componentName, portion_label: portion, qty: modQty });
          continue;
        }

        deductOrExplain(component, modQty, componentName, portion);
      }
    }

    // The report's modifier rows should add up to the bowls sold. If some are
    // missing, those bowls' pieces are unknown and must not vanish.
    if (explained < qty) {
      addNotDeducted(product.product_name, portion, qty - explained, 'pieces missing from the POS report');
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const sortByQty = <T extends { qty: number }>(rows: T[]) => rows.sort((a, b) => b.qty - a.qty);

  const result: DayResolution = {
    deducted: sortByQty([...deducted.values()]).map(r => ({ ...r, qty: round(r.qty) })),
    not_deducted: sortByQty([...notDeducted.values()]),
    unmapped_products: sortByQty([...unmappedProducts.values()]),
    unmapped_tokens: sortByQty([...unmappedTokens.values()]),
    unresolved_components: sortByQty([...unresolved.values()]),
    ignored: sortByQty([...ignored.values()]),
    bowl_pieces: sortByQty([...bowlPieces.values()]),
    item_count: round(itemCount),
    revenue_cop: round(revenue),
    held: false,
  };

  result.held =
    result.unmapped_products.length > 0 ||
    result.unmapped_tokens.length > 0 ||
    result.unresolved_components.length > 0;

  return result;
}

export function summariseFreehand(rows: PosFreehandRow[]): { name: string; qty: number; total_sales: number }[] {
  return rows
    .filter(r => toNumber(r.product_quantity) > 0)
    .map(r => ({ name: r.product_name, qty: toNumber(r.product_quantity), total_sales: toNumber(r.total_sales) }))
    .sort((a, b) => b.qty - a.qty);
}

// Every distinct piece that appears inside a composite-looking product, for
// discovery. Products not yet mapped are included because the bowl itself may
// still be waiting for its first mapping.
export function discoverTokens(
  products: PosProductRow[],
  productMaps: ProductMapping[],
): { token_key: string; token_display: string }[] {
  const byKey = new Map(productMaps.map(m => [productKey(m.pos_product_id, m.pos_variant_id), m]));
  const tokens = new Map<string, string>();

  for (const product of products) {
    const mapping = byKey.get(productKey(product.product_id, product.variant_id ?? ''));
    // A confirmed plain menu item's modifiers are side choices already covered
    // by its recipe; they are not pieces anyone needs to map.
    if (mapping?.confirmed && mapping.kind !== 'composite') continue;

    for (const modifier of product.modifiers ?? []) {
      if (modifier.modifier_name === NO_MODIFIER || toNumber(modifier.modifier_quantity) <= 0) continue;
      for (const token of splitModifier(modifier.modifier_name)) {
        const key = normaliseToken(token);
        if (!tokens.has(key)) tokens.set(key, token);
      }
    }
  }

  return [...tokens.entries()].map(([token_key, token_display]) => ({ token_key, token_display }));
}
