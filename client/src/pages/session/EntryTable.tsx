import { useState, useRef, useCallback, Fragment, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Eye, Pencil, Trash2, ChevronDown, AlertTriangle, ImageOff, Lock } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Cable } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Entry, Photo, Pin } from "@shared/schema";

function EntryTable({
  entries, photos, onEdit, sessionId, totalFootage, onUndoableDelete, canEdit = true, forceExpandKey, lockedAisles, isOwner = false, onJumpToPin,
}: {
  entries: Entry[];
  photos: Photo[];
  onEdit: (entry: Entry) => void;
  sessionId: number;
  totalFootage: number;
  onUndoableDelete?: (action: any) => void;
  canEdit?: boolean;
  forceExpandKey?: string;
  lockedAisles?: Set<string>;
  isOwner?: boolean;
  onJumpToPin?: (photoId: number, pinId: number) => void;
}) {
  const { toast } = useToast();
  const photoMap = new Map(photos.map(p => [p.id, p]));

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
  });
  const pinByEntryId = new Map(sessionPins.filter(p => p.entryId).map(p => [p.entryId!, p]));

  const deleteEntry = useMutation({
    mutationFn: async ({ id, entry }: { id: number; entry: Entry }) => {
      await apiRequest("DELETE", `/api/entries/${id}`);
      return entry;
    },
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
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
    const totalFootage = entry.footage || 0;
    const reelCount = entry.reelCount || 1;
    const perReel = reelCount > 0 ? Math.round(totalFootage / reelCount) : totalFootage;
    return { reelCount, perReel, totalFootage };
  };

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (forceExpandKey) {
      setExpandedSections(prev => ({ ...prev, [forceExpandKey]: true }));
    }
  }, [forceExpandKey]);

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

  const grouped = entries.reduce<Record<string, typeof entries>>((acc, entry) => {
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
      <CardHeader className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-sm" data-testid="text-entries-title">Table View - {entries.length} Entries</CardTitle>
          {(() => {
            const warningEntries = entries.filter(e => !e.reelTag || !e.footage);
            return warningEntries.length > 0 ? (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-amber-500 hover:underline cursor-pointer"
                onClick={() => {
                  const affectedKeys = new Set<string>();
                  for (const e of warningEntries) {
                    affectedKeys.add(`${e.aisle || "—"}-${e.section || "—"}`);
                  }
                  const next: Record<string, boolean> = {};
                  for (const key of sectionKeys) {
                    next[key] = affectedKeys.has(key);
                  }
                  setExpandedSections(next);
                }}
                data-testid="btn-validation-warnings"
              >
                <AlertTriangle className="h-3 w-3" />
                {warningEntries.length} warning{warningEntries.length !== 1 ? "s" : ""}
              </button>
            ) : null;
          })()}
          {(() => {
            const photolessEntries = entries.filter(e => !pinByEntryId.has(e.id));
            return photolessEntries.length > 0 ? (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-amber-500 hover:underline cursor-pointer"
                onClick={() => {
                  const affectedKeys = new Set<string>();
                  for (const e of photolessEntries) {
                    affectedKeys.add(`${e.aisle || "—"}-${e.section || "—"}`);
                  }
                  const next: Record<string, boolean> = {};
                  for (const key of sectionKeys) {
                    next[key] = affectedKeys.has(key);
                  }
                  setExpandedSections(next);
                }}
                data-testid="btn-photoless-warnings"
              >
                <ImageOff className="h-3 w-3" />
                {photolessEntries.length} without photo
              </button>
            ) : null;
          })()}
        </div>
      </CardHeader>
      <CardContent className="p-0">
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
                <th style={{ textAlign: "center" }}>Category:</th>
                <th className="hidden sm:table-cell" style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Vendor:</th>
                <th className="hidden" style={{ textAlign: "center", whiteSpace: "nowrap" }}>VEN:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  <span className="sm:hidden">Rls:</span>
                  <span className="hidden sm:inline">Reels:</span>
                </th>
                <th className="hidden sm:table-cell" style={{ textAlign: "center", whiteSpace: "nowrap" }}>Ft/Reel:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  <span className="sm:hidden">Total:</span>
                  <span className="hidden sm:inline">Total Ft:</span>
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
                const isExpanded = expandedSections[sectionKey] ?? false;
                const sectionFootage = sectionEntries.reduce((s, e) => s + (e.footage || 0), 0);
                const [aisleLabel, sectionLabel] = sectionKey.split("-");
                return (
                  <Fragment key={sectionKey}>
                    <tr
                      className="section-header-row"
                      onClick={() => toggleSection(sectionKey)}
                      data-testid={`section-toggle-${sectionKey}`}
                    >
                      <td colSpan={10}>
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                          <span className="font-semibold">{aisleLabel.toLowerCase() === "receiving" ? "Receiving Area" : `Aisle ${aisleLabel}`} - {aisleLabel.toLowerCase() === "receiving" && sectionLabel === "000" ? "Section Unknown" : `Section ${sectionLabel}`}</span>
                          {lockedAisles?.has(aisleLabel) && (
                            <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" data-testid={`icon-aisle-locked-${aisleLabel}`} />
                          )}
                          <span className="hidden sm:inline text-muted-foreground">({sectionEntries.length} {sectionEntries.length === 1 ? "entry" : "entries"}, {sectionFootage.toLocaleString()} ft. total)</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && sectionEntries.map((entry, idx) => {
                      const info = getReelInfo(entry);
                      const isUnpinned = !pinByEntryId.has(entry.id);
                      const entryAisleLocked = !isOwner && !!lockedAisles?.has(entry.aisle);
                      return (<tr key={entry.id} data-testid={`row-entry-${entry.id}`}>
                        <td className={`mono ${isUnpinned ? "text-amber-500 border-l-2 border-amber-400" : "text-muted-foreground"}`} style={{ textAlign: "center" }}>{(() => { const pin = pinByEntryId.get(entry.id); if (pin && onJumpToPin) { return <button className="underline decoration-dotted hover:text-foreground transition-colors cursor-pointer" data-testid={`link-pin-${pin.id}`} onClick={() => onJumpToPin(pin.photoId, pin.id)}>{pin.label}</button>; } return pin?.label || String(idx + 1).padStart(3, "0"); })()}</td>
                        <td className="hidden sm:table-cell" style={{ textAlign: "center" }}>{entry.aisle}</td>
                        <td className="hidden sm:table-cell" style={{ textAlign: "center" }}>{entry.section}</td>
                        <td className="mono font-bold">
                          {entry.reelTag || "-"}
                          {entry.manufacturer && <span className="sm:hidden">-{entry.manufacturer}</span>}
                          {!entry.reelTag && (
                            <span className="inline-flex items-center ml-1" title="No category">
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            </span>
                          )}
                        </td>
                        <td className="hidden sm:table-cell" style={{ textAlign: "center" }}>{entry.manufacturer || "-"}</td>
                        <td className="hidden" style={{ textAlign: "center" }}>{entry.manufacturer || "-"}</td>
                        <td className="mono" style={{ textAlign: "center" }}>{info.reelCount}</td>
                        <td className="hidden sm:table-cell mono" style={{ textAlign: "center" }}>{info.perReel ? `${info.perReel.toLocaleString()}'` : "-"}</td>
                        <td className="mono font-bold" style={{ textAlign: "center" }}>
                          {info.totalFootage ? `${info.totalFootage.toLocaleString()}'` : "-"}
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
                                  <div className="relative inline-block w-full">
                                    <img
                                      src={(() => { const p = photoMap.get(entry.photoId!); const key = p?.objectStorageKey || ""; return key.startsWith("/uploads/") ? key : `/uploads/${key}`; })()}
                                      alt="Entry photo"
                                      className="w-full rounded-md"
                                      style={{ display: "block" }}
                                      data-testid={`img-entry-photo-${entry.id}`}
                                    />
                                    {(() => {
                                      const pin = pinByEntryId.get(entry.id);
                                      if (!pin) return null;
                                      return (
                                        <div
                                          className="absolute pointer-events-none"
                                          style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%`, transform: "translate(-50%, -50%)" }}
                                          data-testid={`pin-highlight-${entry.id}`}
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
                                      );
                                    })()}
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
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
                              disabled={!canEdit || entryAisleLocked}
                              title={entryAisleLocked ? "Aisle is locked" : "Edit Entry"}
                              data-testid={`button-edit-entry-${entry.id}`}
                            >
                              {entryAisleLocked ? <Lock className="h-3 w-3 text-amber-500" /> : <Pencil className="h-3 w-3" />}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="hidden sm:inline-flex"
                                  disabled={!canEdit || entryAisleLocked}
                                  title={entryAisleLocked ? "Aisle is locked" : "Delete Entry"}
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
                <td colSpan={6} className="font-semibold">
                  Total: {entries.length} entries
                </td>
                <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage">
                  {totalFootage.toLocaleString()}'
                </td>
                <td colSpan={3} />
              </tr>
              <tr className="sm:hidden">
                <td colSpan={3} className="font-semibold">
                  Total: {entries.length} entries
                </td>
                <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage-mobile">
                  {totalFootage.toLocaleString()}'
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default EntryTable;
