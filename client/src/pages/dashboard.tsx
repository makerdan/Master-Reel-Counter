import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import reelIconPath from "@assets/Master_Reel_Counter_-_i001_1776633528982.png";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Cable, Plus, LogOut, MapPin, Clock, Trash2, ChevronRight, Settings, BarChart3,
  Pencil, Hash, Ruler, CheckCircle2, RotateCcw, Camera, Layers, Users,
  FolderPlus, FolderOpen, Folder, MoreVertical, Copy, FolderInput,
  Search, ChevronDown, X, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle,
  Lock, Unlock, History, Download, FileText, FileSpreadsheet, Loader2, RotateCw,
  SlidersHorizontal, Lightbulb,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ThemeToggle } from "@/components/theme-toggle";
import HelpMenu from "@/components/HelpMenu";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient, parseApiErrorPayload } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/hooks/use-timezone";
import { formatTimestamp } from "@/lib/timezone";
import type { Session, Folder as FolderType } from "@shared/schema";
import { toDisplayUnit, unitLabel } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";
import { findFolderConflict, getNextAutoNumberedName } from "@/lib/folder-conflicts";
import { FolderConflictDialog, type ConflictResolution } from "@/components/folder-conflict-dialog";
import { buildExportFilename } from "./session/utils";

type SessionWithStats = Session & {
  entryCount: number;
  totalFootage: number;
  sectionCount: number;
  photoCount: number;
  firstPhotoAt: string | null;
  lastPhotoAt: string | null;
  thumbnailKey: string | null;
  collaboratorUsernames: string[];
};

