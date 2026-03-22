import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Clock, FileText, Camera, MapPin, MessageSquare, User, AlertTriangle,
  Copy, Check, Lock, Unlock, Shield, ArrowRightLeft, Download, Flag,
  FlagOff, Settings, Link, Unlink, LogOut, Trash2, Files, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTimezone } from "@/hooks/use-timezone";
import { formatDateOnly, formatTimestamp } from "@/lib/timezone";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ActivityLogEntry {
  id: number;
  sessionId: number;
  userId: string;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: string | null;
  createdAt: string;
  _type: "activity";
}

interface SessionNote {
  id: number;
  sessionId: number;
  userId: string;
  username: string | null;
  text: string;
  createdAt: string;
  _type: "note";
}

type TimelineItem = ActivityLogEntry | SessionNote;

const ACTION_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  entry_created: { icon: FileText, label: "Added entry", color: "text-green-500" },
  entry_updated: { icon: FileText, label: "Updated entry", color: "text-blue-500" },
  entry_deleted: { icon: FileText, label: "Deleted entry", color: "text-red-500" },
  photo_uploaded: { icon: Camera, label: "Uploaded photo", color: "text-purple-500" },
  photo_deleted: { icon: Camera, label: "Deleted photo", color: "text-red-500" },
  photo_duplicated: { icon: Files, label: "Duplicated photo", color: "text-purple-500" },
  pin_created: { icon: MapPin, label: "Placed pin", color: "text-orange-500" },
  pin_committed: { icon: MapPin, label: "Committed pin", color: "text-green-500" },
  pin_deleted: { icon: Trash2, label: "Deleted pin", color: "text-red-500" },
  pin_flagged: { icon: Flag, label: "Flagged pin", color: "text-amber-500" },
  pin_unflagged: { icon: FlagOff, label: "Unflagged pin", color: "text-green-500" },
  comment_added: { icon: MessageSquare, label: "Commented", color: "text-blue-500" },
  status_changed: { icon: Clock, label: "Status changed", color: "text-yellow-500" },
  collaborator_added: { icon: User, label: "Added team member", color: "text-green-500" },
  collaborator_removed: { icon: User, label: "Removed team member", color: "text-red-500" },
  collaborator_left: { icon: LogOut, label: "Left session", color: "text-orange-500" },
  locked_session: { icon: Lock, label: "Locked session", color: "text-amber-600" },
  unlocked_session: { icon: Unlock, label: "Unlocked session", color: "text-green-500" },
  changed_role: { icon: Shield, label: "Changed role", color: "text-blue-500" },
  transferred_ownership: { icon: ArrowRightLeft, label: "Transferred ownership", color: "text-purple-600" },
  exported_pdf: { icon: Download, label: "Exported PDF", color: "text-blue-600" },
  exported_excel: { icon: Download, label: "Exported Excel", color: "text-green-600" },
  session_updated: { icon: Settings, label: "Updated session", color: "text-blue-500" },
  invite_created: { icon: Link, label: "Created invite link", color: "text-green-500" },
  invite_deactivated: { icon: Unlink, label: "Deactivated invite link", color: "text-red-500" },
};

function formatTimeAgo(dateStr: string, tz: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateOnly(date, tz);
}

