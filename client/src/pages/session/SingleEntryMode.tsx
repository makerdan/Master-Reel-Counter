import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, Save, X, Loader2, ImagePlus, Flag, AlertTriangle } from "lucide-react";
import { toDisplayUnit, toBaseFeet, unitLabel } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";

import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { createEntryWithOfflineFallback } from "@/lib/offlineEntryCreate";
import { createDirectPhotoRegistrationKey, directPhotoFileKey } from "@/lib/directPhotoRegistration";
import { saveToQueue } from "@/lib/offlineQueue";
import { useUpload } from "@/hooks/use-upload";
import type { UploadResponse } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { lookupCatalog, PARSED_CATALOG, userWireCatalogToParsedEntry, type ParsedCatalogEntry } from "@/lib/wireReference";
import { useVendorCodes } from "@/hooks/use-vendor-codes";
import { useWireCatalogs } from "@/hooks/use-wire-catalogs";
import type { Entry, Pin } from "@shared/schema";

const UNREADABLE_SENTINEL = "[unreadable]";
const ENCRYPTED_ENTRY_FIELDS = [
  "reelTag", "wireType", "gauge", "color", "manufacturer", "notes", "palletId", "position", "conductors",
] as const;
const FIELD_LABELS: Record<string, string> = {
  reelTag: "Catalog", wireType: "Wire Type", gauge: "Gauge", color: "Color",
  manufacturer: "Vendor Code", notes: "Notes", palletId: "Pallet ID",
  position: "Position", conductors: "Conductors",
};
// Fields that have a rendered input in SingleEntryMode and can be re-typed by the user
const VISIBLE_ENCRYPTED_FIELDS = new Set(["reelTag", "manufacturer", "notes"]);

function clearSentinel(val: string | null | undefined): string {
  return val === UNREADABLE_SENTINEL ? "" : (val || "");
}

function getCorruptedFields(entry: Entry): Set<string> {
  const out = new Set<string>();
  for (const f of ENCRYPTED_ENTRY_FIELDS) {
    if ((entry[f as keyof Entry] as unknown) === UNREADABLE_SENTINEL) out.add(f);
  }
  return out;
}

