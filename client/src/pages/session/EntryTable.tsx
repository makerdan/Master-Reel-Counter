import { useState, useMemo, Fragment, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Eye, Pencil, Trash2, ChevronDown, AlertTriangle, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Cable } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { toDisplayUnit } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";
import type { Entry, Photo, Pin, ReviewResponse } from "@shared/schema";

type FilterChip = "flagged" | "incomplete" | "no-photo" | string;

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-700 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function EntryPhotoDialogContent({ src, entryId, pin }: {
  src: string;
  entryId: number;
  pin: { xPercent: number; yPercent: number } | undefined;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => { setImgLoaded(false); }, [src]);
  return (
    <div className="relative inline-block w-full">
      <img
        src={src}
        alt="Entry photo"
        className="w-full rounded-md"
        style={{ display: "block" }}
        data-testid={`img-entry-photo-${entryId}`}
        onLoad={() => setImgLoaded(true)}
      />
      {imgLoaded && pin && (
        <div
          className="absolute pointer-events-none"
          style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%`, transform: "translate(-50%, -50%)" }}
          data-testid={`pin-highlight-${entryId}`}
          ref={(el) => {
            if (el && !el.dataset.scrolled) {
              el.dataset.scrolled = "1";
              setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
            }
          }}
        >
          <div className="w-24 h-24 rounded-full animate-pulse opacity-100" style={{ border: "12px solid #f97316" }} />
          <div className="absolute inset-0 w-24 h-24 rounded-full border-2 border-white opacity-100" />
        </div>
      )}
    </div>
  );
}

function FilterChipButton({ label, active, count, onClick, testId }: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} filter${count !== undefined && count > 0 ? ` (${count})` : ""}${active ? ", active" : ""}`}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        active
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
      }`}
      data-testid={testId}
    >
      {label}
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className={`h-4 min-w-[16px] px-1 text-[10px] ${active ? "bg-blue-800 text-white" : ""}`}>
          {count}
        </Badge>
      )}
    </button>
  );
}

function EntryTable({
  entries, photos, onEdit, sessionId, totalFootage, onUndoableDelete, canEdit = true, forceExpandKey, exclusiveExpandKey, onJumpToPin, unitLabel: uLabel = "ft", currentUnit = "feet" as UnitType,
}: {
  entries: Entry[];
  photos: Photo[];
  onEdit: (entry: Entry) => void;
  sessionId: number;
  totalFootage: number;
  onUndoableDelete?: (action: any) => void;
  canEdit?: boolean;
  forceExpandKey?: string;
  exclusiveExpandKey?: string;
  onJumpToPin?: (photoId: number, pinId: number) => void;
  unitLabel?: string;
  currentUnit?: UnitType;
}) {
  const { toast } = useToast();
  const photoMap = new Map(photos.map(p => [p.id, p]));

  const { data: sessionPins = [], isFetching: pinsFetching } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
  });
  const pinByEntryId = new Map(sessionPins.filter(p => p.entryId).map(p => [p.entryId!, p]));

  const { data: reviewResponses = [] } = useQuery<ReviewResponse[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "review-responses"],
    enabled: sessionId > 0,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FilterChip>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: serverSearchData, isFetching: isSearchFetching, isError: isSearchError, refetch: refetchSearch } = useQuery<{ matches: { entryId: number; field: string; preview: string }[]; total: number; encryptionActive?: boolean }>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries", "search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return { matches: [], total: 0, encryptionActive: false };
      const res = await fetch(`/api/sessions/${sessionId}/entries/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return res.json();
    },
    enabled: debouncedQuery.trim().length > 0,
    placeholderData: { matches: [], total: 0, encryptionActive: false },
    retry: 1,
  });

  const isSearchEncryptionActive = !!(serverSearchData?.encryptionActive && debouncedQuery.trim());

  const serverMatchedIds = useMemo(() => {
    if (!debouncedQuery.trim() || isSearchError || !serverSearchData?.matches) return null;
    return new Set(serverSearchData.matches.map(m => m.entryId));
  }, [serverSearchData, debouncedQuery, isSearchError]);

  const toggleFilter = (filter: FilterChip) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setDebouncedQuery("");
    setActiveFilters(new Set());
  };

  const wireTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of entries) {
      if (e.wireType) types.add(e.wireType);
    }
    return Array.from(types).sort();
  }, [entries]);

  const flaggedEntryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const pin of sessionPins) {
      if (pin.flagged && pin.entryId) ids.add(pin.entryId);
    }
    for (const r of reviewResponses) {
      if (r.verdict === "flagged") ids.add(r.entryId);
    }
    return ids;
  }, [sessionPins, reviewResponses]);

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (serverMatchedIds !== null) {
      result = result.filter(e => serverMatchedIds.has(e.id));
    }

    const statusFilters: string[] = [];
    const wireTypeFilters: string[] = [];
    for (const filter of Array.from(activeFilters)) {
      if (filter === "flagged" || filter === "incomplete" || filter === "no-photo") {
        statusFilters.push(filter);
      } else {
        wireTypeFilters.push(filter);
      }
    }

    for (const filter of statusFilters) {
      if (filter === "flagged") {
        result = result.filter(e => flaggedEntryIds.has(e.id));
      } else if (filter === "incomplete") {
        result = result.filter(e => !e.reelTag || !e.footage);
      } else if (filter === "no-photo") {
        result = result.filter(e => !pinByEntryId.has(e.id));
      }
    }

    if (wireTypeFilters.length > 0) {
      const wireSet = new Set(wireTypeFilters);
      result = result.filter(e => e.wireType && wireSet.has(e.wireType));
    }

    return result;
  }, [entries, serverMatchedIds, activeFilters, flaggedEntryIds, pinByEntryId]);

  const hasActiveFilters = searchQuery.trim() !== "" || activeFilters.size > 0;
  const isFiltered = hasActiveFilters;
  const isSearchActive = debouncedQuery.trim().length > 0;

  const incompleteCount = useMemo(() => entries.filter(e => !e.reelTag || !e.footage).length, [entries]);
  const noPhotoCount = useMemo(() => entries.filter(e => !pinByEntryId.has(e.id)).length, [entries, pinByEntryId]);
  const flaggedCount = useMemo(() => entries.filter(e => flaggedEntryIds.has(e.id)).length, [entries, flaggedEntryIds]);

  const deleteEntry = useMutation({
    mutationFn: async ({ id, entry }: { id: number; entry: Entry }) => {
      await apiRequest("DELETE", `/api/entries/${id}`);
      return entry;
    },
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      if (onUndoableDelete) {
        const { id, ...rest } = entry;
        onUndoableDelete({
          type: "delete-entry",
          sessionId,
          entityId: id,
          data: rest,
          previousData: rest,
        });
      }
      toast({ title: "Entry deleted" });
    },
  });

  const getReelInfo = (entry: Entry) => {
    const rawFootage = entry.footage || 0;
    const displayFootage = toDisplayUnit(rawFootage, currentUnit);
    const reelCount = entry.reelCount || 1;
    const perReel = reelCount > 0 ? Math.round(displayFootage / reelCount) : displayFootage;
    return { reelCount, perReel, totalFootage: displayFootage };
  };

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (forceExpandKey) {
      setExpandedSections(prev => ({ ...prev, [forceExpandKey]: true }));
    }
  }, [forceExpandKey]);

  useEffect(() => {
    if (exclusiveExpandKey) {
      setExpandedSections({ [exclusiveExpandKey]: true });
    }
  }, [exclusiveExpandKey]);

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Cable className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No entries yet. Entries are created by placing and committing pins in Photo Mode.</p>
        </CardContent>
      </Card>
    );
  }

  const displayEntries = hasActiveFilters ? filteredEntries : entries;

  const grouped = displayEntries.reduce<Record<string, typeof entries>>((acc, entry) => {
    const key = `${entry.aisle || "—"}-${entry.section || "—"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  const sectionKeys = Object.keys(grouped).sort();

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Card>
      <CardHeader className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-sm" data-testid="text-entries-title">
            Table View - {isFiltered ? `${filteredEntries.length} of ${entries.length}` : entries.length} Entries
          </CardTitle>
          {isSearchActive && !isSearchError && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1"
              data-testid="text-search-match-count"
            >
              {isSearchFetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {!isSearchFetching && `${filteredEntries.length} of ${entries.length} match "${debouncedQuery}"`}
              {isSearchFetching && "Searching..."}
            </span>
          )}
          {isSearchActive && isSearchError && !isSearchFetching && (
            <span
              role="status"
              aria-live="polite"
              className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-1"
              data-testid="text-search-error-badge"
            >
              <AlertTriangle className="h-3 w-3" />
              Search failed
            </span>
          )}
          {isSearchEncryptionActive && (
            <span
              role="status"
              aria-live="polite"
              className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center gap-1"
              data-testid="text-search-encryption-notice"
            >
              <AlertTriangle className="h-3 w-3" />
              Encryption on — searching location fields only
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs"
              data-testid="input-entry-search"
            />
            {isSearchFetching && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 px-2 text-xs text-muted-foreground"
              data-testid="btn-clear-filters"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap" data-testid="filter-chips">
          {incompleteCount > 0 && (
            <FilterChipButton
              label="Incomplete"
              active={activeFilters.has("incomplete")}
              count={incompleteCount}
              onClick={() => toggleFilter("incomplete")}
              testId="chip-incomplete"
            />
          )}
          {noPhotoCount > 0 && (
            <FilterChipButton
              label="No Photo"
              active={activeFilters.has("no-photo")}
              count={noPhotoCount}
              onClick={() => toggleFilter("no-photo")}
              testId="chip-no-photo"
            />
          )}
          {flaggedCount > 0 && (
            <FilterChipButton
              label="Flagged"
              active={activeFilters.has("flagged")}
              count={flaggedCount}
              onClick={() => toggleFilter("flagged")}
              testId="chip-flagged"
            />
          )}
          {wireTypes.map(wt => (
            <FilterChipButton
              key={wt}
              label={wt}
              active={activeFilters.has(wt)}
              onClick={() => toggleFilter(wt)}
              testId={`chip-wiretype-${wt.replace(/[^a-zA-Z0-9-]/g, "_")}`}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isSearchActive && isSearchError && !isSearchFetching ? (
          <div
            className="py-8 text-center text-sm flex flex-col items-center gap-3"
            role="alert"
            aria-live="polite"
            data-testid="text-search-error"
          >
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>Search failed — try again</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchSearch()}
              data-testid="btn-retry-search"
            >
              Retry search
            </Button>
          </div>
        ) : hasActiveFilters && filteredEntries.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm" data-testid="text-no-filter-results">
            No entries match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="entries-table" data-testid="entries-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <span className="sm:hidden">Pin:</span>
                    <span className="hidden sm:inline">Pin #:</span>
                  </th>
                  <th className="hidden sm:table-cell" style={{ textAlign: "center" }}>Aisle:</th>
                  <th className="hidden sm:table-cell" style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Section:</th>
                  <th style={{ textAlign: "center" }}>Catalog:</th>
                  <th className="hidden sm:table-cell" style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Vendor:</th>
                  <th className="hidden" style={{ textAlign: "center", whiteSpace: "nowrap" }}>VEN:</th>
                  <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <span className="sm:hidden">Rls:</span>
                    <span className="hidden sm:inline">Reels:</span>
                  </th>
                  <th className="hidden sm:table-cell" style={{ textAlign: "center", whiteSpace: "nowrap" }}>{uLabel}/Reel:</th>
                  <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <span className="sm:hidden">Total:</span>
                    <span className="hidden sm:inline">Total {uLabel}:</span>
                  </th>
                  <th className="hidden sm:table-cell" style={{ width: 50, textAlign: "center" }}>Photo:</th>
                  <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Edit:</th>
                </tr>
              </thead>
              <tbody>
                {sectionKeys.map((sectionKey) => {
                  const sectionEntries = [...grouped[sectionKey]].sort((a, b) => {
                    const pinA = pinByEntryId.get(a.id);
                    const pinB = pinByEntryId.get(b.id);
                    const numA = pinA?.label ? parseInt(pinA.label, 10) : Infinity;
                    const numB = pinB?.label ? parseInt(pinB.label, 10) : Infinity;
                    return (isNaN(numA) ? Infinity : numA) - (isNaN(numB) ? Infinity : numB);
                  });
                  const isExpanded = expandedSections[sectionKey] ?? (hasActiveFilters ? true : false);
                  const sectionFootage = toDisplayUnit(sectionEntries.reduce((s, e) => s + (e.footage || 0), 0), currentUnit);
                  const [aisleLabel, sectionLabel] = sectionKey.split("-");
                  return (
                    <Fragment key={sectionKey}>
                      <tr
                        className="section-header-row"
                        onClick={() => toggleSection(sectionKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSection(sectionKey);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        aria-label={`${aisleLabel.toLowerCase() === "receiving" ? "Receiving Area" : `Aisle ${aisleLabel}`} - ${aisleLabel.toLowerCase() === "receiving" && sectionLabel === "000" ? "Section Unknown" : `Section ${sectionLabel}`}, ${sectionEntries.length} ${sectionEntries.length === 1 ? "entry" : "entries"}, ${isExpanded ? "expanded" : "collapsed"}`}
                        data-testid={`section-toggle-${sectionKey}`}
                      >
                        <td colSpan={11}>
                          <div className="flex items-center gap-2">
                            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                            <span className="font-semibold">{aisleLabel.toLowerCase() === "receiving" ? "Receiving Area" : `Aisle ${aisleLabel}`} - {aisleLabel.toLowerCase() === "receiving" && sectionLabel === "000" ? "Section Unknown" : `Section ${sectionLabel}`}</span>
                            <span className="hidden sm:inline text-muted-foreground">({sectionEntries.length} {sectionEntries.length === 1 ? "entry" : "entries"}, {sectionFootage.toLocaleString()} {uLabel} total)</span>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && sectionEntries.map((entry) => {
                        const info = getReelInfo(entry);
                        const isUnpinned = !pinByEntryId.has(entry.id);
                        return (<tr key={entry.id} data-testid={`row-entry-${entry.id}`}>
                          <td className={`mono ${isUnpinned ? "" : "text-muted-foreground"}`} style={{ textAlign: "center" }}>{(() => { const pin = pinByEntryId.get(entry.id); if (pin && onJumpToPin) { return <button className="underline decoration-dotted hover:text-foreground transition-colors cursor-pointer" data-testid={`link-pin-${pin.id}`} onClick={() => onJumpToPin(pin.photoId, pin.id)}>{pin.label}</button>; } if (pin) return pin.label; if (pinsFetching) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mx-auto" data-testid={`spinner-pin-${entry.id}`} />; return <span className="text-muted-foreground">—</span>; })()}</td>
                          <td className="hidden sm:table-cell" style={{ textAlign: "center" }}><HighlightText text={entry.aisle || ""} query={debouncedQuery} /></td>
                          <td className="hidden sm:table-cell" style={{ textAlign: "center" }}><HighlightText text={entry.section || ""} query={debouncedQuery} /></td>
                          <td className="mono font-bold">
                            {entry.reelTag ? <HighlightText text={entry.reelTag} query={debouncedQuery} /> : "-"}
                            {entry.manufacturer && <span className="sm:hidden">-<HighlightText text={entry.manufacturer} query={debouncedQuery} /></span>}
                            {!entry.reelTag && (
                              <span className="inline-flex items-center ml-1" title="No catalog">
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                              </span>
                            )}
                          </td>
                          <td className="hidden sm:table-cell" style={{ textAlign: "center" }}>{entry.manufacturer ? <HighlightText text={entry.manufacturer} query={debouncedQuery} /> : "-"}</td>
                          <td className="hidden" style={{ textAlign: "center" }}>{entry.manufacturer ? <HighlightText text={entry.manufacturer} query={debouncedQuery} /> : "-"}</td>
                          <td className="mono" style={{ textAlign: "center" }}>{info.reelCount}</td>
                          <td className="hidden sm:table-cell mono" style={{ textAlign: "center" }}>{info.perReel ? `${info.perReel.toLocaleString()} ${uLabel}` : "-"}</td>
                          <td className="mono font-bold" style={{ textAlign: "center" }}>
                            {info.totalFootage ? `${info.totalFootage.toLocaleString()} ${uLabel}` : "-"}
                            {!info.totalFootage && (
                              <span className="inline-flex items-center ml-1" title="Zero footage">
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                              </span>
                            )}
                          </td>
                          <td className="hidden sm:table-cell" style={{ textAlign: "center" }}>
                            {entry.photoId && photoMap.get(entry.photoId) ? (
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="icon" variant="ghost" title="View Photo" data-testid={`button-view-photo-${entry.id}`}>
                                    <Eye className="h-3 w-3" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
                                  <DialogHeader className="p-4 pb-2 shrink-0">
                                    <DialogTitle>Photo - {photoMap.get(entry.photoId)?.originalFilename || "Photo"}</DialogTitle>
                                  </DialogHeader>
                                  <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
                                    <EntryPhotoDialogContent
                                      src={(() => { const p = photoMap.get(entry.photoId!); if (!p) return ""; const key = p.objectStorageKey || ""; return key.startsWith("/uploads/") ? key : `/uploads/${key}`; })()}
                                      entryId={entry.id}
                                      pin={pinByEntryId.get(entry.id)}
                                    />
                                  </div>
                                </DialogContent>
                              </Dialog>
                            ) : entry.photoId && !photoMap.get(entry.photoId) ? (
                              <Button size="icon" variant="ghost" title="Photo loading..." disabled className="opacity-50" data-testid={`button-photo-loading-${entry.id}`}>
                                <Loader2 className="h-3 w-3 animate-spin" />
                              </Button>
                            ) : isUnpinned ? (
                              <span className="flex justify-center" title="No linked photo" data-testid={`icon-no-photo-${entry.id}`}>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => onEdit(entry)}
                                disabled={!canEdit}
                                title="Edit Entry"
                                data-testid={`button-edit-entry-${entry.id}`}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="hidden sm:inline-flex"
                                    disabled={!canEdit}
                                    title="Delete Entry"
                                    data-testid={`button-delete-entry-${entry.id}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
                                    <AlertDialogDescription>This entry will be permanently removed.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteEntry.mutate({ id: entry.id, entry })}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="hidden sm:table-row">
                  <td colSpan={8} className="font-semibold">
                    Total: {displayEntries.length} entries{isFiltered ? ` (filtered from ${entries.length})` : ""}
                  </td>
                  <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage">
                    {(isFiltered
                      ? toDisplayUnit(displayEntries.reduce((s, e) => s + (e.footage || 0), 0), currentUnit)
                      : totalFootage
                    ).toLocaleString()} {uLabel}
                  </td>
                  <td colSpan={2} />
                </tr>
                <tr className="sm:hidden">
                  <td colSpan={8} className="font-semibold">
                    Total: {displayEntries.length} entries{isFiltered ? ` (filtered from ${entries.length})` : ""}
                  </td>
                  <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage-mobile">
                    {(isFiltered
                      ? toDisplayUnit(displayEntries.reduce((s, e) => s + (e.footage || 0), 0), currentUnit)
                      : totalFootage
                    ).toLocaleString()} {uLabel}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default EntryTable;