export default function ActivityLog({
  sessionId,
  currentUserId,
  isOwner,
}: {
  sessionId: number;
  currentUserId?: string;
  isOwner?: boolean;
}) {
  const tz = useTimezone();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [copied, setCopied] = useState(false);
  const [noteText, setNoteText] = useState("");
  const listEndRef = useRef<HTMLDivElement>(null);

  const isFiltering = selectedUserId !== "all";

  type ActivityResponse = { logs: ActivityLogEntry[]; total: number; limit: number; offset: number };
  const ACTIVITY_PAGE_SIZE = 50;
  const [activityOffset, setActivityOffset] = useState(0);
  const [allLogs, setAllLogs] = useState<ActivityLogEntry[]>([]);
  const prevFilterRef = useRef(selectedUserId);
  if (prevFilterRef.current !== selectedUserId) {
    prevFilterRef.current = selectedUserId;
    if (activityOffset !== 0) setActivityOffset(0);
    if (allLogs.length > 0) setAllLogs([]);
  }

  const { data: activityData, isLoading: logsLoading, isError: logsError } = useQuery<ActivityResponse>({
    queryKey: ["/api/sessions", sessionId.toString(), "activity", isFiltering ? selectedUserId : "all", activityOffset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isFiltering) params.set("userId", selectedUserId);
      params.set("limit", String(ACTIVITY_PAGE_SIZE));
      params.set("offset", String(activityOffset));
      const url = `/api/sessions/${sessionId}/activity?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const activityTotal = activityData?.total ?? 0;

  

  const logs = (() => {
    if (!activityData) return allLogs.length > 0 ? allLogs : [];
    if (activityOffset === 0) return activityData.logs;
    const existingIds = new Set(allLogs.map(l => l.id));
    return [...allLogs, ...activityData.logs.filter(l => !existingIds.has(l.id))];
  })();

  const hasMoreLogs = logs.length < activityTotal;

  const { data: rawComments = [] } = useQuery<Array<{
    id: number;
    sessionId: number;
    userId: string;
    username: string | null;
    text: string;
    createdAt: string;
    entryId: number | null;
    photoId: number | null;
    parentCommentId: number | null;
  }>>({
    queryKey: ["/api/sessions", sessionId.toString(), "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/comments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: users = [] } = useQuery<Array<{ userId: string; username: string | null }>>({
    queryKey: ["/api/sessions", sessionId.toString(), "activity-users"],
    refetchInterval: 60000,
  });

  const postNote = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/comments`, { text });
      return res.json();
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "activity"] });
    },
    onError: () => {
      toast({ title: "Failed to post note", variant: "destructive" });
    },
  });

  const deleteNote = useMutation({
    mutationFn: async (commentId: number) => {
      const res = await apiRequest("DELETE", `/api/comments/${commentId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
    },
    onError: () => {
      toast({ title: "Failed to delete note", variant: "destructive" });
    },
  });

  const isLoading = logsLoading;

  const sessionNotes: SessionNote[] = rawComments
    .filter(c => c.entryId === null && c.photoId === null && c.parentCommentId === null)
    .map(c => ({ ...c, _type: "note" as const }));

  const sessionNoteIds = new Set(sessionNotes.map(n => n.id));

  const activityItems: ActivityLogEntry[] = logs
    .filter(l => !(l.action === "comment_added" && l.entityType === "comment" && l.entityId !== null && sessionNoteIds.has(l.entityId)))
    .map(l => ({ ...l, _type: "activity" as const }));

  const filteredNotes = isFiltering
    ? sessionNotes.filter(n => n.userId === selectedUserId)
    : sessionNotes;

  const timeline: TimelineItem[] = [...activityItems, ...filteredNotes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const handlePostNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    postNote.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlePostNote();
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (logsError) {
    return (
      <div className="p-4 text-center">
        <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
        <p className="text-xs text-muted-foreground">Failed to load activity log</p>
      </div>
    );
  }

  const copyAll = () => {
    const lines = timeline.map((item) => {
      if (item._type === "note") {
        const timestamp = formatTimestamp(item.createdAt, tz, {
          month: "short", day: "numeric", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        return [item.username || "Unknown", "Note", item.text, timestamp].filter(Boolean).join(" | ");
      }
      const log = item as ActivityLogEntry;
      const config = ACTION_CONFIG[log.action] || { label: log.action };
      const timestamp = formatTimestamp(log.createdAt, tz, {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      const parts = [
        log.username || "Unknown",
        config.label,
        log.details || "",
        timestamp,
      ];
      return parts.filter(Boolean).join(" | ");
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="h-7 text-xs w-[140px]" data-testid="select-activity-user-filter">
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-all-users">All users</SelectItem>
            {users.map(u => (
              <SelectItem key={u.userId} value={u.userId} data-testid={`select-item-user-${u.userId}`}>{u.username || "Unknown"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={copyAll} data-testid="button-copy-activity">
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy All</>}
        </Button>
      </div>

      {timeline.length === 0 && !isFiltering ? (
        <div className="p-4 text-center">
          <Clock className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No activity yet</p>
        </div>
      ) : timeline.length === 0 && isFiltering ? (
        <div className="p-4 text-center">
          <p className="text-xs text-muted-foreground">No activity for this user</p>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[320px] overflow-y-auto" data-testid="activity-log-list">
          {timeline.map((item) => {
            if (item._type === "note") {
              const note = item as SessionNote;
              const canDelete = currentUserId === note.userId || isOwner;
              return (
                <div
                  key={`note-${note.id}`}
                  className="flex items-start gap-2 px-2 py-1.5 hover:bg-muted/50 rounded-sm group bg-blue-50/30 dark:bg-blue-950/20 border-l-2 border-blue-400/50"
                  data-testid={`note-${note.id}`}
                >
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-tight">
                      <span className="font-medium">{note.username || "Unknown"}</span>
                      {" "}
                      <span className="text-muted-foreground italic">{note.text}</span>
                    </p>
                    <span className="text-[10px] text-muted-foreground mono">{formatTimeAgo(note.createdAt, tz)}</span>
                  </div>
                  {canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={() => deleteNote.mutate(note.id)}
                      disabled={deleteNote.isPending}
                      data-testid={`button-delete-note-${note.id}`}
                      title="Delete note"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  )}
                </div>
              );
            }

            const log = item as ActivityLogEntry;
            const config = ACTION_CONFIG[log.action] || { icon: Clock, label: log.action, color: "text-muted-foreground" };
            const Icon = config.icon;
            return (
              <div key={`activity-${log.id}`} className="flex items-start gap-2 px-2 py-1.5 hover:bg-muted/50 rounded-sm" data-testid={`activity-${log.id}`}>
                <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${config.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-tight">
                    <span className="font-medium">{log.username || "Unknown"}</span>
                    {" "}
                    <span className="text-muted-foreground">{config.label}</span>
                    {log.details && <span className="text-muted-foreground"> — {log.details}</span>}
                  </p>
                  <span className="text-[10px] text-muted-foreground mono">{formatTimeAgo(log.createdAt, tz)}</span>
                </div>
              </div>
            );
          })}
          {hasMoreLogs && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAllLogs(logs);
                  setActivityOffset(prev => prev + ACTIVITY_PAGE_SIZE);
                }}
                disabled={logsLoading}
                data-testid="button-load-more-activity"
              >
                Load more activity
              </Button>
            </div>
          )}
          <div ref={listEndRef} />
        </div>
      )}

      <div className="px-2 py-2 border-t border-border/50 mt-1">
        <div className="flex gap-2 items-end">
          <Textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a session note... (Ctrl+Enter to post)"
            className="text-xs resize-none min-h-[60px] flex-1"
            data-testid="input-session-note"
            disabled={postNote.isPending}
          />
          <Button
            size="sm"
            className="h-[60px] px-3 shrink-0"
            onClick={handlePostNote}
            disabled={!noteText.trim() || postNote.isPending}
            data-testid="button-post-note"
          >
            {postNote.isPending ? (
              <span className="text-xs">Posting...</span>
            ) : (
              <><Send className="h-3.5 w-3.5" /><span className="text-xs ml-1">Post Note</span></>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
