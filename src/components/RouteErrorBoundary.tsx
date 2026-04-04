import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Sentry } from '@/lib/sentry';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Per-route error boundary that catches rendering errors
 * and reports them to Sentry without crashing the entire app.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <div className="text-center max-w-md space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">
              {this.props.fallbackTitle ?? 'Something went wrong'}
            </h2>
            <p className="text-sm text-muted-foreground">
              This page encountered an error. Try refreshing or navigating back.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => window.history.back()}>
                Go back
              </Button>
              <Button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                Refresh page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
