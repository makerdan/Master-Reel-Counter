import { Cable, Clock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function PendingApproval() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full" data-testid="card-pending-approval">
        <CardContent className="pt-8 pb-6 px-6 text-center space-y-6">
          <div className="flex items-center justify-center">
            <div className="p-4 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Clock className="h-10 w-10 text-amber-600 dark:text-amber-400" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-pending-title">
              Pending Approval
            </h1>
            <p className="text-muted-foreground" data-testid="text-pending-message">
              Hi {user?.firstName || "there"}, your account is awaiting approval from the app owner. You'll be able to access the app once you've been approved.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Cable className="h-4 w-4 text-amber-500" />
            <span>Master Reel Counter</span>
          </div>

          <Button
            variant="outline"
            onClick={() => logout()}
            className="w-full"
            data-testid="button-pending-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
