import type React from 'react';

// Matches the admin dashboard's existing dark palette so the new tab does not
// look bolted on: #111 page, #1a1a1a panels, #222/#333 borders, #f0b427 accent.
export const iv: Record<string, React.CSSProperties> = {
    wrap: { display: 'flex', flexDirection: 'column', gap: 16 },

    subTabs: { display: 'flex', gap: 8, borderBottom: '1px solid #222', paddingBottom: 12 },
    subTab: {
        padding: '8px 16px',
        background: 'transparent',
        border: '1px solid #333',
        borderRadius: 8,
        color: '#999',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
    },
    // Full shorthand rather than borderColor: React warns when a rerender swaps
    // between the shorthand above and a longhand override, and the tab bar
    // rerenders on every click.
    subTabActive: { background: 'rgba(240,180,39,0.12)', border: '1px solid #f0b427', color: '#f0b427' },

    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    sectionTitle: { fontSize: 16, fontWeight: 700, color: '#eee', margin: 0 },
    hint: { fontSize: 12, color: '#666', margin: 0, lineHeight: 1.5 },

    card: { background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 16 },

    btn: {
        padding: '8px 16px',
        background: '#f0b427',
        border: 'none',
        borderRadius: 8,
        color: '#111',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
    },
    btnGhost: {
        padding: '8px 16px',
        background: 'transparent',
        border: '1px solid #333',
        borderRadius: 8,
        color: '#999',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
    },
    btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },

    input: {
        padding: '8px 10px',
        background: '#111',
        border: '1px solid #333',
        borderRadius: 6,
        color: '#eee',
        fontSize: 13,
        fontFamily: 'Inter, sans-serif',
        width: '100%',
        boxSizing: 'border-box',
    },
    label: { fontSize: 11, color: '#777', display: 'block', marginBottom: 4, letterSpacing: 0.4 },
    field: { display: 'flex', flexDirection: 'column', minWidth: 0 },
    fieldRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 },

    tableWrap: { overflowX: 'auto', border: '1px solid #222', borderRadius: 10 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 },
    th: {
        textAlign: 'left',
        padding: '10px 10px',
        color: '#777',
        fontWeight: 600,
        borderBottom: '1px solid #222',
        background: '#151515',
        whiteSpace: 'nowrap',
        fontSize: 11,
        letterSpacing: 0.4,
    },
    td: { padding: '8px 10px', color: '#ccc', borderBottom: '1px solid #1e1e1e', verticalAlign: 'middle' },
    tdMono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#888' },

    badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4 },
    badgeOk: { background: 'rgba(34,197,94,0.15)', color: '#22c55e' },
    badgeWarn: { background: 'rgba(234,179,8,0.15)', color: '#eab308' },
    badgeBad: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
    badgeInfo: { background: 'rgba(96,165,250,0.15)', color: '#60a5fa' },

    dropZone: {
        border: '2px dashed #333',
        borderRadius: 12,
        padding: 32,
        textAlign: 'center',
        color: '#777',
        cursor: 'pointer',
        background: '#141414',
    },
    dropZoneActive: { border: '2px dashed #f0b427', background: 'rgba(240,180,39,0.06)' },

    warnBox: {
        background: 'rgba(234,179,8,0.08)',
        border: '1px solid rgba(234,179,8,0.3)',
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        color: '#eab308',
        lineHeight: 1.6,
    },
    errBox: {
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        color: '#ef4444',
        lineHeight: 1.6,
    },
    okBox: {
        background: 'rgba(34,197,94,0.08)',
        border: '1px solid rgba(34,197,94,0.3)',
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        color: '#22c55e',
        lineHeight: 1.6,
    },

    empty: { padding: 32, textAlign: 'center', color: '#555', fontSize: 13 },
    preview: { maxHeight: 220, borderRadius: 8, border: '1px solid #333', display: 'block' },
};

// One colour per ledger reason, shared by every screen that lists movements so
// "waste" is the same red on the waste log and on the monthly report.
export const REASON_COLOUR: Record<string, string> = {
    purchase: '#22c55e',
    opening: '#22c55e',
    sale: '#60a5fa',
    count: '#a78bfa',
    waste: '#ef4444',
    staff_meal: '#eab308',
    comp: '#eab308',
    transfer_out: '#eab308',
    adjustment: '#f0b427',
};
