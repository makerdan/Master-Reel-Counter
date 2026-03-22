import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/lib/theme-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import SessionPage from "@/pages/session";
import SettingsPage from "@/pages/settings";
import StatsPage from "@/pages/stats";
import JoinPage from "@/pages/join";
import HelpPage from "@/pages/help";
import TesterLoginPage from "@/pages/tester-login";
import PendingApproval from "@/pages/pending-approval";
import NotFound from "@/pages/not-found";
import { NetworkStatusIndicator } from "@/components/NetworkStatusIndicator";

const TEXT_SIZE_MAP: Record<string, string> = {
  small: "14px",
  default: "16px",
  large: "18px",
  "extra-large": "20px",
};

function TextSizeSyncer() {
  const { user } = useAuth();
  const { data: settings } = useQuery<{ textSize?: string }>({
    queryKey: ["/api/settings"],
    enabled: !!user,
  });
  useEffect(() => {
    const size = settings?.textSize || "default";
    document.documentElement.style.fontSize = TEXT_SIZE_MAP[size] || "16px";
    return () => { document.documentElement.style.fontSize = ""; };
  }, [settings?.textSize]);
  return null;
}

function ThemeSyncer() {
  const { setThemeMode } = useTheme();
  const { user } = useAuth();
  const { data: settings } = useQuery<{ defaultTheme: string }>({
    queryKey: ["/api/settings"],
    enabled: !!user,
  });
  useEffect(() => {
    if (settings?.defaultTheme && !localStorage.getItem("themeMode")) {
      setThemeMode(settings.defaultTheme as "light" | "dark" | "system");
    }
  }, [settings?.defaultTheme, setThemeMode]);
  return null;
}

function AuthRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loading-spinner" />
      </div>
    );
  }

  const isApproved = !user || user.approved || user.isTester;

  return (
    <Switch>
      <Route path="/">
        {user ? (isApproved ? <Dashboard /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route path="/tester-login">
        {user ? (isApproved ? <Dashboard /> : <PendingApproval />) : <TesterLoginPage />}
      </Route>
      <Route path="/session/:id">
        {user ? (isApproved ? <SessionPage /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route path="/settings">
        {user ? (isApproved ? <SettingsPage /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route path="/stats">
        {user ? (isApproved ? <StatsPage /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route path="/join/:token">
        {user ? (isApproved ? <JoinPage /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route path="/help">
        {user ? (isApproved ? <HelpPage /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <ThemeSyncer />
            <TextSizeSyncer />
            <NetworkStatusIndicator />
            <AuthRouter />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
