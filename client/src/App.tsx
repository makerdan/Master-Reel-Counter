import { useEffect, useRef } from "react";
import { THEME_MODE_KEY, PAGEVIEW_LAST_KEY, readSessionKey, writeSessionKey } from "@/lib/storageKeys";
import { Switch, Route, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
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
import PendingApproval from "@/pages/pending-approval";
import NotFound from "@/pages/not-found";
import { NetworkStatusIndicator } from "@/components/NetworkStatusIndicator";
import { WsReconnectProvider } from "@/hooks/use-ws-reconnect";
import { HelpOnboarding } from "@/components/HelpMenu";
import { buildSignInPath, getReturnPathFromSearch } from "@shared/auth-routing";
import { buildPublishableKey } from "@clerk/shared/keys";

const clerkPublicHost =
  import.meta.env.VITE_CLERK_PUBLIC_HOST || window.location.hostname;
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLIC_HOST
  ? buildPublishableKey(clerkPublicHost)
  : publishableKeyFromHost(
      clerkPublicHost,
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    );
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#b45309",
    colorForeground: "#292524",
    colorMutedForeground: "#78716c",
    colorDanger: "#b91c1c",
    colorBackground: "#fffbeb",
    colorInput: "#ffffff",
    colorInputForeground: "#292524",
    colorNeutral: "#d6d3d1",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-amber-50 rounded-2xl w-[440px] max-w-full overflow-hidden border border-amber-700/20 shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-stone-900 font-bold",
    headerSubtitle: "text-stone-600",
    socialButtonsBlockButtonText: "text-stone-800",
    formFieldLabel: "text-stone-800",
    footerActionLink: "text-amber-700 font-semibold",
    footerActionText: "text-stone-600",
    dividerText: "text-stone-500",
    identityPreviewEditButton: "text-amber-700",
    formFieldSuccessText: "text-green-700",
    alertText: "text-stone-800",
    logoBox: "mb-4",
    logoImage: "h-14 w-14 rounded-xl",
    socialButtonsBlockButton: "border-stone-300 bg-white",
    formButtonPrimary: "bg-amber-700 hover:bg-amber-800 text-white",
    formFieldInput: "bg-white border-stone-300 text-stone-900",
    footerAction: "bg-amber-100/70",
    dividerLine: "bg-stone-300",
    alert: "bg-amber-100 border-amber-300",
    otpCodeFieldInput: "bg-white border-stone-300 text-stone-900",
    formFieldRow: "gap-2",
    main: "gap-4",
  },
};

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
    if (settings?.defaultTheme && !localStorage.getItem(THEME_MODE_KEY)) {
      setThemeMode(settings.defaultTheme as "light" | "dark" | "system");
    }
  }, [settings?.defaultTheme, setThemeMode]);
  return null;
}

function PageViewTracker() {
  const [location] = useLocation();
  useEffect(() => {
    const now = Date.now();
    try {
      const previous = JSON.parse(readSessionKey(PAGEVIEW_LAST_KEY) || "null") as { path?: string; at?: number } | null;
      if (previous?.path === location && typeof previous.at === "number" && now - previous.at < 30_000) return;
      writeSessionKey(PAGEVIEW_LAST_KEY, JSON.stringify({ path: location, at: now }));
    } catch {
      // Tracking must never affect navigation.
    }
    // Defer tracking by 2 s so the POST fires after the page has reached
    // network-idle. This prevents the request from delaying load-state checks.
    const t = setTimeout(() => {
      fetch("/api/track/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location }),
        credentials: "include",
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [location]);
  return null;
}

function AuthRouter() {
  const [location] = useLocation();
  const {
    user,
    identityId,
    isLoading,
    accessDenied,
    identityError,
    isNotProvisioned,
  } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loading-spinner" />
      </div>
    );
  }

  if (identityError) {
    return <PendingApproval status="service-error" />;
  }

  if (isNotProvisioned) {
    return <PendingApproval status="not-provisioned" />;
  }

  const isApproved = !user || user.approved;
  if (accessDenied || user?.rejected) {
    return <PendingApproval status="rejected" />;
  }

  return (
    <Switch>
      <Route path="/">
        {user ? (isApproved ? <Dashboard key={identityId ?? user.id} /> : <PendingApproval />) : <Landing />}
      </Route>
      <Route path="/session/:id">
        {user ? (isApproved ? <SessionPage /> : <PendingApproval />) : <Landing signInHref={buildSignInPath(location, basePath)} />}
      </Route>
      <Route path="/settings">
        {user ? (isApproved ? <SettingsPage /> : <PendingApproval />) : <Landing signInHref={buildSignInPath(location, basePath)} />}
      </Route>
      <Route path="/stats">
        {user ? (isApproved ? <StatsPage /> : <PendingApproval />) : <Landing signInHref={buildSignInPath(location, basePath)} />}
      </Route>
      <Route path="/join/:token">
        {user ? (isApproved ? <JoinPage /> : <PendingApproval />) : <Landing signInHref={buildSignInPath(location, basePath)} />}
      </Route>
      <Route path="/help">
        {user ? (isApproved ? <HelpPage /> : <PendingApproval />) : <Landing signInHref={buildSignInPath(location, basePath)} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function SignInPage() {
  const search = useSearch();
  const returnPath = getReturnPathFromSearch(search);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-neutral-900 via-stone-900 to-amber-950 px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={returnPath ?? `${basePath}/`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-neutral-900 via-stone-900 to-amber-950 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      client.clear();
    }
    previousUserId.current = userId;
  }), [addListener, client]);
  return null;
}

function Application() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <WsReconnectProvider>
          <TooltipProvider>
            <Toaster />
            <ThemeSyncer />
            <TextSizeSyncer />
            <PageViewTracker />
            <HelpOnboarding />
            <NetworkStatusIndicator />
            <AuthRouter />
          </TooltipProvider>
        </WsReconnectProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{ signIn: { start: { title: "Welcome back", subtitle: "Sign in to access Master Reel Counter" } }, signUp: { start: { title: "Create your account", subtitle: "Start counting with your team" } } }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={Application} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}
