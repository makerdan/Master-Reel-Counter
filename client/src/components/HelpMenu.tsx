import { useState, useRef, useEffect, useCallback } from "react";
import { HelpCircle, Camera, MapPin, Flag, Eye, EyeOff, ZoomIn, ZoomOut, Move, RotateCw, ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Download, FileText, Mail, Lock, Unlock, Undo2, Redo2, History, Users, Share2, AlertCircle, AlertTriangle, StickyNote, Focus, ArrowUpDown, ArrowUp, ImagePlus, Check, X, Copy, Cable, Folder, FolderPlus, FolderInput, Search, MoreVertical, Settings, LogOut, BarChart3, CheckCircle2, Hash, Ruler, ExternalLink, MessageSquare, Loader2, ScanLine, Grid3X3, ListChecks, Sparkles, SquareCheck, Send, Bot, User, RotateCcw, HardDrive, Globe, FileSpreadsheet, Clock, Shield, Flame, Trophy, Activity, Award, Layers, Target, Calendar, Package, MessageCircle, Reply, Accessibility, Palette, Type, Sliders, Key } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocation } from "wouter";

function FeedbackDialog({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("BUG_REPORT");
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  const submit = useMutation({
    mutationFn: async (data: { topic: string; message: string; page: string }) => {
      const res = await apiRequest("POST", "/api/feedback", data);
      return res.json();
    },
    onSuccess: () => {
      setOpen(false);
      setMessage("");
      setTopic("BUG_REPORT");
      toast({ title: "Feedback sent — thank you!" });
    },
    onError: () => {
      toast({ title: "Failed to send feedback", variant: "destructive" });
    },
  });

  return (
    <>
      <Button
        variant="outline"
        className="w-full mb-2 gap-2 text-xs"
        onClick={() => setOpen(true)}
        data-testid="button-send-feedback-help"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Send Feedback
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Send Feedback</DialogTitle>
            <DialogDescription className="text-xs">
              Share a bug report, feature idea, or any other feedback with the developer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Topic</Label>
              <Select value={topic} onValueChange={setTopic}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-feedback-topic-help">
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
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                rows={4}
                className="text-sm resize-none"
                data-testid="textarea-feedback-message-help"
              />
              <p className="text-xs text-muted-foreground text-right mt-0.5">{message.length}/1000</p>
            </div>
            <Button
              className="w-full"
              disabled={message.trim().length < 20 || submit.isPending}
              onClick={() => submit.mutate({ topic, message: message.trim(), page })}
              data-testid="button-submit-feedback-help"
            >
              {submit.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Send Feedback
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HelpBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[hsl(18_85%_40%/0.15)] border border-[hsl(18_85%_40%/0.3)] text-[hsl(18_70%_45%)] dark:text-[hsl(25_70%_65%)] px-1.5 py-0.5 text-[11px] font-mono font-medium">
      {children}
    </span>
  );
}

export function HelpKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function HelpIcon({ icon: Icon, className }: { icon: React.ElementType; className?: string }) {
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${className || "text-[hsl(18_70%_50%)]"}`} />;
}

export function FeatureRow({ icon, label, description }: { icon: React.ReactNode; label: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5">{icon}</div>
      <div>
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

export function OverviewHelp() {
  return (
    <AccordionItem value="overview">
      <AccordionTrigger className="text-sm font-semibold py-3">
        <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Master Reel Counter — Overview</span>
      </AccordionTrigger>
      <AccordionContent className="text-[11px] text-muted-foreground leading-relaxed space-y-2 pb-4">
        <p>Master Reel Counter is a warehouse wire reel counting application. It helps you photograph pallet sections, annotate reels with pins, enter wire catalog details, and export professional inventory reports.</p>
        <p>The <HelpBadge>Dashboard</HelpBadge> is your home base for managing sessions and folders, with bulk actions for managing multiple sessions at once. Inside a session, five tabs provide the complete desktop workflow: <HelpBadge>Photos Reel</HelpBadge>, <HelpBadge>Reel IDs</HelpBadge>, <HelpBadge>Flagged</HelpBadge>, <HelpBadge>Review</HelpBadge>, and <HelpBadge>Final Results</HelpBadge>. <HelpBadge>Mobile Flow</HelpBadge> offers a streamlined phone-friendly capture experience — tap the red button in the session header to enter it.</p>
        <p>Each session can have a name, location, and optional <HelpBadge>description</HelpBadge> for documenting context. A built-in <HelpBadge>comments system</HelpBadge> lets your team leave threaded comments on the session, individual entries, or specific photos.</p>
      </AccordionContent>
    </AccordionItem>
  );
}

export function DashboardSections() {
  return (
    <>
      <AccordionItem value="dash-header-bar">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Cable className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Header Bar</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <FeatureRow
            icon={<span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[hsl(18_70%_50%)]" />}
            label="Theme Toggle"
            description="Switch between dark and light mode using the sun/moon icon."
          />
          <FeatureRow
            icon={<HelpIcon icon={HelpCircle} />}
            label="Help"
            description="Opens this help guide with information about all dashboard features."
          />
          <FeatureRow
            icon={<HelpIcon icon={BarChart3} />}
            label="Summary Stats"
            description="Opens the Summary Stats page showing key metrics across all your sessions — total reels, footage, sessions, entries, and photos. Includes role-based comparison charts (bar and pie graphs) showing reel counts, footage, and entry counts broken down by user role. Averages per session are also displayed."
          />
          <FeatureRow
            icon={<HelpIcon icon={Settings} />}
            label="Settings"
            description="Opens your profile and app settings. Upload a custom profile avatar, edit your display name, manage encryption keys, configure preferences for display, accessibility, data entry, photo capture, and export. Also manage custom wire categories (add individually or bulk import CSV), browse the built-in wire catalog, and view your storage usage dashboard with backfill tools."
          />
          <FeatureRow
            icon={<HelpIcon icon={LogOut} />}
            label="Sign Out"
            description="Logs you out of your account. Your sessions are saved and will be waiting when you log back in."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-creating-sessions">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Plus className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Creating Sessions</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <FeatureRow
            icon={<HelpIcon icon={Plus} />}
            label="New Session"
            description="Tap the + button to create a new counting session. Give it a name and optional location, then start counting reels."
          />
          <FeatureRow
            icon={<HelpIcon icon={ChevronRight} />}
            label="Continue Last Session"
            description="If your most recent session is inside a folder, a 'Continue' shortcut appears at the top for quick access. Tap it to jump right back into where you left off."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-folders">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Folder className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Folder Organization</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Organize your sessions into folders and even nest folders inside other folders for complex projects.</p>
          <FeatureRow
            icon={<HelpIcon icon={FolderPlus} />}
            label="Create Folder"
            description="Tap the folder+ button to create a new folder. Give it a name to group related sessions together."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Rename Folder"
            description="Open a folder's action menu (three dots) and select Rename to change its name."
          />
          <FeatureRow
            icon={<HelpIcon icon={FolderInput} />}
            label="Move to Folder (Nested Folders)"
            description="Move a folder inside another folder using the 'Move to Folder' submenu. Folders can be nested multiple levels deep. You can also move a nested folder back to the root level."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete Folder"
            description="Deleting a folder moves all its sessions back to the main Sessions list. Sessions are never deleted when removing a folder."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-sorting-search">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Search className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Sorting & Search</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <FeatureRow
            icon={<HelpIcon icon={ArrowUpDown} />}
            label="Sort Sessions"
            description="Sort your sessions by Date, Name, Reels, or Footage. Tap the sort button to cycle through options. Tap the same option again to reverse the direction (ascending/descending)."
          />
          <FeatureRow
            icon={<HelpIcon icon={Search} />}
            label="Search"
            description="Type in the search bar to instantly filter sessions by name or location. Both your sessions and shared sessions are searched. Results show a count of matches."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-session-cards">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><MoreVertical className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Session Card Actions</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Each session card shows the name, location, reel count, total footage, photo count, and time. Tap the three-dot menu for actions:</p>
          <FeatureRow
            icon={<HelpIcon icon={CheckCircle2} />}
            label="Mark Complete / Reopen"
            description="Toggle a session between active and completed status. Completed sessions show a green checkmark badge."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Rename"
            description="Change the session name and location without opening the session."
          />
          <FeatureRow
            icon={<HelpIcon icon={Copy} />}
            label="Duplicate"
            description="Creates an exact copy of the session with all its entries, photos, and pins. A dialog prompts you to enter a name for the copy (defaults to the original name with a '(Copy)' suffix)."
          />
          <FeatureRow
            icon={<HelpIcon icon={FolderInput} />}
            label="Move to Folder"
            description="Move a session into any folder, or back to the main Sessions list. Sessions inside folders appear grouped under the folder header."
          />
          <FeatureRow
            icon={<HelpIcon icon={Lock} />}
            label="Lock / Unlock"
            description="Lock a session to prevent any edits. Useful when a count is finalized. A lock icon appears on the session card."
          />
          <FeatureRow
            icon={<HelpIcon icon={History} />}
            label="Activity Log"
            description="View a timestamped log of all changes — entries created/edited/deleted, photos uploaded/deleted/duplicated, pins flagged/unflagged, collaborators added/removed, exports generated, and more. Filter by user with the dropdown. Copy all entries to clipboard."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Move to Trash"
            description="Moves a session to the Trash instead of deleting it immediately. Trashed sessions are kept for 30 days before being automatically purged. You can restore or permanently delete them from the Trash view."
          />
          <FeatureRow
            icon={<HelpIcon icon={Download} />}
            label="Export (PDF / Excel)"
            description="Export any session directly from its card menu without opening it. Choose between PDF and Excel formats."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-trash">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Trash</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Deleted sessions are moved to the Trash instead of being permanently removed. Toggle the Trash view using the trash icon button in the dashboard header.</p>
          <FeatureRow
            icon={<HelpIcon icon={RotateCcw} />}
            label="Restore"
            description="Bring a trashed session back to your active sessions list. All data (photos, entries, pins) is preserved."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Permanent Delete"
            description="Permanently remove a trashed session and all its data. This cannot be undone. A separate confirmation dialog appears."
          />
          <FeatureRow
            icon={<HelpIcon icon={Clock} />}
            label="Auto-Purge (30 Days)"
            description="Sessions in the Trash are automatically and permanently deleted after 30 days. The countdown starts from when the session was trashed."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-shared-sessions">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Shared Sessions</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Sessions shared with you by other users appear in a separate 'Shared with You' section below your own sessions.</p>
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Shared Session Cards"
            description="Shared sessions show the owner's name and your role (Editor or Viewer). Tap to open and collaborate."
          />
          <FeatureRow
            icon={<span className="text-xs font-bold text-[hsl(18_70%_50%)]">R</span>}
            label="Your Role"
            description="Your role determines what you can do: Editors can add and modify entries. Viewers can only view data. The session owner controls roles from within the session."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-session-info">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Session Card Details</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Each session card displays key information at a glance:</p>
          <FeatureRow
            icon={<HelpIcon icon={Hash} />}
            label="Reel Count"
            description="The total number of reel entries in the session."
          />
          <FeatureRow
            icon={<HelpIcon icon={Ruler} />}
            label="Total Footage"
            description="The combined footage across all entries, formatted with commas for readability."
          />
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Photo Count"
            description="The number of photos uploaded to the session."
          />
          <FeatureRow
            icon={<HelpIcon icon={MapPin} />}
            label="Location"
            description="The session's location (if set) appears below the name."
          />
          <FeatureRow
            icon={<span className="inline-block w-3 h-3 rounded-sm bg-primary/20 border border-primary/30" />}
            label="Thumbnail"
            description="A small preview of the first photo in the session appears on the card for visual identification."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-bulk-actions">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><SquareCheck className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Bulk Actions</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Select multiple sessions to perform actions in bulk. A floating action bar appears at the bottom of the screen when sessions are selected.</p>
          <FeatureRow
            icon={<HelpIcon icon={CheckCircle2} />}
            label="Select Sessions"
            description="Tap the checkbox on any session card to select it. Multiple sessions can be selected at once. The action bar shows a count of selected sessions."
          />
          <FeatureRow
            icon={<HelpIcon icon={CheckCircle2} />}
            label="Mark Complete"
            description="Mark all selected sessions as completed in one action. Completed sessions display a green checkmark badge."
          />
          <FeatureRow
            icon={<HelpIcon icon={RotateCcw} />}
            label="Reopen"
            description="Reopen all selected sessions, changing their status back to active."
          />
          <FeatureRow
            icon={<HelpIcon icon={FolderInput} />}
            label="Move to Folder"
            description="Move all selected sessions into a folder, or back to the main Sessions list. A dialog lets you choose the target folder."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Bulk Delete"
            description="Move all selected sessions to the Trash at once. A confirmation dialog appears before deletion. Trashed sessions can be restored within 30 days."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-stats">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Summary Stats Page</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">A dedicated statistics page accessible from the dashboard header. Provides a comprehensive breakdown of your counting activity across all sessions.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Overview Metrics</p>
          <FeatureRow
            icon={<HelpIcon icon={BarChart3} />}
            label="Key Counts"
            description="Total sessions, completed sessions, active sessions, total reels, total footage, total entries, and total photos — all displayed as stat cards at the top of the page."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Averages & Records</p>
          <FeatureRow
            icon={<HelpIcon icon={Award} />}
            label="Performance Metrics"
            description="Average footage per session, average entries per session, average reels per entry, and your best session by footage."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Streaks & Activity</p>
          <FeatureRow
            icon={<HelpIcon icon={Flame} />}
            label="Streaks"
            description="Current streak (consecutive days with activity), longest streak, and busiest day of the week."
          />
          <FeatureRow
            icon={<HelpIcon icon={Activity} />}
            label="Weekly Activity Chart"
            description="A horizontal bar chart showing entries and footage per week, so you can visualize your counting activity over time."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Top Categories & Vendor Codes</p>
          <FeatureRow
            icon={<HelpIcon icon={Layers} />}
            label="Category & Vendor Breakdowns"
            description="Bar charts showing your most frequently counted wire categories (with footage totals) and most common vendor codes. Helps identify the most prevalent wire types across your sessions."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Shared Session Performance</p>
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Contributor Leaderboard"
            description="For sessions shared with collaborators, a per-session breakdown shows each contributor's entries, photos, reels, and footage. Your own stats are highlighted. Progress bars visualize relative contributions."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Role Comparison</p>
          <FeatureRow
            icon={<HelpIcon icon={Shield} />}
            label="Role-Based Metrics"
            description="Entries, footage, reels, and photos broken down by role (Owner, Editor, Tester, Viewer). Each role has a color-coded bar. Your current roles are highlighted with a ring indicator. Useful for understanding how work is distributed across roles."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-settings">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Settings className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Settings</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Configure your profile, preferences, wire categories, and monitor storage usage.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Display & Theme</p>
          <FeatureRow
            icon={<HelpIcon icon={Palette} />}
            label="Theme Toggle"
            description="Switch between Light, Dark, and System themes. Your preference is saved and applied across all pages."
          />
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Dashboard Thumbnail Size"
            description="Choose the thumbnail size shown on session cards: None, Small, Medium, or Large. Affects how session photos appear on the dashboard."
          />
          <FeatureRow
            icon={<HelpIcon icon={Globe} />}
            label="Timezone"
            description="Select your timezone for displaying timestamps throughout the app. Defaults to your browser's detected timezone."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Accessibility</p>
          <FeatureRow
            icon={<HelpIcon icon={Target} />}
            label="Larger Touch Targets"
            description="Enable larger buttons and tap areas for easier use on touch devices or for users who prefer bigger controls."
          />
          <FeatureRow
            icon={<HelpIcon icon={Type} />}
            label="Text Size"
            description="Adjust the base text size across the app. Choose from Small, Default, Large, or Extra Large. Disabled during Mobile Flow."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Data Entry Preferences</p>
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Default Starting Aisle"
            description="Set a default aisle prefix that auto-fills in new sessions and Mobile Flow, saving you from typing it every time."
          />
          <FeatureRow
            icon={<HelpIcon icon={ArrowUp} />}
            label="Section Auto-Advance Step"
            description="Configure how much the section number increments when using section stepper buttons (default is 1). Useful for warehouses with non-sequential section numbering."
          />
          <FeatureRow
            icon={<HelpIcon icon={Ruler} />}
            label="Default Unit of Measurement"
            description="Choose between Feet and Meters for all footage displays, inputs, and exports throughout the app."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Photo Capture Preferences</p>
          <FeatureRow
            icon={<HelpIcon icon={Sliders} />}
            label="Photo Quality"
            description="Adjust the JPEG compression quality for uploaded photos using a slider. Higher quality means larger file sizes but better detail for reading reel labels."
          />
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Receiving Quality Override"
            description="Enable a separate quality setting specifically for photos taken in Receiving mode. Useful when receiving dock photos need different compression than aisle photos."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Export Preferences</p>
          <FeatureRow
            icon={<HelpIcon icon={Download} />}
            label="Default Export Format"
            description="Choose your preferred export format (PDF or CSV) that will be pre-selected when exporting sessions."
          />
          <FeatureRow
            icon={<HelpIcon icon={FileText} />}
            label="Company Name & Logo"
            description="Set your company name and upload a logo to brand PDF exports. The company name appears in the header of exported reports."
          />
          <FeatureRow
            icon={<HelpIcon icon={FileText} />}
            label="PDF Footer Text"
            description="Add custom footer text that appears at the bottom of every page in PDF exports. Useful for disclaimers, report IDs, or company info."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Security</p>
          <FeatureRow
            icon={<HelpIcon icon={Key} />}
            label="Tester Password"
            description="Set up a password for tester login. Testers can sign in using a special URL without needing a Replit account. They receive Editor access to your sessions but cannot lock/unlock, delete sessions, or manage collaborators."
          />
          <FeatureRow
            icon={<HelpIcon icon={Shield} />}
            label="Data Encoding (AES-256)"
            description="Toggle AES-256 encryption on sensitive entry fields (reel tags, wire types, gauges, colors, manufacturers, notes). When enabled, data is encrypted at rest in the database. A limitations section explains which fields are encoded and what trade-offs apply (e.g., server-side search on encrypted fields is limited)."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Wire Categories</p>
          <FeatureRow
            icon={<HelpIcon icon={Cable} />}
            label="Custom Categories"
            description="Add your own wire categories that appear in autocomplete alongside the built-in catalog. Add them one at a time with the Add Category form, or use Bulk Import to paste or upload a CSV file with multiple entries at once."
          />
          <FeatureRow
            icon={<HelpIcon icon={Search} />}
            label="Built-in Catalog Viewer"
            description="Expand the Built-in Catalog section to browse all ~300 default wire entries. Use the search bar to filter by catalog code, vendor, or description. These entries are always available in autocomplete throughout the app."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete Custom Categories"
            description="Remove individual custom categories using the trash icon on each row. Built-in catalog entries cannot be deleted."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Storage Usage</p>
          <FeatureRow
            icon={<HelpIcon icon={HardDrive} />}
            label="Your Storage"
            description="View how much storage your photos are using, including total bytes, photo count, and session count. A progress bar shows usage against the 10 GB limit. Use the Backfill Sizes button to calculate sizes for older photos that were uploaded before size tracking was added."
          />
          <FeatureRow
            icon={<HelpIcon icon={Globe} />}
            label="App-Wide Storage (Owner)"
            description="Session owners see an additional card showing total storage usage across all users, with a count of distinct users and total photos. Use the refresh button to re-fetch the latest numbers."
          />
        </AccordionContent>
      </AccordionItem>
    </>
  );
}

export function SessionSections() {
  return (
    <>
      <AccordionItem value="session-header">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Session Header</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Back Arrow"
            description="Returns to the dashboard where all sessions and folders are listed."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Session Name, Location & Description"
            description="Tap the session name to edit the name, location, and an optional description for documenting session context. Changes auto-save after closing the dialog."
          />
          <FeatureRow
            icon={<HelpIcon icon={Lock} />}
            label="Lock / Unlock"
            description="Session owners can lock a session to prevent all edits. Collaborators see a lock icon when a session is locked. Useful for finalizing counts."
          />
          <FeatureRow
            icon={<HelpIcon icon={Undo2} />}
            label="Undo / Redo"
            description="Reverts or re-applies recent entry and pin modifications. Tracks create, edit, and delete actions within the current session."
          />
          <FeatureRow
            icon={<Users className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" />}
            label="Online Users"
            description="Shows avatars with green dots for collaborators currently viewing this session. Up to 3 avatars display, with a +N overflow count."
          />
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Team Button"
            description="Opens the Team dialog (owner only). Invite collaborators by username, shareable link, or email. Set roles (editor/viewer), transfer ownership, and track invite link usage with join counts and 7-day auto-expiry."
          />
          <FeatureRow
            icon={<HelpIcon icon={History} />}
            label="Activity Log"
            description="Toggle the activity log panel showing a timestamped feed of all session changes — entries created/edited/deleted, photos uploaded/deleted/duplicated, pins flagged/unflagged/deleted, collaborators added/removed/role changes, invite links created/deactivated, exports generated, and session lock/unlock. Filter by user with the dropdown at the top. Close the panel with the X button."
          />
          <FeatureRow
            icon={<HelpIcon icon={Download} />}
            label="Export"
            description="Export session data as Excel (.xlsx workbook) or PDF (formatted report), or share a summary via email. The export dropdown in the session header provides quick access to all formats."
          />
          <FeatureRow
            icon={<HelpIcon icon={EyeOff} />}
            label="Hide Pins Overlay"
            description="A toggle button on the photo viewer overlay strip that hides all pin markers on the current photo. Useful for getting an unobstructed view of the reel labels. Tap again to show pins."
          />
          <FeatureRow
            icon={<span className="inline-block w-3.5 h-3.5 rounded bg-red-600/80" />}
            label="Mobile Flow Toggle"
            description="The red button (phone icon) in the header switches to Mobile Flow — a phone-optimized capture screen. Once inside Mobile Flow, the button turns blue (monitor icon) and reads 'Reel IDs' — tap it to return to the full desktop tabs."
          />
          <div className="flex items-start gap-2.5 py-1.5">
            <div className="mt-0.5"><span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[hsl(18_70%_50%)]" /></div>
            <div>
              <span className="text-xs font-semibold text-foreground">Dark / Light Mode</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Toggle between dark and light themes using the sun/moon icon in the header.</p>
            </div>
          </div>
          <FeatureRow
            icon={<span className="text-[11px] font-mono font-bold text-green-500">&#10003;</span>}
            label="Auto-Save Indicator"
            description='Shows "Saving..." with a spinner during save operations, then "Saved" with a checkmark when complete. All changes auto-save — no manual save button needed.'
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-photos-reel">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Eye className="h-4 w-4 text-[hsl(200_70%_45%)]" /> Photos Reel Tab</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">A visual grid of every photo in the session, grouped and sorted by aisle then section. Use it to review coverage, manage individual photos, and navigate back to any shot.</p>
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(200_70%_45%)]">086</span>}
            label="Sequence Badge"
            description="Each photo card shows a 3-digit sequence number (e.g. 086) extracted from its filename for quick identification."
          />
          <FeatureRow
            icon={<HelpIcon icon={Eye} />}
            label="Lightbox View"
            description='Tap any photo thumbnail to open a full-screen lightbox. The header shows the location in "A04 - S12" format. Use the left/right arrows or swipe to navigate between photos without closing the lightbox.'
          />
          <FeatureRow
            icon={<HelpIcon icon={StickyNote} />}
            label="Photo Notes"
            description="Photo cards with notes automatically expand to show them. Tap the note area to collapse it — the collapsed state is remembered for the rest of your session. Notes are also editable directly from this view."
          />
          <FeatureRow
            icon={<HelpIcon icon={ExternalLink} />}
            label="Link To (Detail Shot)"
            description="Mark a photo as a detail/close-up shot and link it to a parent photo. The photo picker lists available photos sorted by photo number ascending, making it easy to find the right parent. Once linked, the relationship appears in exports."
          />
          <FeatureRow
            icon={<HelpIcon icon={Copy} />}
            label="Duplicate Photo"
            description="Tap the copy icon on a photo card to create a duplicate. The duplicate shares the same image file and preserves the original capture timestamp — useful for assigning the same photo to a different aisle or section."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete Photo"
            description="Tap the trash icon, then confirm with a second tap. Deleting a photo also removes its linked entries and pins."
          />
          <FeatureRow
            icon={<HelpIcon icon={ExternalLink} />}
            label="Jump to Photo"
            description="Tap the external-link icon to jump directly to that photo in the Reel IDs tab, ready for pinning."
          />
          <FeatureRow
            icon={<HelpIcon icon={ArrowUp} />}
            label="Back to Top"
            description="A 'Back to Top' button appears at the bottom of the Photos Reel grid. Clicking it smoothly scrolls the page back to the top."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-photo-mode">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Camera className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Reel IDs Tab</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">The primary workflow. Upload photos of pallet sections, place pins on each reel, then fill in wire details below.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Uploading Photos</p>
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Upload Photos / Take Photo"
            description="Upload one or more images from your gallery, or open the camera to take a photo directly. Photos are stored in the cloud and tagged with the current aisle."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Aisle & Section Fields"
            description='Set the aisle and section for the current photo. Type "rec" as a shortcut to auto-fill "Receiving". These values auto-save with a short delay.'
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Photo Navigation</p>
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Previous / Next Photo"
            description="Navigate between uploaded photos. The counter shows your current position (e.g. 03 / 12). You can also type a photo number directly into the counter to jump."
          />
          <FeatureRow
            icon={<HelpIcon icon={AlertCircle} />}
            label="Next Reel Button"
            description="Appears when there are pins without wire details filled in. Jumps to the next photo with incomplete pins and scrolls to the entry table so you can start filling in details immediately. The count updates live as you fill in rows — ticking down in real-time on the current photo, then falling back to the total across all photos. If this is the last remaining incomplete entry, a notification appears instead of navigating away."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Photo Viewer Controls</p>
          <FeatureRow
            icon={<HelpIcon icon={ZoomIn} />}
            label="Zoom In / Out"
            description="Zoom the photo up to 5x for close inspection. Use the + and - buttons on the right side overlay strip."
          />
          <FeatureRow
            icon={<HelpIcon icon={Move} />}
            label="Pan Mode"
            description="Toggle pan mode to drag the photo around when zoomed in, instead of placing new pins. The button highlights when active."
          />
          <FeatureRow
            icon={<HelpIcon icon={RotateCw} />}
            label="Rotate"
            description="Rotate the photo 90° clockwise or counter-clockwise if it was taken at an angle. The rotation is saved to the database and persists across sessions and users. PDF exports apply the saved rotation automatically."
          />
          <FeatureRow
            icon={<span className="inline-block w-3.5 h-3.5 border-2 border-[hsl(18_70%_50%)] rounded-sm" />}
            label="Pin Size Adjust"
            description="Increase or decrease the size of pin markers on the photo. Useful for dense photos with many closely-spaced reels. The pin scale is saved per-photo."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Placing & Managing Pins</p>
          <FeatureRow
            icon={<MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" />}
            label="Place a Pin"
            description="Tap/click anywhere on the photo to place a pin. Each pin marks a reel position and is auto-labeled with a sequential number. Pins appear as interactive markers with a label, reel count, and delete button."
          />
          <FeatureRow
            icon={<span className="text-xs font-bold text-[hsl(18_70%_50%)]">A1</span>}
            label="Rename Pin"
            description="Tap the pin label to rename it with a custom shelf/spot code (e.g. 9001). Useful for matching physical location tags."
          />
          <FeatureRow
            icon={<span className="text-xs font-bold text-[hsl(18_70%_50%)]">+/-</span>}
            label="Reel Count Buttons"
            description="Each pin has + and - buttons to adjust the reel count (1–99) directly on the photo. This count carries through to the entry table below."
          />
          <FeatureRow
            icon={<HelpIcon icon={Move} />}
            label="Drag Pins"
            description="Press and drag any pin to reposition it on the photo. Works with both mouse and touch."
          />
          <FeatureRow
            icon={<X className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" />}
            label="Delete Pin"
            description='Tap the "×" button on a pin to remove it. This only deletes the draft pin; committed entries are managed in the Table View.'
          />
          <div className="flex items-start gap-2.5 py-1.5">
            <div className="mt-0.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-muted-foreground opacity-60" /></div>
            <div>
              <span className="text-xs font-semibold text-foreground">Committed Pins</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Pins that have been saved as entries appear with a "P" prefix and a muted style. They can still be deleted to remove the entry.</p>
            </div>
          </div>
          <FeatureRow
            icon={<span className="inline-block w-3 h-3 rounded border border-[hsl(18_70%_50%)]" />}
            label="Draft Pins Auto-Save"
            description="Draft pins (positions and details) are automatically saved to the server in the background. If you navigate away and come back, your pins are restored."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Reel Crop Preview</p>
          <FeatureRow
            icon={<HelpIcon icon={Focus} />}
            label="Pin Selection Preview"
            description="Tap a pin or its row in the entry table to see a zoomed crop of the area around that pin. The image appears on the left with a vertical button column on the right for Close-up, Wide, Zoom +/-, Rotate, and Close controls. This sticks to the top of the screen as you scroll."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Entry Details Table</p>
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">CAT</span>}
            label="Category Input (Wire Details)"
            description="Type a wire category and the system searches the built-in catalog (~300 entries) plus any custom categories you've added in Settings. Use arrow keys to navigate suggestions and Enter to select. Selecting a category auto-fills the vendor code and footage fields. The suggestion dropdown scrolls when there are many matches."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">VND</span>}
            label="Vendor Code"
            description="Select the vendor code from the dropdown (COP, ALU, COR, ALF). Auto-filled when selecting a catalog entry."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">FT</span>}
            label="Footage"
            description="Enter the total footage for this reel position. Auto-calculated from catalog data when a category is selected. While not focused the value displays with comma formatting (e.g. 2,500) for readability."
          />
          <FeatureRow
            icon={<X className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" />}
            label="Clear Row"
            description="Clears all fields in a single row back to empty, keeping the pin position."
          />
          <FeatureRow
            icon={<HelpIcon icon={Flag} className="text-yellow-500" />}
            label="Flag for Re-shoot"
            description="Marks a pin as needing a re-shoot or additional info. A popover lets you enter an optional reason (e.g. 'label obscured', 'bad angle'). Flagged pins appear in the Flagged tab with their reason and have a yellow highlight."
          />
          <FeatureRow
            icon={<Plus className="h-3.5 w-3.5 shrink-0 text-green-500" />}
            label="Add Reel(s) from Image"
            description="Commits all pins on the current photo as entries. Requires an aisle to be set. Shows a progress bar for batch creation. After committing, pins become read-only committed markers."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Photo Notes & Detail Shots</p>
          <FeatureRow
            icon={<HelpIcon icon={StickyNote} />}
            label="Photo Notes"
            description="Add free-text notes to any photo. Notes auto-save with a short delay and appear as a sticky-note icon in the photo info bar."
          />
          <FeatureRow
            icon={<HelpIcon icon={Focus} />}
            label="Detail / Close-up Shot"
            description='Check the "This is a detail/close-up shot" box to mark a photo as a detail shot. You can link it to a parent photo, creating a parent→detail relationship visible in exports. Detail shots can also be captured via the Re-shoot button in the Flagged tab.'
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Nearby Photos</p>
          <FeatureRow
            icon={<HelpIcon icon={Eye} />}
            label="Nearby Photo Strip"
            description="Shows a horizontal strip of photos sorted by aisle/section location, centered on the current photo. Tap a thumbnail to preview that photo's image and committed pins without leaving your current pin context. An orange badge shows the incomplete pin count for each nearby photo."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Quick Entry Panel</p>
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Quick Entry Toggle"
            description="Tap the Quick Entry button in the top toolbar (next to Take Photo) to expand a collapsible entry form. Creates entries without placing pins on the photo. When expanded, Upload Photos and Take Photo buttons are faded out and disabled."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">AUTO</span>}
            label="Auto-Fill Location"
            description="The Quick Entry panel automatically fills in the aisle and section from the currently viewed photo, so you don't have to type them."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">CAT</span>}
            label="Catalog Autocomplete"
            description="The category field searches the built-in catalog (~300 entries) plus your custom categories from Settings. Selecting a match auto-fills the vendor code and footage fields."
          />
          <FeatureRow
            icon={<HelpIcon icon={Check} />}
            label="On Floor, In Front Of"
            description='A single combined checkbox that toggles both "On Floor" and "In Front Of" note tags on the entry. Useful for quickly marking reels that are not on the pallet.'
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">REC</span>}
            label="Receiving Mode"
            description="The Receiving checkbox auto-fills the next sequential Receiving section number, computed from both existing photos and entries in the session."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-ai-scanner">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><ScanLine className="h-4 w-4 text-[hsl(270_60%_55%)]" /> AI Label Scanner</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">A panel within the Reel IDs tab that uses AI vision to read wire reel labels from photo crops. Select a photo, preview cropped regions around pins, analyze labels in batch, review results, and apply them as entries.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Photo & Card Selection</p>
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Photo Selection"
            description="Choose a photo from the session. The scanner shows a card for each pin on the photo with a cropped preview of the label area."
          />
          <FeatureRow
            icon={<HelpIcon icon={ZoomIn} />}
            label="Zoom & Pan Controls"
            description="Each card shows a cropped preview of the pin area. Adjust the zoom level to frame the label, and drag to pan the crop window for the best view of the text."
          />
          <FeatureRow
            icon={<HelpIcon icon={SquareCheck} />}
            label="Include / Exclude Cards"
            description="Each card has a checkbox to include or exclude it from the analysis batch. Uncheck cards with unreadable or irrelevant labels to save processing time. Your selections are saved automatically and restored if the page refreshes."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Single Photo vs All Photos</p>
          <FeatureRow
            icon={<HelpIcon icon={Grid3X3} />}
            label="All Photos Mode"
            description="Toggle the grid icon to switch to All Photos mode, which shows a dense grid of ALL active pins across the entire session — every photo with draft or incomplete pins. Each card shows a badge with its source photo location. The scanner defaults to this mode when previous results exist."
          />
          <FeatureRow
            icon={<HelpIcon icon={ListChecks} />}
            label="Single Photo Mode"
            description="The default view shows only pins from the currently selected photo. Use this for focused analysis of one section at a time."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Analysis & Results</p>
          <FeatureRow
            icon={<HelpIcon icon={Sparkles} />}
            label="Analyze Labels"
            description="Sends the cropped pin images to AI vision for label reading. Cards are batched automatically (up to 20 per request). A progress bar shows the analysis status. Results are cached on the server so re-analyzing the same photo is instant."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(270_60%_55%)]">RAW</span>}
            label="Raw AI Text"
            description='Each analyzed card displays the literal text the AI read from the label in a monospace block. Shows "unreadable" in italic if the AI could not read the label.'
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">CAT</span>}
            label="Matched Results"
            description="The raw text is automatically matched against the built-in catalog (~300 entries) plus your custom categories. The best match fills in the category, vendor code, and footage fields. You can edit any field to correct the AI before applying."
          />
          <FeatureRow
            icon={<HelpIcon icon={Check} />}
            label="Add Reels from Images"
            description='Tap "Add Reels from X Images" to commit the scanned results as entries. Draft pins become committed entries with their wire details filled in. Incomplete committed pins get their existing entries updated with the scanned data.'
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Advanced Features</p>
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(270_60%_55%)]">REC</span>}
            label="Receiving Pooling"
            description={`When a photo's location contains "Receiving", the scanner pools pins from all Receiving photos (up to 9 cards) to batch more labels per analysis. Pooled cards from other photos show a purple badge with their source location.`}
          />
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Real-Time Sync"
            description="Scan results are saved to the server and synced via WebSocket. Multiple team members can divide scanning work and see each other's results in real time."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-flagged">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Flag className="h-4 w-4 text-yellow-500" /> Flagged Tab</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Dedicated view for all reels that have been flagged for re-shoot or additional information. Each card shows the flag reason (if provided) and allows inline editing.</p>
          <FeatureRow
            icon={<HelpIcon icon={Eye} />}
            label="Photo Preview"
            description="Each flagged reel shows a thumbnail of its photo with an orange pulsing ring highlighting the pin location. Tap the thumbnail for a full-size preview with the same highlighting."
          />
          <FeatureRow
            icon={<MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" />}
            label="Location Info"
            description="Each card shows the aisle and section where the reel is located, along with the pin label and wire details."
          />
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Re-shoot"
            description='Tap "Re-shoot" to enter detail-shot mode in Mobile Flow. The aisle and section are pre-filled from the original photo. After capturing, a review screen shows your photo with an editable notes field. Tap "Save & Done" to save or "Retake" to try again.'
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Flag Reason"
            description="Each flagged pin displays its reason below the card. Tap the reason text to edit it inline — changes save automatically. Useful for communicating what needs to be re-checked."
          />
          <FeatureRow
            icon={<HelpIcon icon={Check} />}
            label="Un-Flag"
            description='Tap "Un-Flag" to unflag a reel once the re-shoot or additional info has been captured. The reason is cleared and the reel disappears from the flagged list.'
          />
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Back to Flagged Reels"
            description="While in detail-shot mode, tap this button to return to the Flagged tab without capturing a photo."
          />
          <FeatureRow
            icon={<HelpIcon icon={Share2} />}
            label="Shareable Link"
            description="Copy a direct link to the Flagged tab to share with team members. The link opens the session directly to this view."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Edit Flagged Reel"
            description="Tap the pencil icon on a flagged card to open an inline edit form. Edit wire details (category, vendor, footage, reel count), notes, and the flag reason. Changes save when you tap Save."
          />
          <FeatureRow
            icon={<HelpIcon icon={Copy} />}
            label="Duplicate Detection"
            description="The Flagged tab automatically detects potential duplicate entries — reels with the same aisle, section, category, vendor code, footage, and reel count. Duplicate groups are highlighted with an amber warning. You can dismiss false positives, and dismissals are saved to the server so they persist across browsers and devices."
          />
          <FeatureRow
            icon={<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            label="Entries Without Photos"
            description="An amber-highlighted Issues section appears below the flagged pins list whenever entries exist with no linked photo. Each card shows the reel tag, aisle/section, reel count, and footage. These entries are not yet associated with a pin on any photo — edit or delete them from Table View."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-review">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Review Tab</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">A structured one-by-one review queue that lets your team verify every reel entry. Each entry shows a zoomed crop of its pin location alongside the full photo. Responses are tracked per user and synced in real time.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Review Queue</p>
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Navigation"
            description="Use Prev / Next buttons to move through your assigned entries. The counter shows your position (e.g. 3 / 18). On load, the view automatically jumps to your first unreviewed entry."
          />
          <FeatureRow
            icon={<HelpIcon icon={Clock} />}
            label="Reveal Timer"
            description="Entries created in the last 60 seconds show a countdown before the wire details are revealed. This encourages independent verification rather than copying a freshly entered value. Entries older than 60 seconds are revealed immediately."
          />
          <FeatureRow
            icon={<HelpIcon icon={CheckCircle2} />}
            label="Looks Good (Approve)"
            description='Tap "Looks Good" to mark the entry as reviewed and correct. The queue automatically advances to your next unreviewed entry. Approved entries are tracked with a green checkmark.'
          />
          <FeatureRow
            icon={<HelpIcon icon={Flag} className="text-yellow-500" />}
            label="Flag for Re-check"
            description='Tap "Flag" to flag the entry for further attention. Optionally enter a reason before confirming. Flagged entries appear in the Flagged tab and count toward the "Still flagged" stat in Final Results.'
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Viewing Controls</p>
          <FeatureRow
            icon={<HelpIcon icon={ZoomIn} />}
            label="Pin Crop View"
            description="A zoomed canvas crop centered on the pin position appears at the top. Drag to pan the crop window. Use the zoom slider to adjust magnification — zoom in to read fine label text."
          />
          <FeatureRow
            icon={<HelpIcon icon={Eye} />}
            label="Full Photo View"
            description="The complete photo is shown below the crop. Scroll-wheel or pinch to zoom, drag to pan when zoomed in."
          />
          <FeatureRow
            icon={<HelpIcon icon={RotateCw} />}
            label="Rotate"
            description="Rotate the full photo view clockwise or counter-clockwise within the review session."
          />
          <FeatureRow
            icon={<HelpIcon icon={Move} />}
            label="Pan Mode"
            description="Toggle pan mode on the full photo to drag it when zoomed in, rather than accidentally triggering other controls."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Collaborative Review</p>
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Cohort Distribution"
            description="When multiple users open the Review tab at the same time, entries are automatically divided among them — each reviewer gets a non-overlapping slice of the queue. A progress bar shows each reviewer's completion status."
          />
          <FeatureRow
            icon={<span className="inline-block w-2 h-2 rounded-full bg-green-500" />}
            label="Real-Time Sync"
            description="Review responses are saved to the server and synced instantly. When a collaborator marks an entry, your queue and progress totals update live."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-ai-scanner">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><ScanLine className="h-4 w-4 text-[hsl(270_60%_55%)]" /> AI Label Scanner</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">A panel within the Reel IDs tab that uses AI vision to read wire reel labels from photo crops. Select a photo, preview cropped regions around pins, analyze labels in batch, review results, and apply them as entries.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Photo & Card Selection</p>
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Photo Selection"
            description="Choose a photo from the session. The scanner shows a card for each pin on the photo with a cropped preview of the label area."
          />
          <FeatureRow
            icon={<HelpIcon icon={ZoomIn} />}
            label="Zoom & Pan Controls"
            description="Each card shows a cropped preview of the pin area. Adjust the zoom level to frame the label, and drag to pan the crop window for the best view of the text."
          />
          <FeatureRow
            icon={<HelpIcon icon={SquareCheck} />}
            label="Include / Exclude Cards"
            description="Each card has a checkbox to include or exclude it from the analysis batch. Uncheck cards with unreadable or irrelevant labels to save processing time. Your selections are saved automatically and restored if the page refreshes."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Single Photo vs All Photos</p>
          <FeatureRow
            icon={<HelpIcon icon={Grid3X3} />}
            label="All Photos Mode"
            description="Toggle the grid icon to switch to All Photos mode, which shows a dense grid of ALL active pins across the entire session — every photo with draft or incomplete pins. Each card shows a badge with its source photo location. The scanner defaults to this mode when previous results exist."
          />
          <FeatureRow
            icon={<HelpIcon icon={ListChecks} />}
            label="Single Photo Mode"
            description="The default view shows only pins from the currently selected photo. Use this for focused analysis of one section at a time."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Analysis & Results</p>
          <FeatureRow
            icon={<HelpIcon icon={Sparkles} />}
            label="Analyze Labels"
            description="Sends the cropped pin images to AI vision for label reading. Cards are batched automatically (up to 20 per request). A progress bar shows the analysis status. Results are cached on the server so re-analyzing the same photo is instant."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(270_60%_55%)]">RAW</span>}
            label="Raw AI Text"
            description='Each analyzed card displays the literal text the AI read from the label in a monospace block. Shows "unreadable" in italic if the AI could not read the label.'
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">CAT</span>}
            label="Matched Results"
            description="The raw text is automatically matched against the built-in catalog (~300 entries) plus your custom categories. The best match fills in the category, vendor code, and footage fields. You can edit any field to correct the AI before applying."
          />
          <FeatureRow
            icon={<HelpIcon icon={Check} />}
            label="Add Reels from Images"
            description='Tap "Add Reels from X Images" to commit the scanned results as entries. Draft pins become committed entries with their wire details filled in. Incomplete committed pins get their existing entries updated with the scanned data.'
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Advanced Features</p>
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(270_60%_55%)]">REC</span>}
            label="Receiving Pooling"
            description={`When a photo's location contains "Receiving", the scanner pools pins from all Receiving photos (up to 9 cards) to batch more labels per analysis. Pooled cards from other photos show a purple badge with their source location.`}
          />
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Real-Time Sync"
            description="Scan results are saved to the server and synced via WebSocket. Multiple team members can divide scanning work and see each other's results in real time."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-table-view">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Eye className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Table View</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Displayed below the tabs, the Table View shows all committed entries grouped by aisle/section. It provides the master inventory list. Columns (desktop): Pin # → Aisle → Section → Category → Vendor → Reels → Ft/Reel → Total Ft → Photo → Edit.</p>
          <FeatureRow
            icon={<HelpIcon icon={MapPin} />}
            label="Clickable Pin #"
            description="Tap any Pin # in the table to jump directly to that pin's photo in Reel IDs mode. The target pin flashes with a yellow glow for a few seconds so you can spot it immediately — useful for zooming in on a label you need to verify."
          />
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Collapsible Sections"
            description="Entries are grouped by aisle-section. Tap a section header to expand or collapse it. The header shows the entry count for that section."
          />
          <FeatureRow
            icon={<HelpIcon icon={Eye} />}
            label="Photo Viewer"
            description="Tap the eye icon on any entry to view its linked photo. The photo opens with an orange pulsing ring highlighting the exact pin location, auto-scrolled to center."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Edit Entry"
            description="Tap the pencil icon to open the entry in an edit dialog with the linked photo and pin highlight visible above the form."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete Entry"
            description="Tap the trash icon to delete an entry. A confirmation dialog appears. Deleted entries can be restored with Undo."
          />
          <FeatureRow
            icon={<HelpIcon icon={AlertCircle} />}
            label="Validation Warnings"
            description="Entries missing a reel tag or footage show a yellow warning badge on the section header. This helps catch incomplete data before exporting."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">FT</span>}
            label="Total Footage"
            description="The Table View footer shows the total footage across all entries for quick reference."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-final-results">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Final Results Tab</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">A summary view showing review status, a category-level count tally for the entire session, and an optional comparison against a pre-loaded inventory spreadsheet.</p>

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Review Status Banner</p>
          <FeatureRow
            icon={<HelpIcon icon={CheckCircle2} />}
            label="Not Yet Reviewed"
            description='Shows how many entries still need a review response out of the total. When all entries are reviewed the count turns green. On mobile in light mode, this banner has a blue background.'
          />
          <FeatureRow
            icon={<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            label="Still Flagged"
            description="Shows how many entries are currently flagged. Unflag them in the Flagged tab to clear this count."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Session Count Tally</p>
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">CAT</span>}
            label="Category Rows"
            description="Every unique wire category in the session appears as its own row with vendor code, reel count, and total footage. On desktop, Category and Vendor are separate columns. On mobile, they are combined into a single 'Category-Vendor' value (e.g. RX43WG2500-COP) and the Reels column is hidden to save space."
          />
          <FeatureRow
            icon={<span className="text-muted-foreground italic text-[11px]">(uncategorized)</span>}
            label="Uncategorized Pins"
            description="Pins without any wire details entered appear in a special row. On mobile, tap a location link to jump directly to that pin's photo in the Reel IDs tab so you can fill in the missing data."
          />
          <FeatureRow
            icon={<HelpIcon icon={MapPin} />}
            label="Locations"
            description="Expand the Locations column for any category row to see which aisle/section combinations contain that wire type and how many reels are at each location."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Inventory Comparison</p>
          <FeatureRow
            icon={<HelpIcon icon={FileSpreadsheet} />}
            label="Upload Inventory"
            description="Drag-and-drop or tap to upload a CSV or Excel spreadsheet of expected inventory. The file should have columns for wire category, vendor code, reel count, and footage."
          />
          <FeatureRow
            icon={<HelpIcon icon={CheckCircle2} />}
            label="Match / Mismatch Badges"
            description="Each tally row gets a status badge after an inventory file is loaded — Match (counts agree), Discrepancy (counts differ), or Unmatched (category not in inventory). Rows are color-coded for quick scanning."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Clear Inventory"
            description="Remove the loaded inventory file with the Clear button to return to the plain tally view."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-table-view">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Eye className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Table View</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Displayed below the tabs, the Table View shows all committed entries grouped by aisle/section. It provides the master inventory list. Columns (desktop): Pin # → Aisle → Section → Category → Vendor → Reels → Ft/Reel → Total Ft → Photo → Edit.</p>
          <FeatureRow
            icon={<HelpIcon icon={MapPin} />}
            label="Clickable Pin #"
            description="Tap any Pin # in the table to jump directly to that pin's photo in Reel IDs mode. The target pin flashes with a yellow glow for a few seconds so you can spot it immediately — useful for zooming in on a label you need to verify."
          />
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Collapsible Sections"
            description="Entries are grouped by aisle-section. Tap a section header to expand or collapse it. The header shows the entry count for that section."
          />
          <FeatureRow
            icon={<HelpIcon icon={Eye} />}
            label="Photo Viewer"
            description="Tap the eye icon on any entry to view its linked photo. The photo opens with an orange pulsing ring highlighting the exact pin location, auto-scrolled to center."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Edit Entry"
            description="Tap the pencil icon to open the entry in an edit dialog with the linked photo and pin highlight visible above the form."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete Entry"
            description="Tap the trash icon to delete an entry. A confirmation dialog appears. Deleted entries can be restored with Undo."
          />
          <FeatureRow
            icon={<HelpIcon icon={AlertCircle} />}
            label="Validation Warnings"
            description="Entries missing a reel tag or footage show a yellow warning badge on the section header. This helps catch incomplete data before exporting."
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">FT</span>}
            label="Total Footage"
            description="The Table View footer shows the total footage across all entries for quick reference."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-collaboration">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Collaboration</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Work together with your team in real-time on counting sessions.</p>
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Three Invite Methods"
            description="Invite by Username (adds by Replit username for immediate access), Share Link (generates a link anyone can use — no account required), or Email (opens your email client with a pre-filled invite). Each tab shows a description of what it does."
          />
          <FeatureRow
            icon={<span className="text-xs font-bold text-[hsl(18_70%_50%)]">R</span>}
            label="Role-Based Permissions"
            description="Editors can add, edit, and delete entries and photos. Viewers can only view data. The owner can toggle roles and transfer ownership. Testers who log in via the tester password receive Editor access to the owner's sessions (they cannot lock/unlock, delete sessions, or manage collaborators)."
          />
          <FeatureRow
            icon={<span className="inline-block w-2 h-2 rounded-full bg-green-500" />}
            label="Real-Time Presence"
            description="See who's online with green dot indicators. Changes sync via WebSocket in real-time — when a collaborator adds an entry or uploads a photo, you see it immediately."
          />
          <FeatureRow
            icon={<HelpIcon icon={Share2} />}
            label="Invite Link Tracking"
            description="Shareable invite links show how many people have used them and auto-expire after 7 days for security."
          />
          <FeatureRow
            icon={<HelpIcon icon={Lock} />}
            label="Session Locking"
            description="The owner can lock a session to freeze all edits. Collaborators see a lock banner and cannot make changes until the owner unlocks."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-comments">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Comments</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Leave comments on a session, individual entries, or specific photos to communicate with your team. Comments appear in context wherever they are posted.</p>
          <FeatureRow
            icon={<HelpIcon icon={MessageCircle} />}
            label="Contextual Threads"
            description="Comments are scoped to their context — session-level comments appear on the session as a whole, while entry comments appear on that specific entry and photo comments on that photo. Each context has its own comment thread."
          />
          <FeatureRow
            icon={<HelpIcon icon={Reply} />}
            label="Nested Replies"
            description="Reply to any top-level comment to create a nested thread. Replies are indented with a left border for visual clarity. Hover over a comment to reveal the Reply button."
          />
          <FeatureRow
            icon={<HelpIcon icon={Clock} />}
            label="Time-Ago Formatting"
            description='Comments display relative timestamps (e.g. "5m ago", "2h ago", "3d ago") that update as time passes. Older comments show the full date.'
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Edit & Delete"
            description='Edit or delete your own comments. Edited comments show an "(edited)" indicator. Hover over a comment to reveal edit and delete buttons.'
          />
          <FeatureRow
            icon={<HelpIcon icon={Users} />}
            label="Role Permissions"
            description="Editors and session owners can post, edit, and delete their own comments. Viewers can read comments but cannot post or modify them."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-export">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Download className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Export & Sharing</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Export session data in multiple formats. Exports can be triggered from the session header or from the three-dot action menu on session cards in the Dashboard.</p>
          <FeatureRow
            icon={<HelpIcon icon={FileSpreadsheet} />}
            label="Excel Export (.xlsx)"
            description="Downloads a professionally formatted .xlsx workbook with session metadata in two side-by-side columns at the top, entries grouped by aisle/section with indented pin rows, centered data columns, and column headers with black underline styling. Grand totals for reels and footage appear at the bottom."
          />
          <FeatureRow
            icon={<HelpIcon icon={FileText} />}
            label="PDF Export"
            description="Generates a formatted PDF report. A quality picker dialog opens with two options — Full Quality (original resolution, recommended for auditing reel labels) and Standard (smaller file). Both begin generating in parallel; the chosen version downloads instantly. Your last-used choice is remembered."
          />
          <FeatureRow
            icon={<HelpIcon icon={Mail} />}
            label="Share via Email"
            description="Opens your email client with a pre-composed message containing a text summary of the session — name, location, entry count, footage totals, and a grouped breakdown by aisle/section."
          />
          <FeatureRow
            icon={<HelpIcon icon={Download} />}
            label="Dashboard Export"
            description="Export any session directly from the Dashboard without opening it. Use the three-dot menu on a session card to access Excel and PDF export options. Unsaved changes are automatically flushed before any export."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-tips">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Tips & Efficiency</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-2 pb-4 text-[11px] text-muted-foreground leading-relaxed">
          <p><span className="font-semibold text-foreground">Rapid Data Entry:</span> Type a few letters of a wire category and use <HelpKey>Arrow Down</HelpKey> + <HelpKey>Enter</HelpKey> to select. The cursor auto-advances to the next row.</p>
          <p><span className="font-semibold text-foreground">Next Reel Navigation:</span> After placing all your pins, use the orange "Next Reel" button to jump through photos that still need details. The entry table auto-scrolls into view.</p>
          <p><span className="font-semibold text-foreground">Receiving Mode:</span> Type "rec" in the aisle field to auto-fill "Receiving". In Mobile Flow, the Receiving checkbox auto-increments section numbers.</p>
          <p><span className="font-semibold text-foreground">Pin Scale:</span> For photos with many small reels close together, decrease the pin size using the size controls on the right overlay strip. Pin scale is remembered per-photo.</p>
          <p><span className="font-semibold text-foreground">Nearby Photos:</span> Use the photo strip below the viewer to preview adjacent sections without losing your pin work on the current photo. A nearby photo may show a different angle on a reel's tag, helping you correctly identify and input wire data you couldn't read from the current photo.</p>
          <p><span className="font-semibold text-foreground">Flagging Workflow:</span> When you can't read a tag, flag the reel and continue. Later, share the Flagged tab link with someone who can re-photograph those specific reels.</p>
          <p><span className="font-semibold text-foreground">Undo Safety Net:</span> All entry creates, edits, and deletes can be undone. The undo/redo buttons in the header track your action history for the current session.</p>
        </AccordionContent>
      </AccordionItem>
    </>
  );
}

export function MobileFlowSections() {
  return (
    <>
      <AccordionItem value="mobile-capture">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Camera className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Capturing Photos</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Aisle & Section"
            description='Enter the aisle and section before taking photos. Aisle is required — a red underlined warning appears until it is filled in. These values tag every photo you capture until you change them.'
          />
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">+/−</span>}
            label="Section Stepper Buttons"
            description="Two buttons below the Section field increment or decrement the section number by 1. Whole integers only — the value cannot go below 0. Zero-padding is preserved (e.g. 003 → 002 or 004)."
          />
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Take Photo"
            description="Opens the device camera to capture a photo. The photo is tagged with the current aisle and section, then queued for upload."
          />
          <FeatureRow
            icon={<HelpIcon icon={ImagePlus} />}
            label="Upload from Gallery"
            description="Select one or more existing photos from your gallery. Supports multi-select for batch uploading."
          />
          <FeatureRow
            icon={<HelpIcon icon={Pencil} />}
            label="Quick Entry"
            description="Create entries without taking a photo. Enter wire details (category, vendor, footage, reel count) with the current aisle and section. Useful for quick manual counts."
          />
          <div className="flex items-start gap-2.5 py-1.5">
            <div className="mt-0.5"><Check className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" /></div>
            <div>
              <span className="text-xs font-semibold text-foreground">Receiving Checkbox</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Check "Receiving" to auto-set the aisle to "Receiving" and auto-increment the section number (001, 002, 003...) with each new photo. Section becomes optional.</p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="mobile-upload-queue">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><ArrowUpDown className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Upload Queue & Offline</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Photos upload in the background so you can keep capturing without waiting.</p>
          <FeatureRow
            icon={<span className="inline-flex items-center gap-1"><span className="animate-spin text-[11px]">&#9696;</span></span>}
            label="Background Upload"
            description="Photos are queued and uploaded one at a time in the background. A counter shows how many are pending. You can keep taking photos while uploads proceed."
          />
          <FeatureRow
            icon={<span className="text-xs text-destructive font-bold">!</span>}
            label="Failed Uploads"
            description='If an upload fails (network issue), it shows with a red warning. Tap "Retry" to re-attempt or "Dismiss" to discard. Failed uploads stay in the queue until resolved.'
          />
          <FeatureRow
            icon={<span className="text-xs text-yellow-500 font-bold">&#9888;</span>}
            label="Offline Mode"
            description="When your device goes offline, a yellow banner appears. Photos are saved to your device's local storage (IndexedDB) and will automatically upload when connectivity returns. No data is lost."
          />
          <FeatureRow
            icon={<span className="text-[11px] font-mono font-bold text-[hsl(18_70%_50%)]">DB</span>}
            label="IndexedDB Persistence"
            description="Even if you close the app or your phone restarts while offline, queued photos are preserved in IndexedDB and restored when you reopen the session."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="mobile-review">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Eye className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Photo Review</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Review and manage photos after capture, right from the Mobile Flow.</p>
          <FeatureRow
            icon={<HelpIcon icon={ChevronLeft} />}
            label="Photo Navigation"
            description='Swipe through photos with Prev/Next buttons. The counter shows your position (e.g. "3 / 12"). Navigation buttons appear both above and below the photo.'
          />
          <FeatureRow
            icon={<HelpIcon icon={ArrowUpDown} />}
            label="Sort Toggle"
            description='Switch between "By Aisle" (grouped by location) and "Latest" (most recent first) sorting for the photo carousel.'
          />
          <FeatureRow
            icon={<HelpIcon icon={StickyNote} />}
            label="Photo Notes"
            description="Add notes to any photo. Notes auto-save after a brief delay. A saving indicator appears while syncing."
          />
          <FeatureRow
            icon={<HelpIcon icon={Focus} />}
            label="Detail Shot Toggle"
            description="Mark any photo as a detail/close-up shot with the checkbox. Useful for tagging zoomed-in photos of specific reel labels."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete Photo"
            description='Tap the trash icon, then confirm with the "Delete" button. A cancel option is always available before the photo is permanently removed.'
          />
          <div className="flex items-start gap-2.5 py-1.5">
            <div className="mt-0.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(18_70%_50%)]" /></div>
            <div>
              <span className="text-xs font-semibold text-foreground">Location Labels</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Each photo displays its aisle and section tag below the image. Receiving photos with auto-incremented sections show the padded number (e.g. "Section: 003").</p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="mobile-offline">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Globe className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Install App & Offline Mode</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Master Reel Counter can be installed as a standalone app on your phone, tablet, or desktop. It works offline in warehouses with no signal.</p>
          <FeatureRow
            icon={<HelpIcon icon={Download} />}
            label="Install as App (PWA)"
            description="On your phone or tablet, open the app in your browser and tap 'Add to Home Screen' (Safari) or 'Install App' (Chrome). It launches like a native app — no app store needed."
          />
          <FeatureRow
            icon={<HelpIcon icon={Globe} />}
            label="Offline Access"
            description="Once installed, the app caches its pages and assets so it loads even without internet. Previously visited sessions are available offline from the cache."
          />
          <FeatureRow
            icon={<HelpIcon icon={Camera} />}
            label="Offline Photo Capture"
            description="Take photos in areas with no signal. Photos are queued locally on your device and automatically uploaded when connectivity returns."
          />
          <FeatureRow
            icon={<HelpIcon icon={Plus} />}
            label="Offline Entry Creation"
            description="Create new entries while offline. They are saved locally and synced to the server as soon as you reconnect. Pin placement is skipped for offline entries."
          />
          <FeatureRow
            icon={<HelpIcon icon={Activity} />}
            label="Network Status Indicator"
            description="A small indicator appears at the bottom of the screen when you go offline, showing your connection status and how many items are waiting to sync. It also shows when syncing is in progress."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="mobile-tips">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Mobile Tips</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-2 pb-4 text-[11px] text-muted-foreground leading-relaxed">
          <p><span className="font-semibold text-foreground">Speed Workflow:</span> Set your aisle and section, then rapidly tap "Take Photo" to capture multiple angles. The upload queue handles everything in the background.</p>
          <p><span className="font-semibold text-foreground">Section Stepper:</span> Use the +/− buttons below the Section field to quickly move between sections by one. Zero-padding is preserved automatically, and the value can't go below 0.</p>
          <p><span className="font-semibold text-foreground">Receiving Mode:</span> Check the Receiving box for dock areas. Sections auto-number so you never have to type them — just keep snapping photos.</p>
          <p><span className="font-semibold text-foreground">Offline Resilience:</span> Head into low-signal warehouse areas with confidence. Photos and entries queue locally and sync when you get back to connectivity. A status indicator shows pending items.</p>
          <p><span className="font-semibold text-foreground">Batch Capture:</span> Use the gallery upload button to select multiple photos at once from your camera roll — all will be tagged with the current aisle/section.</p>
          <p><span className="font-semibold text-foreground">Review Later:</span> Mobile Flow is optimized for capturing. Switch to Full Mode on a tablet or desktop to add pins, wire details, and finalize entries.</p>
        </AccordionContent>
      </AccordionItem>
    </>
  );
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const helpChatState: { messages: ChatMessage[] } = {
  messages: [],
};

export function AskAIChat() {
  const [messages, setMessagesRaw] = useState<ChatMessage[]>(helpChatState.messages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      helpChatState.messages = next;
      return next;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/help-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages: updatedMessages }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Failed to get response");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done) continue;
              if (data.error) throw new Error(data.error);
              if (data.content) {
                assistantContent += data.content;
                const captured = assistantContent;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: captured };
                  return updated;
                });
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && prev[prev.length - 1].content === "") {
          return [...prev.slice(0, -1), { role: "assistant", content: "Sorry, I couldn't get a response. Please try again." }];
        }
        return [...prev, { role: "assistant", content: "Sorry, I couldn't get a response. Please try again." }];
      });
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, setMessages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInput("");
  }, [setMessages]);

  const renderMarkdown = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={i} className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">{part.slice(1, -1)}</code>;
      }
      if (part === "\n") {
        return <br key={i} />;
      }
      return part;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Bot className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Ask me anything about the app</p>
            <p className="text-xs text-muted-foreground/60 mt-1">I know about all features, workflows, and tips</p>
            <div className="flex flex-wrap gap-1.5 mt-4 justify-center max-w-[280px]">
              {["How do I place pins?", "What is Mobile Flow?", "How to export data?"].map((q) => (
                <button
                  key={q}
                  className="text-[10px] px-2 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  data-testid={`button-suggestion-${q.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`chat-message-${msg.role}-${i}`}>
            {msg.role === "assistant" && (
              <div className="shrink-0 mt-0.5">
                <div className="h-5 w-5 rounded-full bg-[hsl(18_70%_50%)] flex items-center justify-center">
                  <Bot className="h-3 w-3 text-white" />
                </div>
              </div>
            )}
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            }`}>
              {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
              {msg.role === "assistant" && isStreaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-3 bg-foreground/50 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
            {msg.role === "user" && (
              <div className="shrink-0 mt-0.5">
                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t p-3 space-y-2">
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground gap-1.5"
            onClick={clearChat}
            disabled={isStreaming}
            data-testid="button-clear-chat"
          >
            <RotateCcw className="h-3 w-3" />
            Clear chat
          </Button>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={isStreaming}
            data-testid="input-help-chat"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            data-testid="button-send-help-chat"
          >
            {isStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function HelpMenu({ mode = "full" }: { mode?: "full" | "mobile" | "dashboard" }) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  const title = mode === "dashboard" ? "Dashboard Help" : mode === "mobile" ? "Mobile Flow Help" : "Session Help";
  const description = mode === "dashboard"
    ? "Guide to all dashboard actions and features."
    : mode === "mobile"
    ? "Quick reference for the mobile capture workflow."
    : "Comprehensive guide to session features and workflow.";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button size="icon" variant="ghost" data-testid="button-help-menu" className="h-8 w-8">
              <HelpCircle className="h-5 w-5" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Help</TooltipContent>
      </Tooltip>
      <SheetContent side="left" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-5 w-5 text-[hsl(18_70%_50%)]" />
            {title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {description}
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="guide" className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-4 mt-2 shrink-0">
            <TabsTrigger value="guide" className="flex-1 text-xs gap-1.5" data-testid="tab-help-guide">
              <HelpCircle className="h-3.5 w-3.5" />
              Guide
            </TabsTrigger>
            <TabsTrigger value="ask-ai" className="flex-1 text-xs gap-1.5" data-testid="tab-help-ask-ai">
              <Sparkles className="h-3.5 w-3.5" />
              Ask AI
            </TabsTrigger>
          </TabsList>
          <TabsContent value="guide" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <ScrollArea className="flex-1">
              <div className="px-4">
                <Accordion type="multiple" className="w-full">
                  <OverviewHelp />
                  {mode === "dashboard" && <DashboardSections />}
                  {mode === "full" && <SessionSections />}
                  {mode === "mobile" && <MobileFlowSections />}
                </Accordion>
                <Separator className="my-3" />
                <Button
                  variant="outline"
                  className="w-full mb-2 gap-2 text-xs"
                  onClick={() => {
                    setOpen(false);
                    setLocation("/help");
                  }}
                  data-testid="button-full-help-guide"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View Full Help Guide
                </Button>
                <FeedbackDialog page={mode} />
                <div className="h-4" />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="ask-ai" forceMount className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col data-[state=inactive]:hidden">
            <AskAIChat />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
