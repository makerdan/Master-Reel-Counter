import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2, ChevronDown, ChevronUp, X, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, Info, Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { Entry, Photo, Pin, ReviewResponse } from "@shared/schema";
import { toDisplayUnit, unitLabel } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TallyRow {
  catalog: string;
  vendorCode: string;
  totalReels: number;
  totalFootage: number;
  locations: { aisle: string; section: string; reelCount: number; footage: number | null; pinLabel?: string; photoId?: number; pinId?: number }[];
}

interface InventoryRow {
  catalog: string;
  vendorCode: string;
  reelCount: number;
  footage: number;
}

type MatchStatus = "match" | "discrepancy" | "unmatched";

interface ComparedRow extends TallyRow {
  status: MatchStatus;
  invReelCount?: number;
  invFootage?: number;
}

// ─── Column detection heuristic ──────────────────────────────────────────────

function detectColumn(headers: string[], keywords: string[]): number {
  const lower = headers.map(h => (h ?? "").toString().toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex(h => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseInventorySheet(rows: any[][]): InventoryRow[] {
  if (!rows.length) return [];
  const headerRow = rows[0].map(c => (c ?? "").toString());
  const catIdx = detectColumn(headerRow, ["category", "description", "wire type", "catalog", "item", "wire"]);
  const vendorIdx = detectColumn(headerRow, ["vendor code", "vendor_code", "vendorcode", "vendor", "manufacturer", "mfr"]);
  const reelIdx = detectColumn(headerRow, ["reel count", "reel_count", "reelcount", "reels", "quantity", "qty", "count", "reel"]);
  const footageIdx = detectColumn(headerRow, ["footage", "feet", "length (ft)", "length", "meters"]);

  const results: InventoryRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c == null || c === "")) continue;
    const catalog = catIdx >= 0 ? (row[catIdx] ?? "").toString().trim() : "";
    const vendorCode = vendorIdx >= 0 ? (row[vendorIdx] ?? "").toString().trim() : "";
    const reelCount = reelIdx >= 0 ? Number(row[reelIdx]) || 0 : 0;
    const footage = footageIdx >= 0 ? Number(row[footageIdx]) || 0 : 0;
    if (!catalog && !vendorCode) continue;
    results.push({ catalog, vendorCode, reelCount, footage });
  }
  return results;
}

// ─── LocationList (collapsible) ──────────────────────────────────────────────

