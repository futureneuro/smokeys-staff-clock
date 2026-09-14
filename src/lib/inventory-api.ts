// Data access for the inventory feature. Nothing here touches existing tables.

import { supabase, EDGE_FUNCTIONS_BASE_URL } from './supabase';
import { getBogotaDateString, normaliseDescription } from './inventory-units';
import type {
    DraftLine,
    GlobalUnitConversion,
    InventoryItem,
    ItemAlias,
    ItemStock,
    MenuItem,
    MenuItemCapacity,
    MenuItemCost,
    PackConversion,
    Purchase,
    PurchaseLine,
    CountSummary,
    CountVarianceRow,
    AlertRecipient,
    InventoryAlert,
    InventorySettings,
    MovementByReason,
    RecipeLine,
    SalesEntry,
    StockCount,
    StockEventReason,
    StorageArea,
    ScanResult,
    StockOverviewRow,
    Supplier,
} from './inventory-types';

// Lets local development point the scanner at `supabase functions serve` while
// every other edge function keeps talking to production.
const EDGE_BASE = process.env.NEXT_PUBLIC_INVENTORY_EDGE_URL || EDGE_FUNCTIONS_BASE_URL;

export const SCAN_RECEIPT_URL = `${EDGE_BASE.replace(/\/+$/, '')}/scan-receipt`;

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

// Phone photos are far larger than the model needs. Downscaling before upload
// keeps requests small and scans fast.
const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export async function downscaleImage(file: File): Promise<{ base64: string; mimeType: string }> {
    // PDFs and unsupported types go through untouched.
    if (!file.type.startsWith('image/')) {
        return { base64: await fileToBase64(file), mimeType: file.type };
    }

    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
        const width = Math.round(bitmap.width * scale);
        const height = Math.round(bitmap.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        return { base64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg' };
    } catch {
        // Any canvas problem (HEIC without decoder, memory) falls back to the
        // original bytes rather than failing the scan.
        return { base64: await fileToBase64(file), mimeType: file.type || 'image/jpeg' };
    }
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? '');
            resolve(result.slice(result.indexOf(',') + 1));
        };
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
    });
}

// Keeps the original document alongside the extracted data.
//
// The extraction is a machine's reading of a photo; when a line is disputed
// weeks later, the photo is the only way to check it. A theft-detection system
// that throws away its evidence is not much of one.
export async function uploadReceiptImage(
    file: File,
    // Pass the already-downscaled bytes from the scan. Decoding an 8-12 MB
    // phone photo twice on the phone's main thread doubles the wait before the
    // review table appears.
    prepared?: { base64: string; mimeType: string },
): Promise<string | null> {
    try {
        const { base64, mimeType } = prepared ?? await downscaleImage(file);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

        const ext = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
        // Bogota, like every other date in the feature. A UTC date filed every
        // evening's receipts under the following day, so looking for the
        // original document of a disputed line meant the wrong folder.
        const path = `receipts/${getBogotaDateString()}/${Date.now()}.${ext}`;

        const { error } = await supabase.storage
            .from('task-attachments')
            .upload(path, bytes, { contentType: mimeType });
        if (error) throw error;

        return supabase.storage.from('task-attachments').getPublicUrl(path).data?.publicUrl ?? null;
    } catch (e) {
        // Never block a purchase over the image. The extracted data is the part
        // that matters; a missing photo is visible in the UI and can be re-added.
        console.warn('Could not store the receipt image:', e);
        return null;
    }
}

