import React, { useState, useEffect } from 'react';
import { Search, Loader2, PackageCheck, PackageX, Globe, User, Image as ImageIcon, MessagesSquare } from 'lucide-react';
import { api } from '../../services/api';

// ─── Payload shape of the backend SSE event `wa_medicine_match` ──────────────
// Broadcast by src/services/whatsappIntentService.ts after its pipeline:
// noise-word stripped candidates → local DB match → stock check → catalog +
// ONE live Pharmarack search (already done server-side before broadcast).
interface PrHit {
  name?: string;
  productName?: string;
  mrp?: number | null;
  rate?: number | null;
  distributor?: string;
  mapped?: boolean;
  score?: number;
}

interface RelatedMedicine { name: string; registered: boolean; inventoryStock: number }

interface WaMatchRow {
  customerName: string;
  customerPhone: string;
  isNewCustomer: boolean;
  medicineName: string;
  quantity: string;
  dosageForm: string;
  localMatches: string[];
  inventoryStock: Record<string, number>;
  availability: string;
  productKind: string;
  confidence: number;
  source: string;
  messageBody: string;
  pharmaHits: PrHit[];
  mediaId: string;
  relatedMedicines: RelatedMedicine[];
  ts: number;
}

interface WaCustomerInfo { id?: number; name?: string; phone?: string }

// Module-level feed buffer (SPA contract): survives tab switches within session.
const feedCache: WaMatchRow[] = [];
const FEED_CAP = 50;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const normalizeHit = (raw: unknown): PrHit => {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const mrp = r.mrp;
  const rate = r.rate;
  return {
    name: str(r.name) || str(r.productName),
    productName: str(r.productName),
    mrp: typeof mrp === 'number' ? mrp : null,
    rate: typeof rate === 'number' ? rate : null,
    distributor: str(r.distributor),
    mapped: r.mapped === true,
    score: typeof r.score === 'number' ? r.score : undefined,
  };
};

// Module-level helper (react-compiler purity): stamps time and prepends to cache.
const recordIncomingMatch = (frame: unknown): void => {
  if (!frame || typeof frame !== 'object') return;
  const f = frame as Record<string, unknown>;
  const customer = (f.customer && typeof f.customer === 'object' ? f.customer : {}) as WaCustomerInfo;
  const rawMatches = Array.isArray(f.localMatches) ? f.localMatches.filter((m): m is string => typeof m === 'string') : [];
  const stock: Record<string, number> = {};
  if (f.inventoryStock && typeof f.inventoryStock === 'object') {
    Object.entries(f.inventoryStock as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'number') stock[k.toLowerCase()] = v;
    });
  }
  const qtyRaw = f.quantity;
  const quantity = typeof qtyRaw === 'number' || typeof qtyRaw === 'string'
    ? `${String(qtyRaw).trim()}${str(f.unit) ? ` ${str(f.unit)}` : ''}`.trim()
    : '';
  const pharmaHits = Array.isArray(f.livePharmarackResults)
    ? f.livePharmarackResults.slice(0, 6).map(normalizeHit)
    : [];
  const relatedRaw = Array.isArray(f.relatedMedicines) ? f.relatedMedicines : [];
  const relatedMedicines: RelatedMedicine[] = relatedRaw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .slice(0, 4)
    .map((r) => ({
      name: str(r.name),
      registered: r.registered === true,
      inventoryStock: num(r.inventoryStock),
    }))
    .filter((r) => r.name);
  feedCache.unshift({
    customerName: str(customer.name),
    customerPhone: str(customer.phone),
    isNewCustomer: f.isNewCustomer === true,
    medicineName: str(f.medicineName),
    quantity,
    dosageForm: str(f.dosageForm),
    localMatches: rawMatches.slice(0, 8),
    inventoryStock: stock,
    availability: str(f.availability),
    productKind: str(f.productKind),
    confidence: num(f.confidence),
    source: str(f.source) || 'text',
    messageBody: str(f.messageBody),
    pharmaHits,
    mediaId: typeof f.mediaId === 'string' || typeof f.mediaId === 'number' ? String(f.mediaId) : '',
    relatedMedicines,
    ts: Date.now(),
  });
  if (feedCache.length > FEED_CAP) feedCache.length = FEED_CAP;
};