type SharedSessionWithStats = SessionWithStats & {
  role: string;
  ownerUsername?: string;
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const tz = useTimezone();
  const { data: dashSettings } = useQuery<{ defaultUnit: string }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({ defaultUnit: data?.defaultUnit ?? "feet" }),
  });
  const currentUnit: UnitType = (dashSettings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [sessionLocation, setSessionLocation] = useState("");
  const [editingSession, setEditingSession] = useState<SessionWithStats | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [duplicatingSession, setDuplicatingSession] = useState<SessionWithStats | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<FolderType | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInside, setSearchInside] = useState(false);
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "completed">("");
  const [filterCollaborator, setFilterCollaborator] = useState("");
  const [filterWireType, setFilterWireType] = useState("");
  const [filterMinFootage, setFilterMinFootage] = useState("");
  const [filterDateMonth, setFilterDateMonth] = useState("");
  const [filterDateYear, setFilterDateYear] = useState("");

  type SortField = "date" | "name" | "entries" | "footage";
  type SortDirection = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  const RECENT_SEARCHES_KEY = "reel-counter-recent-searches";
  const MAX_RECENT = 8;

  const getRecentSearches = useCallback((): string[] => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  }, []);

  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);

  const addRecentSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(s => s !== trimmed);
      const updated = [trimmed, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches(prev => {
      const updated = prev.filter(s => s !== query);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
    setRecentSearches([]);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        recentDropdownRef.current &&
        !recentDropdownRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setShowRecentSearches(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const [moveSessionTarget, setMoveSessionTarget] = useState<SessionWithStats | null>(null);
  const [createFolderForSession, setCreateFolderForSession] = useState<SessionWithStats | null>(null);
  const [inlineFolderName, setInlineFolderName] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: number; name: string; sessionCount: number } | null>(null);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{ id: number; name: string } | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [resetSessionTarget, setResetSessionTarget] = useState<{ id: number; name: string } | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  const [pdfQualityOpen, setPdfQualityOpen] = useState(false);
  const [pdfQualityChoice, setPdfQualityChoice] = useState<"full" | "standard">(
    () => (localStorage.getItem("pdfExportQuality") as "full" | "standard") ?? "full"
  );
  const [pdfDialogWaiting, setPdfDialogWaiting] = useState(false);
  const [exportSessionTarget, setExportSessionTarget] = useState<SessionWithStats | null>(null);
  const fullAbortRef = useRef<AbortController | null>(null);
  const stdAbortRef = useRef<AbortController | null>(null);
  const fullBlobRef = useRef<Blob | null>(null);
  const stdBlobRef = useRef<Blob | null>(null);
  const fullFetchRef = useRef<Promise<Blob | null> | null>(null);
  const stdFetchRef = useRef<Promise<Blob | null> | null>(null);

  const [folderConflict, setFolderConflict] = useState<{
    mode: "create" | "create-and-move";
    proposedName: string;
    autoNumberedName: string;
    existingFolderId: number;
    sessionId?: number;
  } | null>(null);

  const { data: userSettings } = useQuery<{
    thumbnailSize: string;
    defaultExportFormat: string;
    companyName: string | null;
    exportFooterText: string | null;
  }>({
    queryKey: ["/api/settings"],
    enabled: !!user,
  });

  const thumbSize = userSettings?.thumbnailSize || "medium";
  const thumbClasses: Record<string, string> = {
    none: "hidden",
    small: "w-8 h-8",
    medium: "w-12 h-12",
    large: "w-16 h-16",
  };
  const thumbIconClasses: Record<string, string> = {
    small: "h-3.5 w-3.5",
    medium: "h-5 w-5",
    large: "h-6 w-6",
  };

  const PAGE_SIZE = 50;
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [allLoadedSessions, setAllLoadedSessions] = useState<SessionWithStats[]>([]);

  type SessionsResponse = { sessions: SessionWithStats[]; total: number; limit: number; offset: number };

  const { data: sessionsData, isLoading, isError: sessionsError } = useQuery<SessionsResponse>({
    queryKey: ["/api/sessions", showTrash, sessionsOffset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showTrash) params.set("trash", "true");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(sessionsOffset));
      const res = await fetch(`/api/sessions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json();
    },
    enabled: !!user,
  });

  // Pagination accumulator: when the user loads the first page (offset 0) the
  // list is replaced wholesale (handles remount with cached data and trash-mode
  // toggle). For subsequent "load more" pages (offset > 0) new sessions are
  // appended with ID-based deduplication so a concurrent server-side insert
  // between pages doesn't produce a duplicate row in the displayed list.
  useEffect(() => {
    if (sessionsData) {
      if (sessionsOffset === 0) {
        setAllLoadedSessions(sessionsData.sessions);
      } else {
        setAllLoadedSessions(prev => {
          const existingIds = new Set(prev.map(s => s.id));
          const newSessions = sessionsData.sessions.filter(s => !existingIds.has(s.id));
          return [...prev, ...newSessions];
        });
      }
    }
  }, [sessionsData, sessionsOffset]);

  useEffect(() => {
    setSessionsOffset(0);
    // Do NOT clear allLoadedSessions here. When showTrash changes, sessionsOffset
    // resets to 0 and a fresh query fires. The sessionsData effect above will
    // replace the list (offset === 0 branch) once the response arrives, keeping
    // the previous list visible in the meantime instead of showing a blank flash.
    // Clearing here also races with the sessionsData effect on every remount,
    // wiping cache-rehydrated data and causing the empty-dashboard-on-back bug.
  }, [showTrash]);

  const sessions = allLoadedSessions;
  const sessionsTotal = sessionsData?.total ?? 0;
  const hasMoreSessions = sessions.length < sessionsTotal;

  const { data: sharedSessions } = useQuery<SharedSessionWithStats[]>({
    queryKey: ["/api/sessions/shared"],
    enabled: !!user && !showTrash,
    placeholderData: [],
  });

  const { data: userFolders } = useQuery<FolderType[]>({
    queryKey: ["/api/folders"],
    enabled: !!user,
    placeholderData: [],
  });

  type SearchResult = { ownedIds: number[]; sharedIds: number[]; reasons: Record<number, string[]>; entrySnippets?: Record<number, { field: string; preview: string }[]>; encryptionActive?: boolean };
  const emptySearch: SearchResult = { ownedIds: [], sharedIds: [], reasons: {}, entrySnippets: {}, encryptionActive: false };

  const activeFilters = {
    status: filterStatus || undefined,
    collaborator: filterCollaborator.trim() || undefined,
    wireType: filterWireType.trim() || undefined,
    minFootage: filterMinFootage ? parseInt(filterMinFootage) : undefined,
    dateMonth: filterDateMonth ? parseInt(filterDateMonth) : undefined,
    dateYear: filterDateYear ? parseInt(filterDateYear) : undefined,
  };
  const hasActiveFilters = !!(activeFilters.status || activeFilters.collaborator || activeFilters.wireType || activeFilters.minFootage || activeFilters.dateMonth || activeFilters.dateYear);

  const { data: searchResults } = useQuery<SearchResult>({
    queryKey: ["/api/search/sessions", searchQuery, searchInside, activeFilters],
    queryFn: async () => {
      if (!searchQuery.trim() && !hasActiveFilters) return emptySearch;
      const params = new URLSearchParams({ q: searchQuery, inside: String(searchInside) });
      if (activeFilters.status) params.set("status", activeFilters.status);
      if (activeFilters.collaborator) params.set("collaborator", activeFilters.collaborator);
      if (activeFilters.wireType) params.set("wireType", activeFilters.wireType);
      if (activeFilters.minFootage) params.set("minFootage", String(activeFilters.minFootage));
      if (activeFilters.dateMonth) params.set("dateMonth", String(activeFilters.dateMonth));
      if (activeFilters.dateYear) params.set("dateYear", String(activeFilters.dateYear));
      const res = await fetch(`/api/search/sessions?${params}`);
      if (!res.ok) return emptySearch;
      return res.json();
    },
    enabled: !!user && (searchQuery.trim().length > 0 || hasActiveFilters),
    placeholderData: emptySearch,
  });

  useEffect(() => {
    if (searchQuery.trim() && searchResults && (searchResults.ownedIds.length > 0 || searchResults.sharedIds.length > 0)) {
      addRecentSearch(searchQuery);
    }
  }, [searchResults]);

  const isSearching = searchQuery.trim().length > 0 || hasActiveFilters;
  const ownedMatchSet = useMemo(() => new Set(searchResults?.ownedIds || []), [searchResults]);
  const sharedMatchSet = useMemo(() => new Set(searchResults?.sharedIds || []), [searchResults]);
  const matchReasons = searchResults?.reasons || {};
  const entrySnippets = searchResults?.entrySnippets || {};

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    if (!isSearching) return sessions;
    return sessions.filter(s => ownedMatchSet.has(s.id));
  }, [sessions, isSearching, ownedMatchSet]);

  const sortSessions = useCallback((list: SessionWithStats[]) => {
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "entries":
          cmp = a.entryCount - b.entryCount;
          break;
        case "footage":
          cmp = a.totalFootage - b.totalFootage;
          break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });
  }, [sortField, sortDirection]);

  const filteredSharedSessions = useMemo(() => {
    if (!sharedSessions) return [];
    const filtered = isSearching ? sharedSessions.filter(s => sharedMatchSet.has(s.id)) : sharedSessions;
    return sortSessions(filtered as SessionWithStats[]) as SharedSessionWithStats[];
  }, [sharedSessions, isSearching, sharedMatchSet, sortSessions]);

  const folderedSessions = useMemo(() => {
    const map = new Map<number | null, SessionWithStats[]>();
    map.set(null, []);
    for (const folder of (userFolders || [])) {
      map.set(folder.id, []);
    }
    for (const session of filteredSessions) {
      const key = session.folderId ?? null;
      if (!map.has(key)) map.set(null, [...(map.get(null) || []), session]);
      else map.get(key)!.push(session);
    }
    for (const [key, list] of map.entries()) {
      map.set(key, sortSessions(list));
    }
    return map;
  }, [filteredSessions, userFolders, sortSessions]);

  const invalidateAll = useCallback(() => {
    setSessionsOffset(0);
    setAllLoadedSessions([]);
    queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
  }, []);

  const createSession = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions", {
        name: sessionName,
        location: sessionLocation || null,
      });
      return res.json();
    },
    onSuccess: (session: Session) => {
      invalidateAll();
      setNewDialogOpen(false);
      setSessionName("");
      setSessionLocation("");
      setLocation(`/session/${session.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create session", variant: "destructive" });
    },
  });

  const deleteSession = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sessions/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Session moved to trash" });
    },
    onError: () => {
      toast({ title: "Failed to delete session", variant: "destructive" });
    },
  });

  const restoreSession = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/sessions/${id}/restore`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Session restored" });
    },
    onError: () => {
      toast({ title: "Failed to restore session", variant: "destructive" });
    },
  });

  const permanentDeleteSession = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sessions/${id}/permanent`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Session permanently deleted" });
    },
    onError: () => {
      toast({ title: "Failed to permanently delete session", variant: "destructive" });
    },
  });

  const resetSession = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/sessions/${id}/reset-to-photos`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Session reset to photos only" });
    },
    onError: () => {
      toast({ title: "Failed to reset session", variant: "destructive" });
    },
  });

  // Tracks the authoritative lastUpdatedAt timestamp for the session currently
  // being edited inline. Stored as a ref (not state) so that the auto-save
  // effect can read the latest value without being listed as a dependency —
  // adding it to deps would cause the effect to re-fire and reset the debounce
  // timer every time a save completes, making rapid edits unreliable. The ref
  // is seeded from editingSession on open and updated on every successful save
  // or SESSION_VERSION_CONFLICT response so the next auto-save always sends the
  // most recent timestamp to updateSessionIfUnchanged.
  const editingSessionVersionRef = useRef<string | Date | null | undefined>(undefined);

  const updateSession = useMutation({
    mutationFn: async ({ id, name, location, expectedLastUpdatedAt }: { id: number; name: string; location: string; expectedLastUpdatedAt?: string | Date | null }) => {
      const res = await apiRequest("PATCH", `/api/sessions/${id}`, { name, location: location || null, expectedLastUpdatedAt });
      return res.json();
    },
    onSuccess: async (result) => {
      if (result?.lastUpdatedAt) editingSessionVersionRef.current = result.lastUpdatedAt;
      await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
    },
    onError: async (err: unknown) => {
      let message = "Failed to update session";
      const parsed = parseApiErrorPayload(err);
      if (parsed?.code === "SESSION_VERSION_CONFLICT") {
        // Another client (or browser tab) saved the session between when we
        // loaded it and when we tried to save. The server returns the current
        // lastUpdatedAt so we can update our ref and retry on the next
        // auto-save without a full page reload. We also refetch the session
        // list so the displayed data is consistent with the DB state.
        if (typeof parsed.message === "string") message = parsed.message;
        if (typeof parsed.currentLastUpdatedAt === "string") editingSessionVersionRef.current = parsed.currentLastUpdatedAt;
        await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  const sessionAutoSaveRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!editingSession) return;
    if (!editName.trim()) return;
    if (editName === editingSession.name && (editLocation || "") === (editingSession.location || "")) return;
    clearTimeout(sessionAutoSaveRef.current);
    sessionAutoSaveRef.current = setTimeout(() => {
      updateSession.mutate({ id: editingSession.id, name: editName, location: editLocation, expectedLastUpdatedAt: editingSessionVersionRef.current ?? editingSession.lastUpdatedAt });
    }, 1000);
    return () => clearTimeout(sessionAutoSaveRef.current);
  }, [editName, editLocation, editingSession]);

  useEffect(() => {
    editingSessionVersionRef.current = editingSession?.lastUpdatedAt;
  }, [editingSession?.id]);

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status, expectedLastUpdatedAt }: { id: number; status: string; expectedLastUpdatedAt?: string | Date | null }) => {
      const body: any = { status, expectedLastUpdatedAt };
      if (status === "completed") body.completedAt = new Date().toISOString();
      else body.completedAt = null;
      const res = await apiRequest("PATCH", `/api/sessions/${id}`, body);
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
    },
    onError: async (err: unknown) => {
      let message = "Failed to update session status";
      const parsed = parseApiErrorPayload(err);
      if (parsed?.code === "SESSION_VERSION_CONFLICT") {
        if (typeof parsed.message === "string") message = parsed.message;
        await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  const toggleLock = useMutation({
    mutationFn: async ({ id, locked }: { id: number; locked: boolean }) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/lock`, { locked });
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      await queryClient.refetchQueries({ queryKey: ["/api/shared-sessions"] });
      toast({ title: variables.locked ? "Session locked" : "Session unlocked" });
    },
    onError: () => {
      toast({ title: "Failed to toggle lock", variant: "destructive" });
    },
  });

  const createFolder = useMutation({
    mutationFn: async (nameOverride?: string) => {
      const res = await apiRequest("POST", "/api/folders", { name: nameOverride || newFolderName });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setNewFolderDialogOpen(false);
      setNewFolderName("");
      toast({ title: "Folder created" });
    },
    onError: () => {
      toast({ title: "Failed to create folder", variant: "destructive" });
    },
  });

  const renameFolder = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/folders/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
    },
    onError: () => {
      toast({ title: "Failed to rename folder", variant: "destructive" });
    },
  });

  const moveFolder = useMutation({
    mutationFn: async ({ id, parentFolderId }: { id: number; parentFolderId: number | null }) => {
      const res = await apiRequest("PATCH", `/api/folders/${id}`, { parentFolderId });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Folder moved" });
    },
    onError: () => {
      toast({ title: "Failed to move folder", variant: "destructive" });
    },
  });

  const folderAutoSaveRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!renamingFolder) return;
    if (!renameFolderName.trim()) return;
    if (renameFolderName === renamingFolder.name) return;
    clearTimeout(folderAutoSaveRef.current);
    folderAutoSaveRef.current = setTimeout(() => {
      renameFolder.mutate({ id: renamingFolder.id, name: renameFolderName });
    }, 1000);
    return () => clearTimeout(folderAutoSaveRef.current);
  }, [renameFolderName, renamingFolder]);

  const deleteFolder = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/folders/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Folder deleted (sessions moved to main list)" });
    },
    onError: () => {
      toast({ title: "Failed to delete folder", variant: "destructive" });
    },
  });

  const moveSession = useMutation({
    mutationFn: async ({ id, folderId }: { id: number; folderId: number | null }) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/move`, { folderId });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setMoveSessionTarget(null);
      toast({ title: "Session moved" });
    },
    onError: () => {
      toast({ title: "Failed to move session", variant: "destructive" });
    },
  });

  const createFolderAndMove = useMutation({
    mutationFn: async ({ sessionId, folderName }: { sessionId: number; folderName: string }) => {
      const folderRes = await apiRequest("POST", "/api/folders", { name: folderName });
      const folder = await folderRes.json();
      await apiRequest("POST", `/api/sessions/${sessionId}/move`, { folderId: folder.id });
      return folder;
    },
    onSuccess: () => {
      invalidateAll();
      setCreateFolderForSession(null);
      setInlineFolderName("");
      toast({ title: "Folder created and session moved" });
    },
    onError: () => {
      toast({ title: "Failed to create folder", variant: "destructive" });
    },
  });

  const handleFolderConflictResolution = useCallback(
    (resolution: ConflictResolution) => {
      if (!folderConflict) return;
      const { mode, proposedName, sessionId } = folderConflict;

      switch (resolution.type) {
        case "rename": {
          const name = resolution.newName;
          const reConflict = findFolderConflict(name, null, userFolders || []);
          if (reConflict) {
            setFolderConflict({
              ...folderConflict,
              proposedName: name,
              autoNumberedName: getNextAutoNumberedName(name, null, userFolders || []),
              existingFolderId: reConflict.id,
            });
            return;
          }
          setFolderConflict(null);
          if (mode === "create") {
            createFolder.mutate(name);
          } else if (mode === "create-and-move" && sessionId) {
            createFolderAndMove.mutate({ sessionId, folderName: name });
          }
          break;
        }
        case "auto-number": {
          const name = resolution.newName;
          setFolderConflict(null);
          if (mode === "create") {
            createFolder.mutate(name);
          } else if (mode === "create-and-move" && sessionId) {
            createFolderAndMove.mutate({ sessionId, folderName: name });
          }
          break;
        }
        case "merge":
          setFolderConflict(null);
          if (mode === "create-and-move" && sessionId) {
            moveSession.mutate({ id: sessionId, folderId: resolution.existingFolderId });
            setCreateFolderForSession(null);
            setInlineFolderName("");
          } else {
            setNewFolderDialogOpen(false);
            setNewFolderName("");
            const targetFolder = (userFolders || []).find(
              (f) => f.id === resolution.existingFolderId,
            );
            if (targetFolder) {
              setOpenFolders((prev) => new Set([...prev, targetFolder.id]));
              toast({ title: `Folder "${targetFolder.name}" already exists` });
            }
          }
          break;
      }
    },
    [folderConflict, userFolders, createFolder, createFolderAndMove, moveSession, toast],
  );

  const duplicateSession = useMutation({
    mutationFn: async ({ id, name }: { id: number; name?: string }) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/duplicate`, { name });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setDuplicatingSession(null);
      toast({ title: "Session duplicated" });
    },
    onError: () => {
      toast({ title: "Failed to duplicate session", variant: "destructive" });
    },
  });

  const bulkUpdateStatus = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      const res = await apiRequest("POST", "/api/sessions/bulk/status", { ids, status });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateAll();
      setSelectedSessions(new Set());
      toast({ title: `${data.updated.length} session(s) updated` });
    },
    onError: () => {
      toast({ title: "Failed to update sessions", variant: "destructive" });
    },
  });

  const bulkMove = useMutation({
    mutationFn: async ({ ids, folderId }: { ids: number[]; folderId: number | null }) => {
      const res = await apiRequest("POST", "/api/sessions/bulk/move", { ids, folderId });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateAll();
      setSelectedSessions(new Set());
      setBulkMoveOpen(false);
      toast({ title: `${data.moved.length} session(s) moved` });
    },
    onError: () => {
      toast({ title: "Failed to move sessions", variant: "destructive" });
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/sessions/bulk/delete", { ids });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateAll();
      setSelectedSessions(new Set());
      toast({ title: `${data.deleted.length} session(s) deleted` });
    },
    onError: () => {
      toast({ title: "Failed to delete sessions", variant: "destructive" });
    },
  });

  const toggleSessionSelection = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSessions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    return () => { abortPdfFetches(); };
  }, []);

  const handleExportExcel = async (session: SessionWithStats) => {
    toast({ title: "Exporting Excel…", description: session.name });
    try {
      const params = new URLSearchParams();
      if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
      const url = `/api/sessions/${session.id}/export/excel?${params}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = buildExportFilename(session, "xlsx");
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast({ title: "Excel export complete" });
    } catch {
      toast({ title: "Failed to export Excel", variant: "destructive" });
    }
  };

  const buildPdfUrl = (sessionId: number, quality: "full" | "standard") => {
    const params = new URLSearchParams();
    if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
    if (userSettings?.exportFooterText) params.set("footerText", userSettings.exportFooterText);
    params.set("quality", quality);
    return `/api/sessions/${sessionId}/export/pdf?${params}`;
  };

  const startPdfFetch = (sessionId: number, quality: "full" | "standard") => {
    const ctrl = new AbortController();
    if (quality === "full") fullAbortRef.current = ctrl;
    else stdAbortRef.current = ctrl;
    const p = fetch(buildPdfUrl(sessionId, quality), { credentials: "include", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        const blob = await res.blob();
        return blob.size >= 500 ? blob : null;
      })
      .catch(() => null);
    if (quality === "full") fullFetchRef.current = p;
    else stdFetchRef.current = p;
    p.then((blob) => {
      if (quality === "full") fullBlobRef.current = blob;
      else stdBlobRef.current = blob;
    });
  };

  const abortPdfFetches = () => {
    fullAbortRef.current?.abort(); fullAbortRef.current = null;
    stdAbortRef.current?.abort(); stdAbortRef.current = null;
    fullBlobRef.current = null; stdBlobRef.current = null;
    fullFetchRef.current = null; stdFetchRef.current = null;
  };

  const handleExportPdf = (session: SessionWithStats) => {
    setExportSessionTarget(session);
    abortPdfFetches();
    setPdfQualityOpen(true);
    startPdfFetch(session.id, "full");
    startPdfFetch(session.id, "standard");
  };

  const confirmPdfQualityExport = async () => {
    if (!exportSessionTarget) return;
    localStorage.setItem("pdfExportQuality", pdfQualityChoice);
    if (pdfQualityChoice === "full") { stdAbortRef.current?.abort(); stdAbortRef.current = null; }
    else { fullAbortRef.current?.abort(); fullAbortRef.current = null; }
    const blobRef = pdfQualityChoice === "full" ? fullBlobRef : stdBlobRef;
    const fetchRef = pdfQualityChoice === "full" ? fullFetchRef : stdFetchRef;
    let blob = blobRef.current;
    if (!blob) {
      setPdfDialogWaiting(true);
      blob = (await fetchRef.current) ?? null;
      setPdfDialogWaiting(false);
    }
    setPdfQualityOpen(false);
    const session = exportSessionTarget;
    setExportSessionTarget(null);
    abortPdfFetches();
    if (!blob) {
      toast({
        title: "PDF Export Failed",
        description: "Export failed — Try again in a moment.",
        variant: "destructive",
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = buildExportFilename(session, "pdf");
    a.download = pdfQualityChoice === "standard"
      ? baseName.replace(/\.pdf$/, " (Standard Quality).pdf")
      : baseName;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "PDF export complete" });
  };

  const cancelPdfQualityDialog = () => {
    abortPdfFetches();
    setPdfQualityOpen(false);
    setExportSessionTarget(null);
  };

  const openEditDialog = (session: SessionWithStats, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingSession(session);
    setEditName(session.name);
    setEditLocation(session.location || "");
  };

  const openDuplicateDialog = (session: SessionWithStats, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDuplicatingSession(session);
    setDuplicateName(`${session.name} (Copy)`);
  };

  const toggleFolderCollapse = (folderId: number) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "";
    return formatTimestamp(date, tz);
  };

  const formatElapsedMinutes = (first: string | null, last: string | null) => {
    if (!first || !last) return null;
    const diff = new Date(last).getTime() - new Date(first).getTime();
    if (diff <= 0) return null;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
    const totalMinutes = Math.round(diff / 60000);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const reasonLabels: Record<string, string> = {
    name: "Matched Name",
    location: "Matched Location",
    status: "Matched Status",
    date: "Matched Date",
    footage: `Matched Footage (${uLabel})`,
    reels: "Matched Reels",
    collaborator: "Matched Collaborator",
    entries: "Matched Entry Content",
  };

  const renderSessionCard = (session: SessionWithStats, isShared = false) => {
    const prefix = isShared ? "shared-" : "";
    const sessionReasons = isSearching ? (matchReasons[session.id] || []) : [];
    const sessionSnippets = isSearching ? (entrySnippets[session.id] || []) : [];
    const isSelected = selectedSessions.has(session.id);
    return (
      <Card
        key={session.id}
        className={`hover-elevate cursor-pointer ${isSelected ? "border border-primary ring-2 ring-primary/30" : "border-0"}`}
        data-testid={`card-${prefix}session-${session.id}`}
        onClick={() => setLocation(`/session/${session.id}`)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            {!isShared && (
              <div className="-ml-1 mt-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSessionSelection(session.id, { stopPropagation: () => {} } as React.MouseEvent)}
                  data-testid={`checkbox-select-session-${session.id}`}
                />
              </div>
            )}
            <div className={`shrink-0 ${thumbSize === "none" ? "hidden" : ""}`} data-testid={`img-session-thumbnail-${session.id}`}>
              {session.thumbnailKey ? (
                <img
                  src={session.thumbnailKey}
                  alt=""
                  className={`${thumbClasses[thumbSize] || thumbClasses.medium} rounded-md object-cover`}
                />
              ) : (
                <div className={`${thumbClasses[thumbSize] || thumbClasses.medium} rounded-md bg-muted flex items-center justify-center`}>
                  <Camera className={thumbIconClasses[thumbSize] || thumbIconClasses.medium + " text-muted-foreground"} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm truncate" data-testid={`text-${prefix}session-name-${session.id}`}>
                  {session.name}
                </h3>
                <Badge
                  variant={session.status === "active" ? "default" : "secondary"}
                  className="no-default-hover-elevate no-default-active-elevate"
                  data-testid={`badge-${prefix}session-status-${session.id}`}
                >
                  {session.status}
                </Badge>
                {session.isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Lock className="h-3.5 w-3.5 text-amber-500" data-testid={`icon-locked-${session.id}`} />
                    </TooltipTrigger>
                    <TooltipContent>Session is locked</TooltipContent>
                  </Tooltip>
                )}
                {isShared && (session as SharedSessionWithStats).role && (
                  <Badge
                    variant="outline"
                    className="no-default-hover-elevate no-default-active-elevate"
                    data-testid={`badge-shared-session-role-${session.id}`}
                  >
                    {(session as SharedSessionWithStats).role}
                  </Badge>
                )}
                {sessionReasons.length > 0 && (
                  <span className="flex items-center gap-1 flex-wrap" data-testid={`match-reasons-${session.id}`}>
                    <span className="text-xs text-primary/70 font-medium">Matched:</span>
                    {sessionReasons.map(reason => (
                      <Badge
                        key={reason}
                        variant="outline"
                        className="no-default-hover-elevate no-default-active-elevate border-primary/40 text-primary bg-primary/5 text-xs"
                        data-testid={`badge-match-reason-${reason}-${session.id}`}
                      >
                        {reasonLabels[reason] || reason}
                      </Badge>
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-start gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                {isShared && (session as SharedSessionWithStats).ownerUsername && (
                  <span className="flex items-center gap-1" data-testid={`text-shared-session-owner-${session.id}`}>
                    <Users className="h-3 w-3 shrink-0" />
                    {(session as SharedSessionWithStats).ownerUsername}
                  </span>
                )}
                {session.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {session.location}
                  </span>
                )}
                <span className="flex items-center gap-1" data-testid={`text-${prefix}session-time-${session.id}`}>
                  <Clock className="h-3 w-3 shrink-0" />
                  {session.firstPhotoAt
                    ? `${formatDate(session.firstPhotoAt)}${session.lastPhotoAt && session.lastPhotoAt !== session.firstPhotoAt ? ` - ${formatDate(session.lastPhotoAt)}` : ""}`
                    : "No photos yet"}
                  {(() => {
                    const elapsed = formatElapsedMinutes(session.firstPhotoAt, session.lastPhotoAt);
                    return elapsed ? <span className="ml-1 mono" data-testid={`badge-${prefix}session-elapsed-${session.id}`}>({elapsed})</span> : null;
                  })()}
                </span>
                <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-photos-${session.id}`}>
                  <Camera className="h-3 w-3 shrink-0" />
                  {session.photoCount} photos
                </span>
                {session.sectionCount > 0 && (
                  <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-sections-${session.id}`}>
                    <Layers className="h-3 w-3 shrink-0" />
                    {session.sectionCount} sections
                  </span>
                )}
                <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-entries-${session.id}`}>
                  <Hash className="h-3 w-3 shrink-0" />
                  {session.entryCount} reels
                </span>
                {session.totalFootage > 0 && (
                  <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-footage-${session.id}`}>
                    <Ruler className="h-3 w-3 shrink-0" />
                    {toDisplayUnit(session.totalFootage, currentUnit).toLocaleString()} {uLabel}
                  </span>
                )}
              </div>
              {(session as any).collaboratorUsernames?.length > 0 && (
                <div className="flex items-center gap-1 mt-2" data-testid={`avatars-session-${session.id}`}>
                  {(session as any).collaboratorUsernames.slice(0, 3).map((name: string, i: number) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold uppercase border border-background"
                      title={name}
                      data-testid={`avatar-collaborator-${session.id}-${i}`}
                    >
                      {name.charAt(0)}
                    </div>
                  ))}
                  {(session as any).collaboratorUsernames.length > 3 && (
                    <span className="text-[10px] text-muted-foreground ml-0.5">
                      +{(session as any).collaboratorUsernames.length - 3}
                    </span>
                  )}
                </div>
              )}
              {sessionSnippets.length > 0 && (
                <div className="mt-2 space-y-0.5" data-testid={`entry-snippets-${session.id}`}>
                  {sessionSnippets.slice(0, 2).map((snippet, i) => (
                    <p key={i} className="text-xs text-muted-foreground italic" data-testid={`snippet-${session.id}-${i}`}>
                      <span className="font-medium not-italic text-muted-foreground/80">{snippet.field}:</span> "{snippet.preview}"
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!isShared && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`button-session-menu-${session.id}`}
                      title="Session menu"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" collisionPadding={8} onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStatus.mutate({
                          id: session.id,
                          status: session.status === "active" ? "completed" : "active",
                          expectedLastUpdatedAt: session.lastUpdatedAt,
                        });
                      }}
                      data-testid={`menu-toggle-status-${session.id}`}
                    >
                      {session.status === "active" ? (
                        <><CheckCircle2 className="h-4 w-4 mr-2" /> Mark Complete</>
                      ) : (
                        <><RotateCcw className="h-4 w-4 mr-2" /> Reopen</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => openEditDialog(session, e)}
                      data-testid={`menu-rename-session-${session.id}`}
                    >
                      <Pencil className="h-4 w-4 mr-2" /> Rename Session
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        openDuplicateDialog(session, e);
                      }}
                      data-testid={`menu-duplicate-session-${session.id}`}
                    >
                      <Copy className="h-4 w-4 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger data-testid={`menu-move-session-${session.id}`}>
                        <FolderInput className="h-4 w-4 mr-2" /> Move to Folder
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent collisionPadding={8}>
                        {session.folderId && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSession.mutate({ id: session.id, folderId: null });
                            }}
                            data-testid={`menu-move-unfiled-${session.id}`}
                          >
                            <X className="h-4 w-4 mr-2" /> Remove from folder
                          </DropdownMenuItem>
                        )}
                        {(userFolders || []).filter(f => f.id !== session.folderId).map(folder => (
                          <DropdownMenuItem
                            key={folder.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSession.mutate({ id: session.id, folderId: folder.id });
                            }}
                            data-testid={`menu-move-to-folder-${folder.id}-${session.id}`}
                          >
                            <Folder className="h-4 w-4 mr-2" /> {folder.name}
                          </DropdownMenuItem>
                        ))}
                        {(userFolders || []).filter(f => f.id !== session.folderId).length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreateFolderForSession(session);
                            setInlineFolderName("");
                          }}
                          data-testid={`menu-create-folder-${session.id}`}
                        >
                          <FolderPlus className="h-4 w-4 mr-2" /> Create New Folder
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLock.mutate({ id: session.id, locked: !session.isLocked });
                      }}
                      data-testid={`menu-lock-session-${session.id}`}
                    >
                      {session.isLocked ? (
                        <><Unlock className="h-4 w-4 mr-2" /> Unlock Session</>
                      ) : (
                        <><Lock className="h-4 w-4 mr-2" /> Lock Session</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation(`/session/${session.id}?activity=1`);
                      }}
                      data-testid={`menu-activity-log-${session.id}`}
                    >
                      <History className="h-4 w-4 mr-2" /> Activity Log
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger data-testid={`menu-export-session-${session.id}`}>
                        <Download className="h-4 w-4 mr-2" /> Export
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent collisionPadding={8}>
                        {(userSettings?.defaultExportFormat === "excel") ? (
                          <>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportExcel(session);
                              }}
                              data-testid={`menu-export-excel-${session.id}`}
                            >
                              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportPdf(session);
                              }}
                              data-testid={`menu-export-pdf-${session.id}`}
                            >
                              <FileText className="h-4 w-4 mr-2" /> PDF
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportPdf(session);
                              }}
                              data-testid={`menu-export-pdf-${session.id}`}
                            >
                              <FileText className="h-4 w-4 mr-2" /> PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportExcel(session);
                              }}
                              data-testid={`menu-export-excel-${session.id}`}
                            >
                              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setResetSessionTarget({ id: session.id, name: session.name });
                      }}
                      data-testid={`menu-reset-session-${session.id}`}
                    >
                      <RotateCw className="h-4 w-4 mr-2" /> Reset to Photos Only
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteSessionTarget({ id: session.id, name: session.name });
                      }}
                      data-testid={`menu-delete-session-${session.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderFolderSection = (folder: FolderType, visited = new Set<number>()) => {
    if (visited.has(folder.id)) return null;
    visited.add(folder.id);
    const folderSessions = folderedSessions.get(folder.id) || [];
    const isCollapsed = isSearching ? false : !openFolders.has(folder.id);

    if (isSearching && folderSessions.length === 0) return null;

    return (
      <Collapsible
        key={folder.id}
        open={!isCollapsed}
      >
        <div className="rounded-md p-3" style={{ backgroundColor: 'hsl(var(--folder-bg))', border: '1px solid hsl(var(--folder-border))' }}>
        <div className="flex items-start justify-between gap-2 group" data-testid={`folder-header-${folder.id}`}>
          <Button variant="ghost" size="sm" className="gap-2 px-2 items-start h-auto touch-manipulation min-w-0" data-testid={`button-toggle-folder-${folder.id}`} title="Toggle folder" onPointerDown={(e) => { e.preventDefault(); toggleFolderCollapse(folder.id); }}>
              {isCollapsed ? <Folder className="h-4 w-4 text-primary shrink-0 mt-0.5" /> : <FolderOpen className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
              <span className="font-semibold text-base text-left">{folder.name}</span>
              <Badge variant="secondary" className="ml-1 no-default-hover-elevate no-default-active-elevate text-xs shrink-0 mt-0.5">
                {folderSessions.length}
              </Badge>
            </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                data-testid={`button-folder-menu-${folder.id}`}
                title="Folder options"
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => {
                  setRenamingFolder(folder);
                  setRenameFolderName(folder.name);
                }}
                data-testid={`menu-rename-folder-${folder.id}`}
              >
                <Pencil className="h-4 w-4 mr-2" /> Rename Folder
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid={`menu-move-folder-${folder.id}`}>
                  <FolderInput className="h-4 w-4 mr-2" /> Move to Folder
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent collisionPadding={8}>
                  {folder.parentFolderId && (
                    <DropdownMenuItem
                      onClick={() => moveFolder.mutate({ id: folder.id, parentFolderId: null })}
                      data-testid={`menu-folder-move-root-${folder.id}`}
                    >
                      <X className="h-4 w-4 mr-2" /> Move to Root
                    </DropdownMenuItem>
                  )}
                  {(() => {
                    const descendants = new Set<number>();
                    const findDescendants = (parentId: number) => {
                      for (const f of (userFolders || [])) {
                        if (f.parentFolderId === parentId && !descendants.has(f.id)) {
                          descendants.add(f.id);
                          findDescendants(f.id);
                        }
                      }
                    };
                    findDescendants(folder.id);
                    return (userFolders || [])
                      .filter(f => f.id !== folder.id && f.id !== folder.parentFolderId && !descendants.has(f.id))
                      .map(target => (
                        <DropdownMenuItem
                          key={target.id}
                          onClick={() => moveFolder.mutate({ id: folder.id, parentFolderId: target.id })}
                          data-testid={`menu-folder-move-to-${target.id}-${folder.id}`}
                        >
                          <Folder className="h-4 w-4 mr-2" /> {target.name}
                        </DropdownMenuItem>
                      ));
                  })()}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  const folderSessions = folderedSessions.get(folder.id) || [];
                  setDeleteFolderTarget({ id: folder.id, name: folder.name, sessionCount: folderSessions.length });
                }}
                data-testid={`menu-delete-folder-${folder.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete Folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CollapsibleContent>
          <div className="space-y-2 mt-2">
            {(userFolders || []).filter(f => f.parentFolderId === folder.id).map(child => renderFolderSection(child, visited))}
            {folderSessions.length === 0 && (userFolders || []).filter(f => f.parentFolderId === folder.id).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 pl-2">No sessions in this folder</p>
            ) : (
              folderSessions.map(session => renderSessionCard(session))
            )}
          </div>
        </CollapsibleContent>
        </div>
      </Collapsible>
    );
  };

  const unfiledSessions = folderedSessions.get(null) || [];

  return (
    <div className="min-h-screen bg-background dashboard-theme">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="relative flex items-center gap-2 px-4 py-3 max-w-5xl mx-auto">
          <button
            className="flex items-center gap-2 shrink-0 min-w-0 hover:opacity-80 transition-opacity"
            onClick={() => { setLocation("/"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            data-testid="button-home-nav"
            title="Go to Sessions Dashboard"
          >
            <img src={reelIconPath} className="h-5 w-5 rounded-md shrink-0" alt="" />
            <span className="font-semibold text-sm truncate max-w-[80px] sm:max-w-none" data-testid="text-user-name">
              {user?.firstName || "User"}
            </span>
          </button>
          <div className="absolute inset-0 hidden sm:flex items-center justify-center pointer-events-none">
            <span className="text-sm font-semibold tracking-wide text-black dark:text-white underline truncate" data-testid="text-app-title">
              Master Reel Counter
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 shrink-0">
            <ThemeToggle />
            <HelpMenu mode="dashboard" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setLocation("/stats")}
                  data-testid="button-stats"
                >
                  <BarChart3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stats</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setLocation("/settings")}
                  data-testid="button-settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => logout()}
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sign out</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-[50vh]">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">
            Sessions Dashboard
          </h1>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showTrash ? "default" : "outline"}
                  size="sm"
                  className={showTrash ? "" : "border border-black"}
                  onClick={() => setShowTrash(v => !v)}
                  data-testid="button-toggle-trash"
                >
                  <Trash2 className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Trash</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showTrash ? "Back to sessions" : "View trash"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border border-black" data-testid="button-sort-sessions" title="Sort sessions">
                  <ArrowUpDown className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">{sortField === "date" ? "Date" : sortField === "name" ? "Name" : sortField === "entries" ? "Reels" : "Footage"}</span>
                  {sortDirection === "desc" ? <ArrowDown className="h-3 w-3 sm:ml-1" /> : <ArrowUp className="h-3 w-3 sm:ml-1" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {([
                  { field: "date" as SortField, label: "Date" },
                  { field: "name" as SortField, label: "Name" },
                  { field: "entries" as SortField, label: "Reels" },
                  { field: "footage" as SortField, label: "Footage" },
                ]).map(({ field, label }) => (
                  <DropdownMenuItem
                    key={field}
                    onClick={() => {
                      if (sortField === field) {
                        setSortDirection(d => d === "desc" ? "asc" : "desc");
                      } else {
                        setSortField(field);
                        setSortDirection(field === "name" ? "asc" : "desc");
                      }
                    }}
                    data-testid={`menu-sort-${field}`}
                  >
                    <span className="flex-1">{label}</span>
                    {sortField === field && (
                      sortDirection === "desc" ? <ArrowDown className="h-3 w-3 ml-2" /> : <ArrowUp className="h-3 w-3 ml-2" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="border border-black" data-testid="button-new-folder" title="Create a new folder">
                  <FolderPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">New Folder</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Folder</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newFolderName.trim()) return;
                    const conflict = findFolderConflict(newFolderName.trim(), null, userFolders || []);
                    if (conflict) {
                      setFolderConflict({
                        mode: "create",
                        proposedName: newFolderName.trim(),
                        autoNumberedName: getNextAutoNumberedName(newFolderName.trim(), null, userFolders || []),
                        existingFolderId: conflict.id,
                      });
                      return;
                    }
                    createFolder.mutate(undefined);
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="folder-name">Folder Name</Label>
                    <Input
                      id="folder-name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="e.g., Building A Counts"
                      data-testid="input-folder-name"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!newFolderName.trim() || createFolder.isPending}
                    data-testid="button-create-folder"
                  >
                    {createFolder.isPending ? "Creating..." : "Create Folder"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-session" title="Create a new counting session" size="sm">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">New Session</span>
                  <span className="sm:hidden">New</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Counting Session</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (sessionName.trim()) createSession.mutate();
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="session-name">Session Name</Label>
                    <Input
                      id="session-name"
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                      placeholder="e.g., Warehouse A - Bay 3"
                      data-testid="input-session-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="session-location">Location (optional)</Label>
                    <Input
                      id="session-location"
                      value={sessionLocation}
                      onChange={(e) => setSessionLocation(e.target.value)}
                      placeholder="e.g., Building 2, Dock 5"
                      data-testid="input-session-location"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!sessionName.trim() || createSession.isPending}
                    data-testid="button-create-session"
                  >
                    {createSession.isPending ? "Creating..." : "Create Session"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="mb-4 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { if (!searchQuery && recentSearches.length > 0) setShowRecentSearches(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  addRecentSearch(searchQuery);
                  setShowRecentSearches(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Search sessions..."
              className="pl-9 pr-20"
              data-testid="input-search-sessions"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={showFilterBar ? "default" : "ghost"}
                    className="h-7 w-7"
                    onClick={() => setShowFilterBar(v => !v)}
                    data-testid="button-toggle-filter-bar"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Filters{hasActiveFilters ? " (active)" : ""}</TooltipContent>
              </Tooltip>
              {searchQuery && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => { setSearchQuery(""); setShowRecentSearches(false); }}
                      data-testid="button-clear-search"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              )}
            </div>
            {showRecentSearches && recentSearches.length > 0 && !searchQuery && (
              <div
                ref={recentDropdownRef}
                className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover shadow-md"
                data-testid="dropdown-recent-searches"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <span className="text-xs font-medium text-muted-foreground">Recent searches</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                    onClick={clearRecentSearches}
                    data-testid="button-clear-recent-searches"
                  >
                    Clear all
                  </Button>
                </div>
                {recentSearches.map((term) => (
                  <div
                    key={term}
                    className="flex items-center justify-between"
                    data-testid={`item-recent-search-${term}`}
                  >
                    <Button
                      variant="ghost"
                      className="flex-1 justify-start gap-2 h-auto py-2 px-3 rounded-none text-sm font-normal"
                      onClick={() => {
                        setSearchQuery(term);
                        setShowRecentSearches(false);
                        addRecentSearch(term);
                      }}
                      data-testid={`button-select-recent-${term}`}
                    >
                      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{term}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 mr-1"
                      onClick={(e) => { e.stopPropagation(); removeRecentSearch(term); }}
                      data-testid={`button-remove-recent-${term}`}
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap" data-testid="toggle-search-inside">
              <div className="flex items-center gap-2">
                <Switch
                  id="search-inside"
                  checked={searchInside}
                  onCheckedChange={setSearchInside}
                  data-testid="switch-search-inside"
                />
                <label htmlFor="search-inside" className="text-sm font-medium cursor-pointer select-none">
                  Search inside sessions
                </label>
              </div>
              {searchInside && searchResults?.encryptionActive && searchQuery.trim() && (
                <span
                  role="status"
                  aria-live="polite"
                  className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center gap-1"
                  data-testid="text-dashboard-search-encryption-notice"
                >
                  Encryption on — entry search limited to location fields
                </span>
              )}
            </div>
            {(hasActiveFilters) && (
              <div className="flex items-center gap-1 flex-wrap">
                {filterStatus && (
                  <Badge
                    variant="secondary"
                    className="gap-1 pr-1 cursor-pointer"
                    data-testid="chip-filter-status"
                    onClick={() => setFilterStatus("")}
                  >
                    Status: {filterStatus}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {filterCollaborator && (
                  <Badge
                    variant="secondary"
                    className="gap-1 pr-1 cursor-pointer"
                    data-testid="chip-filter-collaborator"
                    onClick={() => setFilterCollaborator("")}
                  >
                    Collaborator: {filterCollaborator}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {filterWireType && (
                  <Badge
                    variant="secondary"
                    className="gap-1 pr-1 cursor-pointer"
                    data-testid="chip-filter-wiretype"
                    onClick={() => setFilterWireType("")}
                  >
                    Wire: {filterWireType}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {filterMinFootage && (
                  <Badge
                    variant="secondary"
                    className="gap-1 pr-1 cursor-pointer"
                    data-testid="chip-filter-footage"
                    onClick={() => setFilterMinFootage("")}
                  >
                    Min {filterMinFootage} {uLabel}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {(filterDateMonth || filterDateYear) && (
                  <Badge
                    variant="secondary"
                    className="gap-1 pr-1 cursor-pointer"
                    data-testid="chip-filter-date"
                    onClick={() => { setFilterDateMonth(""); setFilterDateYear(""); }}
                  >
                    Date: {filterDateMonth ? ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(filterDateMonth)-1] : ""}{filterDateMonth && filterDateYear ? " " : ""}{filterDateYear}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground"
                  onClick={() => { setFilterStatus(""); setFilterCollaborator(""); setFilterWireType(""); setFilterMinFootage(""); setFilterDateMonth(""); setFilterDateYear(""); }}
                  data-testid="button-clear-all-filters"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>

          {showFilterBar && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2" data-testid="filter-bar">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <div className="flex gap-1">
                    {(["", "active", "completed"] as const).map(s => (
                      <button
                        key={s || "any"}
                        type="button"
                        onClick={() => setFilterStatus(s)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${filterStatus === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
                        data-testid={`filter-status-${s || "any"}`}
                      >
                        {s === "" ? "Any" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Collaborator</label>
                  <Input
                    value={filterCollaborator}
                    onChange={e => setFilterCollaborator(e.target.value)}
                    placeholder="Username..."
                    className="h-7 text-xs"
                    data-testid="input-filter-collaborator"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Wire Type</label>
                  <Input
                    value={filterWireType}
                    onChange={e => setFilterWireType(e.target.value)}
                    placeholder="e.g. THHN"
                    className="h-7 text-xs"
                    data-testid="input-filter-wiretype"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Min Footage ({uLabel})</label>
                  <Input
                    type="number"
                    value={filterMinFootage}
                    onChange={e => setFilterMinFootage(e.target.value)}
                    placeholder="e.g. 500"
                    className="h-7 text-xs"
                    data-testid="input-filter-footage"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Month</label>
                  <select
                    value={filterDateMonth}
                    onChange={e => setFilterDateMonth(e.target.value)}
                    className="w-full h-7 text-xs rounded-md border border-border bg-background px-2"
                    data-testid="select-filter-month"
                  >
                    <option value="">Any</option>
                    {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                      <option key={m} value={String(i+1)}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Year</label>
                  <Input
                    type="number"
                    value={filterDateYear}
                    onChange={e => setFilterDateYear(e.target.value)}
                    placeholder="e.g. 2025"
                    className="h-7 text-xs"
                    data-testid="input-filter-year"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {showTrash ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Trash2 className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-bold" data-testid="text-trash-title">Trash</h2>
              <span className="text-sm text-muted-foreground">({sessionsTotal} session{sessionsTotal !== 1 ? "s" : ""})</span>
            </div>
            <p className="text-xs text-muted-foreground">Sessions in trash are automatically permanently deleted after 30 days.</p>
            {isLoading && sessions.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <Card className="border border-border">
                <CardContent className="py-12 text-center">
                  <Trash2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">Trash is empty</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {sessions.map(session => (
                  <Card
                    key={session.id}
                    className="border border-border hover:border-primary/40 transition-colors"
                    data-testid={`card-trash-session-${session.id}`}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" data-testid={`text-trash-session-name-${session.id}`}>{session.name}</p>
                          {session.location && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3" /> {session.location}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Deleted {session.deletedAt ? formatTimestamp(session.deletedAt, tz) : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => restoreSession.mutate(session.id)}
                                disabled={restoreSession.isPending}
                                data-testid={`button-restore-session-${session.id}`}
                              >
                                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Restore this session</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setPermanentDeleteTarget({ id: session.id, name: session.name })}
                                disabled={permanentDeleteSession.isPending}
                                data-testid={`button-permanent-delete-session-${session.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Permanently delete</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {hasMoreSessions && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSessionsOffset(prev => prev + PAGE_SIZE)}
                      disabled={isLoading}
                      data-testid="button-load-more-trash"
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
        <>
        {(() => {
          try {
            const lastId = localStorage.getItem("reel-counter-last-session");
            if (!lastId || !sessions?.length) return null;
            const lastSession = sessions.find(s => s.id === parseInt(lastId));
            if (!lastSession || lastSession.status === "completed") return null;
            if (!lastSession.folderId) return null;
            return (
              <div className="mb-4 flex items-center gap-1">
                <Button
                  variant="outline"
                  className="flex-1 justify-start gap-2 border-primary/40 hover:bg-primary/5"
                  onClick={() => setLocation(`/session/${lastSession.id}`)}
                  data-testid="button-continue-last-session"
                  title="Continue your last session"
                >
                  <ChevronRight className="h-4 w-4 text-primary" />
                  <span className="text-sm">Continue: <strong>{lastSession.name}</strong></span>
                  {lastSession.location && <span className="hidden sm:inline text-xs text-muted-foreground">({lastSession.location})</span>}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" data-testid="button-continue-session-menu" title="Session menu">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        toggleStatus.mutate({
                          id: lastSession.id,
                          status: lastSession.status === "active" ? "completed" : "active",
                          expectedLastUpdatedAt: lastSession.lastUpdatedAt,
                        });
                      }}
                      data-testid="menu-continue-toggle-status"
                    >
                      {lastSession.status === "active" ? (
                        <><CheckCircle2 className="h-4 w-4 mr-2" /> Mark Complete</>
                      ) : (
                        <><RotateCcw className="h-4 w-4 mr-2" /> Reopen</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openEditDialog(lastSession)}
                      data-testid="menu-continue-rename-session"
                    >
                      <Pencil className="h-4 w-4 mr-2" /> Rename Session
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openDuplicateDialog(lastSession)}
                      data-testid="menu-continue-duplicate-session"
                    >
                      <Copy className="h-4 w-4 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger data-testid="menu-continue-move-session">
                        <FolderInput className="h-4 w-4 mr-2" /> Move to Folder
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {lastSession.folderId && (
                          <DropdownMenuItem
                            onClick={() => moveSession.mutate({ id: lastSession.id, folderId: null })}
                            data-testid="menu-continue-move-unfiled"
                          >
                            <X className="h-4 w-4 mr-2" /> Remove from folder
                          </DropdownMenuItem>
                        )}
                        {(userFolders || []).filter(f => f.id !== lastSession.folderId).map(folder => (
                          <DropdownMenuItem
                            key={folder.id}
                            onClick={() => moveSession.mutate({ id: lastSession.id, folderId: folder.id })}
                            data-testid={`menu-continue-move-to-folder-${folder.id}`}
                          >
                            <Folder className="h-4 w-4 mr-2" /> {folder.name}
                          </DropdownMenuItem>
                        ))}
                        {(userFolders || []).filter(f => f.id !== lastSession.folderId).length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          onClick={() => {
                            setCreateFolderForSession(lastSession);
                            setInlineFolderName("");
                          }}
                          data-testid="menu-continue-create-folder"
                        >
                          <FolderPlus className="h-4 w-4 mr-2" /> Create New Folder
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                      onClick={() => toggleLock.mutate({ id: lastSession.id, locked: !lastSession.isLocked })}
                      data-testid="menu-continue-lock-session"
                    >
                      {lastSession.isLocked ? (
                        <><Unlock className="h-4 w-4 mr-2" /> Unlock Session</>
                      ) : (
                        <><Lock className="h-4 w-4 mr-2" /> Lock Session</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setLocation(`/session/${lastSession.id}?activity=1`)}
                      data-testid="menu-continue-activity-log"
                    >
                      <History className="h-4 w-4 mr-2" /> Activity Log
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setDeleteSessionTarget({ id: lastSession.id, name: lastSession.name })}
                      data-testid="menu-continue-delete-session"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          } catch { return null; }
        })()}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : sessionsError ? (
          <Card className="border border-destructive/30">
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-destructive" />
              <p className="text-sm font-medium mb-1">Unable to load sessions</p>
              <p className="text-xs text-muted-foreground mb-4">There was a problem connecting to the server. Please try again.</p>
              <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/sessions"] })} data-testid="button-retry-sessions" title="Retry loading sessions">
                <RotateCcw className="h-3 w-3 mr-1" /> Retry
              </Button>
            </CardContent>
          </Card>
        ) : !filteredSessions.length && !isSearching && !(userFolders || []).length ? (
          <Card className="border border-border">
            <CardContent className="py-12 text-center">
              <Cable className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">No sessions yet. Create one to start counting reels.</p>
            </CardContent>
          </Card>
        ) : !filteredSessions.length && !isSearching && (userFolders || []).length > 0 ? (
          <div className="space-y-4">
            {(userFolders || []).filter(f => !f.parentFolderId).map(folder => renderFolderSection(folder))}
            <Card className="border border-border">
              <CardContent className="py-8 text-center">
                <Cable className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground text-sm">No sessions yet. Create one to start counting reels.</p>
              </CardContent>
            </Card>
          </div>
        ) : isSearching && !filteredSessions.length && !filteredSharedSessions.length ? (
          <Card className="border border-border">
            <CardContent className="py-10 text-center space-y-3" data-testid="no-search-results">
              <Search className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium mb-0.5">{searchQuery.trim() ? `No sessions found for "${searchQuery}"` : "No sessions match the active filters"}</p>
                <p className="text-xs text-muted-foreground">Try refining your search or clear filters</p>
              </div>
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>Try a wire type like <button className="underline hover:text-foreground" onClick={() => { setFilterWireType("THHN"); setShowFilterBar(true); }} data-testid="tip-wiretype">THHN</button></span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>Enable <button className="underline hover:text-foreground" onClick={() => setSearchInside(true)} data-testid="tip-search-inside">"Search inside sessions"</button> to search entry fields</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>Search by collaborator username using the Filters panel</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {isSearching && (
              <p className="text-sm text-muted-foreground" data-testid="text-search-result-count">
                Found {filteredSessions.length + filteredSharedSessions.length} result{filteredSessions.length + filteredSharedSessions.length !== 1 ? "s" : ""} matching "{searchQuery}":
              </p>
            )}
            {(userFolders || []).filter(f => !f.parentFolderId).map(folder => renderFolderSection(folder))}

            {unfiledSessions.length > 0 && (
              <div className="space-y-2">
                {unfiledSessions.map(session => renderSessionCard(session))}
              </div>
            )}
          </div>
        )}

        {filteredSharedSessions.length > 0 && (
          <>
            <div className="flex items-center gap-2 mt-8 mb-4">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-bold" data-testid="text-shared-sessions-title">
                Shared with me
              </h2>
            </div>
            <div className="space-y-3">
              {filteredSharedSessions.map((session) => renderSessionCard(session as any, true))}
            </div>
          </>
        )}

        {hasMoreSessions && !showTrash && !(isSearching && !filteredSessions.length && !filteredSharedSessions.length) && (
          <div className="flex justify-center pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSessionsOffset(prev => prev + PAGE_SIZE)}
              disabled={isLoading}
              data-testid="button-load-more-sessions"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Load more ({sessions.length} of {sessionsTotal})
            </Button>
          </div>
        )}
        </>
        )}
      </main>

      <Dialog open={!!editingSession} onOpenChange={(o) => {
        if (!o && editingSession && editName.trim() && (editName !== editingSession.name || (editLocation || "") !== (editingSession.location || ""))) {
          updateSession.mutate({ id: editingSession.id, name: editName, location: editLocation, expectedLastUpdatedAt: editingSessionVersionRef.current ?? editingSession.lastUpdatedAt });
        }
        if (!o) setEditingSession(null);
      }}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-session-name">Session Name</Label>
              <Input
                id="edit-session-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                data-testid="input-edit-session-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-session-location">Location</Label>
              <Input
                id="edit-session-location"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                data-testid="input-edit-session-location"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">Changes are saved automatically</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!duplicatingSession} onOpenChange={(o) => {
        if (!o) setDuplicatingSession(null);
      }}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Duplicate Session</DialogTitle>
            <DialogDescription>Enter a name for the duplicated session.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="duplicate-session-name">Session Name</Label>
              <Input
                id="duplicate-session-name"
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && duplicateName.trim() && duplicatingSession) {
                    duplicateSession.mutate({ id: duplicatingSession.id, name: duplicateName.trim() });
                  }
                }}
                data-testid="input-duplicate-session-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicatingSession(null)} data-testid="button-cancel-duplicate">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (duplicatingSession && duplicateName.trim()) {
                  duplicateSession.mutate({ id: duplicatingSession.id, name: duplicateName.trim() });
                }
              }}
              disabled={!duplicateName.trim() || duplicateSession.isPending}
              data-testid="button-confirm-duplicate"
            >
              {duplicateSession.isPending ? "Duplicating..." : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renamingFolder} onOpenChange={(o) => {
        if (!o && renamingFolder && renameFolderName.trim() && renameFolderName !== renamingFolder.name) {
          renameFolder.mutate({ id: renamingFolder.id, name: renameFolderName });
        }
        if (!o) setRenamingFolder(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rename-folder-name">Folder Name</Label>
              <Input
                id="rename-folder-name"
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                data-testid="input-rename-folder"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">Changes are saved automatically</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createFolderForSession} onOpenChange={(o) => { if (!o) { setCreateFolderForSession(null); setInlineFolderName(""); } }}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Create a folder and move "{createFolderForSession?.name}" into it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createFolderForSession || !inlineFolderName.trim()) return;
              const conflict = findFolderConflict(inlineFolderName.trim(), null, userFolders || []);
              if (conflict) {
                setFolderConflict({
                  mode: "create-and-move",
                  proposedName: inlineFolderName.trim(),
                  autoNumberedName: getNextAutoNumberedName(inlineFolderName.trim(), null, userFolders || []),
                  existingFolderId: conflict.id,
                  sessionId: createFolderForSession.id,
                });
                return;
              }
              createFolderAndMove.mutate({ sessionId: createFolderForSession.id, folderName: inlineFolderName });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="inline-folder-name">Folder Name</Label>
              <Input
                id="inline-folder-name"
                value={inlineFolderName}
                onChange={(e) => setInlineFolderName(e.target.value)}
                placeholder="e.g., Building A Counts"
                data-testid="input-inline-folder-name"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!inlineFolderName.trim() || createFolderAndMove.isPending}
              data-testid="button-create-folder-and-move"
            >
              {createFolderAndMove.isPending ? "Creating..." : "Create & Move"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <FolderConflictDialog
        open={!!folderConflict}
        onOpenChange={(o) => { if (!o) setFolderConflict(null); }}
        conflictingName={folderConflict?.proposedName || ""}
        autoNumberedName={folderConflict?.autoNumberedName || ""}
        existingFolderId={folderConflict?.existingFolderId || 0}
        onResolve={handleFolderConflictResolution}
        isPending={createFolder.isPending || createFolderAndMove.isPending || moveSession.isPending}
        mode={folderConflict?.mode || "create"}
      />

      <Dialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedSessions.size} Session(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => bulkMove.mutate({ ids: Array.from(selectedSessions), folderId: null })}
              disabled={bulkMove.isPending}
              data-testid="button-bulk-move-unfiled"
            >
              <Cable className="h-4 w-4 mr-2" /> Sessions
            </Button>
            {(userFolders || []).map(folder => (
              <Button
                key={folder.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => bulkMove.mutate({ ids: Array.from(selectedSessions), folderId: folder.id })}
                disabled={bulkMove.isPending}
                data-testid={`button-bulk-move-folder-${folder.id}`}
              >
                <Folder className="h-4 w-4 mr-2" /> {folder.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteSessionTarget} onOpenChange={(o) => { if (!o) setDeleteSessionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move "{deleteSessionTarget?.name}" to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This session will be moved to trash. You can restore it within 30 days, after which it will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-session">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteSessionTarget) deleteSession.mutate(deleteSessionTarget.id);
                setDeleteSessionTarget(null);
              }}
              data-testid="button-confirm-delete-session"
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!permanentDeleteTarget} onOpenChange={(o) => { if (!o) setPermanentDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete "{permanentDeleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this session and all its entries, photos, and pins. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-permanent-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (permanentDeleteTarget) permanentDeleteSession.mutate(permanentDeleteTarget.id);
                setPermanentDeleteTarget(null);
              }}
              data-testid="button-confirm-permanent-delete"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!resetSessionTarget} onOpenChange={(o) => { if (!o) setResetSessionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset "{resetSessionTarget?.name}" to photos only?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all entries, pins, comments, scan results, and other data — keeping only photos with their metadata. The session status will be reset to active. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset-session">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resetSessionTarget) resetSession.mutate(resetSessionTarget.id);
                setResetSessionTarget(null);
              }}
              data-testid="button-confirm-reset-session"
            >
              Reset to Photos Only
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteFolderTarget} onOpenChange={(o) => { if (!o) setDeleteFolderTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder "{deleteFolderTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFolderTarget?.sessionCount
                ? `This folder contains ${deleteFolderTarget.sessionCount} session${deleteFolderTarget.sessionCount !== 1 ? "s" : ""}. The sessions will not be deleted — they will be moved to the main Sessions list.`
                : "This empty folder will be permanently removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-folder">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteFolderTarget) deleteFolder.mutate(deleteFolderTarget.id);
                setDeleteFolderTarget(null);
              }}
              data-testid="button-confirm-delete-folder"
            >
              Delete Folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedSessions.size > 0 && (() => {
        const selectedList = (sessions || []).filter((s: any) => selectedSessions.has(s.id));
        const hasActive = selectedList.some((s: any) => s.status === "active");
        const hasCompleted = selectedList.some((s: any) => s.status === "completed");
        return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background border border-primary rounded-lg shadow-lg px-4 py-3 flex items-center gap-2 flex-wrap justify-center max-w-[calc(100vw-2rem)]" data-testid="bulk-action-bar">
          <span className="text-sm font-medium">{selectedSessions.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBulkMoveOpen(true)}
            data-testid="button-bulk-move"
            title="Move to folder"
          >
            <FolderInput className="h-3 w-3 mr-1" /> Move
          </Button>
          {hasActive && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkUpdateStatus.mutate({ ids: Array.from(selectedSessions), status: "completed" })}
            disabled={bulkUpdateStatus.isPending}
            data-testid="button-bulk-complete"
            title="Mark as complete"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
          </Button>
          )}
          {hasCompleted && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkUpdateStatus.mutate({ ids: Array.from(selectedSessions), status: "active" })}
            disabled={bulkUpdateStatus.isPending}
            data-testid="button-bulk-reopen"
            title="Reopen sessions"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Reopen
          </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" data-testid="button-bulk-delete" title="Delete selected sessions">
                <Trash2 className="h-3 w-3 mr-1" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selectedSessions.size} session(s)?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the selected sessions and all their data. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => bulkDelete.mutate(Array.from(selectedSessions))}
                  data-testid="button-confirm-bulk-delete"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        );
      })()}

      <Dialog open={pdfQualityOpen} onOpenChange={(open) => { if (!open) cancelPdfQualityDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>PDF Export Quality</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(["full", "standard"] as const).map((q) => (
              <button
                key={q}
                onClick={() => setPdfQualityChoice(q)}
                className={`w-full text-left rounded-lg border-2 p-4 transition-colors ${
                  pdfQualityChoice === q
                    ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30"
                    : "border-border hover:border-muted-foreground/40"
                }`}
                data-testid={`button-dashboard-pdf-quality-${q}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    {q === "full" ? "Full Quality" : "Standard"}
                  </span>
                  {q === "full" && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 uppercase tracking-wide">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {q === "full"
                    ? "Original resolution — best for auditing reel labels"
                    : "1600 px wide — faster download, smaller file"}
                </p>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={cancelPdfQualityDialog} data-testid="button-dashboard-pdf-quality-cancel">
              Cancel
            </Button>
            <Button
              onClick={confirmPdfQualityExport}
              disabled={pdfDialogWaiting}
              className="bg-orange-600 hover:bg-orange-700 text-white"
              data-testid="button-dashboard-pdf-quality-confirm"
            >
              {pdfDialogWaiting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                "Export"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