export default function SingleEntryMode({
  sessionId, editingEntry, onDoneEditing, onSwitchToPhoto, onUndoableSave, canEdit = true, defaultAisle, defaultSection, getNextReceivingSection, onIsDirtyChange, onTriggerUndo,
}: {
  sessionId: number;
  editingEntry: Entry | null;
  onDoneEditing: () => void;
  onSwitchToPhoto?: (photoId: number, aisle: string, section: string) => void;
  onUndoableSave?: (action: any) => void;
  canEdit?: boolean;
  defaultAisle?: string;
  defaultSection?: string;
  getNextReceivingSection?: () => string;
  onIsDirtyChange?: (isDirty: boolean) => void;
  onTriggerUndo?: () => void;
}) {
  const { identityId } = useAuth();
  const { toast } = useToast();
  const onTriggerUndoRef = useRef(onTriggerUndo);
  useEffect(() => { onTriggerUndoRef.current = onTriggerUndo; }, [onTriggerUndo]);
  const { uploadFile, isUploading } = useUpload();
  const { allCodes: vendorCodes } = useVendorCodes();
  const singleFileRef = useRef<HTMLInputElement>(null);
  const singleCameraRef = useRef<HTMLInputElement>(null);
  const pendingRegistrationKeysRef = useRef(new Map<string, string>());
  const pendingUploadResultsRef = useRef(new Map<string, UploadResponse>());
  const [capturedPhoto, setCapturedPhoto] = useState<{ url: string; objectPath: string; photoId: number } | null>(null);
  const [keepLocation, setKeepLocation] = useState(false);
  const prevDefaultsRef = useRef({ aisle: defaultAisle || "", section: defaultSection || "" });

  const { catalogs: userCatalogs } = useWireCatalogs();
  const userParsedCatalog = useMemo(
    () => userCatalogs.map(userWireCatalogToParsedEntry),
    [userCatalogs]
  );

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

  const currentUnit: UnitType = (entrySettings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);

  const [form, setForm] = useState({
    aisle: editingEntry?.aisle || defaultAisle || "",
    section: editingEntry?.section || defaultSection || "",
    position: editingEntry?.position || "",
    reelTag: editingEntry?.reelTag || "",
    wireType: editingEntry?.wireType || "",
    gauge: editingEntry?.gauge || "",
    footage: editingEntry?.footage ? toDisplayUnit(editingEntry.footage, (entrySettings?.defaultUnit as UnitType) || "feet").toString() : "",
    color: editingEntry?.color || "",
    manufacturer: editingEntry?.manufacturer || "",
    notes: editingEntry?.notes || "",
    reelCount: editingEntry?.reelCount?.toString() || "1",
    conductors: editingEntry?.conductors || "",
  });
  const [onFloorInFront, setOnFloorInFront] = useState(
    (editingEntry?.notes?.includes("On the floor, in front of.") || editingEntry?.notes?.includes("On Floor") || editingEntry?.notes?.includes("In Front Of")) || false
  );
  const [receivingChecked, setReceivingChecked] = useState(editingEntry?.aisle?.toLowerCase() === "receiving" || false);
  const [footageOverride, setFootageOverride] = useState(!!editingEntry);
  const preReceivingSnapshot = useRef<{ aisle: string; section: string } | null>(null);
  const lastMatchedCatalog = useRef<string | null>(null);
  const userClearedFields = useRef<Set<string>>(new Set());
  const [catalogSuggestions, setCatalogSuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [showCatalogSuggestions, setShowCatalogSuggestions] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [corruptedFields, setCorruptedFields] = useState<Set<string>>(() =>
    editingEntry ? getCorruptedFields(editingEntry) : new Set()
  );
  // Frozen snapshot of originally-corrupted fields — never mutated after init.
  // Used at submit time to detect which fields were corrupted AND are still empty.
  const originalCorruptedRef = useRef<Set<string>>(
    editingEntry ? getCorruptedFields(editingEntry) : new Set()
  );
  const [showUnreadableConfirm, setShowUnreadableConfirm] = useState(false);
  const [stillEmptyAtSubmit, setStillEmptyAtSubmit] = useState<string[]>([]);
  const [encodingReconfiguring, setEncodingReconfiguring] = useState(false);
  const encodingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const formDirtyRef = useRef(false);

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
    mutationFn: async ({ pinId, flagged, prevFlagged, prevFlagReason }: { pinId: number; flagged: boolean; prevFlagged: boolean; prevFlagReason: string | null }) => {
      const res = await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged, flagReason: flagged ? undefined : null });
      const updated = await res.json().catch(() => null);
      const serverUpdatedAt: string | undefined = updated?.updatedAt ? new Date(updated.updatedAt as unknown as string).toISOString() : undefined;
      return { pinId, flagged, prevFlagged, prevFlagReason, serverUpdatedAt };
    },
    onSuccess: ({ pinId, flagged, prevFlagged, prevFlagReason, serverUpdatedAt }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/entries", editingEntry?.id?.toString(), "pin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      if (onUndoableSave) {
        if (flagged) {
          onUndoableSave({ type: "flag-pin", sessionId, entityId: pinId, data: { flagged: true, flagReason: null }, previousData: { flagged: prevFlagged, flagReason: prevFlagReason }, serverUpdatedAt });
        } else {
          onUndoableSave({ type: "unflag-pin", sessionId, entityId: pinId, data: { flagged: false, flagReason: null }, previousData: { flagged: true, flagReason: prevFlagReason }, serverUpdatedAt });
        }
      }
      let consumed = false;
      toast({
        title: flagged ? "Pin flagged" : "Flag removed",
        action: onTriggerUndoRef.current
          ? <ToastAction altText="Undo" onClick={(e) => { if (consumed) return; consumed = true; (e.currentTarget as HTMLButtonElement).disabled = true; onTriggerUndoRef.current?.(); }}>Undo</ToastAction>
          : undefined,
      });
    },
  });

  useEffect(() => {
    if (editingEntry) {
      const corrupted = getCorruptedFields(editingEntry);
      setCorruptedFields(corrupted);
      originalCorruptedRef.current = corrupted;
      const notes = clearSentinel(editingEntry.notes);
      setForm({
        aisle: editingEntry.aisle || "",
        section: editingEntry.section || "",
        position: clearSentinel(editingEntry.position),
        reelTag: clearSentinel(editingEntry.reelTag),
        wireType: clearSentinel(editingEntry.wireType),
        gauge: clearSentinel(editingEntry.gauge),
        footage: editingEntry.footage && editingEntry.reelCount && editingEntry.reelCount > 1 ? Math.round(toDisplayUnit(editingEntry.footage, currentUnit) / editingEntry.reelCount).toString() : editingEntry.footage ? toDisplayUnit(editingEntry.footage, currentUnit).toString() : "",
        color: clearSentinel(editingEntry.color),
        manufacturer: clearSentinel(editingEntry.manufacturer),
        notes,
        reelCount: editingEntry.reelCount?.toString() || "1",
        conductors: clearSentinel(editingEntry.conductors),
      });
      setOnFloorInFront(
        (notes.includes("On the floor, in front of.") || notes.includes("On Floor") || notes.includes("In Front Of")) || false
      );
      setReceivingChecked(editingEntry.aisle?.toLowerCase() === "receiving" || false);
      setFootageOverride(true);
      const reelTagClear = clearSentinel(editingEntry.reelTag);
      lastMatchedCatalog.current = reelTagClear ? reelTagClear.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
      setCapturedPhoto(null);
      setErrors({});
      setTouched({});
    } else if (entrySettings?.defaultAislePrefix && !form.aisle) {
      setForm(prev => ({ ...prev, aisle: entrySettings.defaultAislePrefix! }));
    }
  }, [editingEntry, entrySettings?.defaultAislePrefix]);

  useEffect(() => {
    if (editingEntry) return;
    if (defaultAisle !== undefined) {
      setForm(prev => {
        if (!prev.aisle || prev.aisle === prevDefaultsRef.current.aisle) {
          return { ...prev, aisle: defaultAisle };
        }
        return prev;
      });
    }
    if (defaultSection !== undefined) {
      setForm(prev => {
        if (!prev.section || prev.section === prevDefaultsRef.current.section) {
          return { ...prev, section: defaultSection };
        }
        return prev;
      });
    }
    prevDefaultsRef.current = { aisle: defaultAisle || "", section: defaultSection || "" };
  }, [defaultAisle, defaultSection, editingEntry]);

  const getCatalogMatch = (reelTag: string): ParsedCatalogEntry | null => {
    if (!reelTag || reelTag.length < 2) return null;
    const matches = lookupCatalog(reelTag, userParsedCatalog);
    const normalized = reelTag.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const exact = matches.find(m => m.catalog === normalized || m.aliasLabel === normalized);
    return exact || (matches.length === 1 ? matches[0] : null);
  };

  const getUniqueVendor = (catalog: string): string | null => {
    const vendors = new Set(PARSED_CATALOG.filter(e => e.catalog === catalog).map(e => e.vendor));
    return vendors.size === 1 ? [...vendors][0] : null;
  };

  useEffect(() => {
    const match = getCatalogMatch(form.reelTag);
    if (match) {
      if (match.conductors && !form.conductors && !userClearedFields.current.has("conductors")) {
        setForm(f => ({ ...f, conductors: match.conductors || "" }));
      }
      const uniqueVendor = getUniqueVendor(match.catalog);
      if (uniqueVendor && !form.manufacturer && !userClearedFields.current.has("manufacturer")) {
        setForm(f => ({ ...f, manufacturer: uniqueVendor }));
      }
      if (match.footage) {
        const matchCatalog = match.catalog;
        if (matchCatalog !== lastMatchedCatalog.current) {
          lastMatchedCatalog.current = matchCatalog;
          // New catalog selected — allow auto-fill to restore manufacturer/conductors
          // if the user hasn't typed a replacement value yet.
          userClearedFields.current.delete("conductors");
          userClearedFields.current.delete("manufacturer");
          setFootageOverride(false);
          const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
          setForm(f => ({ ...f, footage: (toDisplayUnit(match.footage!, currentUnit) * reelCount).toString() }));
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
        setForm(f => ({ ...f, footage: (toDisplayUnit(match.footage!, currentUnit) * reelCount).toString() }));
      }
    }
  }, [form.reelCount, footageOverride]);

  // Track when the user explicitly clears the conductors field so the
  // auto-fill effect does not immediately overwrite the empty value.
  const prevConductorsRef = useRef(form.conductors);
  useEffect(() => {
    const prev = prevConductorsRef.current;
    const cur = form.conductors;
    if (prev && !cur) {
      userClearedFields.current.add("conductors");
    } else if (cur) {
      userClearedFields.current.delete("conductors");
    }
    prevConductorsRef.current = cur;
  }, [form.conductors]);

  const markDirty = (isDirty: boolean) => {
    formDirtyRef.current = isDirty;
    onIsDirtyChange?.(isDirty);
  };

  useEffect(() => {
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (formDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);
    return () => window.removeEventListener("beforeunload", beforeUnloadHandler);
  }, []);

  // Check encoding status once at mount so button reflects reconfiguration
  // that was already running before this form was opened.
  useEffect(() => {
    let active = true;
    fetch("/api/settings/encoding-status")
      .then(r => r.ok ? r.json() : null)
      .then((data: { inProgress: boolean } | null) => {
        if (active && data?.inProgress) setEncodingReconfiguring(true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Low-frequency background probe (10 s) to catch toggles that start after
  // mount — sets encodingReconfiguring=true, which activates the 2 s fast poll.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/settings/encoding-status");
        if (r.ok) {
          const data: { inProgress: boolean } = await r.json();
          if (data.inProgress) setEncodingReconfiguring(true);
        }
      } catch {}
    }, 10000);
    return () => clearInterval(id);
  }, []);

  // While encoding is reconfiguring, poll every 2 s and clear once done.
  useEffect(() => {
    if (!encodingReconfiguring) {
      if (encodingPollRef.current) {
        clearInterval(encodingPollRef.current);
        encodingPollRef.current = null;
      }
      return;
    }
    if (encodingPollRef.current) return;
    encodingPollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/settings/encoding-status");
        if (r.ok) {
          const data: { inProgress: boolean } = await r.json();
          if (!data.inProgress) setEncodingReconfiguring(false);
        }
      } catch {}
    }, 2000);
    return () => {
      if (encodingPollRef.current) {
        clearInterval(encodingPollRef.current);
        encodingPollRef.current = null;
      }
    };
  }, [encodingReconfiguring]);

  const handleSinglePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileKey = await directPhotoFileKey(file);
    const registrationKey = pendingRegistrationKeysRef.current.get(fileKey)
      ?? createDirectPhotoRegistrationKey();
    pendingRegistrationKeysRef.current.set(fileKey, registrationKey);
    let result = pendingUploadResultsRef.current.get(fileKey);
    if (!result) {
      const uploadResult = await uploadFile(file);
      if (!uploadResult.success) {
        if (uploadResult.networkError) {
          try {
            const blob = file.slice(0, file.size, file.type);
            const queueId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await saveToQueue({
              id: queueId,
              registrationKey: queueId,
              sessionId,
              userId: identityId,
              blob,
              aisle: form.aisle,
              section: form.section,
              notes: "",
              isReceiving: form.aisle.trim().toLowerCase() === "receiving",
              isOnFloor: false,
              createdAt: Date.now(),
            });
            toast({ title: "Photo queued for upload when back online" });
          } catch {
            toast({ title: "Failed to queue photo", variant: "destructive" });
          }
        } else {
          toast({ title: "Upload failed", variant: "destructive" });
        }
        if (singleFileRef.current) singleFileRef.current.value = "";
        if (singleCameraRef.current) singleCameraRef.current.value = "";
        return;
      }
      result = uploadResult.data;
      pendingUploadResultsRef.current.set(fileKey, result);
    }
    try {
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
          registrationKey,
          objectStorageKey: result.objectPath,
          originalFilename: file.name,
          mimeType: file.type,
          fileSize: result.metadata?.size || file.size,
          aisle: form.aisle,
          section: form.section,
        });
        const savedPhoto = await res.json();
        pendingRegistrationKeysRef.current.delete(fileKey);
        pendingUploadResultsRef.current.delete(fileKey);
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
    markDirty(true);
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) {
      setErrors((e) => { const n = { ...e }; delete n[field]; return n; });
    }
    if (corruptedFields.has(field)) {
      setCorruptedFields(prev => { const n = new Set(prev); n.delete(field); return n; });
    }
  };

  const markTouched = (field: string) => {
    setTouched((t) => ({ ...t, [field]: true }));
  };

  const applyCatalogMatch = (match: ParsedCatalogEntry) => {
    markDirty(true);
    const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
    lastMatchedCatalog.current = match.catalog;
    userClearedFields.current.clear();
    setFootageOverride(false);
    const uniqueVendor = getUniqueVendor(match.catalog);
    setForm(f => {
      const aliasTag = match.aliasLabel ? `Alias: ${match.aliasLabel}` : null;
      const currentNotes = f.notes || "";
      const notes = aliasTag && !currentNotes.includes(aliasTag)
        ? (currentNotes ? `${currentNotes}\n${aliasTag}` : aliasTag)
        : currentNotes;
      return {
        ...f,
        reelTag: match.catalog,
        manufacturer: f.manufacturer || (uniqueVendor ?? ""),
        footage: match.footage ? (toDisplayUnit(match.footage, currentUnit) * reelCount).toString() : f.footage,
        conductors: f.conductors || match.conductors || "",
        notes,
      };
    });
    setCatalogSuggestions([]);
    setShowCatalogSuggestions(false);
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
      const displayFootage = form.footage ? parseInt(form.footage) : null;
      const totalFootage = displayFootage !== null ? toBaseFeet(displayFootage, currentUnit) : null;
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
        const patchRes = await apiRequest("PATCH", `/api/entries/${editingEntry.id}`, body);
        const updated = await patchRes.json().catch(() => null);
        result = { type: "update" as const, body, previousData: editingEntry, queued: false, serverUpdatedAt: updated?.updatedAt ?? undefined };
      } else {
        const { entry: created, queued } = await createEntryWithOfflineFallback(sessionId, body, identityId);
        result = { type: "create" as const, body, id: created.id, queued, serverUpdatedAt: queued ? undefined : (created?.updatedAt ?? undefined) };
      }
      return result;
    },
    onSuccess: (result) => {
      markDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      if (editingEntry?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/entries", editingEntry.id.toString(), "pin"] });
      }
      if (onUndoableSave && result) {
        if (result.type === "create") {
          onUndoableSave({ type: "create-entry", sessionId, entityId: result.id, data: result.body, serverUpdatedAt: result.serverUpdatedAt });
        } else if (result.type === "update" && editingEntry) {
          onUndoableSave({ type: "update-entry", sessionId, entityId: editingEntry.id, data: result.body, previousData: result.previousData, serverUpdatedAt: result.serverUpdatedAt });
        }
      }
      toast({ title: editingEntry ? "Entry updated" : (result?.queued ? "Entry queued for sync" : "Entry saved") });
      if (editingEntry) {
        onDoneEditing();
      } else {
        const savedAisle = form.aisle;
        const savedSection = form.section;
        setForm({
          aisle: keepLocation ? savedAisle : (defaultAisle || ""),
          section: keepLocation ? savedSection : (defaultSection || ""),
          position: "", reelTag: "", wireType: "", gauge: "",
          footage: "", color: "", manufacturer: "", notes: "", reelCount: "1", conductors: "",
        });
        setOnFloorInFront(false);
        setReceivingChecked(false);
        setFootageOverride(false);
        lastMatchedCatalog.current = null;
        userClearedFields.current.clear();
        setCapturedPhoto(null);
        setErrors({});
        setTouched({});
      }
    },
    onError: (error: Error) => {
      if (error.message.startsWith("503:")) {
        // Show reconfiguring state on the button; polling will clear it automatically.
        setEncodingReconfiguring(true);
        return;
      }
      toast({ title: "Failed to save entry", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast({ title: "Missing required fields", description: "Aisle and Section are required", variant: "destructive" });
      return;
    }
    // Warn if any originally-corrupted fields are still empty.
    // Check actual form values so a field that was typed then cleared is also caught.
    if (editingEntry && originalCorruptedRef.current.size > 0) {
      const formValues = form as Record<string, unknown>;
      const stillEmpty = Array.from(originalCorruptedRef.current).filter(
        f => !String(formValues[f] ?? "").trim()
      );
      if (stillEmpty.length > 0) {
        setStillEmptyAtSubmit(stillEmpty);
        setShowUnreadableConfirm(true);
        return;
      }
    }
    saveEntry.mutate();
  };

  const hasCorruption = editingEntry && corruptedFields.size > 0;
  const visibleCorrupted = hasCorruption ? Array.from(corruptedFields).filter(f => VISIBLE_ENCRYPTED_FIELDS.has(f)) : [];
  const hiddenCorrupted = hasCorruption ? Array.from(corruptedFields).filter(f => !VISIBLE_ENCRYPTED_FIELDS.has(f)) : [];

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-3">
      {hasCorruption && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm" data-testid="banner-corrupted-fields">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-destructive leading-tight">Some fields could not be decrypted</p>
            {visibleCorrupted.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Re-enter the highlighted fields:{" "}
                <span className="font-medium text-foreground">
                  {visibleCorrupted.map(f => FIELD_LABELS[f] ?? f).join(", ")}
                </span>
              </p>
            )}
            {hiddenCorrupted.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Will be cleared on save:{" "}
                <span className="font-medium text-foreground">
                  {hiddenCorrupted.map(f => FIELD_LABELS[f] ?? f).join(", ")}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
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
                <Button type="button" size="lg" className="flex-1 bg-[hsl(18_85%_48%)] hover:bg-[hsl(18_85%_40%)] text-white font-semibold text-base py-3" onClick={() => singleCameraRef.current?.click()} disabled={isUploading} data-testid="button-single-camera">
                  <Camera className="h-5 w-5 mr-2" />
                  Take Photo
                </Button>
                <Button type="button" size="lg" className="flex-1 bg-[hsl(18_85%_48%)] hover:bg-[hsl(18_85%_40%)] text-white font-semibold text-base py-3" onClick={() => singleFileRef.current?.click()} disabled={isUploading} data-testid="button-single-upload">
                  <ImagePlus className="h-5 w-5 mr-2" />
                  Upload Photo
                </Button>
                {isUploading && <Loader2 className="h-5 w-5 animate-spin self-center" />}
              </div>
              <div className="flex sm:hidden items-center justify-center gap-4">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white border-red-700" onClick={() => singleCameraRef.current?.click()} disabled={isUploading} data-testid="button-single-camera-mobile" title="Take Photo">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </Button>
                <Button type="button" className="bg-orange-500 hover:bg-orange-600 text-white border-orange-600" onClick={() => singleFileRef.current?.click()} disabled={isUploading} data-testid="button-single-upload-mobile" title="Upload Photo">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
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
            enterKeyHint="next"
            className={touched.aisle && errors.aisle ? "border-destructive" : ""}
            data-testid="input-aisle"
          />
          {touched.aisle && errors.aisle && (
            <p className="text-xs text-destructive" data-testid="error-aisle">{errors.aisle}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Section:</Label>
          <Input
            value={form.section}
            onChange={(e) => update("section", e.target.value)}
            onBlur={() => markTouched("section")}
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
                preReceivingSnapshot.current = { aisle: form.aisle, section: form.section };
                update("aisle", "Receiving");
                const nextSection = getNextReceivingSection ? getNextReceivingSection() : "000";
                update("section", nextSection);
              } else {
                const snap = preReceivingSnapshot.current;
                preReceivingSnapshot.current = null;
                update("aisle", snap ? snap.aisle : "");
                update("section", snap ? snap.section : "");
              }
            }}
            data-testid="checkbox-receiving"
          />
          Receiving
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={onFloorInFront}
            onCheckedChange={(c) => {
              const checked = !!c;
              markDirty(true);
              setOnFloorInFront(checked);
              setForm((f) => {
                const parts = f.notes.split("; ").filter(p => p.trim() && p.trim() !== "On the floor, in front of." && p.trim() !== "On Floor" && p.trim() !== "In Front Of");
                if (checked) parts.unshift("On the floor, in front of.");
                return { ...f, notes: parts.join("; ") };
              });
            }}
            data-testid="checkbox-on-floor-in-front"
          />
          On Floor, In Front Of
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 relative">
          <Label className="text-xs underline">
            Catalog:
            {corruptedFields.has("reelTag") && <AlertTriangle className="inline h-3.5 w-3.5 text-destructive ml-1" />}
          </Label>
          <Input
            value={form.reelTag}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              update("reelTag", val);
              if (val.length >= 2) {
                const matches = lookupCatalog(val, userParsedCatalog);
                setCatalogSuggestions(matches);
                setShowCatalogSuggestions(matches.length > 0);
              } else {
                setCatalogSuggestions([]);
                setShowCatalogSuggestions(false);
              }
            }}
            onFocus={() => {
              if (form.reelTag && form.reelTag.length >= 2) {
                const matches = lookupCatalog(form.reelTag, userParsedCatalog);
                setCatalogSuggestions(matches);
                setShowCatalogSuggestions(matches.length > 0);
              }
            }}
            onBlur={() => {
              setTimeout(() => setShowCatalogSuggestions(false), 200);
              const match = getCatalogMatch(form.reelTag);
              if (match) {
                applyCatalogMatch(match);
              } else if (form.reelTag && form.reelTag.length >= 2) {
                const allMatches = lookupCatalog(form.reelTag, userParsedCatalog);
                if (allMatches.length > 1) {
                  toast({ title: "Ambiguous catalog entry", description: "Multiple matches found — select one from the dropdown.", variant: "destructive" });
                }
              }
            }}
            enterKeyHint="next"
            autoComplete="off"
            className={corruptedFields.has("reelTag") ? "border-destructive focus-visible:ring-destructive" : ""}
            data-testid="input-reel-tag"
          />
          {showCatalogSuggestions && catalogSuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid="catalog-suggestions">
              {catalogSuggestions.map((s) => (
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
                  {s.aliasLabel ? (
                    <>
                      <span className="font-mono font-semibold">{s.aliasLabel}</span>
                      <span className="text-muted-foreground mx-1 text-xs">→</span>
                      <span className="font-mono text-xs">{s.catalog}</span>
                      <span className="text-muted-foreground ml-1 text-xs">({s.vendor})</span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono font-semibold">{s.catalog}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{s.description}</span>
                      {s.footage && <span className="text-orange-500 ml-1 text-xs">({toDisplayUnit(s.footage, currentUnit)}{uLabel})</span>}
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">
            Vendor Code:
            {corruptedFields.has("manufacturer") && <AlertTriangle className="inline h-3.5 w-3.5 text-destructive ml-1" />}
          </Label>
          <Input value={form.manufacturer} onChange={(e) => {
            const val = e.target.value.toUpperCase();
            if (!val && form.manufacturer) {
              userClearedFields.current.add("manufacturer");
            } else if (val) {
              userClearedFields.current.delete("manufacturer");
            }
            update("manufacturer", val);
          }} enterKeyHint="next" list="vendor-code-suggestions-single" className={corruptedFields.has("manufacturer") ? "border-destructive focus-visible:ring-destructive" : ""} data-testid="input-manufacturer" />
          <datalist id="vendor-code-suggestions-single">
            {vendorCodes.map(code => (
              <option key={code} value={code} />
            ))}
          </datalist>
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
            enterKeyHint="next"
            data-testid="input-reel-count"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Total Footage ({uLabel}):</Label>
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
        <Label className="text-xs underline">
          Notes:
          {corruptedFields.has("notes") && <AlertTriangle className="inline h-3.5 w-3.5 text-destructive ml-1" />}
        </Label>
        <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Notes..." rows={2} enterKeyHint="done" className={corruptedFields.has("notes") ? "border-destructive focus-visible:ring-destructive" : ""} data-testid="input-notes" />
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
            onClick={() => flagMutation.mutate({ pinId: linkedPin.id, flagged: !linkedPin.flagged, prevFlagged: !!linkedPin.flagged, prevFlagReason: linkedPin.flagReason ?? null })}
            data-testid="button-toggle-flag-edit"
          >
            <Flag className="h-3.5 w-3.5 mr-1" />
            {linkedPin.flagged ? "Flagged for Re-shoot" : "Flag for Re-shoot"}
          </Button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {editingEntry && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (formDirtyRef.current) {
                  const confirmed = window.confirm("You have unsaved changes. Discard them?");
                  if (!confirmed) return;
                }
                markDirty(false);
                onDoneEditing();
              }}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
          )}
          {!editingEntry && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                markDirty(false);
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
                setOnFloorInFront(false);
                setReceivingChecked(false);
                setFootageOverride(false);
                lastMatchedCatalog.current = null;
                userClearedFields.current.clear();
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
            size={editingEntry ? "lg" : "default"}
            className={editingEntry ? "w-full" : undefined}
            disabled={saveEntry.isPending || !canEdit || encodingReconfiguring}
            data-testid="button-save-entry"
          >
            {(saveEntry.isPending || encodingReconfiguring) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {encodingReconfiguring ? "Reconfiguring\u2026" : editingEntry ? "Update" : "Save Entry"}
          </Button>
        </div>
      </div>
    </form>

    <AlertDialog open={showUnreadableConfirm} onOpenChange={setShowUnreadableConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save with missing data?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {(() => {
                const editable = stillEmptyAtSubmit.filter(f => VISIBLE_ENCRYPTED_FIELDS.has(f));
                const uneditable = stillEmptyAtSubmit.filter(f => !VISIBLE_ENCRYPTED_FIELDS.has(f));
                return (
                  <>
                    {editable.length > 0 && (
                      <p>
                        The following fields could not be decrypted and are still empty — go back to fill them in:{" "}
                        <span className="font-medium text-foreground">
                          {editable.map(f => FIELD_LABELS[f] ?? f).join(", ")}
                        </span>
                      </p>
                    )}
                    {uneditable.length > 0 && (
                      <p>
                        The following fields could not be decrypted and cannot be re-entered here — they will be saved as empty:{" "}
                        <span className="font-medium text-foreground">
                          {uneditable.map(f => FIELD_LABELS[f] ?? f).join(", ")}
                        </span>
                      </p>
                    )}
                    <p>
                      {editable.length > 0
                        ? "You can cancel and fill in the editable fields, or save anyway to clear all missing data."
                        : "Saving now will store these fields as empty."}
                    </p>
                  </>
                );
              })()}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-save-unreadable">Go back</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-confirm-save-unreadable"
            onClick={() => { setShowUnreadableConfirm(false); saveEntry.mutate(); }}
          >
            Save anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
