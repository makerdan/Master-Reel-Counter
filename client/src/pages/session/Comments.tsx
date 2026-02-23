import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, Trash2, Pencil, Reply, X, MessageSquare, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useTimezone } from "@/hooks/use-timezone";
import { formatDateOnly } from "@/lib/timezone";

interface CommentData {
  id: number;
  sessionId: number;
  userId: string;
  username: string | null;
  entryId: number | null;
  photoId: number | null;
  parentCommentId: number | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

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

export default function Comments({
  sessionId,
  entryId,
  photoId,
  role,
}: {
  sessionId: number;
  entryId?: number;
  photoId?: number;
  role?: string;
}) {
  const tz = useTimezone();
  const { user } = useAuth();
  const { toast } = useToast();
  const [newText, setNewText] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: allComments = [], isLoading, isError: commentsError } = useQuery<CommentData[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "comments"],
    refetchInterval: 15000,
  });

  const filtered = allComments.filter(c => {
    if (entryId) return c.entryId === entryId;
    if (photoId) return c.photoId === photoId;
    return !c.entryId && !c.photoId;
  });

  const topLevel = filtered.filter(c => !c.parentCommentId);
  const replies = filtered.filter(c => c.parentCommentId);

  const createComment = useMutation({
    mutationFn: async (data: { text: string; parentCommentId?: number }) => {
      const body: any = { text: data.text };
      if (entryId) body.entryId = entryId;
      if (photoId) body.photoId = photoId;
      if (data.parentCommentId) body.parentCommentId = data.parentCommentId;
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/comments`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
      setNewText("");
      setReplyTo(null);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
    },
    onError: () => toast({ title: "Failed to post comment", variant: "destructive" }),
  });

  const updateComment = useMutation({
    mutationFn: async ({ id, text }: { id: number; text: string }) => {
      const res = await apiRequest("PATCH", `/api/comments/${id}`, { text });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
      setEditingId(null);
      setEditText("");
    },
    onError: () => toast({ title: "Failed to update comment", variant: "destructive" }),
  });

  const deleteComment = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/comments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
    },
    onError: () => toast({ title: "Failed to delete comment", variant: "destructive" }),
  });

  const canEdit = role !== "viewer";
  const canPost = canEdit;

  const handleSubmit = () => {
    const text = newText.trim();
    if (!text) return;
    createComment.mutate({ text, parentCommentId: replyTo || undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const renderComment = (comment: CommentData, isReply = false) => {
    const isOwn = user?.id === comment.userId;
    const commentReplies = replies.filter(r => r.parentCommentId === comment.id);

    if (editingId === comment.id) {
      return (
        <div key={comment.id} className={`${isReply ? "ml-6" : ""} mb-2`}>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="text-xs min-h-[60px]"
            data-testid={`input-edit-comment-${comment.id}`}
          />
          <div className="flex gap-1 mt-1">
            <Button size="sm" variant="default" className="h-6 text-xs px-2" onClick={() => updateComment.mutate({ id: comment.id, text: editText })} disabled={!editText.trim()} data-testid={`button-save-edit-${comment.id}`}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditingId(null); setEditText(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div key={comment.id} className={`${isReply ? "ml-6 border-l-2 border-muted pl-2" : ""} mb-2 group`} data-testid={`comment-${comment.id}`}>
        <div className="flex items-start gap-2">
          <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-primary">{(comment.username || "?")[0].toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">{comment.username || "Unknown"}</span>
              <span className="text-[10px] text-muted-foreground mono">{formatTimeAgo(comment.createdAt, tz)}</span>
              {comment.createdAt !== comment.updatedAt && <span className="text-[10px] text-muted-foreground">(edited)</span>}
            </div>
            <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words mt-0.5">{comment.text}</p>
            <div className="flex gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {canEdit && !isReply && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1" onClick={() => setReplyTo(comment.id)} data-testid={`button-reply-${comment.id}`}>
                  <Reply className="h-3 w-3 mr-0.5" /> Reply
                </Button>
              )}
              {isOwn && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1" onClick={() => { setEditingId(comment.id); setEditText(comment.text); }} data-testid={`button-edit-comment-${comment.id}`}>
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              {isOwn && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1 text-destructive" onClick={() => deleteComment.mutate(comment.id)} data-testid={`button-delete-comment-${comment.id}`}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
        {commentReplies.map(r => renderComment(r, true))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (commentsError) {
    return (
      <div className="p-4 text-center">
        <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
        <p className="text-xs text-muted-foreground">Failed to load comments</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="comments-section">
      <div ref={scrollRef} className="flex-1 overflow-y-auto max-h-[300px] px-2 py-1">
        {topLevel.length === 0 ? (
          <div className="text-center py-4">
            <MessageSquare className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No comments yet</p>
          </div>
        ) : (
          topLevel.map(c => renderComment(c))
        )}
      </div>

      {canPost && (
        <div className="border-t p-2">
          {replyTo && (
            <div className="flex items-center gap-1 mb-1 text-xs text-muted-foreground">
              <Reply className="h-3 w-3" />
              <span>Replying to {allComments.find(c => c.id === replyTo)?.username || "comment"}</span>
              <Button size="sm" variant="ghost" className="h-4 w-4 p-0 ml-auto" onClick={() => setReplyTo(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
          <div className="flex gap-1">
            <Textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment..."
              className="text-xs min-h-[36px] max-h-[80px] resize-none flex-1"
              data-testid="input-new-comment"
            />
            <Button
              size="icon"
              variant="default"
              className="h-9 w-9 shrink-0"
              onClick={handleSubmit}
              disabled={!newText.trim() || createComment.isPending}
              data-testid="button-post-comment"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
