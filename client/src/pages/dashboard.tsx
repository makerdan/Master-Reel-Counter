import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Cable, Plus, LogOut, MapPin, Clock, Trash2, ChevronRight, Settings,
  Pencil, Hash, Ruler, CheckCircle2, RotateCcw, Camera, Layers, Users,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Session } from "@shared/schema";

type SessionWithStats = Session & {
  entryCount: number;
  totalFootage: number;
  sectionCount: number;
  photoCount: number;
  firstPhotoAt: string | null;
  lastPhotoAt: string | null;
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

  const { data: sessions, isLoading } = useQuery<SessionWithStats[]>({
    queryKey: ["/api/sessions"],
    enabled: !!user,
    placeholderData: [],
  });

  const { data: sharedSessions } = useQuery<SharedSessionWithStats[]>({
    queryKey: ["/api/sessions/shared"],
    enabled: !!user,
    placeholderData: [],
  });

  const createSession = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions", {
        name: sessionName,
        location: sessionLocation || null,
      });
      return res.json();
    },
    onSuccess: (session: Session) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
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

  const openEditDialog = (session: SessionWithStats, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSession(session);
    setEditName(session.name);
    setEditLocation(session.location || "");
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
        <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">
            Counting Sessions
          </h1>
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

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : !sessions?.length ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Cable className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">No sessions yet. Create one to start counting reels.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <Card
                key={session.id}
                className="hover-elevate cursor-pointer border border-primary"
                data-testid={`card-session-${session.id}`}
                onClick={() => setLocation(`/session/${session.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm truncate" data-testid={`text-session-name-${session.id}`}>
                          {session.name}
                        </h3>
                        <Badge
                          variant={session.status === "active" ? "default" : "secondary"}
                          className="no-default-hover-elevate no-default-active-elevate"
                          data-testid={`badge-session-status-${session.id}`}
                        >
                          {session.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                        {session.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {session.location}
                          </span>
                        )}
                        <span className="flex items-center gap-1" data-testid={`text-session-time-${session.id}`}>
                          <Clock className="h-3 w-3" />
                          {session.firstPhotoAt
                            ? `${formatDate(session.firstPhotoAt)}${session.lastPhotoAt && session.lastPhotoAt !== session.firstPhotoAt ? ` - ${formatDate(session.lastPhotoAt)}` : ""}`
                            : "No photos yet"}
                          {(() => {
                            const elapsed = formatElapsedMinutes(session.firstPhotoAt, session.lastPhotoAt);
                            return elapsed ? <span className="ml-1 mono" data-testid={`badge-session-elapsed-${session.id}`}>({elapsed})</span> : null;
                          })()}
                        </span>
                        <span className="flex items-center gap-1 mono" data-testid={`text-session-photos-${session.id}`}>
                          <Camera className="h-3 w-3" />
                          {session.photoCount} photos
                        </span>
                        {session.sectionCount > 0 && (
                          <span className="flex items-center gap-1 mono" data-testid={`text-session-sections-${session.id}`}>
                            <Layers className="h-3 w-3" />
                            {session.sectionCount} sections
                          </span>
                        )}
                        <span className="flex items-center gap-1 mono" data-testid={`text-session-entries-${session.id}`}>
                          <Hash className="h-3 w-3" />
                          {session.entryCount} reels
                        </span>
                        {session.totalFootage > 0 && (
                          <span className="flex items-center gap-1 mono" data-testid={`text-session-footage-${session.id}`}>
                            <Ruler className="h-3 w-3" />
                            {session.totalFootage.toLocaleString()} ft
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStatus.mutate({
                                id: session.id,
                                status: session.status === "active" ? "completed" : "active",
                              });
                            }}
                            data-testid={`button-toggle-status-${session.id}`}
                          >
                            {session.status === "active" ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{session.status === "active" ? "Mark Session Complete" : "Reopen This Session"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => openEditDialog(session, e)}
                            data-testid={`button-edit-session-${session.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit Session Name</TooltipContent>
                      </Tooltip>
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`button-delete-session-${session.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>Delete This Session</TooltipContent>
                        </Tooltip>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Session?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete "{session.name}" and all its entries, photos, and pins.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteSession.mutate(session.id)}
                              data-testid="button-confirm-delete"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {sharedSessions && sharedSessions.length > 0 && (
          <>
            <div className="flex items-center gap-2 mt-8 mb-4">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-bold" data-testid="text-shared-sessions-title">
                Shared with me
              </h2>
            </div>
            <div className="space-y-3">
              {sharedSessions.map((session) => (
                <Card
                  key={session.id}
                  className="hover-elevate cursor-pointer border border-primary"
                  data-testid={`card-shared-session-${session.id}`}
                  onClick={() => setLocation(`/session/${session.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm truncate" data-testid={`text-shared-session-name-${session.id}`}>
                            {session.name}
                          </h3>
                          <Badge
                            variant={session.status === "active" ? "default" : "secondary"}
                            className="no-default-hover-elevate no-default-active-elevate"
                            data-testid={`badge-shared-session-status-${session.id}`}
                          >
                            {session.status}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="no-default-hover-elevate no-default-active-elevate"
                            data-testid={`badge-shared-session-role-${session.id}`}
                          >
                            {session.role}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1" data-testid={`text-shared-session-owner-${session.id}`}>
                            <Users className="h-3 w-3" />
                            {session.ownerUsername || session.userId}
                          </span>
                          {session.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {session.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1" data-testid={`text-shared-session-time-${session.id}`}>
                            <Clock className="h-3 w-3" />
                            {session.firstPhotoAt
                              ? `${formatDate(session.firstPhotoAt)}${session.lastPhotoAt && session.lastPhotoAt !== session.firstPhotoAt ? ` - ${formatDate(session.lastPhotoAt)}` : ""}`
                              : "No photos yet"}
                            {(() => {
                              const elapsed = formatElapsedMinutes(session.firstPhotoAt, session.lastPhotoAt);
                              return elapsed ? <span className="ml-1 mono" data-testid={`badge-shared-session-elapsed-${session.id}`}>({elapsed})</span> : null;
                            })()}
                          </span>
                          <span className="flex items-center gap-1 mono" data-testid={`text-shared-session-photos-${session.id}`}>
                            <Camera className="h-3 w-3" />
                            {session.photoCount} photos
                          </span>
                          {session.sectionCount > 0 && (
                            <span className="flex items-center gap-1 mono" data-testid={`text-shared-session-sections-${session.id}`}>
                              <Layers className="h-3 w-3" />
                              {session.sectionCount} sections
                            </span>
                          )}
                          <span className="flex items-center gap-1 mono" data-testid={`text-shared-session-entries-${session.id}`}>
                            <Hash className="h-3 w-3" />
                            {session.entryCount} reels
                          </span>
                          {session.totalFootage > 0 && (
                            <span className="flex items-center gap-1 mono" data-testid={`text-shared-session-footage-${session.id}`}>
                              <Ruler className="h-3 w-3" />
                              {session.totalFootage.toLocaleString()} ft
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
    </div>
  );
}