const AVAIL_BADGE: Record<string, { cls: string; label: string }> = {
  IN_STOCK: { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'In Stock' },
  REGISTERED_NO_STOCK: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Registered · Not In Physical Stock' },
  EXTERNAL_ONLY: { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30', label: 'Not Registered · External Only' },
};

// Non-allopathic kinds (backend detectNonAllopathicKind) — shown as a neutral
// info badge; external Pharmarack searches were deliberately skipped for these.
const KIND_LABEL: Record<string, string> = {
  cosmetic: 'Cosmetic / Personal Care',
  ayurvedic: 'Ayurvedic',
  homeopathy: 'Homeopathy',
};

const availabilityBadge = (row: WaMatchRow): { cls: string; label: string } => {
  if (row.availability === 'NON_ALLOPATHIC') {
    const kind = KIND_LABEL[row.productKind] || 'Non-Allopathic';
    return { cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30', label: `Non-Allopathic · ${kind}` };
  }
  return AVAIL_BADGE[row.availability] ?? {
    cls: 'bg-bg3 text-muted border-glass-border',
    label: row.availability || 'Unknown',
  };
};

const timeAgo = (ts: number): string => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

// Module-level thumbnail cache: one network fetch per shared photo, ever.
const waMediaCache = new Map<string, string>();
const getCachedWaMedia = (id: string): string | null => waMediaCache.get(id) || null;
const cacheWaMedia = (id: string, dataUrl: string): void => { waMediaCache.set(id, dataUrl); };

const WaThumb: React.FC<{ mediaId: string }> = ({ mediaId }) => {
  const [fetched, setFetched] = useState<string | null>(null);
  // Cached hits derive during render — only real network results use state.
  const cached = mediaId ? getCachedWaMedia(mediaId) : null;
  const src = cached ?? fetched;

  useEffect(() => {
    if (!mediaId || getCachedWaMedia(mediaId)) return;
    let alive = true;
    api.getWaMedia(mediaId)
      .then((m) => {
        const dataUrl = `data:${m.mimetype || 'image/jpeg'};base64,${m.data}`;
        cacheWaMedia(mediaId, dataUrl);
        if (alive) setFetched(dataUrl);
      })
      .catch(() => { /* photo stays hidden — a failed fetch is never fabricated */ });
    return () => { alive = false; };
  }, [mediaId]);

  if (!src) return null;
  return (
    <img
      src={src}
      alt="Shared medicine strip"
      className="w-full max-h-52 object-contain rounded-xl border border-glass-border bg-bg3/40"
    />
  );
};

const WaMatchCard: React.FC<{ row: WaMatchRow }> = ({ row }) => {
  const avail = availabilityBadge(row);
  return (
    <div className="bg-bg2 border border-glass-border rounded-2xl p-4 space-y-3">
      {/* Patient + request */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
          <User size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-text">{row.customerName || 'Unknown sender'}</span>
            {row.customerPhone && <span className="text-[11px] text-muted font-mono">{row.customerPhone}</span>}
            {row.isNewCustomer && (
              <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30 text-[9px] font-black uppercase">New</span>
            )}
            {row.source === 'image' && <span title="Photo request" className="inline-flex"><ImageIcon size={12} className="text-muted" /></span>}
          </div>
          {row.messageBody && (
            <p className="text-xs text-muted mt-1 truncate italic">&ldquo;{row.messageBody}&rdquo;</p>
          )}
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wide border ${avail.cls}`}>
          {avail.label}
        </span>
      </div>

      {/* Shared photo (when the request came with an image) */}
      <WaThumb mediaId={row.mediaId} />

      {/* Medicine asked */}
      <div className="flex items-center gap-2 flex-wrap">
        <PackageCheck size={16} className="text-emerald-400 shrink-0" />
        <span className="text-base font-bold text-text">{row.medicineName || '—'}</span>
        {row.quantity && <span className="text-sm font-bold text-primary">× {row.quantity}</span>}
        {row.dosageForm && <span className="text-xs px-2 py-0.5 rounded-full bg-bg3 text-muted border border-glass-border uppercase">{row.dosageForm}</span>}
        {row.confidence > 0 && (
          <span className="ml-auto text-xs font-mono text-muted">match {row.confidence}%</span>
        )}
      </div>

      {/* Extra medicines seen on the same strip / caption — resolved
          LOCAL-ONLY by the pipeline, never re-searched from here */}
      {row.relatedMedicines.length > 0 && (
        <div>
          <p className="text-xs font-bold text-muted uppercase tracking-wider mb-1.5">Also on this strip</p>
          <div className="flex flex-wrap gap-1.5">
            {row.relatedMedicines.map((r) => {
              const cls = !r.registered
                ? 'bg-bg3 text-muted border-glass-border'
                : r.inventoryStock > 0
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
              const label = !r.registered
                ? `${r.name} · not registered`
                : r.inventoryStock > 0
                  ? `${r.name} · ${r.inventoryStock} in stock`
                  : `${r.name} · 0 on shelf`;
              return (
                <span key={r.name} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
                  {r.registered && r.inventoryStock > 0 ? <PackageCheck size={10} /> : <PackageX size={10} />}
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Registered-in-app matches with real shelf stock */}
      {row.localMatches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {row.localMatches.map((m) => {
            const stock = row.inventoryStock[m.toLowerCase()] ?? 0;
            return (
              <span
                key={m}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  stock > 0
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-bg3 text-muted border-glass-border'
                }`}
                title={`Shelf stock: ${stock}`}
              >
                {stock > 0 ? <PackageCheck size={10} /> : <PackageX size={10} />}
                {m} · {stock} in stock
              </span>
            );
          })}
        </div>
      )}

      {/* Pharmarack comparison — already fetched once by the intent pipeline */}
      {row.pharmaHits.length > 0 && (
        <div className="rounded-xl border border-glass-border overflow-hidden">
          <div className="px-3 py-2 bg-bg3/60 flex items-center gap-1.5 text-[10px] font-bold text-muted uppercase tracking-wider">
            <Globe size={11} className="text-violet-400" /> Pharmarack availability
          </div>
          <ul className="divide-y divide-glass-border">
            {row.pharmaHits.map((h, i) => (
              <li key={`${h.name}-${i}`} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-text min-w-0 truncate flex-1">{h.name || h.productName}</span>
                {h.mapped && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px] font-black uppercase">Mapped</span>
                )}
                {h.rate != null && h.rate > 0 && <span className="text-[10px] text-muted">PTR ₹{h.rate.toFixed(2)}</span>}
                {h.mrp != null && h.mrp > 0 && <span className="text-[10px] font-bold text-text">MRP ₹{h.mrp.toFixed(2)}</span>}
                {h.distributor && <span className="text-[10px] text-muted truncate max-w-[140px]">{h.distributor}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[9px] text-muted/70">{timeAgo(row.ts)}</p>
    </div>
  );
};

const WaRequestsPanel: React.FC = () => {
  const [rows, setRows] = useState<WaMatchRow[]>(feedCache);
  // One-shot manual lookup: exactly ONE searchPharmarack call per explicit click.
  const [lookupQ, setLookupQ] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState('');
  interface LookupHit { name?: string; productName?: string; mrp?: number | null; rate?: number | null; distributor?: string }
  const [lookupHits, setLookupHits] = useState<LookupHit[]>([]);
  const [lastLookupTerm, setLastLookupTerm] = useState('');

  useEffect(() => {
    const onMatch = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      recordIncomingMatch(detail);
      setRows(feedCache.slice());
    };
    window.addEventListener('sse-wa-medicine-match', onMatch);
    return () => window.removeEventListener('sse-wa-medicine-match', onMatch);
  }, []);

  const handleLookup = async () => {
    const q = lookupQ.trim();
    if (q.length < 2 || lookupBusy) return;
    setLookupBusy(true);
    setLookupError('');
    try {
      const results = await api.searchPharmarack(q);
      setLookupHits(Array.isArray(results) ? results.slice(0, 8) : []);
      setLastLookupTerm(q);
    } catch (err) {
      console.error('Manual Pharmarack lookup failed:', err);
      setLookupError('Lookup failed — check Pharmarack connection. No retry was attempted.');
    } finally {
      setLookupBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      {/* Panel header strip */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-text tracking-tight flex items-center gap-2 flex-wrap">
            WA Medicine Requests
            <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Live
            </span>
          </h2>
          <p className="text-xs text-muted mt-1 max-w-2xl">
            Every WhatsApp customer request is scanned automatically: filler words are skipped, the medicine is matched
            against your registered master + shelf stock, and compared against Pharmarack — all in ONE pass per message.
            Cosmetic / personal-care, Ayurvedic and Homeopathy products are labeled <span className="text-violet-400 font-bold">Non-Allopathic</span> and
            deliberately skip the Pharmarack comparison instead of producing unmatched noise.
            Results appear here the moment the message arrives; nothing is re-searched behind your back.
          </p>
        </div>
      </div>

      {/* Manual one-shot lookup */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleLookup(); }}
        className="p-4 bg-bg2 border border-glass-border rounded-2xl"
      >
        <label className="block text-[10px] font-bold text-muted uppercase mb-2">
          Quick Pharmarack Lookup (one search per click — no auto-retry)
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Paste medicine name from any chat (min 2 letters)"
              value={lookupQ}
              onChange={(e) => setLookupQ(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>
          <button
            type="submit"
            disabled={lookupBusy || lookupQ.trim().length < 2}
            className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-text text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-violet-500/20"
          >
            {lookupBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search Once
          </button>
        </div>

        {lookupError && (
          <p className="text-[11px] text-red-400 mt-2">{lookupError}</p>
        )}

        {!lookupError && lastLookupTerm && (
          <div className="mt-3 rounded-xl border border-glass-border overflow-hidden">
            <div className="px-3 py-2 bg-bg3/60 text-[10px] font-bold text-muted uppercase tracking-wider">
              Results for &ldquo;{lastLookupTerm}&rdquo;
            </div>
            {lookupHits.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted">No Pharmarack product matched this name.</p>
            ) : (
              <ul className="divide-y divide-glass-border">
                {lookupHits.map((h, i) => (
                  <li key={`${h.name}-${i}`} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-text min-w-0 truncate flex-1">{h.name || h.productName}</span>
                    {h.rate != null && h.rate > 0 && <span className="text-[10px] text-muted">PTR ₹{h.rate.toFixed(2)}</span>}
                    {h.mrp != null && h.mrp > 0 && <span className="text-[10px] font-bold text-text">MRP ₹{h.mrp.toFixed(2)}</span>}
                    {h.distributor && <span className="text-[10px] text-muted truncate max-w-[160px]">{h.distributor}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      {/* Live feed */}
      {rows.length === 0 ? (
        <div className="py-16 text-center">
          <MessagesSquare size={32} className="mx-auto text-muted mb-3" />
          <p className="text-xs text-muted font-semibold">Waiting for WhatsApp medicine requests…</p>
          <p className="text-[11px] text-muted/70 mt-1">
            When a patient sends a medicine name or photo on WhatsApp, the parsed result lands here instantly.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => <WaMatchCard key={`${row.ts}-${row.medicineName}`} row={row} />)}
        </div>
      )}
    </div>
  );
};

export default WaRequestsPanel;
