import { useState } from "react";
import {
  Cable, Camera, Search, FileText, Users, Link2, Shield,
  ImagePlus, Download, Flag, ScanLine, GalleryHorizontalEnd, FileSpreadsheet,
  Layers, AlertTriangle, Mail, Send, Globe, WifiOff, Smartphone,
  FolderOpen, Trash2, BarChart3, Lock, MessageSquare, Undo2,
  Zap, ArrowRight, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";

const coreFeatures = [
  {
    icon: Camera,
    title: "Photo Annotation",
    description: "Upload pallet photos, place color-coded pins directly on reels, and annotate sections visually with zoom, pan, and rotate controls.",
  },
  {
    icon: ScanLine,
    title: "AI Label Scanner",
    description: "Scan reel labels with AI-powered OCR. Automatically read catalog codes, footage, and tag numbers from photos with one tap.",
    badge: "AI",
  },
  {
    icon: Search,
    title: "Catalog Autocomplete",
    description: "Type a few characters and auto-fill vendor, footage, wire type, and size from a built-in 180+ entry wire catalog with custom category support.",
  },
  {
    icon: Flag,
    title: "Flagged Reels & Review",
    description: "Flag reels that need attention, capture close-up detail photos, and resolve flags with a streamlined save-and-resolve workflow.",
  },
  {
    icon: GalleryHorizontalEnd,
    title: "Photos Reel",
    description: "Browse every photo in a session organized by aisle and section. Tap any header to jump straight to that section's annotation view.",
  },
  {
    icon: ImagePlus,
    title: "Detail Shot Linking",
    description: "Mark photos as close-up detail shots and link them to parent overview photos. Auto-labeled detail pins keep everything organized.",
  },
];

const collaborationFeatures = [
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
    icon: MessageSquare,
    title: "Comments & Activity",
    description: "Leave threaded comments on entries and photos. A full activity log tracks every change across the session with timestamps.",
  },
  {
    icon: Lock,
    title: "Session Locking",
    description: "Lock a session when the count is finalized to prevent accidental edits. Unlock anytime if you need to make corrections.",
  },
];

const exportFeatures = [
  {
    icon: FileText,
    title: "PDF Audit Reports",
    description: "Generate professional PDF reports with annotated photos, pin markers, flagged reel indicators, and footage summaries. Choose Full or Standard quality.",
  },
  {
    icon: FileSpreadsheet,
    title: "Excel Export",
    description: "Download formatted .xlsx workbooks with session metadata, entries grouped by aisle/section, and grand totals. Export from inside a session or directly from the dashboard.",
  },
  {
    icon: Mail,
    title: "Email Summaries",
    description: "Share a text summary of any session via email — name, location, entry count, footage totals, and a grouped breakdown by aisle/section.",
  },
  {
    icon: BarChart3,
    title: "Statistics Dashboard",
    description: "View comprehensive counting statistics across all sessions — total reels, footage, photos, entries by vendor, time trends, and more.",
  },
];

const managementFeatures = [
  {
    icon: FolderOpen,
    title: "Folders & Organization",
    description: "Group sessions into folders for easy organization. Drag sessions between folders, rename, and nest them however you like.",
  },
  {
    icon: Trash2,
    title: "Trash & Recovery",
    description: "Deleted sessions go to a 30-day Trash instead of being permanently removed. Restore any trashed session or permanently delete when ready.",
    badge: "New",
  },
  {
    icon: Shield,
    title: "Data Encryption",
    description: "Toggle AES-256 encryption on sensitive fields like reel tags and manufacturer info for added data security at rest.",
  },
  {
    icon: Undo2,
    title: "Undo & Redo",
    description: "Every entry create, edit, and delete can be undone. The undo/redo stack tracks your action history throughout each session.",
  },
];

const mobileFeatures = [
  {
    icon: Smartphone,
    title: "Install as App (PWA)",
    description: "Install Master Reel Counter on your phone or tablet — no app store needed. It launches like a native app from your home screen.",
    badge: "New",
  },
  {
    icon: WifiOff,
    title: "Offline Mode",
    description: "Capture photos and create entries in areas with no signal. Everything queues locally and syncs automatically when connectivity returns.",
    badge: "New",
  },
  {
    icon: Layers,
    title: "Receiving Mode",
    description: "Compact single-photo layout for receiving dock counts. Sections auto-increment so you can focus on snapping photos without typing.",
  },
  {
    icon: Zap,
    title: "Rapid Capture",
    description: "Mobile Flow is optimized for speed. Set your aisle, then rapidly photograph sections — the upload queue handles everything in the background.",
  },
];

