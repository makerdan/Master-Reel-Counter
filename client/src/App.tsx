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
import NotFound from "@/pages/not-found";

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

  return (
    <Switch>
      <Route path="/">
        {user ? <Dashboard /> : <Landing />}
      </Route>
      <Route path="/session/:id">
        {user ? <SessionPage /> : <Landing />}
      </Route>
      <Route path="/settings">
        {user ? <SettingsPage /> : <Landing />}
      </Route>
      <Route path="/stats">
        {user ? <StatsPage /> : <Landing />}
      </Route>
      <Route path="/join/:token">
        {user ? <JoinPage /> : <Landing />}
      </Route>
      <Route path="/help">
        {user ? <HelpPage /> : <Landing />}
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
            <AuthRouter />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
