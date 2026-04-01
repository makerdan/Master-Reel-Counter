import { useLocation } from "wouter";
import { ChevronLeft, HelpCircle, Cable, Camera, Smartphone, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { OverviewHelp, DashboardSections, SessionSections, MobileFlowSections, AskAIChat } from "@/components/HelpMenu";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";

export default function HelpPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

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
          <DashboardSections isTester={user?.isTester} />
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
