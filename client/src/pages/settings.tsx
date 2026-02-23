import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Settings, Shield, ShieldOff, AlertTriangle, Lock,
  Unlock, Loader2, Cable, LogOut, Info, Pencil, Check, X, Mail,
  Download, Camera, Keyboard, Sun, Moon, Monitor, Image, Target,
  ChevronDown, Ruler, Building2, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-toggle";
import HelpMenu from "@/components/HelpMenu";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/lib/theme-provider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UserSettingsResponse {
  userId: string;
  encodingEnabled: boolean;
  defaultExportFormat: string;
  companyName: string | null;
  companyLogoKey: string | null;
  exportFooterText: string | null;
  photoQuality: number;
  useReceivingQuality: boolean;
  receivingPhotoQuality: number;
  defaultAislePrefix: string | null;
  sectionAdvanceStep: number;
  defaultUnit: string;
  defaultTheme: string;
  thumbnailSize: string;
  largerTouchTargets: boolean;
  textSize: string;
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { setThemeMode } = useTheme();
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [limitationsOpen, setLimitationsOpen] = useState(false);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
    }
  }, [user]);

  const updateName = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string }) => {
      const res = await apiRequest("PATCH", "/api/user/profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setEditingName(false);
      toast({ title: "Name updated" });
    },
    onError: () => {
      toast({ title: "Failed to update name", variant: "destructive" });
    },
  });

  const { data: settings, isLoading, isError: settingsError } = useQuery<UserSettingsResponse>({
    queryKey: ["/api/settings"],
  });

  const toggleEncoding = useMutation({
    mutationFn: async ({ enabled }: { enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/settings/encoding", { enabled });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      if (data.encodingEnabled) {
        toast({ title: "Data encoding enabled", description: `${data.entriesEncoded || 0} entries have been encoded.` });
      } else {
        toast({ title: "Data encoding disabled", description: `${data.entriesDecoded || 0} entries have been decoded.` });
      }
    },
    onError: () => {
      toast({ title: "Failed to change encoding setting", variant: "destructive" });
    },
  });

  const updateSetting = useMutation({
    mutationFn: async (data: Partial<UserSettingsResponse>) => {
      const res = await apiRequest("PATCH", "/api/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => {
      toast({ title: "Failed to save setting", variant: "destructive" });
    },
  });

  const saveSetting = (field: string, value: any) => {
    updateSetting.mutate({ [field]: value } as any);
  };

  const encodingEnabled = settings?.encodingEnabled ?? false;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-3 max-w-3xl mx-auto">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setLocation("/")}
              data-testid="button-back-dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Settings className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Settings</span>
          </div>
          <div className="flex items-center gap-1">
            <HelpMenu mode="dashboard" />
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => logout()}
              data-testid="button-logout"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 pb-[50vh] space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your account preferences, display, and data options.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Display</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Theme</Label>
                <p className="text-xs text-muted-foreground">Choose your preferred color theme.</p>
              </div>
              <Select
                value={settings?.defaultTheme || "system"}
                onValueChange={(val) => {
                  saveSetting("defaultTheme", val);
                  setThemeMode(val as "light" | "dark" | "system");
                }}
                data-testid="select-default-theme"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light"><span className="flex items-center gap-2"><Sun className="h-3.5 w-3.5" /> Light</span></SelectItem>
                  <SelectItem value="dark"><span className="flex items-center gap-2"><Moon className="h-3.5 w-3.5" /> Dark</span></SelectItem>
                  <SelectItem value="system"><span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> System</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Dashboard Thumbnail Size</Label>
                <p className="text-xs text-muted-foreground">Size of session preview images on the dashboard.</p>
              </div>
              <Select
                value={settings?.thumbnailSize || "medium"}
                onValueChange={(val) => saveSetting("thumbnailSize", val)}
                data-testid="select-thumbnail-size"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-thumbnail">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Accessibility</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Larger Touch Targets</Label>
                <p className="text-xs text-muted-foreground">Increases pin and button tap areas for easier interaction on mobile devices.</p>
              </div>
              <Switch
                checked={settings?.largerTouchTargets ?? false}
                onCheckedChange={(checked) => saveSetting("largerTouchTargets", checked)}
                data-testid="switch-larger-touch-targets"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Text Size</Label>
                <p className="text-xs text-muted-foreground">Adjust the base text size across the app. Disabled during Mobile Flow.</p>
              </div>
              <Select
                value={settings?.textSize || "default"}
                onValueChange={(val) => saveSetting("textSize", val)}
                data-testid="select-text-size"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-text-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small"><span style={{ fontSize: "12px" }}>Small</span></SelectItem>
                  <SelectItem value="default"><span style={{ fontSize: "14px" }}>Default</span></SelectItem>
                  <SelectItem value="large"><span style={{ fontSize: "17px" }}>Large</span></SelectItem>
                  <SelectItem value="extra-large"><span style={{ fontSize: "20px" }}>Extra Large</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Data Entry</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Default Aisle Prefix</Label>
                <p className="text-xs text-muted-foreground">Auto-fill the aisle field with this value for new entries.</p>
              </div>
              <Input
                className="w-[140px]"
                placeholder="e.g. Receiving"
                value={settings?.defaultAislePrefix || ""}
                onChange={(e) => saveSetting("defaultAislePrefix", e.target.value || null)}
                data-testid="input-default-aisle-prefix"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Section Auto-Advance Step</Label>
                <p className="text-xs text-muted-foreground">How much the section number increments automatically (e.g., 1 = 01, 02, 03; 2 = 01, 03, 05).</p>
              </div>
              <Select
                value={String(settings?.sectionAdvanceStep || 1)}
                onValueChange={(val) => saveSetting("sectionAdvanceStep", parseInt(val))}
                data-testid="select-section-advance"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-section-advance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (01, 02, 03...)</SelectItem>
                  <SelectItem value="2">2 (01, 03, 05...)</SelectItem>
                  <SelectItem value="3">3 (01, 04, 07...)</SelectItem>
                  <SelectItem value="5">5 (01, 06, 11...)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Default Unit of Measurement</Label>
                <p className="text-xs text-muted-foreground">Unit used for footage values across the app.</p>
              </div>
              <Select
                value={settings?.defaultUnit || "feet"}
                onValueChange={(val) => saveSetting("defaultUnit", val)}
                data-testid="select-default-unit"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feet">Feet (ft)</SelectItem>
                  <SelectItem value="meters">Meters (m)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Photo Capture</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <Label className="text-sm font-medium">Photo Quality</Label>
                  <p className="text-xs text-muted-foreground">Lower quality saves bandwidth but may reduce zoom clarity on reel labels. Higher quality preserves detail for accurate reading.</p>
                </div>
                <span className="text-sm font-mono font-semibold tabular-nums w-[3ch] text-right" data-testid="text-photo-quality-value">{settings?.photoQuality ?? 85}%</span>
              </div>
              <Slider
                value={[settings?.photoQuality ?? 85]}
                onValueCommit={(val) => saveSetting("photoQuality", val[0])}
                min={30}
                max={100}
                step={5}
                className="w-full"
                data-testid="slider-photo-quality"
              />
              <div className="relative w-full h-4 mt-0.5">
                {[30, 40, 50, 60, 70, 80, 85, 90, 95, 100].map((tick) => {
                  const pct = ((tick - 30) / 70) * 100;
                  const isSelected = (settings?.photoQuality ?? 85) === tick;
                  return (
                    <div
                      key={tick}
                      className="absolute flex flex-col items-center"
                      style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                    >
                      <div className={`w-px h-1.5 ${isSelected ? "bg-primary" : "bg-muted-foreground/40"}`} />
                      <span className={`text-[9px] tabular-nums ${isSelected ? "text-primary font-semibold" : "text-muted-foreground/60"}`}>
                        {tick}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t pt-3 mt-3">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="flex-1">
                  <Label className="text-sm font-medium">Receiving — Quality Override</Label>
                  <p className="text-xs text-muted-foreground">Reels in Receiving are typically photographed up close, so high zoom clarity isn't needed. Enable this to automatically use a lower quality for Receiving photos, saving bandwidth and storage.</p>
                </div>
                <Switch
                  checked={settings?.useReceivingQuality ?? false}
                  onCheckedChange={(checked) => saveSetting("useReceivingQuality", checked)}
                  data-testid="switch-receiving-quality"
                />
              </div>
              {settings?.useReceivingQuality && (
                <div className="pl-2 border-l-2 border-primary/20 ml-1 mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-4">
                    <Label className="text-xs text-muted-foreground">Receiving photo quality</Label>
                    <span className="text-sm font-mono font-semibold tabular-nums w-[3ch] text-right" data-testid="text-receiving-quality-value">{settings?.receivingPhotoQuality ?? 50}%</span>
                  </div>
                  <Slider
                    value={[settings?.receivingPhotoQuality ?? 50]}
                    onValueCommit={(val) => saveSetting("receivingPhotoQuality", val[0])}
                    min={30}
                    max={100}
                    step={5}
                    className="w-full"
                    data-testid="slider-receiving-quality"
                  />
                  <div className="relative w-full h-4 mt-0.5">
                    {[30, 40, 50, 60, 70, 80, 90, 100].map((tick) => {
                      const pct = ((tick - 30) / 70) * 100;
                      const isSelected = (settings?.receivingPhotoQuality ?? 50) === tick;
                      return (
                        <div
                          key={tick}
                          className="absolute flex flex-col items-center"
                          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                        >
                          <div className={`w-px h-1.5 ${isSelected ? "bg-primary" : "bg-muted-foreground/40"}`} />
                          <span className={`text-[9px] tabular-nums ${isSelected ? "text-primary font-semibold" : "text-muted-foreground/60"}`}>
                            {tick}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Export</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Default Export Format</Label>
                <p className="text-xs text-muted-foreground">Preferred format when exporting session data.</p>
              </div>
              <Select
                value={settings?.defaultExportFormat || "pdf"}
                onValueChange={(val) => saveSetting("defaultExportFormat", val)}
                data-testid="select-export-format"
              >
                <SelectTrigger className="w-[140px]" data-testid="select-trigger-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf"><span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> PDF</span></SelectItem>
                  <SelectItem value="csv"><span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> CSV</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm font-medium">Company Name</Label>
              <p className="text-xs text-muted-foreground">Appears in the header of exported PDF reports.</p>
              <Input
                placeholder="e.g. Acme Wire Co."
                value={settings?.companyName || ""}
                onChange={(e) => saveSetting("companyName", e.target.value || null)}
                data-testid="input-company-name"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm font-medium">PDF Footer Text</Label>
              <p className="text-xs text-muted-foreground">Custom text displayed at the bottom of each exported PDF page.</p>
              <Textarea
                placeholder="e.g. Confidential — Internal Use Only"
                value={settings?.exportFooterText || ""}
                onChange={(e) => saveSetting("exportFooterText", e.target.value || null)}
                rows={2}
                data-testid="input-export-footer"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Data Encoding</CardTitle>
              {encodingEnabled ? (
                <Badge variant="default" className="no-default-hover-elevate no-default-active-elevate" data-testid="badge-encoding-status">
                  <Lock className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate" data-testid="badge-encoding-status">
                  <Unlock className="h-3 w-3 mr-1" />
                  Off
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              When enabled, your reel entry data (wire type, gauge, color, reel tags, manufacturer, notes, pallet ID, and position) 
              will be encrypted in the database using AES-256 encryption. A unique encryption key is generated automatically 
              and secured by the server. The data is automatically decrypted when you view it in the app.
            </p>

            {settingsError ? (
              <div className="flex items-center gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <p className="text-sm">Failed to load encoding settings. Please try refreshing the page.</p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading settings...
              </div>
            ) : encodingEnabled ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-md bg-primary/10 border border-primary/20">
                  <Shield className="h-5 w-5 text-primary shrink-0" />
                  <p className="text-sm">
                    Your data is currently encoded. Entry details are stored as encrypted text in the database and decrypted on-the-fly when you access them.
                  </p>
                </div>

                <Button
                  variant="outline"
                  onClick={() => setConfirmDisableOpen(true)}
                  disabled={toggleEncoding.isPending}
                  data-testid="button-disable-encoding"
                >
                  {toggleEncoding.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ShieldOff className="h-4 w-4 mr-2" />
                  )}
                  Disable Encoding
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Encoding is currently off. Your entry data is stored as plain text in the database.
                  Enable encoding to encrypt sensitive fields automatically.
                </p>

                <Button
                  onClick={() => setConfirmEnableOpen(true)}
                  disabled={toggleEncoding.isPending}
                  data-testid="button-enable-encoding"
                >
                  {toggleEncoding.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Enable Encoding
                </Button>
              </div>
            )}

            <Separator />

            <Collapsible open={limitationsOpen} onOpenChange={setLimitationsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 px-2 w-full justify-start text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-semibold text-sm">Encoding Limitations</span>
                  <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${limitationsOpen ? "" : "-rotate-90"}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 mt-3 pl-1">
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">External API returns encoded data</p>
                      <p className="text-xs text-muted-foreground">
                        The Power Apps external API will return encrypted/unreadable values for encoded fields. 
                        Any systems pulling data via the external API will see encoded strings instead of readable text.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Manual entry and catalog autocomplete unaffected</p>
                      <p className="text-xs text-muted-foreground">
                        Category autocomplete and catalog lookup work from a built-in reference, not from stored entries. 
                        Any values you save will be encoded before storage.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">CSV/PDF exports are automatically decoded</p>
                      <p className="text-xs text-muted-foreground">
                        When you export data through the app, entries are decrypted before export so your files are readable. 
                        Only data accessed directly through the database or external APIs would appear encoded.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Toggling encoding migrates all existing entries</p>
                      <p className="text-xs text-muted-foreground">
                        When you turn encoding on, all your existing entries will be encrypted. When you turn it off, 
                        they will all be decrypted back to plain text. For large datasets this may take a moment.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Only entry details are encoded</p>
                      <p className="text-xs text-muted-foreground">
                        Encoding applies to text fields within entries (reel tags, wire type, gauge, color, manufacturer, notes, 
                        pallet ID, position). Session names, photo metadata, aisle/section identifiers, and numerical values 
                        like footage and reel counts remain unencoded for sorting and functionality.
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex gap-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Encryption key is managed automatically</p>
                      <p className="text-xs text-muted-foreground">
                        A unique encryption key is generated for your account and secured by the server. You don't need to 
                        remember a passphrase. The key is protected and cannot be read directly from the database.
                      </p>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cable className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Account</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingName ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-xs">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => updateName.mutate({ firstName, lastName })}
                    disabled={updateName.isPending || (!firstName.trim() && !lastName.trim())}
                    data-testid="button-save-name"
                  >
                    {updateName.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFirstName(user?.firstName || "");
                      setLastName(user?.lastName || "");
                      setEditingName(false);
                    }}
                    disabled={updateName.isPending}
                    data-testid="button-cancel-name"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-medium" data-testid="text-settings-username">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground">Signed in via Replit</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingName(true)}
                  data-testid="button-edit-name"
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit Name
                </Button>
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-end">
              <Button
                variant="outline"
                onClick={() => logout()}
                data-testid="button-settings-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Contact</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              Questions, feedback, or issues? Reach out to the developer.
            </p>
            <a
              href="mailto:makerdantheman@gmail.com"
              className="text-sm font-medium text-primary hover:underline"
              data-testid="link-contact-email"
            >
              makerdantheman@gmail.com
            </a>
            <p className="text-xs text-muted-foreground mt-1">Dan — Developer</p>
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={confirmEnableOpen} onOpenChange={setConfirmEnableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Data Encoding?</AlertDialogTitle>
            <AlertDialogDescription>
              This will encrypt all your existing entry data and all future entries using a secure, 
              automatically generated key. Your data will still be fully readable within the app, 
              but will appear as encrypted text if accessed directly from the database or external APIs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-enable-encoding">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleEncoding.mutate({ enabled: true })}
              data-testid="button-confirm-enable-encoding"
            >
              Enable Encoding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDisableOpen} onOpenChange={setConfirmDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Data Encoding?</AlertDialogTitle>
            <AlertDialogDescription>
              This will decrypt all your entry data back to plain text. Your data will then be stored 
              unencrypted in the database and visible through external APIs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-disable-encoding">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleEncoding.mutate({ enabled: false })}
              data-testid="button-confirm-disable-encoding"
            >
              Disable Encoding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