export async function scanReceipt(
    file: File,
    adminId: string,
    prepared?: { base64: string; mimeType: string },
): Promise<ScanResult> {
    const { base64, mimeType } = prepared ?? await downscaleImage(file);

    const res = await fetch(SCAN_RECEIPT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // The function checks this identifies an active admin before it
            // spends a Gemini call, so the endpoint is not an open OCR proxy
            // billed to the restaurant's key.
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
        },
        body: JSON.stringify({ image_base64: base64, mime_type: mimeType, admin_id: adminId }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(payload?.error || `Scan failed (${res.status}).`);
    }

    return {
        ...payload,
        lines: Array.isArray(payload.lines) ? payload.lines : [],
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    } as ScanResult;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// PostgREST caps a response at max_rows (1000, per supabase/config.toml) and
// truncates silently — no error, just a short list. Anything that must be
// complete is paged explicitly.
const PAGE_SIZE = 1000;

// Every caller must supply a unique ordering column. Without one Postgres
// gives no stable row order between two independent LIMIT/OFFSET queries, so
// page 2 can repeat rows from page 1 and silently omit others.
async function fetchAllPages<T>(
    build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 0; ; page++) {
        const { data, error } = await build().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as T[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) return rows;
    }
}

export async function fetchItems(): Promise<InventoryItem[]> {
    return fetchAllPages<InventoryItem>(() =>
        supabase.from('inv_items').select('*').eq('archived', false).order('name').order('id'),
    );
}

export async function fetchItemStock(): Promise<ItemStock[]> {
    return fetchAllPages<ItemStock>(() => supabase.from('inv_item_stock').select('*').order('name').order('item_id'));
}

// Only the aliases relevant to the document in hand.
//
// Downloading the whole table would silently truncate at PostgREST's max_rows
// (1000, per supabase/config.toml) once the alias table grows, and auto-matching
// would quietly degrade with no error to explain it.
export async function fetchAliasesFor(params: {
    barcodes: string[];
    descriptions: string[];
    supplierId: string | null;
}): Promise<ItemAlias[]> {
    const barcodes = [...new Set(params.barcodes.filter(Boolean))];
    const descriptions = [...new Set(params.descriptions.filter(Boolean))];
    const results: ItemAlias[] = [];

    if (barcodes.length > 0) {
        const { data, error } = await supabase
            .from('inv_item_aliases')
            .select('*')
            .eq('alias_type', 'barcode')
            .in('value', barcodes);
        if (error) throw new Error(error.message);
        results.push(...((data ?? []) as ItemAlias[]));
    }

    // Descriptions only match within the same supplier, because printers
    // truncate labels and two suppliers' products can collide.
    if (descriptions.length > 0 && params.supplierId) {
        const { data, error } = await supabase
            .from('inv_item_aliases')
            .select('*')
            .eq('alias_type', 'description')
            .eq('supplier_id', params.supplierId)
            .in('value', descriptions);
        if (error) throw new Error(error.message);
        results.push(...((data ?? []) as ItemAlias[]));
    }

    return results;
}

export async function fetchPackConversions(): Promise<PackConversion[]> {
    return fetchAllPages<PackConversion>(() => supabase.from('inv_pack_conversions').select('*').order('id'));
}

export async function fetchGlobalConversions(): Promise<GlobalUnitConversion[]> {
    return fetchAllPages<GlobalUnitConversion>(() =>
        supabase.from('inv_global_unit_conversions').select('*').order('id'),
    );
}

export async function createItem(payload: Partial<InventoryItem>): Promise<InventoryItem> {
    const { data, error } = await supabase.from('inv_items').insert(payload).select('*').single();
    if (error) throw new Error(error.message);
    return data as InventoryItem;
}

export async function updateItem(id: string, payload: Partial<InventoryItem>): Promise<void> {
    const { error } = await supabase
        .from('inv_items')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw new Error(error.message);
}

export async function archiveItem(id: string): Promise<void> {
    const { error } = await supabase.from('inv_items').update({ archived: true }).eq('id', id);
    if (error) throw new Error(error.message);
}

export async function addPackConversion(itemId: string, packLabel: string, baseQty: number): Promise<void> {
    const { error } = await supabase
        .from('inv_pack_conversions')
        .insert({ item_id: itemId, pack_label: packLabel.trim(), base_qty: baseQty });
    if (error) throw new Error(error.message);
}

