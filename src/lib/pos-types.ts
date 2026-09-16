// Types for the OlaClick POS sync. Mirrors supabase/functions/_shared/pos-mapping.ts
// and the inv_pos_* tables.

export type PosImportStatus = 'pending_mapping' | 'confirmed' | 'skipped_manual' | 'no_sales' | 'failed';

export interface PosDeductedLine {
    menu_item_id: string;
    name: string;
    portion_label: string | null;
    qty: number;
}

export interface PosNotDeductedLine {
    name: string;
    portion_label: string | null;
    qty: number;
    reason: string;
}

export interface PosUnmappedProduct {
    pos_product_id: string;
    pos_variant_id: string;
    pos_name: string;
    qty: number;
}

export interface PosUnmappedToken {
    token_key: string;
    token_display: string;
    qty: number;
}

export interface PosUnresolvedComponent {
    component_name: string;
    portion_label: string;
    qty: number;
}

export interface PosFreehandLine {
    name: string;
    qty: number;
    total_sales: number;
}

export interface PosBowlPiece {
    token_display: string;
    qty: number;
}

export interface PosImportSummary {
    deducted?: PosDeductedLine[];
    not_deducted?: PosNotDeductedLine[];
    unmapped_products?: PosUnmappedProduct[];
    unmapped_tokens?: PosUnmappedToken[];
    unresolved_components?: PosUnresolvedComponent[];
    ignored?: { name: string; qty: number }[];
    freehand?: PosFreehandLine[];
    bowl_pieces?: PosBowlPiece[];
}

export interface PosImport {
    id: string;
    sold_on: string;
    status: PosImportStatus;
    sales_entry_id: string | null;
    item_count: number;
    revenue_cop: number;
    deducted_count: number;
    not_deducted_count: number;
    held_count: number;
    freehand_count: number;
    summary: PosImportSummary;
    error: string | null;
    triggered_by: 'schedule' | 'admin';
    fetched_at: string | null;
    confirmed_at: string | null;
    updated_at: string;
}

export type PosProductKind = 'menu_item' | 'composite' | 'ignore';

export interface PosProductMap {
    id: string;
    pos_product_id: string;
    pos_variant_id: string;
    pos_name: string;
    kind: PosProductKind | null;
    menu_item_id: string | null;
    portion_label: string | null;
    confirmed: boolean;
    confirmed_at: string | null;
    suggested_kind: PosProductKind | null;
    suggested_menu_item_id: string | null;
    suggested_portion_label: string | null;
    suggestion_reason: string | null;
    suggested_at: string | null;
    last_seen_on: string | null;
}

export type PosModifierKind = 'component' | 'ignore';

export interface PosModifierMap {
    id: string;
    token_key: string;
    token_display: string;
    kind: PosModifierKind | null;
    component_name: string | null;
    confirmed: boolean;
    confirmed_at: string | null;
    suggested_kind: PosModifierKind | null;
    suggested_component_name: string | null;
    suggestion_reason: string | null;
    suggested_at: string | null;
    last_seen_on: string | null;
}

export interface PosSyncDayResult {
    sold_on: string;
    status: PosImportStatus;
    already?: boolean;
    held_count?: number;
    deducted_count?: number;
    not_deducted_count?: number;
    error?: string;
}
