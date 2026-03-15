import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, BarChart3, Package, Ruler, Camera, CheckCircle, Clock, TrendingUp,
  Flame, Trophy, Calendar, Target, Users, Shield, Activity, Award, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

interface SharedContributor {
  userId: string;
  username: string;
  entryCount: number;
  photoCount: number;
  reelCount: number;
  footage: number;
}

interface SharedSession {
  sessionId: number;
  sessionName: string;
  contributors: SharedContributor[];
}

interface RoleMetrics {
  entries: number;
  footage: number;
  reels: number;
  photos: number;
}

interface RoleComparison {
  Owner: RoleMetrics;
  Editor: RoleMetrics;
  Tester: RoleMetrics;
  Viewer: RoleMetrics;
  currentUserRoles: string[];
}

interface UserStats {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  totalEntries: number;
  totalReels: number;
  totalFootage: number;
  totalPhotos: number;
  topCategories: { category: string; count: number; footage: number }[];
  topManufacturers: { manufacturer: string; count: number }[];
  weeklyStats: { week: string; entries: number; footage: number }[];
  bestSessionFootage: number;
  currentStreak: number;
  longestStreak: number;
  busiestDay: string | null;
  sharedPerformance: SharedSession[];
  roleComparison: RoleComparison;
  currentUserId: string;
}

