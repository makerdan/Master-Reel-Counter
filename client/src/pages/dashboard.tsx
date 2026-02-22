import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Cable, Plus, LogOut, MapPin, Clock, Trash2, ChevronRight, Settings, BarChart3,
  Pencil, Hash, Ruler, CheckCircle2, RotateCcw, Camera, Layers, Users,
  FolderPlus, FolderOpen, Folder, MoreVertical, Copy, FolderInput,
  Search, ChevronDown, X, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle,
  Lock, Unlock,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
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
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Session, Folder as FolderType } from "@shared/schema";

type SessionWithStats = Session & {
  entryCount: number;
  totalFootage: number;
  sectionCount: number;
  photoCount: number;
  firstPhotoAt: string | null;
  lastPhotoAt: string | null;
  thumbnailKey: string | null;
};

type SharedSessionWithStats = SessionWithStats & {
  role: string;
  ownerUsername?: string;
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [sessionLocation, setSessionLocation] = useState("");
  const [editingSession, setEditingSession] = useState<SessionWithStats | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<FolderType | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInside, setSearchInside] = useState(false);
  const [showRecentSearches, setShowRecentSearches] = useState(false);

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

  const { data: sessions, isLoading, isError: sessionsError } = useQuery<SessionWithStats[]>({
    queryKey: ["/api/sessions"],
    enabled: !!user,
    placeholderData: [],
  });

  const { data: sharedSessions } = useQuery<SharedSessionWithStats[]>({
    queryKey: ["/api/sessions/shared"],
    enabled: !!user,
    placeholderData: [],
  });

  const { data: userFolders } = useQuery<FolderType[]>({
    queryKey: ["/api/folders"],
    enabled: !!user,
    placeholderData: [],
  });

  type SearchResult = { ownedIds: number[]; sharedIds: number[]; reasons: Record<number, string[]> };
  const emptySearch: SearchResult = { ownedIds: [], sharedIds: [], reasons: {} };

  const { data: searchResults } = useQuery<SearchResult>({
    queryKey: ["/api/search/sessions", searchQuery, searchInside],
    queryFn: async () => {
      if (!searchQuery.trim()) return emptySearch;
      const res = await fetch(`/api/search/sessions?q=${encodeURIComponent(searchQuery)}&inside=${searchInside}`);
      if (!res.ok) return emptySearch;
      return res.json();
    },
    enabled: !!user && searchQuery.trim().length > 0,
    placeholderData: emptySearch,
  });

  useEffect(() => {
    if (searchQuery.trim() && searchResults && (searchResults.ownedIds.length > 0 || searchResults.sharedIds.length > 0)) {
      addRecentSearch(searchQuery);
    }
  }, [searchResults]);

  const isSearching = searchQuery.trim().length > 0;
  const ownedMatchSet = useMemo(() => new Set(searchResults?.ownedIds || []), [searchResults]);
  const sharedMatchSet = useMemo(() => new Set(searchResults?.sharedIds || []), [searchResults]);
  const matchReasons = searchResults?.reasons || {};

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
      toast({ title: "Session deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete session", variant: "destructive" });
    },
  });

  const updateSession = useMutation({
    mutationFn: async ({ id, name, location }: { id: number; name: string; location: string }) => {
      const res = await apiRequest("PATCH", `/api/sessions/${id}`, { name, location: location || null });
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      setEditingSession(null);
      toast({ title: "Session updated" });
    },
    onError: () => {
      toast({ title: "Failed to update session", variant: "destructive" });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const body: any = { status };
      if (status === "completed") body.completedAt = new Date().toISOString();
      else body.completedAt = null;
      const res = await apiRequest("PATCH", `/api/sessions/${id}`, body);
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
    },
    onError: () => {
      toast({ title: "Failed to update session status", variant: "destructive" });
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
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/folders", { name: newFolderName });
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
      setRenamingFolder(null);
      toast({ title: "Folder renamed" });
    },
    onError: () => {
      toast({ title: "Failed to rename folder", variant: "destructive" });
    },
  });

  const deleteFolder = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/folders/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Folder deleted (sessions moved to unfiled)" });
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

  const duplicateSession = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/duplicate`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
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

  const openEditDialog = (session: SessionWithStats, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSession(session);
    setEditName(session.name);
    setEditLocation(session.location || "");
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
    return new Date(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatElapsedMinutes = (first: string | null, last: string | null) => {
    if (!first || !last) return null;
    const diff = new Date(last).getTime() - new Date(first).getTime();
    if (diff <= 0) return null;
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
    footage: "Matched Footage",
    reels: "Matched Reels",
    collaborator: "Matched Collaborator",
    entries: "Matched Entry Content",
  };

  const renderSessionCard = (session: SessionWithStats, isShared = false) => {
    const prefix = isShared ? "shared-" : "";
    const sessionReasons = isSearching ? (matchReasons[session.id] || []) : [];
    const isSelected = selectedSessions.has(session.id);
    return (
      <Card
        key={session.id}
        className={`hover-elevate cursor-pointer border ${isSelected ? "border-primary ring-2 ring-primary/30" : "border-primary"}`}
        data-testid={`card-${prefix}session-${session.id}`}
        onClick={() => setLocation(`/session/${session.id}`)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            {!isShared && (
              <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSessionSelection(session.id, { stopPropagation: () => {} } as React.MouseEvent)}
                  data-testid={`checkbox-select-session-${session.id}`}
                />
              </div>
            )}
            <div className="shrink-0" data-testid={`img-session-thumbnail-${session.id}`}>
              {session.thumbnailKey ? (
                <img
                  src={session.thumbnailKey}
                  alt=""
                  className="w-12 h-12 rounded-md object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                  <Camera className="h-5 w-5 text-muted-foreground" />
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
                {sessionReasons.length > 0 && sessionReasons.map(reason => (
                  <Badge
                    key={reason}
                    variant="outline"
                    className="no-default-hover-elevate no-default-active-elevate border-primary/40 text-primary bg-primary/5"
                    data-testid={`badge-match-reason-${reason}-${session.id}`}
                  >
                    {reasonLabels[reason] || reason}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                {isShared && (session as SharedSessionWithStats).ownerUsername && (
                  <span className="flex items-center gap-1" data-testid={`text-shared-session-owner-${session.id}`}>
                    <Users className="h-3 w-3" />
                    {(session as SharedSessionWithStats).ownerUsername}
                  </span>
                )}
                {session.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {session.location}
                  </span>
                )}
                <span className="flex items-center gap-1" data-testid={`text-${prefix}session-time-${session.id}`}>
                  <Clock className="h-3 w-3" />
                  {session.firstPhotoAt
                    ? `${formatDate(session.firstPhotoAt)}${session.lastPhotoAt && session.lastPhotoAt !== session.firstPhotoAt ? ` - ${formatDate(session.lastPhotoAt)}` : ""}`
                    : "No photos yet"}
                  {(() => {
                    const elapsed = formatElapsedMinutes(session.firstPhotoAt, session.lastPhotoAt);
                    return elapsed ? <span className="ml-1 mono" data-testid={`badge-${prefix}session-elapsed-${session.id}`}>({elapsed})</span> : null;
                  })()}
                </span>
                <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-photos-${session.id}`}>
                  <Camera className="h-3 w-3" />
                  {session.photoCount} photos
                </span>
                {session.sectionCount > 0 && (
                  <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-sections-${session.id}`}>
                    <Layers className="h-3 w-3" />
                    {session.sectionCount} sections
                  </span>
                )}
                <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-entries-${session.id}`}>
                  <Hash className="h-3 w-3" />
                  {session.entryCount} reels
                </span>
                {session.totalFootage > 0 && (
                  <span className="flex items-center gap-1 mono" data-testid={`text-${prefix}session-footage-${session.id}`}>
                    <Ruler className="h-3 w-3" />
                    {session.totalFootage.toLocaleString()} ft
                  </span>
                )}
              </div>
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
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStatus.mutate({
                          id: session.id,
                          status: session.status === "active" ? "completed" : "active",
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
                        duplicateSession.mutate(session.id);
                      }}
                      data-testid={`menu-duplicate-session-${session.id}`}
                    >
                      <Copy className="h-4 w-4 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger data-testid={`menu-move-session-${session.id}`}>
                        <FolderInput className="h-4 w-4 mr-2" /> Move to Folder
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
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
                    <DropdownMenuSeparator />
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

  const renderFolderSection = (folder: FolderType) => {
    const folderSessions = folderedSessions.get(folder.id) || [];
    const isCollapsed = isSearching ? false : !openFolders.has(folder.id);

    if (isSearching && folderSessions.length === 0) return null;

    return (
      <Collapsible
        key={folder.id}
        open={!isCollapsed}
        onOpenChange={() => toggleFolderCollapse(folder.id)}
      >
        <div className="flex items-center gap-2 group" data-testid={`folder-header-${folder.id}`}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 px-2" data-testid={`button-toggle-folder-${folder.id}`}>
              <ChevronDown className={`h-4 w-4 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              {isCollapsed ? <Folder className="h-4 w-4 text-primary" /> : <FolderOpen className="h-4 w-4 text-primary" />}
              <span className="font-semibold text-sm">{folder.name}</span>
              <Badge variant="secondary" className="ml-1 no-default-hover-elevate no-default-active-elevate text-xs">
                {folderSessions.length}
              </Badge>
            </Button>
          </CollapsibleTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                data-testid={`button-folder-menu-${folder.id}`}
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
          <div className="space-y-2 ml-4 mt-1 border-l-2 border-primary/20 pl-3">
            {folderSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 pl-2">No sessions in this folder</p>
            ) : (
              folderSessions.map(session => renderSessionCard(session))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const unfiledSessions = folderedSessions.get(null) || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-3 max-w-5xl mx-auto">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm" data-testid="text-user-name">
              {user?.firstName || "User"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
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

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">
            Counting Sessions
          </h1>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-sort-sessions">
                  <ArrowUpDown className="h-4 w-4 mr-1" />
                  {sortField === "date" ? "Date" : sortField === "name" ? "Name" : sortField === "entries" ? "Reels" : "Footage"}
                  {sortDirection === "desc" ? <ArrowDown className="h-3 w-3 ml-1" /> : <ArrowUp className="h-3 w-3 ml-1" />}
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
                <Button variant="outline" size="sm" data-testid="button-new-folder">
                  <FolderPlus className="h-4 w-4" />
                  New Folder
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Folder</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newFolderName.trim()) createFolder.mutate();
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
                <Button data-testid="button-new-session">
                  <Plus className="h-4 w-4" />
                  New Session
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
                }
              }}
              placeholder="Search sessions..."
              className="pl-9 pr-9"
              data-testid="input-search-sessions"
            />
            {searchQuery && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => { setSearchQuery(""); setShowRecentSearches(false); }}
                data-testid="button-clear-search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
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
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="search-inside"
              checked={searchInside}
              onCheckedChange={(checked) => setSearchInside(checked === true)}
              data-testid="checkbox-search-inside"
            />
            <label htmlFor="search-inside" className="text-xs text-muted-foreground cursor-pointer">
              Search inside sessions (entries, categories, notes)
            </label>
          </div>
        </div>

        {(() => {
          try {
            const lastId = localStorage.getItem("reel-counter-last-session");
            if (!lastId || !sessions?.length) return null;
            const lastSession = sessions.find(s => s.id === parseInt(lastId));
            if (!lastSession || lastSession.status === "completed") return null;
            return (
              <div className="mb-4">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-primary/40 hover:bg-primary/5"
                  onClick={() => setLocation(`/session/${lastSession.id}`)}
                  data-testid="button-continue-last-session"
                >
                  <ChevronRight className="h-4 w-4 text-primary" />
                  <span className="text-sm">Continue: <strong>{lastSession.name}</strong></span>
                  {lastSession.location && <span className="text-xs text-muted-foreground">({lastSession.location})</span>}
                </Button>
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
              <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/sessions"] })} data-testid="button-retry-sessions">
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
            {(userFolders || []).map(folder => renderFolderSection(folder))}
            <Card className="border border-border">
              <CardContent className="py-8 text-center">
                <Cable className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground text-sm">No sessions yet. Create one to start counting reels.</p>
              </CardContent>
            </Card>
          </div>
        ) : isSearching && !filteredSessions.length && !filteredSharedSessions.length ? (
          <Card className="border border-border">
            <CardContent className="py-8 text-center">
              <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">No sessions match "{searchQuery}"</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {isSearching && (
              <p className="text-sm text-muted-foreground" data-testid="text-search-result-count">
                Found {filteredSessions.length + filteredSharedSessions.length} result{filteredSessions.length + filteredSharedSessions.length !== 1 ? "s" : ""} matching "{searchQuery}":
              </p>
            )}
            {(userFolders || []).map(folder => renderFolderSection(folder))}

            {unfiledSessions.length > 0 && (
              <div>
                {(userFolders || []).length > 0 && (
                  <div className="flex items-center gap-2 mb-2" data-testid="unfiled-header">
                    <Cable className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm text-muted-foreground">Unfiled</span>
                    <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">
                      {unfiledSessions.length}
                    </Badge>
                  </div>
                )}
                <div className="space-y-2">
                  {unfiledSessions.map(session => renderSessionCard(session))}
                </div>
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
      </main>

      <Dialog open={!!editingSession} onOpenChange={(o) => { if (!o) setEditingSession(null); }}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editingSession && editName.trim()) {
                updateSession.mutate({ id: editingSession.id, name: editName, location: editLocation });
              }
            }}
            className="space-y-4"
          >
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
            <Button
              type="submit"
              className="w-full"
              disabled={!editName.trim() || updateSession.isPending}
              data-testid="button-save-session-edit"
            >
              {updateSession.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renamingFolder} onOpenChange={(o) => { if (!o) setRenamingFolder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renamingFolder && renameFolderName.trim()) {
                renameFolder.mutate({ id: renamingFolder.id, name: renameFolderName });
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="rename-folder-name">Folder Name</Label>
              <Input
                id="rename-folder-name"
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                data-testid="input-rename-folder"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!renameFolderName.trim() || renameFolder.isPending}
              data-testid="button-save-folder-rename"
            >
              {renameFolder.isPending ? "Saving..." : "Save"}
            </Button>
          </form>
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
              if (createFolderForSession && inlineFolderName.trim()) {
                createFolderAndMove.mutate({ sessionId: createFolderForSession.id, folderName: inlineFolderName });
              }
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
              <Cable className="h-4 w-4 mr-2" /> Unfiled
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
            <AlertDialogTitle>Delete "{deleteSessionTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this session and all its entries, photos, and pins. This cannot be undone.
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
              Delete Session
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
                ? `This folder contains ${deleteFolderTarget.sessionCount} session${deleteFolderTarget.sessionCount !== 1 ? "s" : ""}. The sessions will not be deleted — they will be moved to unfiled.`
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

      {selectedSessions.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background border border-primary rounded-lg shadow-lg px-4 py-3 flex items-center gap-3" data-testid="bulk-action-bar">
          <span className="text-sm font-medium">{selectedSessions.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedSessions(new Set())}
            data-testid="button-bulk-clear"
          >
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBulkMoveOpen(true)}
            data-testid="button-bulk-move"
          >
            <FolderInput className="h-3 w-3 mr-1" /> Move
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkUpdateStatus.mutate({ ids: Array.from(selectedSessions), status: "completed" })}
            disabled={bulkUpdateStatus.isPending}
            data-testid="button-bulk-complete"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkUpdateStatus.mutate({ ids: Array.from(selectedSessions), status: "active" })}
            disabled={bulkUpdateStatus.isPending}
            data-testid="button-bulk-reopen"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Reopen
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" data-testid="button-bulk-delete">
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
      )}
    </div>
  );
}
