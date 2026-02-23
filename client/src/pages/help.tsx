import { useLocation } from "wouter";
import { ChevronLeft, HelpCircle, Cable, Camera, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { OverviewHelp, DashboardSections, SessionSections, MobileFlowSections } from "@/components/HelpMenu";
import { ThemeToggle } from "@/components/theme-toggle";

export default function HelpPage() {
  const [, setLocation] = useLocation();

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
          <h2 className="text-lg font-bold">Dashboard</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Managing sessions, folders, sorting, and search from the Counting Sessions page.</p>
        <Accordion type="multiple" className="w-full">
          <DashboardSections />
        </Accordion>

        <Separator className="my-6" />
        <div className="flex items-center gap-2 mb-2">
          <Camera className="h-5 w-5 text-[hsl(18_70%_50%)]" />
          <h2 className="text-lg font-bold">Session — Full Mode</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Photo annotation, pin placement, entry management, collaboration, and exports inside a counting session.</p>
        <Accordion type="multiple" className="w-full">
          <SessionSections />
        </Accordion>

        <Separator className="my-6" />
        <div className="flex items-center gap-2 mb-2">
          <Smartphone className="h-5 w-5 text-[hsl(18_70%_50%)]" />
          <h2 className="text-lg font-bold">Mobile Flow</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Streamlined capture workflow for walking through the warehouse with a phone.</p>
        <Accordion type="multiple" className="w-full">
          <MobileFlowSections />
        </Accordion>
      </main>
    </div>
  );
}
