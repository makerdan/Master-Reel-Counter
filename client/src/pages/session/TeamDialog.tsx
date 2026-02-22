import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users, Copy, Link, Mail, UserPlus, UserMinus, X, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Collaborator, InviteLink } from "@shared/schema";

export default function TeamDialog({
  open, onOpenChange, sessionId, sessionName, isOwner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number;
  sessionName: string;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-team">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team Management
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="username" className="w-full">
          <TabsList className="w-full" data-testid="tabs-invite-method">
            <TabsTrigger value="username" className="flex-1" data-testid="tab-invite-username">
              <UserPlus className="h-3 w-3 mr-1" />
              Username
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1" data-testid="tab-invite-link">
              <Link className="h-3 w-3 mr-1" />
              Share Link
            </TabsTrigger>
            <TabsTrigger value="email" className="flex-1" data-testid="tab-invite-email">
              <Mail className="h-3 w-3 mr-1" />
              Email
            </TabsTrigger>
          </TabsList>

          <TabsContent value="username" className="space-y-3 mt-3">
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
            <Button
              size="sm"
              variant="outline"
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
                  return (
                    <div key={link.id} className="flex items-center gap-2 text-xs" data-testid={`invite-link-${link.id}`}>
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
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="email" className="space-y-3 mt-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) sendEmailInvite.mutate();
              }}
              className="flex items-center gap-2"
            >
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                  <span className="text-sm truncate" data-testid={`text-collaborator-username-${collab.id}`}>
                    {collab.username || collab.userId}
                  </span>
                  <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid={`badge-collaborator-role-${collab.id}`}>
                    {collab.role}
                  </Badge>
                </div>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCollaborator.mutate(collab.id)}
                    disabled={removeCollaborator.isPending}
                    data-testid={`button-remove-collaborator-${collab.id}`}
                  >
                    <UserMinus className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
