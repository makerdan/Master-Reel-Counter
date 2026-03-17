import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Settings, Shield, ShieldOff, AlertTriangle, Lock,
  Unlock, Loader2, Cable, LogOut, Info, Pencil, Check, X, Mail,
  Download, Camera, Keyboard, Sun, Moon, Monitor, Image, Target,
  ChevronDown, Ruler, Building2, FileText, Globe, Upload, Trash2,
  HardDrive, RefreshCw, Plus, Search, FileUp, Key, Eye, EyeOff, Copy,
  Users, UserCheck, UserX,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ThemeToggle } from "@/components/theme-toggle";
import HelpMenu from "@/components/HelpMenu";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/lib/theme-provider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useWireCategories } from "@/hooks/use-wire-categories";
import { CATALOG, parseCatalogEntry } from "@/lib/wireReference";
import { toDisplayUnit, toBaseFeet, unitLabel, unitLabelFull } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";
import * as XLSX from "xlsx";
import type { UserWireCategory } from "@shared/schema";

interface UserSettingsResponse {
  userId: string;
  encodingEnabled: boolean;
  defaultExportFormat: string;
  companyName: string | null;
  companyLogoKey: string | null;
  exportFooterText: string | null;
  photoQuality: number;
  useReceivingQuality: boolean;
  receivingPhotoQuality: number;
  defaultAislePrefix: string | null;
  sectionAdvanceStep: number;
  defaultUnit: string;
  defaultTheme: string;
  thumbnailSize: string;
  largerTouchTargets: boolean;
  textSize: string;
  timezone: string;
  testerPassword: string | null;
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { setThemeMode } = useTheme();
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [limitationsOpen, setLimitationsOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [feedbackTopic, setFeedbackTopic] = useState("BUG_REPORT");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [localPhotoQuality, setLocalPhotoQuality] = useState<number | null>(null);
  const [localReceivingQuality, setLocalReceivingQuality] = useState<number | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [testerPassword, setTesterPassword] = useState("");
  const [testerPasswordConfirm, setTesterPasswordConfirm] = useState("");
  const [showTesterPassword, setShowTesterPassword] = useState(false);
  const [showTesterPasswordConfirm, setShowTesterPasswordConfirm] = useState(false);
  const [testerPasswordLoaded, setTesterPasswordLoaded] = useState(false);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
    }
  }, [user]);

  const updateName = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string }) => {
      const res = await apiRequest("PATCH", "/api/user/profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setEditingName(false);
      toast({ title: "Name updated" });
    },
    onError: () => {
      toast({ title: "Failed to update name", variant: "destructive" });
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/user/profile/avatar", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Photo updated" });
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    },
    onError: () => {
      toast({ title: "Failed to upload photo", variant: "destructive" });
    },
  });

  const removeAvatar = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/user/profile/avatar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Photo removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove photo", variant: "destructive" });
    },
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/settings/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Logo uploaded" });
      if (logoInputRef.current) logoInputRef.current.value = "";
    },
    onError: () => {
      toast({ title: "Failed to upload logo", variant: "destructive" });
    },
  });

  const removeLogo = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/settings/logo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Logo removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove logo", variant: "destructive" });
    },
  });

  const { data: settings, isLoading, isError: settingsError } = useQuery<UserSettingsResponse>({
    queryKey: ["/api/settings"],
  });

  const { data: storageUsage, isLoading: storageLoading } = useQuery<{
    userBytes: number;
    userPhotoCount: number;
    userSessionCount: number;
    unknownSizeCount: number;
  }>({
    queryKey: ["/api/storage/usage"],
  });

  const { data: globalUsage } = useQuery<{
    totalBytes: number;
    totalPhotoCount: number;
    distinctUserCount: number;
  }>({
    queryKey: ["/api/storage/global-usage"],
    queryFn: async () => {
      const res = await fetch("/api/storage/global-usage", { credentials: "include" });
      if (!res.ok) throw new Error("Not authorized");
      return res.json();
    },
    retry: false,
  });

  const { data: adminUsers, isLoading: adminUsersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  const toggleApproval = useMutation({
    mutationFn: async ({ userId, approved }: { userId: string; approved: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/approval`, { approved });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User approval updated" });
    },
    onError: () => {
      toast({ title: "Failed to update approval", variant: "destructive" });
    },
  });

  const rejectUser = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User rejected" });
    },
    onError: () => {
      toast({ title: "Failed to reject user", variant: "destructive" });
    },
  });

  const clearRejected = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/users/clear-rejected");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Block list cleared", description: "Previously rejected users can now sign in again." });
    },
    onError: () => {
      toast({ title: "Failed to clear block list", variant: "destructive" });
    },
  });

  const backfillSizes = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/storage/backfill-sizes");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage/usage"] });
      toast({ title: "Backfill complete", description: `Updated ${data.updated} of ${data.total} photos${data.failed ? ` (${data.failed} failed)` : ""}` });
    },
    onError: () => {
      toast({ title: "Backfill failed", variant: "destructive" });
    },
  });

  const hasTesterPassword = settings?.testerPassword === "********";

  useEffect(() => {
    if (settings && !testerPasswordLoaded) {
      setTesterPassword("");
      setTesterPasswordLoaded(true);
    }
  }, [settings, testerPasswordLoaded]);

  const saveTesterPassword = useMutation({
    mutationFn: async (pw: string) => {
      const res = await apiRequest("PATCH", "/api/settings", { testerPassword: pw || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setTesterPassword("");
      setTesterPasswordConfirm("");
      toast({ title: "Tester password saved" });
    },
    onError: () => {
      toast({ title: "Failed to save tester password", variant: "destructive" });
    },
  });

  const toggleEncoding = useMutation({
    mutationFn: async ({ enabled }: { enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/settings/encoding", { enabled });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      if (data.encodingEnabled) {
        toast({ title: "Data encoding enabled", description: `${data.entriesEncoded || 0} entries have been encoded.` });
      } else {
        toast({ title: "Data encoding disabled", description: `${data.entriesDecoded || 0} entries have been decoded.` });
      }
    },
    onError: () => {
      toast({ title: "Failed to change encoding setting", variant: "destructive" });
    },
  });

  const updateSetting = useMutation({
    mutationFn: async (data: Partial<UserSettingsResponse>) => {
      const res = await apiRequest("PATCH", "/api/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => {
      toast({ title: "Failed to save setting", variant: "destructive" });
    },
  });

  const saveSetting = (field: string, value: any) => {
    updateSetting.mutate({ [field]: value } as any);
  };

  const submitFeedback = useMutation({
    mutationFn: async (data: { topic: string; message: string; page: string }) => {
      const res = await apiRequest("POST", "/api/feedback", data);
      return res.json();
    },
    onSuccess: () => {
      setFeedbackSent(true);
      setFeedbackMessage("");
      setFeedbackTopic("BUG_REPORT");
      setTimeout(() => setFeedbackSent(false), 3000);
    },
    onError: () => {
      toast({ title: "Failed to send feedback", variant: "destructive" });
    },
  });

  const {
    categories: wireCategories,
    isLoading: wireCategoriesLoading,
    addCategory,
    isAdding: isAddingCategory,
    bulkAddCategories,
    isBulkAdding,
    deleteCategory,
  } = useWireCategories();

  const [wireCatSearch, setWireCatSearch] = useState("");
  const [showAddCategoryForm, setShowAddCategoryForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBuiltInCatalog, setShowBuiltInCatalog] = useState(false);
  const [builtInSearch, setBuiltInSearch] = useState("");
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<Omit<UserWireCategory, "id" | "userId">[] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const [newCat, setNewCat] = useState({
    catalog: "", vendor: "", reelLength: "", description: "",
    color: "", jacketType: "", conductors: "", groundSize: "", wireType: "",
  });

  const filteredWireCategories = useMemo(() => {
    if (!wireCatSearch.trim()) return wireCategories;
    const q = wireCatSearch.toLowerCase();
    return wireCategories.filter(c =>
      c.catalog.toLowerCase().includes(q) ||
      c.vendor.toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q) ||
      (c.wireType || "").toLowerCase().includes(q)
    );
  }, [wireCategories, wireCatSearch]);

  const filteredBuiltIn = useMemo(() => {
    if (!builtInSearch.trim()) return CATALOG;
    const q = builtInSearch.toLowerCase();
    return CATALOG.filter(c =>
      c.catalog.toLowerCase().includes(q) ||
      c.vendor.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  }, [builtInSearch]);

  const parseCsvForImport = (text: string) => {
    setBulkError(null);
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) {
      setBulkError("CSV must have a header row and at least one data row.");
      setBulkPreview(null);
      return;
    }
    const headerLine = lines[0];
    const sep = headerLine.includes("\t") ? "\t" : ",";
    const headers = headerLine.split(sep).map(h => h.trim().toLowerCase().replace(/[^a-z_\s]/g, ""));
    const colMap: Record<string, number> = {};
    const aliases: Record<string, string[]> = {
      catalog: ["catalog", "category", "sku", "code", "catalog code", "category code"],
      vendor: ["vendor", "vendor code"],
      reelLength: ["reel length", "reellength", "footage", "length", "reel_length", "feet"],
      description: ["description", "notes", "desc"],
      color: ["color", "colour"],
      jacketType: ["jacket type", "jackettype", "jacket_type", "jacket"],
      conductors: ["conductors", "number of conductors", "conductor count", "num conductors"],
      groundSize: ["ground size", "groundsize", "ground_size", "ground"],
      wireType: ["wire type", "wiretype", "wire_type", "type"],
      unit: ["unit", "units", "unit of measure", "uom"],
    };
    for (const [field, fieldAliases] of Object.entries(aliases)) {
      const idx = headers.findIndex(h => fieldAliases.includes(h));
      if (idx >= 0) colMap[field] = idx;
    }
    if (!("catalog" in colMap) || !("vendor" in colMap) || !("reelLength" in colMap)) {
      setBulkError("CSV must have columns for: Catalog (or SKU/Code), Vendor, and Reel Length (or Footage).");
      setBulkPreview(null);
      return;
    }
    const rows: Omit<UserWireCategory, "id" | "userId">[] = [];
    const errors: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim().replace(/^["']|["']$/g, ""));
      const catalog = cols[colMap.catalog] || "";
      const vendor = cols[colMap.vendor] || "";
      const reelLengthStr = cols[colMap.reelLength] || "";
      const rawReelLength = parseInt(reelLengthStr);
      if (!catalog) { errors.push(`Row ${i + 1}: missing catalog code`); continue; }
      if (!vendor) { errors.push(`Row ${i + 1}: missing vendor`); continue; }
      if (isNaN(rawReelLength) || rawReelLength <= 0) { errors.push(`Row ${i + 1}: invalid reel length "${reelLengthStr}"`); continue; }
      const rowUnitStr = colMap.unit !== undefined ? (cols[colMap.unit] || "").toLowerCase().trim() : "";
      const rowUnit: UnitType = rowUnitStr === "meters" || rowUnitStr === "m" ? "meters" : rowUnitStr === "feet" || rowUnitStr === "ft" ? "feet" : currentUnit;
      const reelLength = toBaseFeet(rawReelLength, rowUnit);
      rows.push({
        catalog,
        vendor,
        reelLength,
        description: colMap.description !== undefined ? (cols[colMap.description] || null) : null,
        color: colMap.color !== undefined ? (cols[colMap.color] || null) : null,
        jacketType: colMap.jacketType !== undefined ? (cols[colMap.jacketType] || null) : null,
        conductors: colMap.conductors !== undefined ? (cols[colMap.conductors] || null) : null,
        groundSize: colMap.groundSize !== undefined ? (cols[colMap.groundSize] || null) : null,
        wireType: colMap.wireType !== undefined ? (cols[colMap.wireType] || null) : null,
      });
    }
    if (errors.length > 0 && rows.length === 0) {
      setBulkError(errors.join("; "));
      setBulkPreview(null);
      return;
    }
    if (errors.length > 0) {
      setBulkError(`${errors.length} row(s) skipped: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`);
    }
    setBulkPreview(rows);
  };

  const parseExcelForImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        setBulkCsvText(csv);
        parseCsvForImport(csv);
      } catch {
        setBulkError("Failed to parse Excel file. Make sure it's a valid .xlsx or .xls file.");
        setBulkPreview(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const exportWireCategories = (format: "csv" | "xlsx") => {
    const headers = ["Catalog", "Vendor", `Reel Length (${unitLabelFull(currentUnit)})`, "Description", "Color", "Jacket Type", "Conductors", "Ground Size", "Wire Type", "Source"];
    const builtInRows = CATALOG.map(c => {
      const parsed = parseCatalogEntry(c);
      return [c.catalog, c.vendor, parsed.footage ? String(toDisplayUnit(parsed.footage, currentUnit)) : "", c.description, "", "", "", "", parsed.wireType || "", "Built-in"];
    });
    const customRows = wireCategories.map(c => [
      c.catalog, c.vendor, String(toDisplayUnit(c.reelLength, currentUnit)), c.description || "", c.color || "",
      c.jacketType || "", c.conductors || "", c.groundSize || "", c.wireType || "", "Custom",
    ]);
    const allRows = [headers, ...builtInRows, ...customRows];

    if (format === "csv") {
      const csvContent = allRows.map(row => row.map(cell => `"${(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wire-categories.csv";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const ws = XLSX.utils.aoa_to_sheet(allRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Wire Categories");
      XLSX.writeFile(wb, "wire-categories.xlsx");
    }
    toast({ title: `Exported ${CATALOG.length + wireCategories.length} categories as ${format.toUpperCase()}` });
  };

  const currentUnit: UnitType = (settings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);

  const encodingEnabled = settings?.encodingEnabled ?? false;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-3 max-w-3xl mx-auto">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setLocation("/")}
              data-testid="button-back-dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Settings className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Settings</span>
          </div>
          <div className="flex items-center gap-1">
            <HelpMenu mode="dashboard" />
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => logout()}
              data-testid="button-logout"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-[50vh] space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your account preferences, display, and data options.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Storage Usage</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/storage/usage"] });
                }}
                data-testid="button-refresh-storage"
              >
                <RefreshCw className={`h-4 w-4 ${storageLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {storageLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="storage-loading">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading storage info...
              </div>
            ) : storageUsage ? (() => {
              const STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;
              const pct = Math.min((storageUsage.userBytes / STORAGE_LIMIT) * 100, 100);
              const formatBytes = (b: number) => {
                if (b === 0) return "0 B";
                if (b < 1024) return `${b} B`;
                if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
                if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
                return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
              };
              const hasUnknown = storageUsage.unknownSizeCount > 0;
              return (
                <>
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-medium" data-testid="text-storage-used">
                        {formatBytes(storageUsage.userBytes)} used
                      </span>
                      <span className="text-muted-foreground" data-testid="text-storage-limit">
                        {formatBytes(STORAGE_LIMIT)} limit
                      </span>
                    </div>
                    <Progress value={pct} className="h-2.5" data-testid="progress-storage" />
                    <p className="text-xs text-muted-foreground mt-1.5" data-testid="text-storage-details">
                      {storageUsage.userPhotoCount} photo{storageUsage.userPhotoCount !== 1 ? "s" : ""} across {storageUsage.userSessionCount} session{storageUsage.userSessionCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {hasUnknown && (
                    <div className="flex items-center gap-2 bg-muted/50 rounded-md p-2.5">
                      <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 text-xs text-muted-foreground">
                        {storageUsage.unknownSizeCount} photo{storageUsage.unknownSizeCount !== 1 ? "s" : ""} missing file size data.
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => backfillSizes.mutate()}
                        disabled={backfillSizes.isPending}
                        data-testid="button-backfill-sizes"
                      >
                        {backfillSizes.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        )}
                        Calculate
                      </Button>
                    </div>
                  )}
                </>
              );
            })() : (
              <p className="text-sm text-muted-foreground" data-testid="text-storage-unavailable">Storage data unavailable.</p>
            )}
          </CardContent>
        </Card>

        {globalUsage && (() => {
          const STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;
          const pct = Math.min((globalUsage.totalBytes / STORAGE_LIMIT) * 100, 100);
          const formatBytes = (b: number) => {
            if (b === 0) return "0 B";
            if (b < 1024) return `${b} B`;
            if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
            if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
            return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
          };
          return (
            <Card data-testid="card-global-storage">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">App-Wide Storage</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/storage/global-usage"] })}
                      data-testid="button-refresh-global-storage"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Badge variant="secondary" data-testid="badge-owner">Owner</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-medium" data-testid="text-global-storage-used">
                      {formatBytes(globalUsage.totalBytes)} used
                    </span>
                    <span className="text-muted-foreground" data-testid="text-global-storage-limit">
                      {formatBytes(STORAGE_LIMIT)} limit
                    </span>
                  </div>
                  <Progress value={pct} className="h-2.5" data-testid="progress-global-storage" />
                  <p className="text-xs text-muted-foreground mt-1.5" data-testid="text-global-storage-details">
                    {globalUsage.totalPhotoCount} photo{globalUsage.totalPhotoCount !== 1 ? "s" : ""} across {globalUsage.distinctUserCount} user{globalUsage.distinctUserCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Display</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Theme</Label>
                <p className="text-xs text-muted-foreground">Choose your preferred color theme.</p>
              </div>
              <Select
                value={settings?.defaultTheme || "system"}
                onValueChange={(val) => {
                  saveSetting("defaultTheme", val);
                  setThemeMode(val as "light" | "dark" | "system");
                }}
                data-testid="select-default-theme"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light"><span className="flex items-center gap-2"><Sun className="h-3.5 w-3.5" /> Light</span></SelectItem>
                  <SelectItem value="dark"><span className="flex items-center gap-2"><Moon className="h-3.5 w-3.5" /> Dark</span></SelectItem>
                  <SelectItem value="system"><span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> System</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Dashboard Thumbnail Size</Label>
                <p className="text-xs text-muted-foreground">Size of session preview images on the dashboard.</p>
              </div>
              <Select
                value={settings?.thumbnailSize || "medium"}
                onValueChange={(val) => saveSetting("thumbnailSize", val)}
                data-testid="select-thumbnail-size"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-thumbnail">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Timezone</Label>
                <p className="text-xs text-muted-foreground">Used for all timestamps including photo capture times and PDF exports.</p>
              </div>
              <Select
                value={settings?.timezone || "America/Chicago"}
                onValueChange={(val) => saveSetting("timezone", val)}
                data-testid="select-timezone"
              >
                <SelectTrigger className="w-[200px]" data-testid="select-trigger-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                  <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                  <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                  <SelectItem value="America/Anchorage">Alaska (AKT)</SelectItem>
                  <SelectItem value="Pacific/Honolulu">Hawaii (HT)</SelectItem>
                  <SelectItem value="America/Phoenix">Arizona (MST)</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Accessibility</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Larger Touch Targets</Label>
                <p className="text-xs text-muted-foreground">Increases pin and button tap areas for easier interaction on mobile devices.</p>
              </div>
              <Switch
                checked={settings?.largerTouchTargets ?? false}
                onCheckedChange={(checked) => saveSetting("largerTouchTargets", checked)}
                data-testid="switch-larger-touch-targets"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Text Size</Label>
                <p className="text-xs text-muted-foreground">Adjust the base text size across the app. Disabled during Mobile Flow.</p>
              </div>
              <Select
                value={settings?.textSize || "default"}
                onValueChange={(val) => saveSetting("textSize", val)}
                data-testid="select-text-size"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-text-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small"><span style={{ fontSize: "12px" }}>Small</span></SelectItem>
                  <SelectItem value="default"><span style={{ fontSize: "14px" }}>Default</span></SelectItem>
                  <SelectItem value="large"><span style={{ fontSize: "17px" }}>Large</span></SelectItem>
                  <SelectItem value="extra-large"><span style={{ fontSize: "20px" }}>Extra Large</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Data Entry</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Default Starting Aisle</Label>
                <p className="text-xs text-muted-foreground">Auto-fill the aisle field with this value for new entries.</p>
              </div>
              <Input
                className="w-[140px]"
                placeholder="e.g. Receiving"
                value={settings?.defaultAislePrefix || ""}
                onChange={(e) => saveSetting("defaultAislePrefix", e.target.value || null)}
                data-testid="input-default-aisle-prefix"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Section Auto-Advance Step</Label>
                <p className="text-xs text-muted-foreground">How much the section number increments automatically (e.g., 1 = 01, 02, 03; 2 = 01, 03, 05).</p>
              </div>
              <Select
                value={String(settings?.sectionAdvanceStep || 1)}
                onValueChange={(val) => saveSetting("sectionAdvanceStep", parseInt(val))}
                data-testid="select-section-advance"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-section-advance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">By 1 (001, 002, 003...)</SelectItem>
                  <SelectItem value="2">By 2 (001, 003, 005...)</SelectItem>
                  <SelectItem value="3">By 3 (001, 004, 007...)</SelectItem>
                  <SelectItem value="5">By 5 (001, 006, 011...)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Default Unit of Measurement</Label>
                <p className="text-xs text-muted-foreground">Unit used for entering and displaying footage values. Changing this does not convert previously stored data — values are always stored internally in feet and converted for display.</p>
              </div>
              <Select
                value={settings?.defaultUnit || "feet"}
                onValueChange={(val) => saveSetting("defaultUnit", val)}
                data-testid="select-default-unit"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feet">Feet (ft)</SelectItem>
                  <SelectItem value="meters">Meters (m)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cable className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Wire Categories</CardTitle>
                {wireCategories.length > 0 && (
                  <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate" data-testid="badge-wire-category-count">
                    {wireCategories.length}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Add custom wire categories that appear in autocomplete alongside the built-in catalog.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => { setShowAddCategoryForm(!showAddCategoryForm); setShowBulkImport(false); }} data-testid="button-toggle-add-category">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Category
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setShowBulkImport(!showBulkImport); setShowAddCategoryForm(false); setBulkPreview(null); setBulkError(null); setBulkCsvText(""); }} data-testid="button-toggle-bulk-import">
                <FileUp className="h-3.5 w-3.5 mr-1" />
                Bulk Import
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportWireCategories("csv")} data-testid="button-export-csv">
                <Download className="h-3.5 w-3.5 mr-1" />
                Export CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportWireCategories("xlsx")} data-testid="button-export-xlsx">
                <Download className="h-3.5 w-3.5 mr-1" />
                Export Excel
              </Button>
            </div>

            {showAddCategoryForm && (
              <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Catalog Code *</Label>
                    <Input value={newCat.catalog} onChange={(e) => setNewCat(s => ({ ...s, catalog: e.target.value }))} placeholder="e.g. THHN10BK500" className="h-8 text-sm" data-testid="input-new-cat-catalog" />
                  </div>
                  <div>
                    <Label className="text-xs">Vendor *</Label>
                    <Input value={newCat.vendor} onChange={(e) => setNewCat(s => ({ ...s, vendor: e.target.value }))} placeholder="e.g. COP" className="h-8 text-sm" data-testid="input-new-cat-vendor" />
                  </div>
                  <div>
                    <Label className="text-xs">Reel Length ({uLabel}) *</Label>
                    <Input type="number" value={newCat.reelLength} onChange={(e) => setNewCat(s => ({ ...s, reelLength: e.target.value }))} placeholder={currentUnit === "meters" ? "e.g. 305" : "e.g. 1000"} className="h-8 text-sm" data-testid="input-new-cat-reel-length" />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Input value={newCat.description} onChange={(e) => setNewCat(s => ({ ...s, description: e.target.value }))} placeholder="Optional notes" className="h-8 text-sm" data-testid="input-new-cat-description" />
                  </div>
                  <div>
                    <Label className="text-xs">Color</Label>
                    <Input value={newCat.color} onChange={(e) => setNewCat(s => ({ ...s, color: e.target.value }))} placeholder="e.g. BK" className="h-8 text-sm" data-testid="input-new-cat-color" />
                  </div>
                  <div>
                    <Label className="text-xs">Jacket Type</Label>
                    <Input value={newCat.jacketType} onChange={(e) => setNewCat(s => ({ ...s, jacketType: e.target.value }))} placeholder="e.g. THHN" className="h-8 text-sm" data-testid="input-new-cat-jacket" />
                  </div>
                  <div>
                    <Label className="text-xs">Conductors</Label>
                    <Input value={newCat.conductors} onChange={(e) => setNewCat(s => ({ ...s, conductors: e.target.value }))} placeholder="e.g. 3" className="h-8 text-sm" data-testid="input-new-cat-conductors" />
                  </div>
                  <div>
                    <Label className="text-xs">Ground Size</Label>
                    <Input value={newCat.groundSize} onChange={(e) => setNewCat(s => ({ ...s, groundSize: e.target.value }))} placeholder="e.g. 10" className="h-8 text-sm" data-testid="input-new-cat-ground" />
                  </div>
                  <div>
                    <Label className="text-xs">Wire Type</Label>
                    <Input value={newCat.wireType} onChange={(e) => setNewCat(s => ({ ...s, wireType: e.target.value }))} placeholder="e.g. THHN, SER, URD" className="h-8 text-sm" data-testid="input-new-cat-wire-type" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!newCat.catalog.trim() || !newCat.vendor.trim() || !newCat.reelLength || isAddingCategory}
                    onClick={async () => {
                      try {
                        await addCategory({
                          catalog: newCat.catalog.trim(),
                          vendor: newCat.vendor.trim(),
                          reelLength: toBaseFeet(parseInt(newCat.reelLength), currentUnit),
                          description: newCat.description.trim() || null,
                          color: newCat.color.trim() || null,
                          jacketType: newCat.jacketType.trim() || null,
                          conductors: newCat.conductors.trim() || null,
                          groundSize: newCat.groundSize.trim() || null,
                          wireType: newCat.wireType.trim() || null,
                        });
                        setNewCat({ catalog: "", vendor: "", reelLength: "", description: "", color: "", jacketType: "", conductors: "", groundSize: "", wireType: "" });
                        toast({ title: "Category added" });
                      } catch {
                        toast({ title: "Failed to add category", variant: "destructive" });
                      }
                    }}
                    data-testid="button-save-category"
                  >
                    {isAddingCategory ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddCategoryForm(false)} data-testid="button-cancel-add-category">
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {showBulkImport && (
              <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Paste CSV or upload a file (CSV, TSV, or Excel). Required columns: <strong>Catalog</strong> (or SKU/Code), <strong>Vendor</strong>, <strong>Reel Length</strong> (or Footage). Optional: Description, Color, Jacket Type, Conductors, Ground Size, Wire Type, Unit.
                  Reel lengths are assumed to be in {unitLabelFull(currentUnit)} (your current setting) unless a <strong>Unit</strong> column specifies "ft" or "m" per row.
                </p>
                <Textarea
                  placeholder={"Catalog,Vendor,Reel Length,Description,Wire Type\nTHHN10BK500,COP,500,#10 AWG THHN Black,THHN\nSER224500,COP,500,2/0-2/0-4 SER Cable,SER"}
                  value={bulkCsvText}
                  onChange={(e) => { setBulkCsvText(e.target.value); setBulkPreview(null); setBulkError(null); }}
                  rows={5}
                  className="text-xs font-mono"
                  data-testid="textarea-bulk-csv"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => csvFileInputRef.current?.click()} data-testid="button-upload-csv">
                    <Upload className="h-3 w-3 mr-1" />
                    Upload File
                  </Button>
                  <input
                    ref={csvFileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
                      if (isExcel) {
                        parseExcelForImport(file);
                      } else {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const text = ev.target?.result as string;
                          setBulkCsvText(text);
                          parseCsvForImport(text);
                        };
                        reader.readAsText(file);
                      }
                      if (csvFileInputRef.current) csvFileInputRef.current.value = "";
                    }}
                    data-testid="input-csv-file"
                  />
                  <Button size="sm" onClick={() => parseCsvForImport(bulkCsvText)} disabled={!bulkCsvText.trim()} data-testid="button-preview-csv">
                    Preview
                  </Button>
                </div>
                {bulkError && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded p-2" data-testid="text-bulk-error">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {bulkError}
                  </div>
                )}
                {bulkPreview && bulkPreview.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">{bulkPreview.length} categories ready to import:</p>
                    <div className="max-h-40 overflow-y-auto border rounded">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="text-left p-1.5 font-medium">Catalog</th>
                            <th className="text-left p-1.5 font-medium">Vendor</th>
                            <th className="text-right p-1.5 font-medium">Length</th>
                            <th className="text-left p-1.5 font-medium">Wire Type</th>
                            <th className="text-left p-1.5 font-medium">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkPreview.slice(0, 20).map((row, i) => (
                            <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/20"} data-testid={`row-bulk-preview-${i}`}>
                              <td className="p-1.5 font-mono">{row.catalog}</td>
                              <td className="p-1.5">{row.vendor}</td>
                              <td className="p-1.5 text-right tabular-nums">{toDisplayUnit(row.reelLength, currentUnit)} {uLabel}</td>
                              <td className="p-1.5">{row.wireType || "—"}</td>
                              <td className="p-1.5 truncate max-w-[120px]">{row.description || "—"}</td>
                            </tr>
                          ))}
                          {bulkPreview.length > 20 && (
                            <tr><td colSpan={5} className="p-1.5 text-center text-muted-foreground">...and {bulkPreview.length - 20} more</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <Button
                      size="sm"
                      disabled={isBulkAdding}
                      onClick={async () => {
                        try {
                          await bulkAddCategories(bulkPreview);
                          toast({ title: `${bulkPreview.length} categories imported` });
                          setBulkPreview(null);
                          setBulkCsvText("");
                          setBulkError(null);
                          setShowBulkImport(false);
                        } catch {
                          toast({ title: "Failed to import categories", variant: "destructive" });
                        }
                      }}
                      data-testid="button-confirm-bulk-import"
                    >
                      {isBulkAdding ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                      Import {bulkPreview.length} Categories
                    </Button>
                  </div>
                )}
              </div>
            )}

            {wireCategories.length > 0 && (
              <>
                {wireCategories.length > 5 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search categories..."
                      value={wireCatSearch}
                      onChange={(e) => setWireCatSearch(e.target.value)}
                      className="h-8 text-sm pl-8"
                      data-testid="input-search-wire-categories"
                    />
                  </div>
                )}
                <div className="max-h-60 overflow-y-auto border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-1.5 font-medium">Catalog</th>
                        <th className="text-left p-1.5 font-medium">Vendor</th>
                        <th className="text-right p-1.5 font-medium">Length</th>
                        <th className="text-left p-1.5 font-medium">Wire Type</th>
                        <th className="text-left p-1.5 font-medium">Description</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWireCategories.map((cat) => (
                        <tr key={cat.id} className="hover:bg-muted/30" data-testid={`row-wire-category-${cat.id}`}>
                          <td className="p-1.5 font-mono font-medium">{cat.catalog}</td>
                          <td className="p-1.5">{cat.vendor}</td>
                          <td className="p-1.5 text-right tabular-nums">{toDisplayUnit(cat.reelLength, currentUnit)} {uLabel}</td>
                          <td className="p-1.5">{cat.wireType || "—"}</td>
                          <td className="p-1.5 truncate max-w-[120px]" title={[cat.description, cat.color, cat.jacketType, cat.conductors ? `${cat.conductors} cond` : null, cat.groundSize ? `GND ${cat.groundSize}` : null].filter(Boolean).join(" | ")}>
                            {cat.description || "—"}
                          </td>
                          <td className="p-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => deleteCategory(cat.id)}
                              data-testid={`button-delete-category-${cat.id}`}
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {filteredWireCategories.length === 0 && (
                        <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">No matching categories found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {wireCategories.length === 0 && !wireCategoriesLoading && !showAddCategoryForm && !showBulkImport && (
              <p className="text-xs text-muted-foreground italic" data-testid="text-no-wire-categories">
                No custom categories yet. Add categories individually or import them in bulk.
              </p>
            )}

            <div className="border-t pt-3 mt-2">
              <button
                className="flex items-center gap-2 w-full text-left text-sm font-medium"
                onClick={() => setShowBuiltInCatalog(!showBuiltInCatalog)}
                data-testid="button-toggle-built-in-catalog"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showBuiltInCatalog ? "" : "-rotate-90"}`} />
                Built-in Catalog
                <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate ml-1">
                  {CATALOG.length}
                </Badge>
              </button>
              {showBuiltInCatalog && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    These are the default wire entries included with the app. They are always available in autocomplete.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search built-in catalog..."
                      value={builtInSearch}
                      onChange={(e) => setBuiltInSearch(e.target.value)}
                      className="h-8 text-sm pl-8"
                      data-testid="input-search-built-in-catalog"
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto border rounded-md">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-1.5 font-medium">Catalog</th>
                          <th className="text-left p-1.5 font-medium">Vendor</th>
                          <th className="text-left p-1.5 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBuiltIn.map((entry, idx) => (
                          <tr key={idx} className="hover:bg-muted/30" data-testid={`row-built-in-${idx}`}>
                            <td className="p-1.5 font-mono font-medium">{entry.catalog}</td>
                            <td className="p-1.5">{entry.vendor}</td>
                            <td className="p-1.5 truncate max-w-[180px]" title={entry.description}>{entry.description}</td>
                          </tr>
                        ))}
                        {filteredBuiltIn.length === 0 && (
                          <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">No matching entries found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Showing {filteredBuiltIn.length} of {CATALOG.length} entries
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Photo Capture</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <Label className="text-sm font-medium">Photo Quality</Label>
                  <p className="text-xs text-muted-foreground">Lower quality saves bandwidth but may reduce zoom clarity on reel labels. Higher quality preserves detail for accurate reading.</p>
                </div>
                <span className="text-sm font-mono font-semibold tabular-nums w-[3ch] text-right" data-testid="text-photo-quality-value">{localPhotoQuality ?? settings?.photoQuality ?? 85}%</span>
              </div>
              <Slider
                value={[localPhotoQuality ?? settings?.photoQuality ?? 85]}
                onValueChange={(val) => setLocalPhotoQuality(val[0])}
                onValueCommit={(val) => { saveSetting("photoQuality", val[0]); setLocalPhotoQuality(null); }}
                min={30}
                max={100}
                step={5}
                className="w-full"
                data-testid="slider-photo-quality"
              />
              <div className="relative w-full h-4 mt-0.5">
                {[30, 40, 50, 60, 70, 80, 85, 90, 95, 100].map((tick) => {
                  const pct = ((tick - 30) / 70) * 100;
                  const isSelected = (localPhotoQuality ?? settings?.photoQuality ?? 85) === tick;
                  return (
                    <div
                      key={tick}
                      className="absolute flex flex-col items-center"
                      style={{ left: `calc(10px + (100% - 20px) * ${pct / 100})`, transform: "translateX(-50%)" }}
                    >
                      <div className={`w-px h-1.5 ${isSelected ? "bg-primary" : "bg-muted-foreground/40"}`} />
                      <span className={`text-[9px] tabular-nums ${isSelected ? "text-primary font-semibold" : "text-muted-foreground/60"}`}>
                        {tick}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t pt-3 mt-3">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="flex-1">
                  <Label className="text-sm font-medium">Receiving — Quality Override</Label>
                  <p className="text-xs text-muted-foreground">Reels in Receiving are typically photographed up close, so high zoom clarity isn't needed. Enable this to automatically use a lower quality for Receiving photos, saving bandwidth and storage.</p>
                </div>
                <Switch
                  checked={settings?.useReceivingQuality ?? false}
                  onCheckedChange={(checked) => saveSetting("useReceivingQuality", checked)}
                  data-testid="switch-receiving-quality"
                />
              </div>
              {settings?.useReceivingQuality && (
                <div className="pl-2 border-l-2 border-primary/20 ml-1 mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-4">
                    <Label className="text-xs text-muted-foreground">Receiving photo quality</Label>
                    <span className="text-sm font-mono font-semibold tabular-nums w-[3ch] text-right" data-testid="text-receiving-quality-value">{localReceivingQuality ?? settings?.receivingPhotoQuality ?? 50}%</span>
                  </div>
                  <Slider
                    value={[localReceivingQuality ?? settings?.receivingPhotoQuality ?? 50]}
                    onValueChange={(val) => setLocalReceivingQuality(val[0])}
                    onValueCommit={(val) => { saveSetting("receivingPhotoQuality", val[0]); setLocalReceivingQuality(null); }}
                    min={30}
                    max={100}
                    step={5}
                    className="w-full"
                    data-testid="slider-receiving-quality"
                  />
                  <div className="relative w-full h-4 mt-0.5">
                    {[30, 40, 50, 60, 70, 80, 90, 100].map((tick) => {
                      const pct = ((tick - 30) / 70) * 100;
                      const isSelected = (localReceivingQuality ?? settings?.receivingPhotoQuality ?? 50) === tick;
                      return (
                        <div
                          key={tick}
                          className="absolute flex flex-col items-center"
                          style={{ left: `calc(10px + (100% - 20px) * ${pct / 100})`, transform: "translateX(-50%)" }}
                        >
                          <div className={`w-px h-1.5 ${isSelected ? "bg-primary" : "bg-muted-foreground/40"}`} />
                          <span className={`text-[9px] tabular-nums ${isSelected ? "text-primary font-semibold" : "text-muted-foreground/60"}`}>
                            {tick}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Export</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Default Export Format</Label>
                <p className="text-xs text-muted-foreground">Preferred format when exporting session data.</p>
              </div>
              <Select
                value={settings?.defaultExportFormat || "pdf"}
                onValueChange={(val) => saveSetting("defaultExportFormat", val)}
                data-testid="select-export-format"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf"><span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> PDF</span></SelectItem>
                  <SelectItem value="csv"><span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> CSV</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm font-medium">Company Name</Label>
              <p className="text-xs text-muted-foreground">Appears in the header of exported PDF reports.</p>
              <Input
                placeholder="e.g. Acme Wire Co."
                value={settings?.companyName || ""}
                onChange={(e) => saveSetting("companyName", e.target.value || null)}
                data-testid="input-company-name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Company Logo</Label>
              <p className="text-xs text-muted-foreground">Displayed alongside company name in PDF headers. Images are resized to fit (max 300x80px).</p>
              {settings?.companyLogoKey ? (
                <div className="flex items-center gap-3">
                  <div className="border rounded-md p-2 bg-muted/30 flex items-center justify-center" style={{ minWidth: 80, minHeight: 40 }}>
                    <img
                      src={settings.companyLogoKey}
                      alt="Company logo"
                      className="max-w-[150px] max-h-[40px] object-contain"
                      data-testid="img-company-logo"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadLogo.isPending}
                      data-testid="button-change-logo"
                    >
                      {uploadLogo.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      <span className="ml-1">Change</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeLogo.mutate()}
                      disabled={removeLogo.isPending}
                      data-testid="button-remove-logo"
                    >
                      {removeLogo.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      <span className="ml-1">Remove</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadLogo.isPending}
                  data-testid="button-upload-logo"
                >
                  {uploadLogo.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                  Upload Logo
                </Button>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo.mutate(file);
                }}
                data-testid="input-logo-file"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm font-medium">PDF Footer Text</Label>
              <p className="text-xs text-muted-foreground">Custom text displayed at the bottom of each exported PDF page.</p>
              <Textarea
                placeholder="e.g. Confidential — Internal Use Only"
                value={settings?.exportFooterText || ""}
                onChange={(e) => saveSetting("exportFooterText", e.target.value || null)}
                rows={2}
                data-testid="input-export-footer"
              />
            </div>
          </CardContent>
        </Card>


        {!user?.isTester && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Tester Access</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set a password so testers can log in and view your sessions without a Replit account.
            </p>
            {hasTesterPassword && (
              <Badge variant="outline" className="text-green-600 border-green-300 w-fit">Password Set</Badge>
            )}
            <div className="space-y-2">
              <div className="relative">
                <Input
                  data-testid="input-tester-password-settings"
                  type={showTesterPassword ? "text" : "password"}
                  placeholder={hasTesterPassword ? "Enter new password" : "Enter tester password"}
                  value={testerPassword}
                  onChange={(e) => setTesterPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowTesterPassword(!showTesterPassword)}
                  data-testid="button-toggle-tester-password"
                >
                  {showTesterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <div className="relative">
                <Input
                  data-testid="input-tester-password-confirm"
                  type={showTesterPasswordConfirm ? "text" : "password"}
                  placeholder="Confirm password"
                  value={testerPasswordConfirm}
                  onChange={(e) => setTesterPasswordConfirm(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowTesterPasswordConfirm(!showTesterPasswordConfirm)}
                  data-testid="button-toggle-tester-password-confirm"
                >
                  {showTesterPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {testerPassword.trim() && testerPasswordConfirm.trim() && testerPassword !== testerPasswordConfirm && (
                <p className="text-xs text-destructive" data-testid="text-password-mismatch">Passwords do not match</p>
              )}
              <Button
                size="sm"
                onClick={() => saveTesterPassword.mutate(testerPassword)}
                disabled={saveTesterPassword.isPending || !testerPassword.trim() || !testerPasswordConfirm.trim() || testerPassword !== testerPasswordConfirm}
                data-testid="button-save-tester-password"
              >
                {saveTesterPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {hasTesterPassword && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Tester login URL:</span>
                  <code className="bg-muted px-2 py-0.5 rounded text-xs">/tester-login</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    data-testid="button-copy-tester-url"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/tester-login`);
                      toast({ title: "Copied to clipboard" });
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive w-fit"
                  data-testid="button-remove-tester-password"
                  onClick={() => {
                    saveTesterPassword.mutate("");
                    setTesterPassword("");
                  }}
                  disabled={saveTesterPassword.isPending}
                >
                  Remove Tester Password
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        )}


        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Data Encoding</CardTitle>
              {encodingEnabled ? (
                <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate" data-testid="badge-encoding-status">
                  <Lock className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate" data-testid="badge-encoding-status">
                  <Unlock className="h-3 w-3 mr-1" />
                  Off
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              When enabled, your reel entry data (wire type, gauge, color, reel tags, manufacturer, notes, pallet ID, and position) 
              will be encrypted in the database using AES-256 encryption. A unique encryption key is generated automatically 
              and secured by the server. The data is automatically decrypted when you view it in the app.
            </p>

            {settingsError ? (
              <div className="flex items-center gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <p className="text-sm">Failed to load encoding settings. Please try refreshing the page.</p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading settings...
              </div>
            ) : encodingEnabled ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-md bg-primary/10 border border-primary/20">
                  <Shield className="h-5 w-5 text-primary shrink-0" />
                  <p className="text-sm">
                    Your data is currently encoded. Entry details are stored as encrypted text in the database and decrypted on-the-fly when you access them.
                  </p>
                </div>

                <Button
                  variant="outline"
                  onClick={() => setConfirmDisableOpen(true)}
                  disabled={toggleEncoding.isPending}
                  data-testid="button-disable-encoding"
                >
                  {toggleEncoding.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ShieldOff className="h-4 w-4 mr-2" />
                  )}
                  Disable Encoding
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Encoding is currently off. Your entry data is stored as plain text in the database.
                  Enable encoding to encrypt sensitive fields automatically.
                </p>

                <Button
                  onClick={() => setConfirmEnableOpen(true)}
                  disabled={toggleEncoding.isPending}
                  data-testid="button-enable-encoding"
                >
                  {toggleEncoding.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Enable Encoding
                </Button>
              </div>
            )}

            <Separator />

            <Collapsible open={limitationsOpen} onOpenChange={setLimitationsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 px-2 w-full justify-start text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-semibold text-sm">Encoding Limitations</span>
                  <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${limitationsOpen ? "" : "-rotate-90"}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 mt-3 pl-1">
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">External API returns encoded data</p>
                      <p className="text-xs text-muted-foreground">
                        The Power Apps external API will return encrypted/unreadable values for encoded fields. 
                        Any systems pulling data via the external API will see encoded strings instead of readable text.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Manual entry and catalog autocomplete unaffected</p>
                      <p className="text-xs text-muted-foreground">
                        Category autocomplete and catalog lookup work from a built-in reference, not from stored entries. 
                        Any values you save will be encoded before storage.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">CSV/PDF exports are automatically decoded</p>
                      <p className="text-xs text-muted-foreground">
                        When you export data through the app, entries are decrypted before export so your files are readable. 
                        Only data accessed directly through the database or external APIs would appear encoded.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Toggling encoding migrates all existing entries</p>
                      <p className="text-xs text-muted-foreground">
                        When you turn encoding on, all your existing entries will be encrypted. When you turn it off, 
                        they will all be decrypted back to plain text. For large datasets this may take a moment.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Only entry details are encoded</p>
                      <p className="text-xs text-muted-foreground">
                        Encoding applies to text fields within entries (reel tags, wire type, gauge, color, manufacturer, notes, 
                        pallet ID, position). Session names, photo metadata, aisle/section identifiers, and numerical values 
                        like footage and reel counts remain unencoded for sorting and functionality.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Encryption key is managed automatically</p>
                      <p className="text-xs text-muted-foreground">
                        A unique encryption key is generated for your account and secured by the server. You don't need to 
                        remember a passphrase. The key is protected and cannot be read directly from the database.
                      </p>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cable className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Account</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const effectiveAvatar = user?.customAvatarKey || user?.profileImageUrl;
              const initials = [user?.firstName, user?.lastName].filter(Boolean).map(s => s![0]).join("").toUpperCase() || "?";
              return (
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={effectiveAvatar || undefined} alt="Profile photo" />
                    <AvatarFallback className="text-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      data-testid="input-avatar-file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadAvatar.mutate(file);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadAvatar.isPending}
                      data-testid="button-upload-avatar"
                    >
                      {uploadAvatar.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                      ) : (
                        <Upload className="h-3 w-3 mr-1.5" />
                      )}
                      Upload Photo
                    </Button>
                    {user?.customAvatarKey && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeAvatar.mutate()}
                        disabled={removeAvatar.isPending}
                        data-testid="button-remove-avatar"
                      >
                        {removeAvatar.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                        ) : (
                          <Trash2 className="h-3 w-3 mr-1.5" />
                        )}
                        Remove Photo
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}
            <Separator />
            {editingName ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-xs">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => updateName.mutate({ firstName, lastName })}
                    disabled={updateName.isPending || (!firstName.trim() && !lastName.trim())}
                    data-testid="button-save-name"
                  >
                    {updateName.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFirstName(user?.firstName || "");
                      setLastName(user?.lastName || "");
                      setEditingName(false);
                    }}
                    disabled={updateName.isPending}
                    data-testid="button-cancel-name"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-medium" data-testid="text-settings-username">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground">Signed in via Replit</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingName(true)}
                  data-testid="button-edit-name"
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit Name
                </Button>
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-end">
              <Button
                variant="outline"
                onClick={() => logout()}
                data-testid="button-settings-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Contact &amp; Feedback</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Questions, bug reports, or feature ideas? Send feedback directly to the developer.
            </p>
            {feedbackSent ? (
              <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/30 px-3 py-2 text-sm text-green-600 dark:text-green-400" data-testid="feedback-success-message">
                <Check className="h-4 w-4 shrink-0" />
                Thank you — feedback received!
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Topic</Label>
                  <Select value={feedbackTopic} onValueChange={setFeedbackTopic}>
                    <SelectTrigger className="h-8 text-sm" data-testid="select-feedback-topic">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUG_REPORT">Bug Report</SelectItem>
                      <SelectItem value="FEATURE_REQUEST">Feature Request</SelectItem>
                      <SelectItem value="DESIGN">Design Feedback</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Message</Label>
                  <Textarea
                    placeholder="Describe your feedback..."
                    value={feedbackMessage}
                    onChange={(e) => setFeedbackMessage(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    className="text-sm resize-none"
                    data-testid="textarea-feedback-message"
                  />
                  <p className="text-xs text-muted-foreground text-right mt-0.5">
                    {feedbackMessage.length}/1000
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={feedbackMessage.trim().length < 20 || submitFeedback.isPending}
                  onClick={() => submitFeedback.mutate({ topic: feedbackTopic, message: feedbackMessage.trim(), page: window.location.pathname })}
                  data-testid="button-send-feedback"
                >
                  {submitFeedback.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Send Feedback
                </Button>
              </div>
            )}
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Or email Dan directly:</p>
              <a
                href="mailto:makerdantheman@gmail.com"
                className="text-sm font-medium text-primary hover:underline"
                data-testid="link-contact-email"
              >
                makerdantheman@gmail.com
              </a>
            </div>
          </CardContent>
        </Card>

        {!user?.isTester && adminUsers && Array.isArray(adminUsers) && (
          <Card data-testid="card-manage-users">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Manage Users</CardTitle>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => clearRejected.mutate()}
                  disabled={clearRejected.isPending}
                  data-testid="button-clear-rejected"
                >
                  {clearRejected.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Clear Block List
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Approve or reject users who have signed in. Only approved users can access the app.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {adminUsersLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading users...
                </div>
              ) : adminUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No users registered yet.</p>
              ) : (
                <div className="space-y-2">
                  {adminUsers.map((u: any) => {
                    const isOwner = u.id === user?.id;
                    return (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card"
                        data-testid={`row-user-${u.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-8 w-8">
                            {u.profileImageUrl ? (
                              <AvatarImage src={u.profileImageUrl} alt={u.firstName || u.id} />
                            ) : null}
                            <AvatarFallback className="text-xs">
                              {(u.firstName || u.id).charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate" data-testid={`text-username-${u.id}`}>
                                {u.firstName || u.id}{u.lastName ? ` ${u.lastName}` : ""}
                              </span>
                              {isOwner && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Owner</Badge>
                              )}
                            </div>
                            {u.email && (
                              <span className="text-xs text-muted-foreground truncate block">{u.email}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isOwner ? (
                            <Badge className="bg-green-600 text-white text-xs">Approved</Badge>
                          ) : u.approved ? (
                            <>
                              <Badge className="bg-green-600 text-white text-xs" data-testid={`badge-approved-${u.id}`}>
                                Approved
                              </Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                                onClick={() => rejectUser.mutate(u.id)}
                                disabled={rejectUser.isPending}
                                data-testid={`button-reject-${u.id}`}
                              >
                                <UserX className="h-3 w-3 mr-1" />
                                Reject
                              </Button>
                            </>
                          ) : (
                            <>
                              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700" data-testid={`badge-pending-${u.id}`}>
                                Pending
                              </Badge>
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => toggleApproval.mutate({ userId: u.id, approved: true })}
                                disabled={toggleApproval.isPending}
                                data-testid={`button-approve-${u.id}`}
                              >
                                <UserCheck className="h-3 w-3 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                                onClick={() => rejectUser.mutate(u.id)}
                                disabled={rejectUser.isPending}
                                data-testid={`button-reject-pending-${u.id}`}
                              >
                                <UserX className="h-3 w-3 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <AlertDialog open={confirmEnableOpen} onOpenChange={setConfirmEnableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Data Encoding?</AlertDialogTitle>
            <AlertDialogDescription>
              This will encrypt all your existing entry data and all future entries using a secure, 
              automatically generated key. Your data will still be fully readable within the app, 
              but will appear as encrypted text if accessed directly from the database or external APIs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-enable-encoding">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleEncoding.mutate({ enabled: true })}
              data-testid="button-confirm-enable-encoding"
            >
              Enable Encoding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDisableOpen} onOpenChange={setConfirmDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Data Encoding?</AlertDialogTitle>
            <AlertDialogDescription>
              This will decrypt all your entry data back to plain text. Your data will then be stored 
              unencrypted in the database and visible through external APIs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-disable-encoding">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleEncoding.mutate({ enabled: false })}
              data-testid="button-confirm-disable-encoding"
            >
              Disable Encoding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
