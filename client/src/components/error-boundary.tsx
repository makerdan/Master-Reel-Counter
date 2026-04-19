import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Card className="w-full max-w-sm border border-destructive/30">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
              <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
              <p className="text-sm text-muted-foreground mb-6">
                An unexpected error occurred. You can try again or go back to the dashboard.
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { window.location.href = "/"; }}
                  data-testid="button-error-home"
                >
                  Dashboard
                </Button>
                <Button
                  size="sm"
                  onClick={this.handleReset}
                  data-testid="button-error-retry"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
