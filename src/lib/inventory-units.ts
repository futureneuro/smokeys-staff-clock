// Converting a quantity as printed on a document into an item's base unit.
//
// Three sources are consulted, most specific first:
//   1. inv_pack_conversions  — "1 bulto" of THIS item is 50000 g
//   2. inv_global_unit_conversions — "kg" is always 1000 g
//   3. the item's own base unit — "g" for an item measured in g is 1:1
//
// A conversion that cannot be resolved returns an error string rather than a
// guess. Guessing here would silently corrupt every downstream variance figure.

import type { BaseUnit, GlobalUnitConversion, PackConversion } from './inventory-types';

// Re-exported rather than reimplemented: the Bogota date rule is defined once,
// in lib/bogota-date.ts, mirroring the clock-action edge function.
export { getBogotaDateString } from './bogota-date';

export function normaliseUnitLabel(label: string | null | undefined): string {
    return (label ?? '').trim().toLowerCase().replace(/\.$/, '');
}

// Receipt descriptions are matched case- and whitespace-insensitively so that
// "PECHUGA POLLO" and "Pechuga  Pollo" resolve to the same alias.
export function normaliseDescription(value: string | null | undefined): string {
    return (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export interface ConversionResult {
    baseQty: number | null;
    error: string | null;
}

export function convertToBaseQty(params: {
    qty: number | null | undefined;
    unitLabel: string | null | undefined;
    baseUnit: BaseUnit;
    packConversions: PackConversion[];
    globalConversions: GlobalUnitConversion[];
}): ConversionResult {
    const { qty, unitLabel, baseUnit, packConversions, globalConversions } = params;

    if (qty === null || qty === undefined || Number.isNaN(qty)) {
        return { baseQty: null, error: 'No quantity' };
    }

    const label = normaliseUnitLabel(unitLabel);

    // An item-specific pack always wins: "1 caja" means different things for
    // different products.
    const pack = packConversions.find(p => normaliseUnitLabel(p.pack_label) === label);
    if (pack) {
        return { baseQty: qty * Number(pack.base_qty), error: null };
    }

    if (!label) {
        // No unit printed. Only safe when the item is counted in whole units.
        if (baseUnit === 'unidad') return { baseQty: qty, error: null };
        return { baseQty: null, error: `No unit given; item is measured in ${baseUnit}` };
    }

    const global = globalConversions.find(
        c => normaliseUnitLabel(c.unit_label) === label && c.base_unit === baseUnit,
    );
    if (global) {
        return { baseQty: qty * Number(global.base_qty), error: null };
    }

    // The label exists globally but converts to a different dimension — e.g. a
    // receipt priced in kg for an item catalogued in ml. Almost always a
    // mis-mapped item rather than a real unit problem.
    const wrongDimension = globalConversions.find(c => normaliseUnitLabel(c.unit_label) === label);
    if (wrongDimension) {
        return {
            baseQty: null,
            error: `"${label}" is a ${wrongDimension.base_unit} unit but this item is measured in ${baseUnit}`,
        };
    }

    return {
        baseQty: null,
        error: `Unknown unit "${label}" — add a pack size for this item`,
    };
}

const COP = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
});

export function formatCop(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return COP.format(value);
}

export function formatQty(value: number | null | undefined, unit?: string): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const rounded = Math.round(value * 10000) / 10000;
    const text = rounded.toLocaleString('es-CO', { maximumFractionDigits: 4 });
    return unit ? `${text} ${unit}` : text;
}

// ---------------------------------------------------------------------------
// Parsing operator input
// ---------------------------------------------------------------------------

// Quantities carry real decimals (1.43 kg of chicken), and Colombian keyboards
// produce a comma as often as a point. Thousands separators are not expected
// here — nobody types a five-digit quantity on a receipt line.
export function parseQtyInput(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;

    // No negatives: a negative count or waste quantity is always a typo, and
    // accepting one here meant it passed every check and was then dropped by
    // the save with no message.
    const normalised = trimmed.replace(',', '.');
    if (!/^\d*\.?\d*$/.test(normalised) || normalised === '.') return null;

    const value = Number(normalised);
    return Number.isFinite(value) ? value : null;
}

// Money is the harder case. Colombian documents group with either separator in
// the same receipt — "2,450" on a till slip and "$ 1.500.000" in a banking app
// are both integers — while a stored price may carry real decimals.
export function parseCopInput(raw: string): number | null {
    const trimmed = raw.trim().replace(/[\s$]/g, '');
    if (trimmed === '') return null;
    if (!/^-?[\d.,]+$/.test(trimmed)) return null;

    // Colombian documents group with either separator, so the last one decides:
    // three digits after it is a thousands group ("2,450", "120.000"), one or
    // two is a decimal ("32000.5"). Stripping every separator unconditionally
    // turned a stored 32000.50 into 3200050 on a simple round trip through an
    // input field.
    const lastSep = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf(','));
    let normalised: string;

    if (lastSep === -1) {
        normalised = trimmed;
    } else {
        const after = trimmed.slice(lastSep + 1);
        normalised = /^\d{1,2}$/.test(after)
            ? trimmed.slice(0, lastSep).replace(/[.,]/g, '') + '.' + after
            : trimmed.replace(/[.,]/g, '');
    }

    if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null;
    const value = Number(normalised);
    return Number.isFinite(value) ? value : null;
}

// A <input type="date"> silently renders nothing for a non-ISO value while
// React state keeps the bad string, which reads as "field is empty but Save is
// enabled". Anything the model returns is checked before it reaches state.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null | undefined): value is string {
    if (!value || !ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------
// Shared shaping
// ---------------------------------------------------------------------------

export function groupPacksByItem(packs: PackConversion[]): Map<string, PackConversion[]> {
    const map = new Map<string, PackConversion[]>();
    for (const pack of packs) {
        const list = map.get(pack.item_id);
        if (list) list.push(pack);
        else map.set(pack.item_id, [pack]);
    }
    return map;
}
