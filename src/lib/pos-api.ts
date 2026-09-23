// Data access for the OlaClick POS sync.
//
// Reads go straight to the inv_pos_* tables. Writes never do: a mapping decides
// what comes off stock, so it is set only through the admin-checked RPCs, and
// imports are written only by the olaclick-sync edge function.

import { supabase, EDGE_FUNCTIONS_BASE_URL } from './supabase';
import { callEdge } from './inventory-api';
import type {
    PosImport,
    PosModifierKind,
    PosModifierMap,
    PosProductKind,
    PosProductMap,
    PosSyncDayResult,
} from './pos-types';

const EDGE_BASE = process.env.NEXT_PUBLIC_INVENTORY_EDGE_URL || EDGE_FUNCTIONS_BASE_URL;

export const OLACLICK_SYNC_URL = `${EDGE_BASE.replace(/\/+$/, '')}/olaclick-sync`;

export async function fetchPosImports(limit = 30): Promise<PosImport[]> {
    const { data, error } = await supabase
        .from('inv_pos_imports')
        // raw_products and raw_freehand are audit copies; the screen reads the
        // summary and has no reason to download every report in full.
        .select('id, sold_on, status, sales_entry_id, item_count, revenue_cop, deducted_count, not_deducted_count, held_count, freehand_count, summary, error, triggered_by, fetched_at, confirmed_at, updated_at')
        .order('sold_on', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as PosImport[];
}

export async function fetchPosProductMaps(): Promise<PosProductMap[]> {
    const { data, error } = await supabase
        .from('inv_pos_product_map')
        .select('*')
        .order('confirmed', { ascending: true })
        .order('pos_name', { ascending: true })
        .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PosProductMap[];
}

export async function fetchPosModifierMaps(): Promise<PosModifierMap[]> {
    const { data, error } = await supabase
        .from('inv_pos_modifier_map')
        .select('*')
        .order('confirmed', { ascending: true })
        .order('token_display', { ascending: true })
        .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PosModifierMap[];
}

export async function setPosProductMap(params: {
    mapId: string;
    kind: PosProductKind;
    menuItemId: string | null;
    portionLabel: string | null;
    actorId: string | null;
}): Promise<void> {
    const { error } = await supabase.rpc('inv_pos_set_product_map', {
        p_map_id: params.mapId,
        p_kind: params.kind,
        p_menu_item_id: params.kind === 'menu_item' ? params.menuItemId : null,
        p_portion_label: params.kind === 'composite' ? params.portionLabel : null,
        p_actor_id: params.actorId,
    });
    if (error) throw new Error(error.message);
}

export async function setPosModifierMap(params: {
    mapId: string;
    kind: PosModifierKind;
    componentName: string | null;
    actorId: string | null;
}): Promise<void> {
    const { error } = await supabase.rpc('inv_pos_set_modifier_map', {
        p_map_id: params.mapId,
        p_kind: params.kind,
        p_component_name: params.kind === 'component' ? params.componentName : null,
        p_actor_id: params.actorId,
    });
    if (error) throw new Error(error.message);
}

const callSync = <T>(body: Record<string, unknown>) => callEdge<T>(OLACLICK_SYNC_URL, body);

// Omitting the date imports yesterday, which is what the daily schedule does.
export async function syncPosDay(soldOn: string | null, adminId: string | null): Promise<PosSyncDayResult[]> {
    const payload = await callSync<{ results: PosSyncDayResult[] }>({
        action: 'sync',
        ...(soldOn ? { sold_on: soldOn } : {}),
        admin_id: adminId,
    });
    return payload.results ?? [];
}

export async function retryHeldPosDays(adminId: string | null): Promise<PosSyncDayResult[]> {
    const payload = await callSync<{ results: PosSyncDayResult[] }>({ action: 'retry_held', admin_id: adminId });
    return payload.results ?? [];
}

export async function suggestPosMappings(adminId: string | null): Promise<{ products: number; pieces: number }> {
    return callSync<{ products: number; pieces: number }>({ action: 'suggest', admin_id: adminId });
}