const steps = [
  { step: "1", title: "Create a Session", detail: "Name your counting session and set the warehouse location. Organize sessions into folders for easy management." },
  { step: "2", title: "Photograph & Pin", detail: "Snap photos of rack sections, place pins on each reel, and enter catalog codes — or let AI scan them for you." },
  { step: "3", title: "Review & Flag", detail: "Flag questionable reels, capture detail shots, resolve flags with wire data, and have your team review entries." },
  { step: "4", title: "Export & Report", detail: "Download Excel spreadsheets, generate annotated PDF audit reports, or email summaries when the count is complete." },
];

const stats = [
  { value: "180+", label: "Wire Catalog Entries" },
  { value: "5", label: "Workflow Tabs" },
  { value: "3", label: "Export Formats" },
  { value: "100%", label: "Offline Capable" },
];

function FeatureSection({
  id,
  title,
  subtitle,
  features,
  className = "",
}: {
  id?: string;
  title: string;
  subtitle: string;
  features: { icon: any; title: string; description: string; badge?: string }[];
  className?: string;
}) {
  return (
    <section id={id} className={`py-16 px-4 ${className}`}>
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-2 text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground text-center mb-10 max-w-lg mx-auto">{subtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((feature) => (
            <Card key={feature.title} className="border-border/60 hover:border-amber-500/30 transition-colors" data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="p-5 flex gap-4 items-start">
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 shrink-0">
                  <feature.icon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm">{feature.title}</h3>
                    {feature.badge && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25">
                        {feature.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = `Name: ${encodeURIComponent(name)}%0AEmail: ${encodeURIComponent(email)}%0A%0A${encodeURIComponent(message)}`;
    window.location.href = `mailto:makerdantheman@gmail.com?subject=${encodeURIComponent(`Contact from ${name}`)}&body=${body}`;
  };

  return (
    <section id="contact" className="bg-muted/50 py-16 px-4 border-t">
      <div className="max-w-xl mx-auto text-center space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Get In Touch</h2>
        <p className="text-sm text-muted-foreground">Have questions or want to learn more? Drop us a line.</p>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Mail className="h-4 w-4" />
          <span data-testid="text-contact-name">Dan</span>
          <span className="mx-1">—</span>
          <a href="mailto:makerdantheman@gmail.com" className="text-amber-600 dark:text-amber-400 hover:underline" data-testid="link-contact-email">
            makerdantheman@gmail.com
          </a>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div>
            <label htmlFor="contact-name" className="block text-sm font-medium text-foreground mb-1">Name</label>
            <input
              id="contact-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              placeholder="Your name"
              data-testid="input-contact-name"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-sm font-medium text-foreground mb-1">Email</label>
            <input
              id="contact-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              placeholder="you@example.com"
              data-testid="input-contact-email"
            />
          </div>
          <div>
            <label htmlFor="contact-message" className="block text-sm font-medium text-foreground mb-1">Message</label>
            <textarea
              id="contact-message"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
              placeholder="How can we help?"
              data-testid="input-contact-message"
            />
          </div>
          <div className="flex justify-center">
            <Button type="submit" className="bg-amber-600 border-amber-700 text-white" data-testid="button-contact-send">
              <Send className="h-4 w-4 mr-2" />
              Send Message
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="relative flex flex-col">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-stone-900 to-amber-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(180,100,30,0.15),_transparent_60%)]" />

        <div className="relative z-10 bg-amber-500 text-black px-4 py-2.5 text-center" data-testid="banner-testing">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Undergoing Final Testing — This app is not open for general use yet.</span>
          </div>
        </div>

        <header className="relative z-10 flex items-center justify-between gap-2 p-4 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-semibold text-amber-100/80 tracking-wide">Master Reel Counter</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-amber-100/60">
            <a href="#how-it-works" className="hover:text-amber-200 transition-colors" data-testid="link-nav-how">How It Works</a>
            <a href="#features" className="hover:text-amber-200 transition-colors" data-testid="link-nav-features">Features</a>
            <a href="#contact" className="hover:text-amber-200 transition-colors" data-testid="link-nav-contact">Contact</a>
          </nav>
          <ThemeToggle />
        </header>

        <main className="relative z-10 flex flex-col items-center justify-center px-4 py-20 md:py-28">
          <div className="max-w-3xl w-full text-center space-y-8" style={{ animation: "slideIn 0.5s ease-out" }}>
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="p-4 rounded-xl bg-amber-500/20 border border-amber-500/30 shadow-lg shadow-amber-500/10">
                <Cable className="h-12 w-12 text-amber-400" />
              </div>
            </div>

            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-tight" data-testid="text-app-title">
              Master Reel Counter
            </h1>

            <p className="text-lg md:text-xl text-amber-100/70 max-w-2xl mx-auto leading-relaxed">
              The warehouse wire reel counting tool built for teams. Annotate photos, scan labels with AI, flag issues, collaborate in real time, and export professional audit reports — even offline.
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap pt-4">
              <a href="/api/login">
                <Button size="lg" data-testid="button-login" className="bg-amber-600 border-amber-700 text-white h-12 px-8 text-base">
                  Sign in with Replit
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </a>
              <a href="/tester-login">
                <Button size="lg" variant="outline" data-testid="button-tester-login" className="border-amber-500/40 text-amber-100 backdrop-blur-sm bg-white/5 h-12 px-8 text-base">
                  Tester Login
                </Button>
              </a>
            </div>

            <div className="flex items-center justify-center gap-8 flex-wrap pt-6 text-sm text-amber-200/50">
              <span className="flex items-center gap-1.5"><ScanLine className="h-3.5 w-3.5" /> AI label scanning</span>
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Team sharing</span>
              <span className="flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> PDF & Excel export</span>
              <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Works offline</span>
            </div>

            <a href="#how-it-works" className="inline-flex items-center gap-1 text-amber-200/40 hover:text-amber-200/60 transition-colors pt-4" data-testid="link-scroll-down">
              <ChevronDown className="h-5 w-5 animate-bounce" />
            </a>
          </div>
        </main>
      </div>

      <section className="bg-background py-10 px-4 border-b">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-muted/50 py-16 px-4 border-b">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2 text-foreground">How It Works</h2>
          <p className="text-sm text-muted-foreground text-center mb-10 max-w-md mx-auto">Four simple steps from warehouse floor to finished report.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div key={s.step} className="relative flex flex-col items-center text-center space-y-3 p-6 rounded-lg border border-border/50 bg-background" data-testid={`step-${s.step}`}>
                <div className="h-10 w-10 rounded-full bg-amber-600/15 border border-amber-600/25 flex items-center justify-center text-amber-600 font-bold text-sm">
                  {s.step}
                </div>
                <h3 className="font-semibold text-sm">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <FeatureSection
        id="features"
        title="Core Counting Tools"
        subtitle="Everything you need to photograph, annotate, and catalog wire reels across your warehouse."
        features={coreFeatures}
        className="bg-background"
      />

      <FeatureSection
        title="Mobile & Offline"
        subtitle="Built for field workers in warehouses where connectivity is unreliable."
        features={mobileFeatures}
        className="bg-muted/50 border-y"
      />

      <FeatureSection
        title="Collaboration & Security"
        subtitle="Work together with your team while keeping your data safe."
        features={collaborationFeatures}
        className="bg-background"
      />

      <FeatureSection
        title="Export & Reporting"
        subtitle="Turn your counts into professional reports ready for auditing and procurement."
        features={exportFeatures}
        className="bg-muted/50 border-y"
      />

      <FeatureSection
        title="Session Management"
        subtitle="Organize, protect, and track your counting sessions with powerful tools."
        features={managementFeatures}
        className="bg-background"
      />

      <section className="bg-gradient-to-br from-neutral-900 via-stone-900 to-amber-950 py-16 px-4">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-2xl font-bold text-white">Ready to Start Counting?</h2>
          <p className="text-amber-100/60 max-w-md mx-auto">
            Sign in to create your first session and see how Master Reel Counter streamlines your warehouse wire inventory process.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a href="/api/login">
              <Button size="lg" className="bg-amber-600 border-amber-700 text-white h-12 px-8 text-base" data-testid="button-login-cta">
                Get Started
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </a>
            <a href="#features">
              <Button size="lg" variant="outline" className="border-amber-500/40 text-amber-100 backdrop-blur-sm bg-white/5 h-12 px-8 text-base" data-testid="button-features-cta">
                Explore Features
              </Button>
            </a>
          </div>
        </div>
      </section>

      <ContactSection />

      <footer className="bg-muted/50 border-t py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Cable className="h-3.5 w-3.5" />
            <span className="font-medium">Master Reel Counter</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="hover:text-foreground transition-colors" data-testid="link-footer-how">How It Works</a>
            <a href="#features" className="hover:text-foreground transition-colors" data-testid="link-footer-features">Features</a>
            <a href="#contact" className="hover:text-foreground transition-colors" data-testid="link-footer-contact">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
