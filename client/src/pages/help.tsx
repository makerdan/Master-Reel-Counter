import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, HelpCircle, Cable, Camera, Smartphone, Bot, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { OverviewHelp, DashboardSections, SessionSections, MobileFlowSections, AskAIChat } from "@/components/HelpMenu";
import { ThemeToggle } from "@/components/theme-toggle";
import { HELP_ARTICLES } from "@shared/help-content";

export default function HelpPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const filteredArticles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return HELP_ARTICLES;
    return HELP_ARTICLES.filter((article) =>
      [article.title, article.summary, article.body, ...article.keywords].join(" ").toLowerCase().includes(query)
    );
  }, [search]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-3 max-w-3xl mx-auto">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setLocation("/")}
              data-testid="button-help-back"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <HelpCircle className="h-5 w-5 text-[hsl(18_70%_50%)]" />
            <span className="font-semibold text-sm">Full Help Guide</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        <div className="mb-5 space-y-2">
          <label htmlFor="help-search" className="text-sm font-medium">Search help</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="help-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search sessions, photos, mobile flow..."
              className="pl-9"
              data-testid="input-help-search"
            />
          </div>
          {search && (
            <div className="space-y-2" aria-live="polite">
              {filteredArticles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching help topics. Try a different term or send feedback.</p>
              ) : filteredArticles.map((article) => (
                <div key={article.id} className="rounded-md border p-3">
                  <h2 className="font-semibold">{article.title}</h2>
                  <p className="text-sm text-muted-foreground">{article.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <Accordion type="multiple" className="w-full">
          <OverviewHelp />
        </Accordion>

        <Separator className="my-6" />
        <div className="flex items-center gap-2 mb-2">
          <Cable className="h-5 w-5 text-[hsl(18_70%_50%)]" />
          <h2 className="text-xl font-bold">Sessions Dashboard</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Managing sessions, folders, sorting, and search from the Sessions Dashboard.</p>
        <Accordion type="multiple" className="w-full">
          <DashboardSections />
        </Accordion>

        <Separator className="my-6" />
        <div className="flex items-center gap-2 mb-2">
          <Camera className="h-5 w-5 text-[hsl(18_70%_50%)]" />
          <h2 className="text-xl font-bold">Session — Full Mode</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Photo annotation, pin placement, entry management, collaboration, and exports inside a counting session.</p>
        <Accordion type="multiple" className="w-full">
          <SessionSections />
        </Accordion>

        <Separator className="my-6" />
        <div className="flex items-center gap-2 mb-2">
          <Smartphone className="h-5 w-5 text-[hsl(18_70%_50%)]" />
          <h2 className="text-xl font-bold">Session — Mobile Flow</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Streamlined capture workflow for walking through the warehouse with a phone.</p>
        <Accordion type="multiple" className="w-full">
          <MobileFlowSections />
        </Accordion>

        <Separator className="my-6" />
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-5 w-5 text-[hsl(18_70%_50%)]" />
          <h2 className="text-xl font-bold">Ask AI</h2>
        </div>
        <p className="text-2xl text-muted-foreground mb-3">Ask any question about the app and get an instant answer.</p>
        <div className="border rounded-lg overflow-hidden" style={{ height: 520 }}>
          <AskAIChat />
        </div>
      </main>
    </div>
  );
}
