// Shared types for the inventory feature. Mirrors the inv_* tables created in
// supabase/migrations/20260826120000_inventory_core.sql.

export type BaseUnit = 'g' | 'ml' | 'unidad';
export type ItemType = 'raw' | 'prep';
export type ItemCategory = 'ingredient' | 'beverage' | 'alcohol' | 'supply' | 'other';
export type PurchaseSource = 'receipt_scan' | 'transfer' | 'manual';
export type PurchaseStatus = 'draft' | 'confirmed' | 'void';
export type PaymentMethod = 'transfer' | 'cash' | 'card' | 'credit';

export interface InventoryItem {
    id: string;
    name: string;
    item_type: ItemType;
    category: ItemCategory;
    base_unit: BaseUnit;
    is_tracked: boolean;
    track_priority: number;
    cost_per_base_unit: number | null;
    // Where it lives. Count sheets filter on this so the bar and the kitchen can
    // be counted separately by different people.
    storage_area: StorageArea | null;
    notes: string | null;
    archived: boolean;
    created_at: string;
    updated_at: string;
}

export interface ItemAlias {
    id: string;
    item_id: string;
    alias_type: 'barcode' | 'description';
    value: string;
    // Set for descriptions, which are only meaningful within one supplier's
    // printing. Null for barcodes, which are globally unique.
    supplier_id: string | null;
}

export interface PackConversion {
    id: string;
    item_id: string;
    pack_label: string;
    base_qty: number;
}

export interface GlobalUnitConversion {
    id: string;
    unit_label: string;
    base_unit: BaseUnit;
    base_qty: number;
    note: string | null;
}

export interface Supplier {
    id: string;
    name: string;
    nit: string | null;
    default_payment_method: PaymentMethod | null;
    notes: string | null;
    archived: boolean;
}

export interface Purchase {
    id: string;
    supplier_id: string | null;
    purchased_on: string;
    source: PurchaseSource;
    payment_method: PaymentMethod | null;
    document_total_cop: number | null;
    document_number: string | null;
    image_path: string | null;
    ai_warnings: string[] | null;
    status: PurchaseStatus;
    note: string | null;
    created_at: string;
    confirmed_at: string | null;
    supplier?: Supplier | null;
}

export interface PurchaseLine {
    id: string;
    purchase_id: string;
    item_id: string | null;
    line_no: number | null;
    raw_description: string | null;
    raw_barcode: string | null;
    barcode_unreliable: boolean;
    qty: number | null;
    unit_label: string | null;
    base_qty: number | null;
    unit_cost_cop: number | null;
    line_total_cop: number | null;
}

export interface ItemStock {
    item_id: string;
    name: string;
    base_unit: BaseUnit;
    category: ItemCategory;
    is_tracked: boolean;
    track_priority: number;
    cost_per_base_unit: number | null;
    stock_base_qty: number;
    last_movement_at: string | null;
}

// ---------------------------------------------------------------------------
// Menu, recipes and sales
// ---------------------------------------------------------------------------

export type MenuCategory =
    | 'cocktail' | 'juice' | 'soda' | 'coffee' | 'shake'
    | 'brunch' | 'bowl' | 'plate' | 'dessert' | 'side' | 'other';

export const MENU_CATEGORIES: MenuCategory[] = [
    'cocktail', 'juice', 'soda', 'coffee', 'shake',
    'brunch', 'bowl', 'plate', 'dessert', 'side', 'other',
];

export interface MenuItem {
    id: string;
    name: string;
    category: MenuCategory;
    portion_label: string | null;
    sale_price_cop: number | null;
    active: boolean;
    // False while the raw quantities are still being collected. Incomplete
    // items cannot be sold through the sales screen, so a half-entered recipe
    // cannot silently under-deduct stock.
    recipe_complete: boolean;
    notes: string | null;
}

export interface RecipeLine {
    id: string;
    menu_item_id: string;
    item_id: string;
    // In the raw item's base unit — uncooked weight, not plated weight.
    qty_base: number;
    is_tracked: boolean;
    note: string | null;
}

export interface SalesEntry {
    id: string;
    sold_on: string;
    status: 'draft' | 'confirmed' | 'void';
    // 'olaclick' when the day was imported from the register.
    source: 'manual' | 'olaclick';
    note: string | null;
    created_at: string;
    confirmed_at: string | null;
}

export interface SalesLine {
    id: string;
    sales_entry_id: string;
    menu_item_id: string;
    qty_sold: number;
}

export interface MenuItemCost {
    menu_item_id: string;
    name: string;
    category: MenuCategory;
    sale_price_cop: number | null;
    recipe_complete: boolean;
    ingredient_count: number;
    priced_ingredient_count: number;
    raw_cost_cop: number | null;
}

export interface MenuItemCapacity {
    menu_item_id: string;
    name: string;
    category: MenuCategory;
    makeable: number;
    limiting_item: string;
    limiting_stock: number;
    limiting_unit: BaseUnit;
    limiting_qty_per_serving: number;
}

export interface StockOverviewRow {
    item_id: string;
    name: string;
    category: ItemCategory;
    base_unit: BaseUnit;
    is_tracked: boolean;
    stock_base_qty: number;
    cost_per_base_unit: number | null;
    stock_value_cop: number;
    avg_daily_qty: number | null;
    days_of_data: number | null;
    days_left: number | null;
    last_movement_at: string | null;
}