function LocationList({ locations, currentUnit, onPinClick }: {
  locations: TallyRow["locations"];
  currentUnit: UnitType;
  onPinClick?: (photoId: number, pinId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const uLabel = unitLabel(currentUnit);
  if (!locations.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(o => !o)}
        data-testid="button-toggle-locations"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {locations.length} location{locations.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-1">
          {[...locations].sort((a, b) => {
            const aisleA = isNaN(Number(a.aisle)) ? a.aisle : String(Number(a.aisle)).padStart(10, "0");
            const aisleB = isNaN(Number(b.aisle)) ? b.aisle : String(Number(b.aisle)).padStart(10, "0");
            const ac = aisleA.localeCompare(aisleB);
            if (ac !== 0) return ac;
            const secA = isNaN(Number(a.section)) ? a.section : String(Number(a.section)).padStart(10, "0");
            const secB = isNaN(Number(b.section)) ? b.section : String(Number(b.section)).padStart(10, "0");
            return secA.localeCompare(secB);
          }).map((loc, i) => {
            const label = `${loc.pinLabel ? `${loc.pinLabel} — ` : ""}Aisle ${loc.aisle} / Sec ${loc.section}${loc.reelCount > 1 ? ` ×${loc.reelCount}` : ""}${loc.footage != null ? ` — ${toDisplayUnit(loc.footage, currentUnit).toLocaleString()} ${uLabel}` : ""}`;
            const canLink = onPinClick && loc.photoId != null && loc.pinId != null;
            return (
              <li key={i} className="text-xs font-mono">
                {canLink ? (
                  <button
                    className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 cursor-pointer transition-colors text-left"
                    onClick={() => onPinClick!(loc.photoId!, loc.pinId!)}
                    data-testid={`link-pin-location-${i}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="text-muted-foreground">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MatchStatus | null }) {
  if (!status) return null;
  if (status === "match") return (
    <Badge className="bg-green-600/20 text-green-700 dark:text-green-400 border border-green-600/30 text-[10px]" data-testid="badge-match">
      <CheckCircle2 className="h-3 w-3 mr-0.5" /> Match
    </Badge>
  );
  if (status === "discrepancy") return (
    <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[10px]" data-testid="badge-discrepancy">
      <AlertTriangle className="h-3 w-3 mr-0.5" /> Differs
    </Badge>
  );
  return (
    <Badge className="bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/30 text-[10px]" data-testid="badge-unmatched">
      <XCircle className="h-3 w-3 mr-0.5" /> Unmatched
    </Badge>
  );
}

// ─── DropZone ────────────────────────────────────────────────────────────────

function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      data-testid="dropzone-inventory"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        className="hidden"
        onChange={handleChange}
        data-testid="input-inventory-file"
      />
      <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
      <p className="text-sm font-medium mb-1">Upload inventory spreadsheet</p>
      <p className="text-xs text-muted-foreground">Drag and drop or click to select</p>
      <p className="text-xs text-muted-foreground mt-1">Accepts .csv, .tsv, .txt (Excel not supported)</p>
    </div>
  );
}

// ─── FinalResultsTab ─────────────────────────────────────────────────────────

export default function FinalResultsTab({
  sessionId, entries, photos, onJumpToPin, onSwitchToFlagged, onSwitchToReview,
}: {
  sessionId: number;
  entries: Entry[];
  photos: Photo[];
  onJumpToPin?: (photoId: number, pinId: number) => void;
  onSwitchToFlagged?: (section: "pins" | "review") => void;
  onSwitchToReview?: () => void;
}) {
  const { toast } = useToast();

  const { data: settings } = useQuery<{ defaultUnit: string }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({ defaultUnit: data?.defaultUnit ?? "feet" }),
  });
  const currentUnit: UnitType = (settings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
    enabled: sessionId > 0,
  });

  const { data: reviewResponses = [] } = useQuery<ReviewResponse[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "review-responses"],
    enabled: sessionId > 0,
  });

  const reviewStats = useMemo(() => {
    const pinFlaggedEntryIds = new Set<number>();
    for (const p of sessionPins) {
      if (p.entryId && p.flagged) pinFlaggedEntryIds.add(p.entryId);
    }
    const reviewableEntries = entries.filter(e => {
      if (pinFlaggedEntryIds.has(e.id)) return false;
      if (e.notes && e.notes.includes("[Resolved from flag")) return false;
      return true;
    });
    const total = reviewableEntries.length;
    const reviewedIds = new Set(reviewResponses.map(r => r.entryId));
    const notReviewed = reviewableEntries.filter(e => !reviewedIds.has(e.id)).length;
    const pinFlagged = sessionPins.filter(p => p.flagged).length;
    const reviewFlagged = new Set(reviewResponses.filter(r => r.verdict === "flagged").map(r => r.entryId)).size;
    return { total, notReviewed, pinFlagged, reviewFlagged };
  }, [entries, reviewResponses, sessionPins]);

  const photoMap = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);

  const entryMap = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);

  const tallyRows = useMemo<TallyRow[]>(() => {
    const map = new Map<string, TallyRow>();
    for (const pin of sessionPins) {
      const entry = pin.entryId ? entryMap.get(pin.entryId) : undefined;
      const pinWire = (pin.wireDetails || "").trim();
      const entryWire = (entry?.reelTag || "").trim() || (entry?.wireType || "").trim();
      const catalog = pinWire || entryWire || "(uncataloged)";
      const pinVendor = (pin.vendorCode || "").trim();
      const entryVendor = (entry?.manufacturer || "").trim();
      const vendorCode = pinVendor || entryVendor || "";
      const key = `${catalog}|||${vendorCode}`;
      const photo = photoMap.get(pin.photoId);
      const aisle = photo?.aisle || "";
      const section = photo?.section || "";
      const reelCount = pin.reelCount ?? entry?.reelCount ?? 1;
      const footage = pin.footage ?? entry?.footage ?? null;

      if (!map.has(key)) {
        map.set(key, { catalog, vendorCode, totalReels: 0, totalFootage: 0, locations: [] });
      }
      const row = map.get(key)!;
      row.totalReels += reelCount;
      row.totalFootage += (footage != null ? footage * reelCount : 0);
      const pinLabel = pin.label ? `Pin ${pin.label}` : undefined;
      const locExtra = { photoId: pin.photoId, pinId: pin.id };
      row.locations.push({ aisle, section, reelCount, footage, ...(pinLabel !== undefined ? { pinLabel } : {}), ...locExtra });
    }

    return Array.from(map.values()).sort((a, b) => {
      const cc = a.catalog.localeCompare(b.catalog);
      if (cc !== 0) return cc;
      return a.vendorCode.localeCompare(b.vendorCode);
    });
  }, [sessionPins, photoMap, entryMap]);

  const [inventoryRows, setInventoryRows] = useState<InventoryRow[] | null>(null);
  const [inventoryFileName, setInventoryFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      const text = await file.text();
      const delimiter = text.includes("\t") ? "\t" : ",";
      const rows: any[][] = text.split(/\r?\n/).map(line =>
        line.split(delimiter).map(cell => cell.replace(/^"|"$/g, "").replace(/""/g, '"'))
      ).filter(row => row.some(cell => cell.trim() !== ""));
      const parsed = parseInventorySheet(rows);
      if (!parsed.length) {
        toast({ title: "No data found", description: "Could not detect usable rows in the spreadsheet.", variant: "destructive" });
        return;
      }
      setInventoryRows(parsed);
      setInventoryFileName(file.name);
      toast({ title: "File loaded", description: `${parsed.length} inventory rows parsed from "${file.name}"` });
    } catch (err) {
      toast({ title: "Failed to parse file", description: String(err), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }, [toast]);

  const clearInventory = () => {
    setInventoryRows(null);
    setInventoryFileName(null);
  };

  const comparedRows = useMemo<ComparedRow[]>(() => {
    if (!inventoryRows) return tallyRows.map(r => ({ ...r, status: "unmatched" as MatchStatus }));

    const invMap = new Map<string, InventoryRow>();
    for (const inv of inventoryRows) {
      const key = `${inv.catalog.trim()}|||${inv.vendorCode.trim()}`;
      invMap.set(key, inv);
    }

    const sessionKeys = new Set<string>();
    const result: ComparedRow[] = tallyRows.map(row => {
      const key = `${row.catalog}|||${row.vendorCode}`;
      sessionKeys.add(key);
      const inv = invMap.get(key);
      if (!inv) return { ...row, status: "unmatched" };
      const reelMatch = inv.reelCount === row.totalReels;
      // Footage: treat as matching only when both sides have data and values are equal.
      // If either side has no footage data (0 or missing), mark as discrepancy rather than silently matching.
      const sessionHasFootage = row.totalFootage > 0;
      const invHasFootage = inv.footage > 0;
      const footageMatch = sessionHasFootage && invHasFootage
        ? inv.footage === row.totalFootage
        : !sessionHasFootage && !invHasFootage;
      const status: MatchStatus = reelMatch && footageMatch ? "match" : "discrepancy";
      return { ...row, status, invReelCount: inv.reelCount, invFootage: inv.footage };
    });

    for (const inv of inventoryRows) {
      const key = `${inv.catalog.trim()}|||${inv.vendorCode.trim()}`;
      if (!sessionKeys.has(key)) {
        result.push({
          catalog: inv.catalog,
          vendorCode: inv.vendorCode,
          totalReels: 0,
          totalFootage: 0,
          locations: [],
          status: "unmatched",
          invReelCount: inv.reelCount,
          invFootage: inv.footage,
        });
      }
    }

    return result;
  }, [inventoryRows, tallyRows]);

  const summaryStats = useMemo(() => {
    if (!inventoryRows) return null;
    const matched = comparedRows.filter(r => r.status === "match").length;
    const discrepancy = comparedRows.filter(r => r.status === "discrepancy").length;
    const unmatched = comparedRows.filter(r => r.status === "unmatched").length;
    return { matched, discrepancy, unmatched };
  }, [inventoryRows, comparedRows]);

  const rowBg = (status: MatchStatus) => {
    if (!inventoryRows) return "";
    if (status === "match") return "bg-green-500/8 dark:bg-green-500/10";
    if (status === "discrepancy") return "bg-amber-500/8 dark:bg-amber-500/10";
    return "bg-red-500/8 dark:bg-red-500/10";
  };

  const incompleteCount = useMemo(
    () => entries.filter(e =>
      (!(e.reelTag ?? "").trim() && !(e.wireType ?? "").trim()) || !e.footage
    ).length,
    [entries],
  );

  // Track which count value was dismissed so the notice re-appears if new
  // incomplete entries are introduced (i.e. the count grows or resets to >0).
  const [dismissedForCount, setDismissedForCount] = useState<number | null>(null);
  const incompleteNoticeDismissed = dismissedForCount === incompleteCount && incompleteCount > 0;

  return (
    <div className="p-3 sm:p-4 space-y-6" data-testid="final-results-tab">
      <h2 className="text-lg font-bold underline text-center" data-testid="heading-final-results">Final Results</h2>

      {/* ── Review Status Banner ─────────────────────────────────────────── */}
      {reviewStats.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-blue-300 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-900/30 px-4 py-2.5" data-testid="final-results-review-banner">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-white/70 shrink-0" />
            <span className="text-sm text-blue-900 dark:text-white">Not yet reviewed:</span>
            {reviewStats.notReviewed > 0 && onSwitchToReview ? (
              <button
                onClick={() => onSwitchToReview()}
                className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400 underline hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
                data-testid="stat-not-reviewed"
              >
                {reviewStats.notReviewed}
              </button>
            ) : (
              <span className={`text-sm font-semibold tabular-nums underline ${reviewStats.notReviewed > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`} data-testid="stat-not-reviewed">
                {reviewStats.notReviewed}
              </span>
            )}
            <span className="text-sm text-blue-800/80 dark:text-white/80">/ {reviewStats.total}</span>
          </div>
          <div className="w-px h-4 bg-blue-300 dark:bg-blue-700/40 hidden sm:block" />
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-white/70 shrink-0" />
            <span className="text-sm text-blue-900 dark:text-white">Flagged (pins):</span>
            {reviewStats.pinFlagged > 0 && onSwitchToFlagged ? (
              <button
                onClick={() => onSwitchToFlagged("pins")}
                className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400 underline hover:text-red-700 dark:hover:text-red-300 cursor-pointer"
                data-testid="stat-flagged"
              >
                {reviewStats.pinFlagged}
              </button>
            ) : (
              <span className={`text-sm font-semibold tabular-nums underline ${reviewStats.pinFlagged > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} data-testid="stat-flagged">
                {reviewStats.pinFlagged}
              </span>
            )}
          </div>
          <div className="w-px h-4 bg-blue-300 dark:bg-blue-700/40 hidden sm:block" />
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-blue-600 dark:text-white/70 shrink-0" />
            <span className="text-sm text-blue-900 dark:text-white">Flagged (review):</span>
            {reviewStats.reviewFlagged > 0 && onSwitchToFlagged ? (
              <button
                onClick={() => onSwitchToFlagged("review")}
                className="text-sm font-semibold tabular-nums text-yellow-600 dark:text-yellow-400 underline hover:text-yellow-700 dark:hover:text-yellow-300 cursor-pointer"
                data-testid="stat-review-flagged"
              >
                {reviewStats.reviewFlagged}
              </button>
            ) : (
              <span className={`text-sm font-semibold tabular-nums underline ${reviewStats.reviewFlagged > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`} data-testid="stat-review-flagged">
                {reviewStats.reviewFlagged}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Incomplete Data Notice ───────────────────────────────────────── */}
      {incompleteCount > 0 && !incompleteNoticeDismissed && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-amber-400 bg-amber-500/10 px-4 py-3"
          data-testid="banner-final-results-incomplete"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {incompleteCount} {incompleteCount === 1 ? "entry is" : "entries are"} missing a wire type or footage
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              These entries may appear as "(uncataloged)" in the tally below. Edit them in the Entry Table to complete the data.
            </p>
            <button
              onClick={() => {
                document.getElementById("section-entry-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300 transition-colors"
              data-testid="button-goto-entry-table"
            >
              Go to Entry Table ↓
            </button>
          </div>
          <button
            onClick={() => setDismissedForCount(incompleteCount)}
            className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors shrink-0"
            aria-label="Dismiss"
            data-testid="button-dismiss-incomplete-notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Tally Table ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Session Count Tally</h2>
          <Badge variant="outline" className="text-xs">{tallyRows.length} catalog entries</Badge>
        </div>

        {tallyRows.length === 0 ? (
          <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground text-sm" data-testid="text-no-tally">
            No pins recorded in this session yet.
          </div>
        ) : (
          <div className="border border-blue-500 sm:border-blue-600/50 rounded-lg overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-tally">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-2 font-medium underline sm:no-underline after:content-[':'] sm:after:content-['']">Catalog</th>
                  <th className="hidden sm:table-cell text-left p-2 font-medium">Vendor</th>
                  <th className="hidden sm:table-cell text-right p-2 font-medium">Reels</th>
                  <th className="text-right p-2 font-medium whitespace-nowrap underline sm:no-underline">
                    <span className="sm:hidden">Total Footage:</span>
                    <span className="hidden sm:inline">Footage ({uLabel})</span>
                  </th>
                  {inventoryRows && <th className="text-right p-2 font-medium underline sm:no-underline after:content-[':'] sm:after:content-['']">Inv. Reels</th>}
                  {inventoryRows && <th className="text-right p-2 font-medium whitespace-nowrap underline sm:no-underline after:content-[':'] sm:after:content-['']">Inv. Footage</th>}
                  {inventoryRows && <th className="p-2 font-medium underline sm:no-underline after:content-[':'] sm:after:content-['']">Status</th>}
                  <th className="text-left p-2 font-medium underline sm:no-underline after:content-[':'] sm:after:content-['']">Locations</th>
                </tr>
              </thead>
              <tbody>
                {comparedRows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border last:border-0 ${rowBg(row.status)}`}
                    data-testid={`row-tally-${i}`}
                  >
                    <td className="p-2 font-mono font-medium" data-testid={`text-catalog-${i}`}>
                      {row.catalog === "(uncataloged)" ? (
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground italic">(uncataloged)</span>
                          <span
                            title="Reels where the Wire Details field was left blank during counting"
                            className="inline-flex items-center text-muted-foreground/60 hover:text-muted-foreground"
                          >
                            <Info className="h-3 w-3" />
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="sm:hidden">{row.catalog}{row.vendorCode ? `-${row.vendorCode}` : ""}</span>
                          <span className="hidden sm:inline">{row.catalog}</span>
                        </>
                      )}
                    </td>
                    <td className="hidden sm:table-cell p-2 font-mono text-muted-foreground" data-testid={`text-vendor-${i}`}>{row.vendorCode || "—"}</td>
                    <td className="hidden sm:table-cell p-2 text-right font-mono" data-testid={`text-reels-${i}`}>{row.totalReels > 0 ? row.totalReels : "—"}</td>
                    <td className="p-2 text-right font-mono" data-testid={`text-footage-${i}`}>
                      {row.totalFootage > 0 ? toDisplayUnit(row.totalFootage, currentUnit).toLocaleString() : "—"}
                    </td>
                    {inventoryRows && (
                      <td className="p-2 text-right font-mono text-muted-foreground" data-testid={`text-inv-reels-${i}`}>
                        {row.invReelCount != null ? row.invReelCount : "—"}
                      </td>
                    )}
                    {inventoryRows && (
                      <td className="p-2 text-right font-mono text-muted-foreground" data-testid={`text-inv-footage-${i}`}>
                        {row.invFootage != null && row.invFootage > 0 ? toDisplayUnit(row.invFootage, currentUnit).toLocaleString() : "—"}
                      </td>
                    )}
                    {inventoryRows && (
                      <td className="p-2" data-testid={`text-status-${i}`}>
                        <StatusBadge status={row.status} />
                      </td>
                    )}
                    <td className="p-2">
                      {row.locations.length > 0 ? (
                        <LocationList
                          locations={row.locations}
                          currentUnit={currentUnit}
                          onPinClick={onJumpToPin}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Inventory Comparison Section ─────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Inventory Comparison</h2>
          </div>
          {inventoryRows && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={clearInventory}
              data-testid="button-clear-inventory"
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
        </div>

        {inventoryRows ? (
          <div className="space-y-3">
            {/* File info */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
              <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate" data-testid="text-inventory-filename">{inventoryFileName}</span>
              <span>·</span>
              <span>{inventoryRows.length} rows</span>
            </div>

            {/* Summary bar */}
            {summaryStats && (
              <div className="flex flex-wrap gap-2" data-testid="summary-bar">
                <div className="flex items-center gap-1.5 text-xs bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 rounded px-2 py-1" data-testid="summary-matched">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>{summaryStats.matched} matched</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded px-2 py-1" data-testid="summary-discrepancies">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{summaryStats.discrepancy} discrepancies</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 rounded px-2 py-1" data-testid="summary-unmatched">
                  <XCircle className="h-3 w-3" />
                  <span>{summaryStats.unmatched} unmatched</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Upload your master reel count spreadsheet to compare against the session tally. The file is parsed locally and not saved.
            </p>
            <DropZone onFile={handleFile} />
            {parsing && (
              <div className="text-center text-xs text-muted-foreground py-2" data-testid="text-parsing">
                Parsing file…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
