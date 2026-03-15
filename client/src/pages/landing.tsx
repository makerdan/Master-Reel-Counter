import { Cable, Camera, Search, FileText, ClipboardList, Users, Link2, Shield, ImagePlus, Download, Flag, ScanLine, GalleryHorizontalEnd, FileSpreadsheet, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    icon: Camera,
    title: "Photo Annotation",
    description: "Upload pallet photos, place pins directly on reels, and annotate sections visually with zoom, pan, and rotate.",
  },
  {
    icon: ScanLine,
    title: "AI Scanner",
    description: "Scan reel labels with AI-powered OCR. Automatically read catalog codes, footage, and tag numbers from photos.",
  },
  {
    icon: Search,
    title: "Catalog Autocomplete",
    description: "Type a catalog code and auto-fill vendor, footage, wire type, and size from a built-in 180+ entry wire catalog.",
  },
  {
    icon: Flag,
    title: "Flagged Reels",
    description: "Flag reels that need attention — damaged, misplaced, or questionable. Review all flagged items in a dedicated tab with notes.",
  },
  {
    icon: GalleryHorizontalEnd,
    title: "Photos Reel",
    description: "Browse every photo in a session organized by aisle and section. Tap any header to jump straight to that section's annotation view.",
  },
  {
    icon: ImagePlus,
    title: "Detail Shot Linking",
    description: "Mark photos as close-up detail shots and link them to parent overview photos. Browse nearby photos for context.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Share sessions with your team. Assign owner, editor, or viewer roles so everyone sees the same data in real time.",
  },
  {
    icon: Link2,
    title: "Easy Invites",
    description: "Add teammates by username, send a shareable link, or invite by email — three simple ways to bring your crew onboard.",
  },
  {
    icon: FileText,
    title: "PDF Export",
    description: "Generate professional PDF audit reports with annotated photos, pin markers, flagged reel indicators, and footage summaries.",
  },
  {
    icon: FileSpreadsheet,
    title: "Excel & CSV Export",
    description: "Download full session data as formatted Excel workbooks or CSV spreadsheets with color-coded rows and section bands.",
  },
  {
    icon: Shield,
    title: "Data Encryption",
    description: "Toggle AES-256 encryption on sensitive fields like reel tags and manufacturer info for added security.",
  },
  {
    icon: ClipboardList,
    title: "Session Management",
    description: "Organize counts into sessions by warehouse location. Track status, entry counts, and photo timestamps at a glance.",
  },
  {
    icon: Layers,
    title: "Receiving Mode",
    description: "Compact single-photo layout for receiving dock counts. Sections stack efficiently in both the app and exported PDFs.",
  },
];

const steps = [
  { step: "1", title: "Create a Session", detail: "Name your counting session and set the warehouse or receiving location." },
  { step: "2", title: "Photograph & Pin", detail: "Snap photos of rack sections, place pins on each reel, and enter catalog codes or let AI scan them." },
  { step: "3", title: "Review & Flag", detail: "Flag questionable reels, add notes, and browse all photos in the Photos Reel for a full overview." },
  { step: "4", title: "Export & Report", detail: "Download Excel spreadsheets or generate annotated PDF audit reports when the count is complete." },
];

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="relative flex flex-col">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-stone-900 to-amber-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(180,100,30,0.15),_transparent_60%)]" />

        <header className="relative z-10 flex items-center justify-between gap-2 p-4">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-semibold text-amber-100/80 tracking-wide">MRC</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="relative z-10 flex flex-col items-center justify-center px-4 py-16 md:py-24">
          <div className="max-w-2xl w-full text-center space-y-6" style={{ animation: "slideIn 0.5s ease-out" }}>
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="p-3 rounded-md bg-amber-500/20 border border-amber-500/30">
                <Cable className="h-10 w-10 text-amber-400" />
              </div>
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight" data-testid="text-app-title">
              Master Reel Counter
            </h1>

            <p className="text-lg text-amber-100/70 max-w-lg mx-auto leading-relaxed">
              The warehouse wire reel counting tool built for teams. Annotate photos, scan labels with AI, flag issues, collaborate in real time, and export professional audit reports.
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap pt-4">
              <a href="/api/login">
                <Button size="lg" data-testid="button-login" className="bg-amber-600 border-amber-700 text-white">
                  Sign in with Replit
                </Button>
              </a>
              <a href="/tester-login">
                <Button size="lg" variant="outline" data-testid="button-tester-login" className="border-amber-500/40 text-amber-100 backdrop-blur-sm bg-white/5">
                  Tester Login
                </Button>
              </a>
              <a href="#features">
                <Button size="lg" variant="outline" data-testid="button-learn-more" className="border-amber-500/40 text-amber-100 backdrop-blur-sm bg-white/5">
                  See Features
                </Button>
              </a>
            </div>

            <div className="flex items-center justify-center gap-6 flex-wrap pt-6 text-sm text-amber-200/50">
              <span className="flex items-center gap-1.5"><ScanLine className="h-3.5 w-3.5" /> AI label scanning</span>
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Team sharing</span>
              <span className="flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> PDF & Excel export</span>
            </div>
          </div>
        </main>
      </div>

      <section id="how-it-works" className="bg-muted/50 py-12 px-4 border-b">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold text-center mb-8 text-foreground">
            How It Works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((s) => (
              <div key={s.step} className="flex flex-col items-center text-center space-y-2 p-4" data-testid={`step-${s.step}`}>
                <div className="h-9 w-9 rounded-md bg-amber-600/15 border border-amber-600/25 flex items-center justify-center text-amber-600 font-bold text-sm">
                  {s.step}
                </div>
                <h3 className="font-semibold text-sm">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="bg-background py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold text-center mb-2 text-foreground">
            Built for Warehouse Teams
          </h2>
          <p className="text-sm text-muted-foreground text-center mb-8 max-w-lg mx-auto">
            Everything you need to count, catalog, collaborate, and report on wire reels across your warehouse.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature) => (
              <Card key={feature.title} data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <CardContent className="p-5 flex gap-4 items-start">
                  <div className="p-2 rounded-md bg-muted shrink-0">
                    <feature.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-muted/50 border-t py-6 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Cable className="h-3.5 w-3.5" />
          <span>Master Reel Counter</span>
        </div>
      </footer>
    </div>
  );
}
