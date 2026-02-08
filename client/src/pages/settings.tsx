import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Settings, Shield, ShieldOff, AlertTriangle, Lock,
  Unlock, Loader2, Cable, LogOut, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UserSettingsResponse {
  userId: string;
  encodingEnabled: boolean;
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);

  const { data: settings, isLoading } = useQuery<UserSettingsResponse>({
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
            <ThemeToggle />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => logout()}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your account preferences and data security.
          </p>
        </div>

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

            {isLoading ? (
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">Important: Encoding Limitations</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-3">
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
                    <p className="text-sm font-medium">AI Assist still works normally</p>
                    <p className="text-xs text-muted-foreground">
                      AI image analysis reads directly from photos, not from stored entries, so it continues to work. 
                      However, any AI-suggested values you save will be encoded before storage.
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cable className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Account</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-medium" data-testid="text-settings-username">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-muted-foreground">Signed in via Replit</p>
              </div>
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
