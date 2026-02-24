import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, Save, X, Loader2, ImagePlus, Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { lookupCategory, PARSED_CATALOG, type ParsedCatalogEntry } from "@/lib/wireReference";
import type { Entry, Pin } from "@shared/schema";

export default function SingleEntryMode({
  sessionId, editingEntry, onDoneEditing, onSwitchToPhoto, onUndoableSave, canEdit = true,
}: {
  sessionId: number;
  editingEntry: Entry | null;
  onDoneEditing: () => void;
  onSwitchToPhoto?: (photoId: number, aisle: string, section: string) => void;
  onUndoableSave?: (action: any) => void;
  canEdit?: boolean;
}) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const singleFileRef = useRef<HTMLInputElement>(null);
  const singleCameraRef = useRef<HTMLInputElement>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<{ url: string; objectPath: string; photoId: number } | null>(null);
  const [keepLocation, setKeepLocation] = useState(false);

  const { data: entrySettings } = useQuery<{
    defaultAislePrefix: string | null;
    defaultUnit: string;
    largerTouchTargets: boolean;
  }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({
      defaultAislePrefix: data?.defaultAislePrefix ?? null,
      defaultUnit: data?.defaultUnit ?? "feet",
      largerTouchTargets: data?.largerTouchTargets ?? false,
    }),
  });

  const [form, setForm] = useState({
    aisle: editingEntry?.aisle || "",
    section: editingEntry?.section || "",
    position: editingEntry?.position || "",
    reelTag: editingEntry?.reelTag || "",
    wireType: editingEntry?.wireType || "",
    gauge: editingEntry?.gauge || "",
    footage: editingEntry?.footage?.toString() || "",
    color: editingEntry?.color || "",
    manufacturer: editingEntry?.manufacturer || "",
    notes: editingEntry?.notes || "",
    reelCount: editingEntry?.reelCount?.toString() || "1",
    conductors: editingEntry?.conductors || "",
  });
  const [onFloor, setOnFloor] = useState(editingEntry?.notes?.includes("On Floor") || false);
  const [inFrontOf, setInFrontOf] = useState(editingEntry?.notes?.includes("In Front Of") || false);
  const [receivingChecked, setReceivingChecked] = useState(editingEntry?.aisle?.toLowerCase() === "receiving" || false);
  const [footageOverride, setFootageOverride] = useState(!!editingEntry);
  const lastMatchedCatalog = useRef<string | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const { data: linkedPin } = useQuery<Pin>({
    queryKey: ["/api/entries", editingEntry?.id?.toString(), "pin"],
    queryFn: async () => {
      const res = await fetch(`/api/entries/${editingEntry!.id}/pin`, { credentials: "include" });
      if (!res.ok) throw new Error("No pin");
      return res.json();
    },
    enabled: !!editingEntry?.id,
    retry: false,
  });

  const flagMutation = useMutation({
    mutationFn: async ({ pinId, flagged }: { pinId: number; flagged: boolean }) => {
      await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entries", editingEntry?.id?.toString(), "pin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
    },
  });

  useEffect(() => {
    if (editingEntry) {
      setForm({
        aisle: editingEntry.aisle || "",
        section: editingEntry.section || "",
        position: editingEntry.position || "",
        reelTag: editingEntry.reelTag || "",
        wireType: editingEntry.wireType || "",
        gauge: editingEntry.gauge || "",
        footage: editingEntry.footage && editingEntry.reelCount && editingEntry.reelCount > 1 ? Math.round(editingEntry.footage / editingEntry.reelCount).toString() : editingEntry.footage?.toString() || "",
        color: editingEntry.color || "",
        manufacturer: editingEntry.manufacturer || "",
        notes: editingEntry.notes || "",
        reelCount: editingEntry.reelCount?.toString() || "1",
        conductors: editingEntry.conductors || "",
      });
      setOnFloor(editingEntry.notes?.includes("On Floor") || false);
      setInFrontOf(editingEntry.notes?.includes("In Front Of") || false);
      setReceivingChecked(editingEntry.aisle?.toLowerCase() === "receiving" || false);
      setFootageOverride(true);
      lastMatchedCatalog.current = editingEntry.reelTag?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
      setCapturedPhoto(null);
      setErrors({});
      setTouched({});
    } else if (entrySettings?.defaultAislePrefix && !form.aisle) {
      setForm(prev => ({ ...prev, aisle: entrySettings.defaultAislePrefix! }));
    }
  }, [editingEntry, entrySettings?.defaultAislePrefix]);

  const getCatalogMatch = (reelTag: string): ParsedCatalogEntry | null => {
    if (!reelTag || reelTag.length < 2) return null;
    const matches = lookupCategory(reelTag);
    const normalized = reelTag.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const exact = matches.find(m => m.catalog === normalized);
    return exact || (matches.length === 1 ? matches[0] : null);
  };

  const getUniqueVendor = (catalog: string): string | null => {
    const vendors = new Set(PARSED_CATALOG.filter(e => e.catalog === catalog).map(e => e.vendor));
    return vendors.size === 1 ? [...vendors][0] : null;
  };

  useEffect(() => {
    const match = getCatalogMatch(form.reelTag);
    if (match) {
      if (match.conductors && !form.conductors) {
        setForm(f => ({ ...f, conductors: match.conductors || "" }));
      }
      const uniqueVendor = getUniqueVendor(match.catalog);
      if (uniqueVendor && !form.manufacturer) {
        setForm(f => ({ ...f, manufacturer: uniqueVendor }));
      }
      if (match.footage) {
        const matchCatalog = match.catalog;
        if (matchCatalog !== lastMatchedCatalog.current) {
          lastMatchedCatalog.current = matchCatalog;
          setFootageOverride(false);
          const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
          setForm(f => ({ ...f, footage: (match.footage! * reelCount).toString() }));
        }
      } else {
        lastMatchedCatalog.current = match.catalog;
      }
    } else {
      if (lastMatchedCatalog.current !== null) {
        lastMatchedCatalog.current = null;
      }
    }
  }, [form.reelTag]);

  useEffect(() => {
    if (!footageOverride) {
      const match = getCatalogMatch(form.reelTag);
      if (match?.footage) {
        const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
        setForm(f => ({ ...f, footage: (match.footage! * reelCount).toString() }));
      }
    }
  }, [form.reelCount, footageOverride]);

  const handleSinglePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile(file);
      if (!result) {
        toast({ title: "Upload failed", variant: "destructive" });
        return;
      }
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
        objectStorageKey: result.objectPath,
        originalFilename: file.name,
        mimeType: file.type,
        aisle: form.aisle,
        section: form.section,
      });
      const savedPhoto = await res.json();
      await queryClient.refetchQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      if (onSwitchToPhoto) {
        toast({ title: "Photo captured — switching to pin mode" });
        onSwitchToPhoto(savedPhoto.id, form.aisle, form.section);
      } else {
        setCapturedPhoto({ url: result.objectPath, objectPath: result.objectPath, photoId: savedPhoto.id });
        toast({ title: "Photo captured" });
      }
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    }
    if (singleFileRef.current) singleFileRef.current.value = "";
    if (singleCameraRef.current) singleCameraRef.current.value = "";
  };

  const update = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) {
      setErrors((e) => { const n = { ...e }; delete n[field]; return n; });
    }
  };

  const markTouched = (field: string) => {
    setTouched((t) => ({ ...t, [field]: true }));
  };

  const applyCatalogMatch = (match: ParsedCatalogEntry) => {
    const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
    lastMatchedCatalog.current = match.catalog;
    setFootageOverride(false);
    const uniqueVendor = getUniqueVendor(match.catalog);
    setForm(f => ({
      ...f,
      reelTag: match.catalog,
      manufacturer: f.manufacturer || (uniqueVendor ?? ""),
      footage: match.footage ? (match.footage * reelCount).toString() : f.footage,
      conductors: f.conductors || match.conductors || "",
    }));
    setCategorySuggestions([]);
    setShowCategorySuggestions(false);
  };

  const toggleNoteTag = (tag: string, checked: boolean) => {
    setForm((f) => {
      const parts = f.notes.split("; ").filter(p => p.trim() && p.trim() !== tag);
      if (checked) parts.unshift(tag);
      return { ...f, notes: parts.join("; ") };
    });
  };

  const isReceiving = form.aisle.trim().toLowerCase() === "receiving";

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!form.aisle.trim()) newErrors.aisle = "Aisle is required";
    if (!isReceiving && !form.section.trim()) newErrors.section = "Section is required";
    if (form.footage && (isNaN(parseInt(form.footage)) || parseInt(form.footage) < 1)) newErrors.footage = "Must be a positive number";
    setErrors(newErrors);
    setTouched({ aisle: true, section: true, footage: true });
    return Object.keys(newErrors).length === 0;
  };

  const saveEntry = useMutation({
    mutationFn: async () => {
      const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
      const totalFootage = form.footage ? parseInt(form.footage) : null;
      const sectionValue = isReceiving && !form.section.trim() ? "000" : form.section;
      const body: Record<string, unknown> = {
        aisle: form.aisle,
        section: sectionValue,
        position: form.position && form.position !== "__none__" ? form.position : null,
        reelTag: form.reelTag.toUpperCase() || null,
        wireType: form.wireType || null,
        gauge: form.gauge || null,
        footage: totalFootage,
        reelCount,
        color: form.color && form.color !== "__none__" ? form.color : null,
        manufacturer: form.manufacturer || null,
        notes: form.notes || null,
        conductors: form.conductors || null,
      };
      if (!editingEntry && capturedPhoto) body.photoId = capturedPhoto.photoId;

      let result;
      if (editingEntry) {
        const res = await apiRequest("PATCH", `/api/entries/${editingEntry.id}`, body);
        result = { type: "update" as const, body, previousData: editingEntry };
      } else {
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, body);
        const created = await res.json();
        result = { type: "create" as const, body, id: created.id };
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      if (onUndoableSave && result) {
        if (result.type === "create") {
          onUndoableSave({ type: "create-entry", sessionId, entityId: result.id, data: result.body });
        } else if (result.type === "update" && editingEntry) {
          onUndoableSave({ type: "update-entry", sessionId, entityId: editingEntry.id, data: result.body, previousData: result.previousData });
        }
      }
      toast({ title: editingEntry ? "Entry updated" : "Entry saved" });
      if (editingEntry) {
        onDoneEditing();
      } else {
        const savedAisle = form.aisle;
        const savedSection = form.section;
        setForm({
          aisle: keepLocation ? savedAisle : "",
          section: keepLocation ? savedSection : "",
          position: "", reelTag: "", wireType: "", gauge: "",
          footage: "", color: "", manufacturer: "", notes: "", reelCount: "1", conductors: "",
        });
        setOnFloor(false);
        setInFrontOf(false);
        setReceivingChecked(false);
        setFootageOverride(false);
        lastMatchedCatalog.current = null;
        setCapturedPhoto(null);
        setErrors({});
        setTouched({});
      }
    },
    onError: () => {
      toast({ title: "Failed to save entry", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast({ title: "Missing required fields", description: "Aisle and Section are required", variant: "destructive" });
      return;
    }
    saveEntry.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!editingEntry && (
        <div className="space-y-2">
          <Label className="text-xs underline">Photo (optional):</Label>
          <input ref={singleFileRef} type="file" accept="image/*" className="hidden" onChange={handleSinglePhoto} data-testid="input-single-file" />
          <input ref={singleCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleSinglePhoto} data-testid="input-single-camera" />
          {capturedPhoto ? (
            <div className="relative rounded-md overflow-hidden border border-border/50">
              <img src={capturedPhoto.objectPath.startsWith("/uploads/") ? capturedPhoto.objectPath : `/uploads/${capturedPhoto.objectPath}`} alt="Captured" className="w-full max-h-48 object-cover" data-testid="img-captured-photo" />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute top-1 right-1 bg-black/50 text-white"
                onClick={() => setCapturedPhoto(null)}
                data-testid="button-remove-photo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden sm:flex gap-3">
                <Button type="button" size="lg" className="flex-1 bg-[hsl(18_85%_48%)] hover:bg-[hsl(18_85%_40%)] text-white font-semibold text-base py-3" onClick={() => singleFileRef.current?.click()} disabled={isUploading} data-testid="button-single-upload">
                  <ImagePlus className="h-5 w-5 mr-2" />
                  Upload Photo
                </Button>
                <Button type="button" size="lg" className="flex-1 bg-[hsl(18_85%_48%)] hover:bg-[hsl(18_85%_40%)] text-white font-semibold text-base py-3" onClick={() => singleCameraRef.current?.click()} disabled={isUploading} data-testid="button-single-camera">
                  <Camera className="h-5 w-5 mr-2" />
                  Take Photo
                </Button>
                {isUploading && <Loader2 className="h-5 w-5 animate-spin self-center" />}
              </div>
              <div className="flex sm:hidden items-center justify-center gap-4">
                <Button type="button" className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]" onClick={() => singleFileRef.current?.click()} disabled={isUploading} data-testid="button-single-upload-mobile" title="Upload Photo">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </Button>
                <Button type="button" className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]" onClick={() => singleCameraRef.current?.click()} disabled={isUploading} data-testid="button-single-camera-mobile" title="Take Photo">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs underline">Aisle: <span className="text-destructive">*</span></Label>
          <Input
            value={form.aisle}
            onChange={(e) => {
              const val = e.target.value;
              if (val.toLowerCase() === "rec") {
                update("aisle", "Receiving");
              } else {
                update("aisle", val);
              }
            }}
            onBlur={() => markTouched("aisle")}
            placeholder="Aisle"
            enterKeyHint="next"
            className={touched.aisle && errors.aisle ? "border-destructive" : ""}
            data-testid="input-aisle"
          />
          {touched.aisle && errors.aisle && (
            <p className="text-xs text-destructive" data-testid="error-aisle">{errors.aisle}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Section: <span className="text-destructive">*</span></Label>
          <Input
            value={form.section}
            onChange={(e) => update("section", e.target.value)}
            onBlur={() => markTouched("section")}
            placeholder="Section"
            enterKeyHint="next"
            className={touched.section && errors.section ? "border-destructive" : ""}
            data-testid="input-section"
          />
          {touched.section && errors.section && (
            <p className="text-xs text-destructive" data-testid="error-section">{errors.section}</p>
          )}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={receivingChecked}
            onCheckedChange={(c) => {
              const checked = !!c;
              setReceivingChecked(checked);
              if (checked) {
                update("aisle", "Receiving");
                update("section", "000");
              } else {
                update("aisle", "");
                update("section", "");
              }
            }}
            data-testid="checkbox-receiving"
          />
          Receiving
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={onFloor}
            onCheckedChange={(c) => {
              const checked = !!c;
              setOnFloor(checked);
              toggleNoteTag("On Floor", checked);
            }}
            data-testid="checkbox-on-floor"
          />
          On Floor
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={inFrontOf}
            onCheckedChange={(c) => {
              const checked = !!c;
              setInFrontOf(checked);
              toggleNoteTag("In Front Of", checked);
            }}
            data-testid="checkbox-in-front-of"
          />
          In Front Of
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 relative">
          <Label className="text-xs underline">Category:</Label>
          <Input
            value={form.reelTag}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              update("reelTag", val);
              if (val.length >= 2) {
                const matches = lookupCategory(val);
                setCategorySuggestions(matches);
                setShowCategorySuggestions(matches.length > 0);
              } else {
                setCategorySuggestions([]);
                setShowCategorySuggestions(false);
              }
            }}
            onFocus={() => {
              if (form.reelTag && form.reelTag.length >= 2) {
                const matches = lookupCategory(form.reelTag);
                setCategorySuggestions(matches);
                setShowCategorySuggestions(matches.length > 0);
              }
            }}
            onBlur={() => {
              setTimeout(() => setShowCategorySuggestions(false), 200);
              const match = getCatalogMatch(form.reelTag);
              if (match) applyCatalogMatch(match);
            }}
            placeholder="Category"
            enterKeyHint="next"
            autoComplete="off"
            data-testid="input-reel-tag"
          />
          {showCategorySuggestions && categorySuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid="category-suggestions">
              {categorySuggestions.map((s) => (
                <button
                  key={s.catalog}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-b border-border/30 last:border-0"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyCatalogMatch(s);
                  }}
                  data-testid={`suggestion-${s.catalog}`}
                >
                  <span className="font-mono font-semibold">{s.catalog}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{s.description}</span>
                  {s.footage && <span className="text-orange-500 ml-1 text-xs">({s.footage}ft)</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Vendor Code:</Label>
          <Input value={form.manufacturer} onChange={(e) => update("manufacturer", e.target.value.toUpperCase())} placeholder="Vendor Code" enterKeyHint="next" data-testid="input-manufacturer" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs underline">Number of Reels:</Label>
          <Input
            type="number"
            value={form.reelCount}
            onChange={(e) => update("reelCount", e.target.value)}
            min={1}
            inputMode="numeric"
            placeholder="1"
            enterKeyHint="next"
            data-testid="input-reel-count"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Total Footage:</Label>
          <Input
            type="number"
            value={form.footage}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              setFootageOverride(true);
              update("footage", v);
            }}
            onBlur={() => markTouched("footage")}
            onKeyDown={(e) => { if (e.key === "-" || e.key === "." || e.key === "e" || e.key === "+") e.preventDefault(); }}
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="Auto or enter manually"
            enterKeyHint="next"
            className={touched.footage && errors.footage ? "border-destructive" : ""}
            data-testid="input-footage"
          />
          {touched.footage && errors.footage && (
            <p className="text-xs text-destructive" data-testid="error-footage">{errors.footage}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs underline">Notes:</Label>
        <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Notes..." rows={2} enterKeyHint="done" data-testid="input-notes" />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        {!editingEntry && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={keepLocation}
              onCheckedChange={(c) => setKeepLocation(!!c)}
              data-testid="checkbox-keep-location"
            />
            Keep Location
          </label>
        )}
        {editingEntry && linkedPin && (
          <Button
            type="button"
            variant={linkedPin.flagged ? "default" : "outline"}
            size="sm"
            className={linkedPin.flagged ? "bg-[hsl(45_90%_45%)] hover:bg-[hsl(45_90%_35%)] text-black" : ""}
            disabled={flagMutation.isPending}
            onClick={() => flagMutation.mutate({ pinId: linkedPin.id, flagged: !linkedPin.flagged })}
            data-testid="button-toggle-flag-edit"
          >
            <Flag className="h-3.5 w-3.5 mr-1" />
            {linkedPin.flagged ? "Flagged for Re-shoot" : "Flag for Re-shoot"}
          </Button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {editingEntry && (
            <Button type="button" variant="outline" onClick={onDoneEditing} data-testid="button-cancel-edit">
              Cancel
            </Button>
          )}
          {!editingEntry && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(f => ({
                  aisle: keepLocation ? f.aisle : "",
                  section: keepLocation ? f.section : "",
                  position: "",
                  reelTag: "",
                  wireType: "",
                  gauge: "",
                  footage: "",
                  color: "",
                  manufacturer: "",
                  notes: "",
                  reelCount: "1",
                  conductors: "",
                }));
                setOnFloor(false);
                setInFrontOf(false);
                setReceivingChecked(false);
                setFootageOverride(false);
                lastMatchedCatalog.current = null;
                setCapturedPhoto(null);
                setErrors({});
                setTouched({});
              }}
              data-testid="button-clear-form"
            >
              Clear
            </Button>
          )}
          <Button
            type="submit"
            disabled={saveEntry.isPending || !canEdit}
            data-testid="button-save-entry"
          >
            {saveEntry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingEntry ? "Update" : "Save Entry"}
          </Button>
        </div>
      </div>
    </form>
  );
}
