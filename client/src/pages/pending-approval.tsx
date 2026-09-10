import { Cable, Clock, LogOut, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

type IdentityStatus = "pending" | "rejected" | "not-provisioned" | "service-error";

export default function PendingApproval({ status = "pending" }: { status?: IdentityStatus }) {
  const {
    user,
    logout,
    refreshIdentity,
    isRefreshingIdentity,
  } = useAuth();
  const isRejected = status === "rejected";
  const isNotProvisioned = status === "not-provisioned";
  const isServiceError = status === "service-error";
  const canRefresh = !isRejected;

  const handleRefresh = () => {
    void refreshIdentity();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full" data-testid={`card-identity-${status}`}>
        <CardContent className="pt-8 pb-6 px-6 text-center space-y-6">
          <div className="flex items-center justify-center">
            <div className="p-4 rounded-full bg-amber-100 dark:bg-amber-900/30">
              {isServiceError || isNotProvisioned
                ? <TriangleAlert className="h-10 w-10 text-amber-600 dark:text-amber-400" />
                : <Clock className="h-10 w-10 text-amber-600 dark:text-amber-400" />}
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-pending-title">
              {isServiceError
                ? "Service temporarily unavailable"
                : isNotProvisioned
                  ? "Account not provisioned"
                  : isRejected
                    ? "Access Denied"
                    : "Pending Approval"}
            </h1>
            <p className="text-muted-foreground" data-testid="text-pending-message">
              {isServiceError
                ? "We couldn't confirm your account right now. Try again in a moment."
                : isNotProvisioned
                  ? "Your sign-in is recognized, but this app account has not been provisioned yet. Contact the app owner, then try again."
                  : isRejected
                    ? "This account is not authorized to access Master Reel Counter. Contact the app owner if you believe this is an error."
                    : `Hi ${user?.firstName || "there"}, your account is awaiting approval from the app owner. You'll be able to access the app once you've been approved.`}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Cable className="h-4 w-4 text-amber-500" />
            <span>Master Reel Counter</span>
          </div>

          <div className="space-y-3">
            {canRefresh && (
              <Button
                onClick={handleRefresh}
                className="w-full"
                disabled={isRefreshingIdentity}
                data-testid="button-refresh-identity"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshingIdentity ? "animate-spin" : ""}`} />
                {isRefreshingIdentity ? "Checking status…" : "Check status"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void logout()}
              className="w-full"
              data-testid="button-pending-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
