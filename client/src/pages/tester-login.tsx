import { useState, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Cable, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getTesterOwnerFromSearch } from "@/lib/testerAccess";

export default function TesterLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const displayNameRef = useRef<HTMLInputElement>(null);

  const linkedOwner = getTesterOwnerFromSearch(search);
  const [displayName, setDisplayName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(linkedOwner);
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/tester-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: displayName.trim(),
          ownerUserId: ownerUserId.trim(),
          password: password.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Login failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !ownerUserId.trim() || !password.trim()) return;
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Cable className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">Master Reel Counter</span>
          </div>
          <CardTitle className="text-lg" data-testid="text-tester-login-title">Tester Login</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your name and the tester password to access the app.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Your Name</Label>
              <Input
                id="displayName"
                ref={displayNameRef}
                data-testid="input-display-name"
                placeholder="e.g. John"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerUserId">Owner Access Code</Label>
              <Input
                id="ownerUserId"
                data-testid="input-owner-access-code"
                placeholder="Enter the owner's access code"
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                autoComplete="off"
                readOnly={Boolean(linkedOwner)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Tester Password</Label>
              <Input
                id="password"
                data-testid="input-tester-password"
                type="password"
                placeholder="Enter tester password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending || !displayName.trim() || !ownerUserId.trim() || !password.trim()}
              data-testid="button-tester-login"
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              Sign In as Tester
            </Button>
          </form>
          <div className="mt-6 text-center">
            <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
              Back to home
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