// ---------------------------------------------------------------------------
// scan-receipt edge function contract
// ---------------------------------------------------------------------------

export type ScanDocType = 'itemized_receipt' | 'transfer' | 'card_slip' | 'unknown';

export interface ScannedLine {
    line_no?: number | null;
    description: string;
    barcode?: string | null;
    barcode_unreliable: boolean;
    qty?: number | null;
    unit_label?: string | null;
    unit_cost_cop?: number | null;
    line_total_cop?: number | null;
}

export interface ScanResult {
    doc_type: ScanDocType;
    merchant_name?: string | null;
    merchant_nit?: string | null;
    document_number?: string | null;
    purchased_on?: string | null;
    document_total_cop?: number | null;
    payment_method?: PaymentMethod | null;
    reference_note?: string | null;
    lines: ScannedLine[];
    warnings: string[];
    model_used?: string;
}

// A scanned line after the reviewer has worked on it. This is what the review
// table edits; nothing reaches the database until the purchase is confirmed.
export interface DraftLine extends ScannedLine {
    key: string;
    item_id: string | null;
    // Suggested by alias lookup rather than chosen by a human. Shown differently
    // so the reviewer knows what to double-check.
    auto_matched: boolean;
    base_qty: number | null;
    // Why base_qty could not be computed, if it could not.
    conversion_error: string | null;
    // Raw text exactly as typed. Numeric fields must keep the string, because
    // parsing on every keystroke destroys a half-typed decimal: Number('1.')
    // is 1, so re-rendering a controlled input from the number eats the point
    // and "1.43" becomes "143".
    qty_input: string;
    line_total_input: string;
}

// ---------------------------------------------------------------------------
// Physical counts, variance and stock events
// ---------------------------------------------------------------------------

export type StorageArea = 'kitchen' | 'bar' | 'fridge' | 'freezer' | 'dry_store' | 'other';

export const STORAGE_AREAS: StorageArea[] = ['kitchen', 'bar', 'fridge', 'freezer', 'dry_store', 'other'];

export const STORAGE_AREA_LABEL: Record<StorageArea, string> = {
    kitchen: 'Kitchen',
    bar: 'Bar',
    fridge: 'Fridge',
    freezer: 'Freezer',
    dry_store: 'Dry store',
    other: 'Other',
};

// Reasons stock legitimately leaves. OlaClick cannot record any of these, so
// without them every spoiled tomato reads as theft.
export type StockEventReason = 'waste' | 'staff_meal' | 'comp' | 'adjustment' | 'opening' | 'transfer_out';

export const STOCK_EVENT_LABEL: Record<StockEventReason, string> = {
    waste: 'Waste / spoiled',
    staff_meal: 'Staff meal',
    comp: 'Comped or remade',
    transfer_out: 'Moved elsewhere',
    adjustment: 'Manual correction',
    opening: 'Opening stock (adds)',
};

export interface InventorySettings {
    id: boolean;
    variance_pct_threshold: number;
    variance_value_threshold_cop: number;
    blind_count: boolean;
}

export interface StockCount {
    id: string;
    counted_on: string;
    storage_area: StorageArea | null;
    status: 'draft' | 'confirmed' | 'void';
    note: string | null;
    created_at: string;
    confirmed_at: string | null;
}

export interface CountVarianceRow {
    count_id: string;
    counted_on: string;
    storage_area: StorageArea | null;
    status: string;
    line_id: string;
    item_id: string;
    item_name: string;
    category: ItemCategory;
    base_unit: BaseUnit;
    cost_per_base_unit: number | null;
    counted_qty: number;
    expected_qty: number | null;
    variance_qty: number | null;
    variance_value_cop: number | null;
    variance_pct: number | null;
    is_alert: boolean;
}

export interface CountSummary {
    count_id: string;
    counted_on: string;
    storage_area: StorageArea | null;
    status: string;
    note: string | null;
    confirmed_at: string | null;
    items_counted: number;
    items_alerting: number;
    shortfall_value_cop: number;
    surplus_value_cop: number;
}

export interface MovementByReason {
    item_id: string;
    item_name: string;
    base_unit: BaseUnit;
    occurred_on: string;
    reason: string;
    qty: number;
    value_cop: number;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface AlertSummaryItem {
    item: string;
    expected: number;
    counted: number;
    missing: number;
    unit: BaseUnit;
    pct: number | null;
    value_cop: number;
}

export interface InventoryAlert {
    id: string;
    count_id: string | null;
    kind: 'count_variance';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    summary: AlertSummaryItem[] | null;
    items_alerting: number;
    shortfall_value_cop: number;
    status: 'new' | 'acknowledged' | 'dismissed';
    acknowledged_at: string | null;
    claimed_at?: string | null;
    // Why the shortfall happened. Required to close an alert — this is the
    // field that makes the thresholds tunable and patterns visible.
    acknowledge_note: string | null;
    // 'sending' is a claim held by a dispatcher in flight.
    email_status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
    email_error: string | null;
    email_sent_at: string | null;
    created_at: string;
}

// Who receives the alert report. A managed list rather than one field in
// settings: who should hear about a shortfall changes with staff and holidays,
// and should never need a developer.
export interface AlertRecipient {
    id: string;
    email: string;
    label: string | null;
    // Switched off rather than deleted, so somebody on leave keeps their place.
    active: boolean;
    created_at: string;
}
