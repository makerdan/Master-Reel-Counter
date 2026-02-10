import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import SessionPage from "@/pages/session";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

queryClient.clear();

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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AuthRouter />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
