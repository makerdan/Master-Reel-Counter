import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users, Copy, Link, Mail, UserPlus, UserMinus, X, Loader2, Clock, ArrowRightLeft,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Collaborator, InviteLink } from "@shared/schema";

type OnlineUser = { userId: string; username: string };

export default function TeamDialog({
  open, onOpenChange, sessionId, sessionName, isOwner, onlineUsers = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number;
  sessionName: string;
  isOwner: boolean;
  onlineUsers?: OnlineUser[];
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [transferTarget, setTransferTarget] = useState<{ id: number; username: string } | null>(null);
  const { data: collaboratorsData } = useQuery<{ collaborators: Collaborator[]; owner: { userId: string } }>({
    queryKey: ["/api/sessions", sessionId.toString(), "collaborators"],
    enabled: open,
  });

  const { data: inviteLinks = [] } = useQuery<InviteLink[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "invite-links"],
    enabled: open && isOwner,
  });

  const addCollaborator = useMutation({
    mutationFn: async (uname: string) => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/collaborators`, { username: uname });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Collaborator added" });
      setUsername("");
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "collaborators"] });
    },
    onError: async (error: any) => {
      let message = "Failed to add collaborator";
      try { message = (await error)?.message || message; } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  const removeCollaborator = useMutation({
    mutationFn: async (collabId: number) => {
      await apiRequest("DELETE", `/api/sessions/${sessionId}/collaborators/${collabId}`);
    },
    onSuccess: () => {
      toast({ title: "Collaborator removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "collaborators"] });
    },
    onError: () => {
      toast({ title: "Failed to remove collaborator", variant: "destructive" });
    },
  });

  const changeRole = useMutation({
    mutationFn: async ({ collabId, role }: { collabId: number; role: string }) => {
      const res = await apiRequest("PATCH", `/api/sessions/${sessionId}/collaborators/${collabId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "collaborators"] });
    },
    onError: () => {
      toast({ title: "Failed to update role", variant: "destructive" });
    },
  });

  const transferOwnership = useMutation({
    mutationFn: async (collaboratorId: number) => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/transfer-ownership`, { collaboratorId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ownership transferred" });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "collaborators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to transfer ownership", variant: "destructive" });
    },
  });

  const generateLink = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/invite-links`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "invite-links"] });
      toast({ title: "Invite link generated" });
    },
    onError: () => {
      toast({ title: "Failed to generate invite link", variant: "destructive" });
    },
  });

  const revokeLink = useMutation({
    mutationFn: async (linkId: number) => {
      await apiRequest("DELETE", `/api/invite-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "invite-links"] });
      toast({ title: "Invite link revoked" });
    },
    onError: () => {
      toast({ title: "Failed to revoke link", variant: "destructive" });
    },
  });

  const sendEmailInvite = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/invite-links`);
      return res.json();
    },
    onSuccess: (link: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "invite-links"] });
      const inviteUrl = `${window.location.origin}/join/${link.token}`;
      const subject = encodeURIComponent(`You've been invited to count reels - ${sessionName}`);
      const body = encodeURIComponent(`You've been invited to collaborate on the counting session '${sessionName}'. Click the link to join: ${inviteUrl}`);
      window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`, "_self");
      setEmail("");
      toast({ title: "Email client opened" });
    },
    onError: () => {
      toast({ title: "Failed to generate invite link", variant: "destructive" });
    },
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Link copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const activeLinks = inviteLinks.filter((l: any) => l.isActive);
  const collaborators = collaboratorsData?.collaborators || [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-team">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team Management
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const onlineSet = new Set(onlineUsers.map((u) => u.userId));
            const ownerUserId = collaboratorsData?.owner?.userId;
            const roleMap = new Map<string, string>();
            if (ownerUserId) roleMap.set(ownerUserId, "owner");
            collaborators.forEach((c) => roleMap.set(c.userId, c.role));
            const allMembers = [
              ...(ownerUserId ? [{ userId: ownerUserId, username: onlineUsers.find(u => u.userId === ownerUserId)?.username || (ownerUserId === collaboratorsData?.owner?.userId ? "Owner" : ownerUserId), role: "owner" }] : []),
              ...collaborators.map((c) => ({ userId: c.userId, username: c.username || c.userId, role: c.role })),
            ];
            const uniqueMembers = Array.from(new Map(allMembers.map(m => [m.userId, m])).values());
            const onlineMembers = onlineUsers.filter(u => !uniqueMembers.find(m => m.userId === u.userId));
            const displayList = [
              ...uniqueMembers,
              ...onlineMembers.map(u => ({ userId: u.userId, username: u.username, role: roleMap.get(u.userId) || "viewer" })),
            ];
            if (displayList.length === 0) return null;
            return (
              <div className="border border-border rounded-md px-3 py-2 space-y-1.5" data-testid="online-users-section">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Who's Online</p>
                <div className="flex flex-wrap gap-2">
                  {displayList.map((m) => {
                    const isOnline = onlineSet.has(m.userId);
                    return (
                      <div key={m.userId} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${isOnline ? "border-green-500/40 bg-green-500/10" : "border-border bg-muted/40 opacity-60"}`} data-testid={`online-user-${m.userId}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                        <span className="font-medium">{m.username}</span>
                        <span className="text-muted-foreground capitalize">{m.role}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <Tabs defaultValue="username" className="w-full">
            <TabsList className="w-full grid grid-cols-2 sm:flex h-auto sm:h-9" data-testid="tabs-invite-method">
              <TabsTrigger value="username" className="flex-1 border border-white/20" data-testid="tab-invite-username">
                <UserPlus className="h-3 w-3 mr-1" />
                Username
              </TabsTrigger>
              <TabsTrigger value="link" className="flex-1 border border-white/20" data-testid="tab-invite-link">
                <Link className="h-3 w-3 mr-1" />
                Share Link
              </TabsTrigger>
              <TabsTrigger value="email" className="flex-1 border border-white/20" data-testid="tab-invite-email">
                <Mail className="h-3 w-3 mr-1" />
                Email
              </TabsTrigger>
            </TabsList>

            <TabsContent value="username" className="space-y-3 mt-3">
              <p className="text-xs text-muted-foreground">Add a teammate directly by their Replit username. They'll get immediate access.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (username.trim()) addCollaborator.mutate(username.trim());
                }}
                className="flex items-center gap-2"
              >
                <Input
                  placeholder="Replit username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="min-w-0"
                  data-testid="input-collaborator-username"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!username.trim() || addCollaborator.isPending}
                  data-testid="button-add-collaborator"
                >
                  {addCollaborator.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="link" className="space-y-3 mt-3">
              <p className="text-xs text-muted-foreground">Generate a shareable link. Anyone with the link can join this session — no Replit account required.</p>
              <Button
                size="sm"
                variant="outline"
                className="[border-color:hsl(var(--input))]"
                onClick={() => generateLink.mutate()}
                disabled={generateLink.isPending}
                data-testid="button-generate-link"
              >
                {generateLink.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Link className="h-3 w-3 mr-1" />}
                Generate Link
              </Button>
              {activeLinks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Active invite links:</p>
                  {activeLinks.map((link: any) => {
                    const fullUrl = `${window.location.origin}/join/${link.token}`;
                    const expiresAt = link.expiresAt ? new Date(link.expiresAt) : null;
                    const now = new Date();
                    const isExpired = expiresAt && expiresAt < now;
                    const timeLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : null;
                    return (
                      <div key={link.id} className="space-y-1" data-testid={`invite-link-${link.id}`}>
                        <div className="flex items-center gap-2 text-xs">
                          <code className="flex-1 truncate bg-muted px-2 py-1 rounded text-xs" data-testid={`text-invite-url-${link.id}`}>
                            {fullUrl}
                          </code>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" onClick={() => copyToClipboard(fullUrl)} data-testid={`button-copy-link-${link.id}`}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy link</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button size="sm" variant="ghost" onClick={() => revokeLink.mutate(link.id)} disabled={revokeLink.isPending} data-testid={`button-revoke-link-${link.id}`}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-2">
                          <span data-testid={`text-link-used-${link.id}`}>
                            {link.usedCount || 0} joined
                          </span>
                          {timeLeft !== null && (
                            <span className={`flex items-center gap-0.5 ${isExpired ? 'text-destructive' : ''}`} data-testid={`text-link-expiry-${link.id}`}>
                              <Clock className="h-2.5 w-2.5" />
                              {isExpired ? "Expired" : `${timeLeft}d left`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="email" className="space-y-3 mt-3">
              <p className="text-xs text-muted-foreground">Open your email client with a pre-filled invite message and a join link for this session.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) sendEmailInvite.mutate();
                }}
                className="flex items-center gap-2"
              >
                <Input
                  type="email"
                  placeholder="Send to Email..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-w-0"
                  data-testid="input-invite-email"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!email.trim() || sendEmailInvite.isPending}
                  data-testid="button-send-email-invite"
                >
                  {sendEmailInvite.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send Invite"}
                </Button>
              </form>
            </TabsContent>

          </Tabs>

          {collaborators.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground">Team Members ({collaborators.length})</p>
              {collaborators.map((collab: any) => (
                <div key={collab.id} className="flex items-center justify-between gap-2" data-testid={`collaborator-${collab.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold uppercase shrink-0">
                      {(collab.username || "?").charAt(0)}
                    </div>
                    <span className="text-sm truncate" data-testid={`text-collaborator-username-${collab.id}`}>
                      {collab.username || collab.userId}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isOwner ? (
                      <>
                        <Select
                          value={collab.role}
                          onValueChange={(role) => changeRole.mutate({ collabId: collab.id, role })}
                        >
                          <SelectTrigger className="h-7 w-[90px] text-xs" data-testid={`select-role-${collab.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="editor">Editor</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setTransferTarget({ id: collab.id, username: collab.username || collab.userId })}
                              data-testid={`button-transfer-ownership-${collab.id}`}
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Transfer ownership</TooltipContent>
                        </Tooltip>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeCollaborator.mutate(collab.id)}
                          disabled={removeCollaborator.isPending}
                          data-testid={`button-remove-collaborator-${collab.id}`}
                        >
                          <UserMinus className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid={`badge-collaborator-role-${collab.id}`}>
                        {collab.role}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!transferTarget} onOpenChange={(o) => { if (!o) setTransferTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer Ownership</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to transfer ownership of "{sessionName}" to {transferTarget?.username}? You will become an editor instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-transfer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (transferTarget) transferOwnership.mutate(transferTarget.id);
                setTransferTarget(null);
              }}
              data-testid="button-confirm-transfer"
            >
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
