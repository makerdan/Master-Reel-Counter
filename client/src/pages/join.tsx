import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle, AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

export default function JoinPage() {
  const [, params] = useRoute("/join/:token");
  const [, setLocation] = useLocation();
  const token = params?.token || "";

  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/join/${token}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (token) {
      joinMutation.mutate();
    }
  }, [token]);

  if (joinMutation.isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" data-testid="loading-join" />
            <p className="text-muted-foreground">Joining session...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinMutation.isError) {
    const rawMsg = (joinMutation.error as Error)?.message || "";
    let errorMsg = "This invite link may be invalid or expired.";
    try {
      const jsonPart = rawMsg.substring(rawMsg.indexOf("{"));
      const parsed = JSON.parse(jsonPart);
      if (parsed.message) errorMsg = parsed.message;
    } catch {
      if (rawMsg.includes("401")) errorMsg = "Please log in to join this session.";
    }
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <p className="font-semibold" data-testid="text-join-error">Unable to join session</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-dashboard">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinMutation.isSuccess) {
    const data = joinMutation.data;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle className="h-8 w-8 text-green-600 mx-auto" />
            <p className="font-semibold" data-testid="text-join-success">
              {data.alreadyMember ? "You already have access" : "Successfully joined!"}
            </p>
            <p className="text-sm text-muted-foreground">
              Session: <span className="font-medium">{data.session?.name}</span>
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button onClick={() => setLocation(`/session/${data.session?.id}`)} data-testid="button-go-session">
                <Users className="h-4 w-4 mr-1" />
                Open Session
              </Button>
              <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-go-dashboard">
                Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
