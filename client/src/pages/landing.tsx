import { Cable, Camera, Search, FileText, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    icon: Camera,
    title: "Photo Annotation",
    description: "Upload pallet photos, place pins on reels, and annotate sections visually.",
  },
  {
    icon: Search,
    title: "Catalog Lookup",
    description: "Type a category code and auto-fill vendor, footage, wire type, and size from the catalog.",
  },
  {
    icon: FileText,
    title: "PDF Export",
    description: "Generate professional PDF reports of your counting sessions.",
  },
  {
    icon: ClipboardList,
    title: "Session Management",
    description: "Organize counts into sessions by warehouse location and date.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="relative flex-1 flex flex-col">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-stone-900 to-amber-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(180,100,30,0.15),_transparent_60%)]" />

        <header className="relative z-10 flex items-center justify-between gap-2 p-4">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-semibold text-amber-100/80 tracking-wide">MRC</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-12">
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
              Track wire reels across warehouse pallet sections with photo annotation and catalog lookup
            </p>

            <div className="pt-4">
              <a href="/api/login">
                <Button size="lg" data-testid="button-login" className="bg-amber-600 border-amber-700 text-white">
                  Sign in with Replit
                </Button>
              </a>
            </div>
          </div>
        </main>
      </div>

      <section className="bg-background py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold text-center mb-8 text-foreground">
            Built for Warehouse Teams
          </h2>
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
    </div>
  );
}
