"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  resetLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          aria-label="error-boundary-fallback"
          className="rounded-lg border border-border bg-surface p-6"
          style={{ borderLeftColor: "var(--status-critical)", borderLeftWidth: "4px" }}
        >
          <div className="space-y-4">
            <div>
              <h2 className="font-mono text-lg font-semibold text-text-primary">
                Something went wrong
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {this.state.error?.message ?? "An unexpected error occurred"}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-hover"
            >
              {this.props.resetLabel ?? "Try again"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
