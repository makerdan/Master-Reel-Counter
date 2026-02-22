import { useState, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Eye, Pencil, Trash2, ChevronDown, AlertTriangle } from "lucide-react";
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
  entries, photos, onEdit, sessionId, totalFootage, onUndoableDelete, canEdit = true,
}: {
  entries: Entry[];
  photos: Photo[];
  onEdit: (entry: Entry) => void;
  sessionId: number;
  totalFootage: number;
  onUndoableDelete?: (action: any) => void;
  canEdit?: boolean;
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

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Cable className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No entries yet. Add reels using the form above.</p>
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
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm" data-testid="text-entries-title">Table View - {entries.length} Entries</CardTitle>
          {(() => {
            const warnings = entries.filter(e => !e.reelTag || !e.footage).length;
            return warnings > 0 ? (
              <span className="flex items-center gap-1 text-xs text-amber-500" data-testid="text-validation-warnings">
                <AlertTriangle className="h-3 w-3" />
                {warnings} warning{warnings !== 1 ? "s" : ""}
              </span>
            ) : null;
          })()}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="entries-table" data-testid="entries-table">
            <thead>
              <tr>
                <th style={{ width: 65, textAlign: "center", whiteSpace: "nowrap" }}>Pin #:</th>
                <th style={{ textAlign: "center" }}>Aisle:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Section:</th>
                <th style={{ textAlign: "center" }}>Category:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Reels:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Ft/Reel:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Total Ft:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Vendor Code:</th>
                <th style={{ width: 50, textAlign: "center" }}>Photo:</th>
                <th style={{ width: 70, textAlign: "center" }}>Actions:</th>
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
                          <span className="text-muted-foreground">({sectionEntries.length} {sectionEntries.length === 1 ? "entry" : "entries"}, {sectionFootage.toLocaleString()} ft. total)</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && sectionEntries.map((entry, idx) => {
                      const info = getReelInfo(entry);
                      return (<tr key={entry.id} data-testid={`row-entry-${entry.id}`}>
                        <td className="mono text-muted-foreground" style={{ textAlign: "center" }}>{pinByEntryId.get(entry.id)?.label || String(idx + 1).padStart(2, "0")}</td>
                        <td style={{ textAlign: "center" }}>{entry.aisle}</td>
                        <td style={{ textAlign: "center" }}>{entry.section}</td>
                        <td className="mono">
                          {entry.reelTag || "-"}
                          {!entry.reelTag && (
                            <span className="inline-flex items-center ml-1" title="No category">
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            </span>
                          )}
                        </td>
                        <td className="mono" style={{ textAlign: "center" }}>{info.reelCount}</td>
                        <td className="mono" style={{ textAlign: "center" }}>{info.perReel ? `${info.perReel.toLocaleString()}'` : "-"}</td>
                        <td className="mono" style={{ textAlign: "center" }}>
                          {info.totalFootage ? `${info.totalFootage.toLocaleString()}'` : "-"}
                          {!info.totalFootage && (
                            <span className="inline-flex items-center ml-1" title="Zero footage">
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>{entry.manufacturer || "-"}</td>
                        <td style={{ textAlign: "center" }}>
                          {entry.photoId && photoMap.get(entry.photoId) ? (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="icon" variant="ghost" data-testid={`button-view-photo-${entry.id}`}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Photo - {photoMap.get(entry.photoId)?.originalFilename || "Photo"}</DialogTitle>
                                </DialogHeader>
                                <img
                                  src={(() => { const p = photoMap.get(entry.photoId!); const key = p?.objectStorageKey || ""; return key.startsWith("/uploads/") ? key : `/uploads/${key}`; })()}
                                  alt="Entry photo"
                                  className="w-full rounded-md"
                                  data-testid={`img-entry-photo-${entry.id}`}
                                />
                              </DialogContent>
                            </Dialog>
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
                              data-testid={`button-edit-entry-${entry.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={!canEdit}
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
              <tr>
                <td colSpan={6} className="font-semibold">
                  Total: {entries.length} entries
                </td>
                <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage">
                  {totalFootage.toLocaleString()}'
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default EntryTable;