export default function StatsPage() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading, isError } = useQuery<UserStats>({
    queryKey: ["/api/stats"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <Button size="icon" variant="ghost" onClick={() => setLocation("/")} data-testid="button-back-stats-error">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-sm font-semibold">Summary Stats</h1>
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm border border-destructive/30">
            <CardContent className="py-8 text-center">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 text-destructive" />
              <p className="text-sm font-medium mb-1">Unable to load stats</p>
              <p className="text-xs text-muted-foreground mb-4">There was a problem fetching your statistics.</p>
              <Button variant="outline" size="sm" onClick={() => setLocation("/")} data-testid="button-back-to-dashboard">
                <ArrowLeft className="h-3 w-3 mr-1" /> Back to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasNoPersonalData = stats.totalSessions === 0 && stats.totalEntries === 0;
  const hasNoData = hasNoPersonalData && stats.sharedPerformance.length === 0;

  const maxWeeklyEntries = Math.max(...stats.weeklyStats.map(w => w.entries), 1);
  const maxCatCount = Math.max(...stats.topCategories.map(c => c.count), 1);
  const maxMfgCount = Math.max(...stats.topManufacturers.map(m => m.count), 1);

  const avgEntriesPerSession = stats.totalSessions > 0 ? Math.round(stats.totalEntries / stats.totalSessions) : 0;
  const avgReelsPerEntry = stats.totalEntries > 0 ? (stats.totalReels / stats.totalEntries).toFixed(1) : "0";

  return (
    <div className="min-h-screen bg-background flex flex-col dashboard-theme">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <Button size="icon" variant="ghost" onClick={() => setLocation("/")} data-testid="button-back-stats">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-semibold underline" data-testid="text-stats-title">Summary Stats</h1>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-4 pb-[50vh] space-y-8">
        {hasNoData ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No data yet. Start counting reels to see your stats here.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {!hasNoPersonalData && (
              <>
                <section data-testid="section-overview">
                  <SectionHeading icon={<BarChart3 className="h-4 w-4" />} title="Overview" testId="heading-overview" />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Total Sessions:" value={stats.totalSessions} testId="stat-total-sessions" />
                    <StatCard icon={<CheckCircle className="h-4 w-4" />} label="Completed:" value={stats.completedSessions} testId="stat-completed" />
                    <StatCard icon={<Clock className="h-4 w-4" />} label="Active Sessions:" value={stats.activeSessions} testId="stat-active" />
                    <StatCard icon={<Package className="h-4 w-4" />} label="Total Reels:" value={stats.totalReels.toLocaleString()} testId="stat-total-reels" />
                    <StatCard icon={<Ruler className="h-4 w-4" />} label="Total Footage:" value={`${stats.totalFootage.toLocaleString()} ft`} testId="stat-total-footage" />
                    <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Total Entries:" value={stats.totalEntries.toLocaleString()} testId="stat-total-entries" />
                    <StatCard icon={<Camera className="h-4 w-4" />} label="Total Photos:" value={stats.totalPhotos.toLocaleString()} testId="stat-total-photos" />
                  </div>
                </section>

                <section data-testid="section-averages-records">
                  <SectionHeading icon={<Award className="h-4 w-4" />} title="Averages & Records" testId="heading-averages-records" />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard
                      icon={<Ruler className="h-4 w-4" />}
                      label="Avg Footage/Session:"
                      value={stats.totalSessions > 0 ? `${Math.round(stats.totalFootage / stats.totalSessions).toLocaleString()} ft` : "0 ft"}
                      testId="stat-avg-footage"
                    />
                    <StatCard icon={<Target className="h-4 w-4" />} label="Avg Entries/Session:" value={avgEntriesPerSession} testId="stat-avg-entries" />
                    <StatCard icon={<Package className="h-4 w-4" />} label="Avg Reels/Entry:" value={avgReelsPerEntry} testId="stat-avg-reels" />
                    <StatCard icon={<Trophy className="h-4 w-4" />} label="Best Session:" value={`${stats.bestSessionFootage.toLocaleString()} ft`} testId="stat-best-session" />
                  </div>
                </section>

                <section data-testid="section-streaks-activity">
                  <SectionHeading icon={<Flame className="h-4 w-4" />} title="Streaks & Activity" testId="heading-streaks-activity" />
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StatCard icon={<Flame className="h-4 w-4" />} label="Current Streak:" value={`${stats.currentStreak} day${stats.currentStreak !== 1 ? "s" : ""}`} testId="stat-current-streak" />
                    <StatCard icon={<Flame className="h-4 w-4" />} label="Longest Streak:" value={`${stats.longestStreak} day${stats.longestStreak !== 1 ? "s" : ""}`} testId="stat-longest-streak" />
                    <StatCard icon={<Calendar className="h-4 w-4" />} label="Busiest Day:" value={stats.busiestDay || "—"} testId="stat-busiest-day" />
                  </div>
                </section>

                {stats.weeklyStats.length > 0 && (
                  <section data-testid="section-weekly-activity">
                    <SectionHeading icon={<Activity className="h-4 w-4" />} title="Weekly Activity" testId="heading-weekly-activity" />
                    <Card>
                      <CardContent className="pt-4">
                        <div className="space-y-1">
                          {stats.weeklyStats.map((w) => {
                            const weekDate = new Date(w.week);
                            const label = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                            return (
                              <div key={w.week} className="flex items-center gap-2 text-xs" data-testid={`stat-week-${w.week}`}>
                                <span className="w-16 text-muted-foreground mono shrink-0">{label}</span>
                                <div className="flex-1 flex items-center gap-1">
                                  <div
                                    className="h-4 bg-primary/80 rounded-sm"
                                    style={{ width: `${(w.entries / maxWeeklyEntries) * 100}%`, minWidth: w.entries > 0 ? 4 : 0 }}
                                  />
                                  <span className="mono text-muted-foreground shrink-0">{w.entries} entries</span>
                                </div>
                                <span className="mono text-muted-foreground shrink-0 w-20 text-right">{w.footage.toLocaleString()} ft</span>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {(stats.topCategories.length > 0 || stats.topManufacturers.length > 0) && (
                  <section data-testid="section-top-categories-vendors">
                    <SectionHeading icon={<Layers className="h-4 w-4" />} title="Top Categories & Vendors" testId="heading-categories-vendors" />
                    <div className="grid md:grid-cols-2 gap-4">
                      {stats.topCategories.length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold">Top Categories:</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {stats.topCategories.map((c, i) => (
                                <div key={c.category} className="flex items-center gap-2" data-testid={`stat-category-${i}`}>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-xs mono truncate">{c.category}</span>
                                      <span className="text-xs text-muted-foreground mono shrink-0 ml-2">{c.count} ({c.footage.toLocaleString()} ft)</span>
                                    </div>
                                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-primary/70 rounded-full" style={{ width: `${(c.count / maxCatCount) * 100}%` }} />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {stats.topManufacturers.length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold">Top Vendor Codes:</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {stats.topManufacturers.map((m, i) => (
                                <div key={m.manufacturer} className="flex items-center gap-2" data-testid={`stat-manufacturer-${i}`}>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-xs mono truncate">{m.manufacturer}</span>
                                      <span className="text-xs text-muted-foreground mono shrink-0 ml-2">{m.count}</span>
                                    </div>
                                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-orange-500/70 rounded-full" style={{ width: `${(m.count / maxMfgCount) * 100}%` }} />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </section>
                )}

                {stats.topCategories.length === 0 && stats.topManufacturers.length === 0 && stats.weeklyStats.length === 0 && (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <BarChart3 className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Start counting reels to see detailed breakdowns here.</p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            <section data-testid="section-shared-performance">
              <SectionHeading icon={<Users className="h-4 w-4" />} title="Shared Session Performance" testId="text-shared-performance-title" />

              {stats.sharedPerformance.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No shared sessions yet. Invite teammates to a session to see performance comparisons.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {stats.sharedPerformance.map((session) => {
                    const maxEntries = Math.max(...session.contributors.map(c => c.entryCount), 1);
                    return (
                      <Card key={session.sessionId} data-testid={`shared-session-${session.sessionId}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold truncate">{session.sessionName}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {session.contributors.map((c) => {
                              const isCurrentUser = c.userId === stats.currentUserId;
                              return (
                                <div
                                  key={c.userId}
                                  className={`rounded-md p-2 ${isCurrentUser ? "bg-primary/10 ring-1 ring-primary/20" : "bg-muted/30"}`}
                                  data-testid={`contributor-${session.sessionId}-${c.userId}`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-xs font-medium truncate ${isCurrentUser ? "text-primary" : ""}`}>
                                      {c.username}{isCurrentUser ? " (you)" : ""}
                                    </span>
                                    <span className="text-xs text-muted-foreground mono shrink-0 ml-2">
                                      {c.footage.toLocaleString()} ft
                                    </span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
                                    <div
                                      className={`h-full rounded-full ${isCurrentUser ? "bg-primary/80" : "bg-muted-foreground/40"}`}
                                      style={{ width: `${(c.entryCount / maxEntries) * 100}%`, minWidth: c.entryCount > 0 ? 4 : 0 }}
                                    />
                                  </div>
                                  <div className="flex gap-3 text-[10px] text-muted-foreground mono">
                                    <span data-testid={`contrib-entries-${session.sessionId}-${c.userId}`}>{c.entryCount} entries</span>
                                    <span data-testid={`contrib-photos-${session.sessionId}-${c.userId}`}>{c.photoCount} photos</span>
                                    <span data-testid={`contrib-reels-${session.sessionId}-${c.userId}`}>{c.reelCount} reels</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {stats.roleComparison && <RoleComparisonSection roleComparison={stats.roleComparison} />}
      </div>
    </div>
  );
}

const ROLE_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  Owner: { bar: "bg-blue-500", text: "text-blue-700 dark:text-blue-400", bg: "bg-blue-500/10" },
  Editor: { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  Tester: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10" },
  Viewer: { bar: "bg-purple-500", text: "text-purple-700 dark:text-purple-400", bg: "bg-purple-500/10" },
};

const ROLE_ORDER: ("Owner" | "Editor" | "Tester" | "Viewer")[] = ["Owner", "Editor", "Tester", "Viewer"];

function RoleComparisonSection({ roleComparison }: { roleComparison: RoleComparison }) {
  const metrics: { key: keyof RoleMetrics; label: string; format: (v: number) => string }[] = [
    { key: "entries", label: "Entries", format: (v) => v.toLocaleString() },
    { key: "footage", label: "Footage (ft)", format: (v) => v.toLocaleString() },
    { key: "reels", label: "Reels", format: (v) => v.toLocaleString() },
    { key: "photos", label: "Photos", format: (v) => v.toLocaleString() },
  ];

  const currentUserRoles = roleComparison.currentUserRoles || [];
  const isCurrentUserRole = (role: string) => currentUserRoles.includes(role);

  return (
    <section className="space-y-4" data-testid="section-role-comparison">
      <SectionHeading icon={<Shield className="h-4 w-4" />} title="Role Comparison" testId="text-role-comparison-title" />

      <div className="flex flex-wrap gap-2 mb-2">
        {ROLE_ORDER.map((role) => {
          const hasData = roleComparison[role].entries > 0 || roleComparison[role].footage > 0 ||
            roleComparison[role].reels > 0 || roleComparison[role].photos > 0;
          const colors = ROLE_COLORS[role];
          const isYou = isCurrentUserRole(role);
          return (
            <span
              key={role}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${isYou ? `ring-2 ring-primary/40 ${colors.bg} ${colors.text}` : hasData ? `${colors.bg} ${colors.text}` : "bg-muted text-muted-foreground opacity-50"}`}
              data-testid={`role-badge-${role.toLowerCase()}`}
            >
              <span className={`w-2 h-2 rounded-full ${hasData ? colors.bar : "bg-muted-foreground/30"}`} />
              {role}{isYou ? " (you)" : ""}
            </span>
          );
        })}
      </div>

      {metrics.map((metric) => {
        const maxVal = Math.max(...ROLE_ORDER.map((r) => roleComparison[r][metric.key]), 1);
        return (
          <Card key={metric.key} data-testid={`role-metric-card-${metric.key}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{metric.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {ROLE_ORDER.map((role) => {
                  const value = roleComparison[role][metric.key];
                  const hasValue = value > 0;
                  const colors = ROLE_COLORS[role];
                  const isYou = isCurrentUserRole(role);
                  return (
                    <div
                      key={role}
                      className={`flex items-center gap-2 ${isYou ? "bg-primary/5 rounded-md px-1.5 py-0.5 ring-1 ring-primary/20" : ""} ${!hasValue && !isYou ? "opacity-40" : ""}`}
                      data-testid={`role-bar-${metric.key}-${role.toLowerCase()}`}
                    >
                      <span className={`w-14 text-xs font-medium shrink-0 ${isYou ? "text-primary font-semibold" : hasValue ? colors.text : "text-muted-foreground"}`}>
                        {role}
                      </span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${hasValue ? colors.bar : "bg-muted-foreground/20"}`}
                          style={{ width: `${(value / maxVal) * 100}%`, minWidth: hasValue ? 4 : 0 }}
                        />
                      </div>
                      <span className={`text-xs mono shrink-0 w-16 text-right ${isYou ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                        {metric.format(value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function SectionHeading({ icon, title, testId }: { icon: React.ReactNode; title: string; testId: string }) {
  return (
    <div className="flex items-center gap-2 mb-3" data-testid={testId}>
      <div className="text-primary">{icon}</div>
      <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
      <div className="flex-1 h-px bg-border ml-2" />
    </div>
  );
}

function StatCard({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: string | number; testId: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1 text-muted-foreground">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-lg font-bold mono" data-testid={testId}>{value}</p>
      </CardContent>
    </Card>
  );
}
