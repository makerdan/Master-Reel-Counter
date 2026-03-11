import { useState } from "react";
import { HelpCircle, Camera, MapPin, Flag, Eye, ZoomIn, ZoomOut, Move, RotateCw, ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Download, FileText, Mail, Lock, Unlock, Undo2, Redo2, History, Users, Share2, AlertCircle, AlertTriangle, StickyNote, Focus, ArrowUpDown, ArrowUp, ImagePlus, Check, X, Copy, Cable, Folder, FolderPlus, FolderInput, Search, MoreVertical, Settings, LogOut, BarChart3, CheckCircle2, Hash, Ruler, ExternalLink, MessageSquare, Loader2, ScanLine, Grid3X3, ListChecks, Sparkles, SquareCheck } from "lucide-react";
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
        <span className="text-2xl font-semibold text-foreground">{label}</span>
        <p className="text-[22px] text-muted-foreground leading-relaxed">{description}</p>
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
      <AccordionContent className="text-2xl text-muted-foreground leading-relaxed space-y-2 pb-4">
        <p>Master Reel Counter is a warehouse wire reel counting application. It helps you photograph pallet sections, annotate reels with pins, enter wire catalog details, and export professional inventory reports.</p>
        <p>The <HelpBadge>Dashboard</HelpBadge> is your home base for managing sessions and folders. Inside a session, <HelpBadge>Full Mode</HelpBadge> provides the complete desktop workflow with Section Photo, Flagged, Photos Reel, and AI Scanner tabs. <HelpBadge>Mobile Flow</HelpBadge> offers a streamlined phone-friendly capture experience.</p>
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
            label="Stats"
            description="Opens the summary statistics page showing key metrics across all your sessions — total reels, footage, sessions, and activity charts."
          />
          <FeatureRow
            icon={<HelpIcon icon={Settings} />}
            label="Settings"
            description="Opens your profile and app settings. Upload a custom profile avatar, edit your display name, manage encryption keys, and configure preferences for display, accessibility, data entry, photo capture, and export."
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
          <p className="text-[22px] text-muted-foreground leading-relaxed mb-2">Organize your sessions into folders and even nest folders inside other folders for complex projects.</p>
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
          <p className="text-[22px] text-muted-foreground leading-relaxed mb-2">Each session card shows the name, location, reel count, total footage, photo count, and time. Tap the three-dot menu for actions:</p>
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
            description="Creates an exact copy of the session with all its entries, photos, and pins. The copy is named with a '(copy)' suffix."
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
            description="View a timestamped log of all changes — entries created, photos uploaded, collaborators joining, etc. You can copy all entries to clipboard."
          />
          <FeatureRow
            icon={<HelpIcon icon={Trash2} />}
            label="Delete"
            description="Permanently delete a session and all its data. A confirmation dialog appears before deletion."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="dash-shared-sessions">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Shared Sessions</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[22px] text-muted-foreground leading-relaxed mb-2">Sessions shared with you by other users appear in a separate 'Shared with You' section below your own sessions.</p>
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
          <p className="text-[22px] text-muted-foreground leading-relaxed mb-2">Each session card displays key information at a glance:</p>
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
            description="Toggle the activity log showing a timestamped feed of all session changes — entries created, photos uploaded, collaborators joining, etc."
          />
          <FeatureRow
            icon={<HelpIcon icon={Download} />}
            label="Export"
            description="Export session data as CSV (spreadsheet), PDF (formatted report), or share via email. The export includes all entries grouped by aisle/section."
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

      <AccordionItem value="session-photo-mode">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Camera className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Section Photo Tab</span>
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
            description="Tap a pin or its row in the entry table to see a zoomed crop of the area around that pin. Toggle between close-up and wide crop modes for different detail levels. This sticks to the top of the screen as you scroll."
          />

          <Separator className="my-2" />
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">Entry Details Table</p>
          <FeatureRow
            icon={<span className="text-xs font-mono font-bold text-[hsl(18_70%_50%)]">CAT</span>}
            label="Category Input (Wire Details)"
            description="Type a wire category and the system searches ~186 catalog entries. Use arrow keys to navigate suggestions and Enter to select. Selecting a category auto-fills the vendor code and footage fields. The suggestion dropdown scrolls when there are many matches."
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
            description="The category field searches the same ~186 wire catalog entries. Selecting a match auto-fills the vendor code and footage fields."
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
            icon={<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            label="Entries Without Photos"
            description="An amber-highlighted Issues section appears below the flagged pins list whenever entries exist with no linked photo. Each card shows the reel tag, aisle/section, reel count, and footage. These entries are not yet associated with a pin on any photo — edit or delete them from Table View."
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
            description="Tap the external-link icon to jump directly to that photo in the Section Photo tab, ready for pinning."
          />
          <FeatureRow
            icon={<HelpIcon icon={ArrowUp} />}
            label="Back to Top"
            description="A 'Back to Top' button appears at the bottom of the Photos Reel grid (above the Table View). Clicking it smoothly scrolls the page back to the top."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-ai-scanner">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><ScanLine className="h-4 w-4 text-[hsl(270_60%_55%)]" /> AI Scanner Tab</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Uses AI vision to read wire reel labels from photo crops. Select a photo, preview cropped regions around pins, analyze labels in batch, review results, and apply them as entries.</p>

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
            description="Each card has a checkbox to include or exclude it from the analysis batch. Uncheck cards with unreadable or irrelevant labels to save processing time."
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
            description="The raw text is automatically matched against the ~186 wire catalog entries. The best match fills in the category, vendor code, and footage fields. You can edit any field to correct the AI before applying."
          />
          <FeatureRow
            icon={<HelpIcon icon={Check} />}
            label="Apply to Entries"
            description="Commits the scanned results as entries. Draft pins become committed entries with their wire details filled in. Incomplete committed pins get their existing entries updated with the scanned data."
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
            description="Tap any Pin # in the table to jump directly to that pin's photo in Section Photo mode. The target pin flashes with a yellow glow for a few seconds so you can spot it immediately — useful for zooming in on a label you need to verify."
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
            description="Editors can add, edit, and delete entries and photos. Viewers can only view data. The owner can toggle roles and transfer ownership."
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
          <FeatureRow
            icon={<HelpIcon icon={Unlock} />}
            label="Per-Aisle Locking"
            description="The owner can lock individual aisles while leaving others open for counting. Use the Lock Aisles button in the session header to open a popover listing all aisles with lock toggles. Locked aisles show a lock icon on their photos and entries. Collaborators cannot edit anything in a locked aisle but can continue working in unlocked aisles."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="session-export">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><Download className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Export & Sharing</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-1 pb-4">
          <FeatureRow
            icon={<HelpIcon icon={FileText} />}
            label="CSV Export"
            description="Downloads all entries as a CSV spreadsheet. Includes columns for aisle, section, position, pallet ID, reel tag, wire type, gauge, footage, reel count, conductors, color, manufacturer, notes, photo filename, photo notes, detail shot status, and parent photo."
          />
          <FeatureRow
            icon={<HelpIcon icon={FileText} />}
            label="PDF Export"
            description="Generates a formatted PDF report. A quality picker dialog opens with two options — Full Quality (original resolution, recommended for auditing reel labels) and Standard (smaller file). Both begin generating in parallel; the chosen version downloads instantly. Your last-used choice is remembered."
          />
          <FeatureRow
            icon={<HelpIcon icon={Mail} />}
            label="Share via Email"
            description="Opens your email client with a pre-composed message containing the session link for quick sharing."
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

      <AccordionItem value="mobile-tips">
        <AccordionTrigger className="text-sm font-semibold py-3">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[hsl(18_70%_50%)]" /> Mobile Tips</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-2 pb-4 text-[11px] text-muted-foreground leading-relaxed">
          <p><span className="font-semibold text-foreground">Speed Workflow:</span> Set your aisle and section, then rapidly tap "Take Photo" to capture multiple angles. The upload queue handles everything in the background.</p>
          <p><span className="font-semibold text-foreground">Section Stepper:</span> Use the +/− buttons below the Section field to quickly move between sections by one. Zero-padding is preserved automatically, and the value can't go below 0.</p>
          <p><span className="font-semibold text-foreground">Receiving Mode:</span> Check the Receiving box for dock areas. Sections auto-number so you never have to type them — just keep snapping photos.</p>
          <p><span className="font-semibold text-foreground">Offline Resilience:</span> Head into low-signal warehouse areas with confidence. Photos queue locally and sync when you get back to connectivity.</p>
          <p><span className="font-semibold text-foreground">Batch Capture:</span> Use the gallery upload button to select multiple photos at once from your camera roll — all will be tagged with the current aisle/section.</p>
          <p><span className="font-semibold text-foreground">Review Later:</span> Mobile Flow is optimized for capturing. Switch to Full Mode on a tablet or desktop to add pins, wire details, and finalize entries.</p>
        </AccordionContent>
      </AccordionItem>
    </>
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
            <Button size="icon" variant="ghost" data-testid="button-help-menu">
              <HelpCircle className="h-4 w-4" />
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
        <ScrollArea className="flex-1 px-4">
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
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