export async function deletePackConversion(id: string): Promise<void> {
    const { error } = await supabase.from('inv_pack_conversions').delete().eq('id', id);
    if (error) throw new Error(error.message);
}

interface AliasRow {
    item_id: string;
    alias_type: 'barcode' | 'description';
    value: string;
    supplier_id: string | null;
}

// Remembers how a reviewer mapped a receipt line so the next scan matches it
// automatically. Price-embedded barcodes are deliberately not remembered:
// they change with the item's weight, so they identify nothing.
//
// The reviewer's latest choice always wins. If a description was previously
// bound to the wrong item, confirming a correction has to rebind it — keeping
// the old row would re-suggest the wrong item on every future scan forever.
export async function rememberAliases(lines: DraftLine[], supplierId: string | null): Promise<void> {
    const barcodeRows = new Map<string, AliasRow>();
    const descriptionRows = new Map<string, AliasRow>();

    for (const line of lines) {
        if (!line.item_id) continue;

        if (line.barcode && !line.barcode_unreliable) {
            const value = line.barcode.trim();
            barcodeRows.set(value, { item_id: line.item_id, alias_type: 'barcode', value, supplier_id: null });
        }

        const description = normaliseDescription(line.description);
        // Without a supplier there is nothing to scope the description to, and
        // an unscoped label would collide across suppliers.
        if (description && supplierId) {
            descriptionRows.set(description, {
                item_id: line.item_id,
                alias_type: 'description',
                value: description,
                supplier_id: supplierId,
            });
        }
    }

    const rows = [...barcodeRows.values(), ...descriptionRows.values()];
    if (rows.length === 0) return;

    // Via RPC rather than a PostgREST upsert: both uniqueness rules are partial
    // indexes (scoped by alias_type), and PostgREST cannot name a partial index
    // as an ON CONFLICT arbiter.
    const { error } = await supabase.rpc('inv_remember_aliases', { p_rows: rows });
    if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function fetchSuppliers(): Promise<Supplier[]> {
    const { data, error } = await supabase
        .from('inv_suppliers')
        .select('*')
        .eq('archived', false)
        .order('name');
    if (error) throw new Error(error.message);
    return (data ?? []) as Supplier[];
}

// Supplier names come out of an OCR model, so they can contain anything —
// including characters PostgREST treats specially. `%` and `_` are LIKE
// wildcards, and PostgREST additionally rewrites `*` into `%` inside a
// like/ilike value, which no amount of escaping can express.
//
// There are a handful of suppliers, so the match is done here instead: exact,
// case-insensitive, no pattern language involved.
export async function findSupplierByName(name: string): Promise<string | null> {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return null;

    const { data, error } = await supabase
        .from('inv_suppliers')
        .select('id, name')
        .eq('archived', false);

    if (error) throw new Error(error.message);

    const hit = (data ?? []).find(
        row => String((row as { name: string }).name).trim().toLowerCase() === trimmed);
    return hit ? (hit as { id: string }).id : null;
}

export async function findOrCreateSupplier(name: string, nit?: string | null): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const existingId = await findSupplierByName(trimmed);
    if (existingId) return existingId;

    const { data, error } = await supabase
        .from('inv_suppliers')
        .insert({ name: trimmed, nit: nit || null })
        .select('id')
        .single();
    if (error) throw new Error(error.message);
    return data.id as string;
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export async function fetchPurchases(limit = 100): Promise<Purchase[]> {
    const { data, error } = await supabase
        .from('inv_purchases')
        .select('*, supplier:inv_suppliers(*)')
        .order('purchased_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as Purchase[];
}

export async function fetchPurchaseLines(purchaseId: string): Promise<PurchaseLine[]> {
    const { data, error } = await supabase
        .from('inv_purchase_lines')
        .select('*')
        .eq('purchase_id', purchaseId)
        .order('line_no');
    if (error) throw new Error(error.message);
    return (data ?? []) as PurchaseLine[];
}

export interface SavePurchaseInput {
    supplierName: string;
    supplierNit?: string | null;
    purchasedOn: string;
    source: Purchase['source'];
    paymentMethod: Purchase['payment_method'];
    documentTotalCop: number | null;
    documentNumber: string | null;
    imagePath: string | null;
    note: string | null;
    aiRaw: unknown;
    aiWarnings: string[];
    lines: DraftLine[];
    actorId: string | null;
}

// Writes the purchase and its lines as a draft, then confirms it in one RPC so
// the ledger entries land atomically.
export async function savePurchase(input: SavePurchaseInput): Promise<string> {
    const supplierId = await findOrCreateSupplier(input.supplierName, input.supplierNit);

    const { data: purchase, error: purchaseError } = await supabase
        .from('inv_purchases')
        .insert({
            supplier_id: supplierId,
            purchased_on: input.purchasedOn,
            source: input.source,
            payment_method: input.paymentMethod,
            document_total_cop: input.documentTotalCop,
            document_number: input.documentNumber,
            image_path: input.imagePath,
            ai_raw: input.aiRaw ?? null,
            ai_warnings: input.aiWarnings.length > 0 ? input.aiWarnings : null,
            note: input.note,
            status: 'draft',
            created_by: input.actorId,
        })
        .select('id')
        .single();

    if (purchaseError) throw new Error(purchaseError.message);
    const purchaseId = purchase.id as string;

    if (input.lines.length > 0) {
        const rows = input.lines.map((line, index) => ({
            purchase_id: purchaseId,
            item_id: line.item_id,
            line_no: index + 1,
            raw_description: line.description || null,
            raw_barcode: line.barcode || null,
            barcode_unreliable: Boolean(line.barcode_unreliable),
            qty: line.qty ?? null,
            unit_label: line.unit_label || null,
            base_qty: line.base_qty,
            unit_cost_cop: line.unit_cost_cop ?? null,
            line_total_cop: line.line_total_cop ?? null,
        }));

        const { error: linesError } = await supabase.from('inv_purchase_lines').insert(rows);
        if (linesError) {
            // Leave nothing half-written behind.
            await supabase.from('inv_purchases').delete().eq('id', purchaseId);
            throw new Error(linesError.message);
        }
    }

    const { error: confirmError } = await supabase.rpc('inv_confirm_purchase', {
        p_purchase_id: purchaseId,
        p_actor_id: input.actorId,
    });

    if (confirmError) {
        // The RPC is atomic, so a failure means no ledger rows were written.
        // Clear the draft too: nothing in the UI can confirm, edit or delete a
        // stranded draft, so retrying would just pile up unreachable rows.
        await supabase.from('inv_purchases').delete().eq('id', purchaseId);
        throw new Error(confirmError.message);
    }

    // Stock has already moved and the purchase is confirmed. Alias bookkeeping
    // is a convenience for the next scan, so a failure here must not be
    // reported as a failed save — the operator would retry and double-count.
    try {
        await rememberAliases(input.lines, supplierId);
    } catch (aliasError) {
        console.warn('Purchase saved, but remembering item aliases failed:', aliasError);
    }

    return purchaseId;
}

// ---------------------------------------------------------------------------
// Menu and recipes
// ---------------------------------------------------------------------------

export async function fetchMenuItems(): Promise<MenuItem[]> {
    return fetchAllPages<MenuItem>(() =>
        supabase.from('inv_menu_items').select('*').eq('active', true).order('category').order('name').order('id'),
    );
}

export async function fetchRecipeLines(): Promise<RecipeLine[]> {
    return fetchAllPages<RecipeLine>(() => supabase.from('inv_recipe_lines').select('*').order('id'));
}

export async function createMenuItem(payload: Partial<MenuItem>): Promise<MenuItem> {
    const { data, error } = await supabase.from('inv_menu_items').insert(payload).select('*').single();
    if (error) throw new Error(error.message);
    return data as MenuItem;
}

export async function updateMenuItem(id: string, payload: Partial<MenuItem>): Promise<void> {
    const { error } = await supabase
        .from('inv_menu_items')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw new Error(error.message);
}

export async function archiveMenuItem(id: string): Promise<void> {
    const { error } = await supabase.from('inv_menu_items').update({ active: false }).eq('id', id);
    if (error) throw new Error(error.message);
}

export async function upsertRecipeLine(
    menuItemId: string,
    itemId: string,
    qtyBase: number,
    isTracked = true,
): Promise<void> {
    const { error } = await supabase
        .from('inv_recipe_lines')
        .upsert(
            { menu_item_id: menuItemId, item_id: itemId, qty_base: qtyBase, is_tracked: isTracked },
            { onConflict: 'menu_item_id,item_id', ignoreDuplicates: false },
        );
    if (error) throw new Error(error.message);
}

export async function deleteRecipeLine(id: string): Promise<void> {
    const { error } = await supabase.from('inv_recipe_lines').delete().eq('id', id);
    if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Overview views
// ---------------------------------------------------------------------------

export async function fetchStockOverview(): Promise<StockOverviewRow[]> {
    return fetchAllPages<StockOverviewRow>(() =>
        supabase.from('inv_stock_overview').select('*').order('name').order('item_id'),
    );
}

export async function fetchMenuCapacity(): Promise<MenuItemCapacity[]> {
    return fetchAllPages<MenuItemCapacity>(() =>
        supabase.from('inv_menu_item_capacity').select('*').order('makeable').order('menu_item_id'),
    );
}

export async function fetchMenuCosts(): Promise<MenuItemCost[]> {
    return fetchAllPages<MenuItemCost>(() => supabase.from('inv_menu_item_cost').select('*').order('name').order('menu_item_id'));
}

// ---------------------------------------------------------------------------
// Sales entry
// ---------------------------------------------------------------------------

export async function fetchSalesEntries(limit = 60): Promise<SalesEntry[]> {
    const { data, error } = await supabase
        .from('inv_sales_entries')
        .select('*')
        .order('sold_on', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as SalesEntry[];
}

export interface SaveSalesInput {
    soldOn: string;
    note: string | null;
    // menu_item_id -> quantity sold. Zero and blank entries are dropped.
    quantities: Record<string, number>;
    actorId: string | null;
}

// Writes the day's sales and confirms it in one RPC, so the stock deductions
// land atomically. A confirmed entry already exists for that date is rejected by
// a unique index rather than silently double-deducting.
export async function saveSalesEntry(input: SaveSalesInput): Promise<number> {
    const lines = Object.entries(input.quantities)
        .map(([menu_item_id, qty]) => ({ menu_item_id, qty_sold: qty }))
        .filter(line => Number.isFinite(line.qty_sold) && line.qty_sold > 0);

    if (lines.length === 0) throw new Error('Enter at least one quantity before saving.');

    const { data: entry, error: entryError } = await supabase
        .from('inv_sales_entries')
        .insert({ sold_on: input.soldOn, note: input.note, status: 'draft', created_by: input.actorId })
        .select('id')
        .single();
    if (entryError) throw new Error(entryError.message);

    const entryId = entry.id as string;

    const { error: linesError } = await supabase
        .from('inv_sales_lines')
        .insert(lines.map(line => ({ ...line, sales_entry_id: entryId })));
    if (linesError) {
        await supabase.from('inv_sales_entries').delete().eq('id', entryId);
        throw new Error(linesError.message);
    }

    const { data: written, error: confirmError } = await supabase.rpc('inv_confirm_sales_entry', {
        p_entry_id: entryId,
        p_actor_id: input.actorId,
    });

    if (confirmError) {
        // The RPC is atomic, so nothing was deducted. Clear the draft rather
        // than leaving a row no screen can reach.
        await supabase.from('inv_sales_entries').delete().eq('id', entryId);
        throw new Error(confirmError.message);
    }

    return Number(written ?? 0);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function fetchSettings(): Promise<InventorySettings> {
    const { data, error } = await supabase.from('inv_settings').select('*').limit(1).single();
    if (error) throw new Error(error.message);
    return data as InventorySettings;
}

// Via the admin-checked function: these thresholds decide whether an alert
// fires at all, so the anon key must not be able to move or delete them.
export async function updateSettings(
    payload: { variance_pct_threshold: number; variance_value_threshold_cop: number; blind_count: boolean },
    actorId: string | null,
): Promise<void> {
    const { error } = await supabase.rpc('inv_update_settings', {
        p_pct: payload.variance_pct_threshold,
        p_value: payload.variance_value_threshold_cop,
        p_blind: payload.blind_count,
        p_actor_id: actorId,
    });
    if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Physical counts
// ---------------------------------------------------------------------------

export async function fetchCountSummaries(limit = 40): Promise<CountSummary[]> {
    const { data, error } = await supabase
        .from('inv_count_summary')
        .select('*')
        .order('counted_on', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as CountSummary[];
}

export async function fetchCountVariance(countId: string): Promise<CountVarianceRow[]> {
    const { data, error } = await supabase
        .from('inv_count_variance')
        .select('*')
        .eq('count_id', countId)
        .order('variance_value_cop');
    if (error) throw new Error(error.message);
    return (data ?? []) as CountVarianceRow[];
}

export interface SaveCountInput {
    countedOn: string;
    storageArea: StorageArea | null;
    note: string | null;
    // item_id -> counted quantity in the item's base unit
    quantities: Record<string, number>;
    actorId: string | null;
}

// Writes the count and confirms it in one go, so the expected figures are
// frozen and the ledger adjustment lands atomically.
export async function saveCount(input: SaveCountInput): Promise<string> {
    const lines = Object.entries(input.quantities)
        .map(([item_id, counted_qty]) => ({ item_id, counted_qty }))
        .filter(l => Number.isFinite(l.counted_qty) && l.counted_qty >= 0);

    if (lines.length === 0) throw new Error('Count at least one item before saving.');

    const { data: count, error: countError } = await supabase
        .from('inv_counts')
        .insert({
            counted_on: input.countedOn,
            storage_area: input.storageArea,
            note: input.note,
            status: 'draft',
            counted_by: input.actorId,
        })
        .select('id')
        .single();
    if (countError) throw new Error(countError.message);

    const countId = count.id as string;

    const { error: linesError } = await supabase
        .from('inv_count_lines')
        .insert(lines.map(l => ({ ...l, count_id: countId })));
    if (linesError) {
        await supabase.from('inv_counts').delete().eq('id', countId);
        throw new Error(linesError.message);
    }

    const { error: confirmError } = await supabase.rpc('inv_confirm_count', {
        p_count_id: countId,
        p_actor_id: input.actorId,
    });
    if (confirmError) {
        await supabase.from('inv_counts').delete().eq('id', countId);
        throw new Error(confirmError.message);
    }

    return countId;
}

// ---------------------------------------------------------------------------
// Waste, staff meals, comps
// ---------------------------------------------------------------------------

export async function recordStockEvent(params: {
    itemId: string;
    qty: number;
    reason: StockEventReason;
    note: string | null;
    occurredOn: string | null;
    actorId: string | null;
}): Promise<void> {
    const { error } = await supabase.rpc('inv_record_stock_event', {
        p_item_id: params.itemId,
        p_qty: params.qty,
        p_reason: params.reason,
        p_note: params.note,
        p_occurred_on: params.occurredOn,
        p_actor_id: params.actorId,
    });
    if (error) throw new Error(error.message);
}

export async function fetchRecentMovements(sinceDays = 14): Promise<MovementByReason[]> {
    // occurred_on is a Bogota date. Deriving the cut-off from a UTC timestamp
    // moved it forward a day every evening (Bogota is UTC-5), so the oldest
    // day of waste vanished during service and reappeared next morning.
    const todayBogota = new Date(`${getBogotaDateString()}T00:00:00Z`);
    todayBogota.setUTCDate(todayBogota.getUTCDate() - sinceDays);
    const since = todayBogota.toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('inv_movement_by_reason')
        .select('*')
        .gte('occurred_on', since)
        .order('occurred_on', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as MovementByReason[];
}

export async function fetchCounts(limit = 40): Promise<StockCount[]> {
    const { data, error } = await supabase
        .from('inv_counts')
        .select('*')
        .order('counted_on', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as StockCount[];
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const INVENTORY_ALERT_URL = `${EDGE_BASE.replace(/\/+$/, '')}/inventory-alert`;

export async function fetchAlerts(limit = 30): Promise<InventoryAlert[]> {
    const { data, error } = await supabase
        .from('inv_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as InventoryAlert[];
}

export async function acknowledgeAlert(
    alertId: string,
    note: string,
    actorId: string | null,
    dismiss = false,
): Promise<void> {
    const { error } = await supabase.rpc('inv_acknowledge_alert', {
        p_alert_id: alertId,
        p_note: note,
        p_actor_id: actorId,
        p_dismiss: dismiss,
    });
    if (error) throw new Error(error.message);
}

// Fires the email. The alert already exists in the app either way, so a
// dispatch failure never blocks the count — it is reported, not thrown.
export async function dispatchAlertEmails(
    alertId?: string,
    adminId?: string | null,
): Promise<{ sent: number; reason?: string }> {
    try {
        const res = await fetch(INVENTORY_ALERT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
            },
            body: JSON.stringify({
                ...(alertId ? { alert_id: alertId } : {}),
                // The function refuses callers that are neither an admin nor
                // the scheduled job, so it will not send email for anyone who
                // merely knows the URL.
                admin_id: adminId ?? null,
            }),
        });

        const payload = await res.json().catch(() => ({}));

        // Failures come back as {error: "..."}. Reading only `reason` turned
        // every one of them into "unknown reason" on screen.
        if (!res.ok) {
            return { sent: 0, reason: payload?.error || `Alert service returned ${res.status}.` };
        }

        return { sent: Number(payload?.sent ?? 0), reason: payload?.reason || payload?.error };
    } catch (e) {
        return { sent: 0, reason: e instanceof Error ? e.message : 'Could not reach the alert service.' };
    }
}

// ---------------------------------------------------------------------------
// Alert recipients
// ---------------------------------------------------------------------------

export async function fetchAlertRecipients(): Promise<AlertRecipient[]> {
    const { data, error } = await supabase
        .from('inv_alert_recipients')
        .select('*')
        .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []) as AlertRecipient[];
}

// Writes go through admin-checked functions rather than the table: the anon
// key ships in the browser bundle, and the recipient list decides who receives
// the full shortfall report.
export async function addAlertRecipient(
    email: string, label: string | null, actorId: string | null,
): Promise<void> {
    const { error } = await supabase.rpc('inv_add_alert_recipient', {
        p_email: email.trim(),
        p_label: label?.trim() || null,
        p_actor_id: actorId,
    });
    if (error) {
        // A duplicate is a normal mistake rather than a fault — say so plainly.
        if (error.code === '23505') throw new Error('That address is already on the list.');
        if (error.code === '23514') throw new Error('That does not look like an email address.');
        throw new Error(error.message);
    }
}

export async function setAlertRecipientActive(
    id: string, active: boolean, actorId: string | null,
): Promise<void> {
    const { error } = await supabase.rpc('inv_set_alert_recipient_active', {
        p_id: id, p_active: active, p_actor_id: actorId,
    });
    if (error) throw new Error(error.message);
}

export async function deleteAlertRecipient(id: string, actorId: string | null): Promise<void> {
    const { error } = await supabase.rpc('inv_delete_alert_recipient', {
        p_id: id, p_actor_id: actorId,
    });
    if (error) throw new Error(error.message);
}
