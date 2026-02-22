import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, BarChart3, Package, Ruler, Camera, CheckCircle, Clock, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

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

  const hasNoData = stats.totalSessions === 0 && stats.totalEntries === 0;

  const maxWeeklyFootage = Math.max(...stats.weeklyStats.map(w => w.footage), 1);
  const maxWeeklyEntries = Math.max(...stats.weeklyStats.map(w => w.entries), 1);
  const maxCatCount = Math.max(...stats.topCategories.map(c => c.count), 1);
  const maxMfgCount = Math.max(...stats.topManufacturers.map(m => m.count), 1);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <Button size="icon" variant="ghost" onClick={() => setLocation("/")} data-testid="button-back-stats">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-semibold underline" data-testid="text-stats-title">Summary Stats</h1>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-4 pb-[50vh] space-y-6">
        {hasNoData ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No data yet. Start counting reels to see your stats here.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Total Sessions:" value={stats.totalSessions} testId="stat-total-sessions" />
              <StatCard icon={<CheckCircle className="h-4 w-4" />} label="Completed:" value={stats.completedSessions} testId="stat-completed" />
              <StatCard icon={<Package className="h-4 w-4" />} label="Total Reels:" value={stats.totalReels.toLocaleString()} testId="stat-total-reels" />
              <StatCard icon={<Ruler className="h-4 w-4" />} label="Total Footage:" value={`${stats.totalFootage.toLocaleString()} ft`} testId="stat-total-footage" />
              <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Total Entries:" value={stats.totalEntries.toLocaleString()} testId="stat-total-entries" />
              <StatCard icon={<Camera className="h-4 w-4" />} label="Total Photos:" value={stats.totalPhotos.toLocaleString()} testId="stat-total-photos" />
              <StatCard icon={<Clock className="h-4 w-4" />} label="Active Sessions:" value={stats.activeSessions} testId="stat-active" />
              <StatCard
                icon={<Ruler className="h-4 w-4" />}
                label="Avg Footage/Session:"
                value={stats.totalSessions > 0 ? `${Math.round(stats.totalFootage / stats.totalSessions).toLocaleString()} ft` : "0 ft"}
                testId="stat-avg-footage"
              />
            </div>

            {stats.weeklyStats.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Weekly Activity:</CardTitle>
                </CardHeader>
                <CardContent>
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
            )}

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
      </div>
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
