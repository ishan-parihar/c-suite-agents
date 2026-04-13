"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-status-critical/10">
            <AlertTriangle className="h-8 w-8 text-status-critical" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary mb-2">
            Application Error
          </h1>
          <p className="text-sm text-text-muted mb-6">
            A critical error occurred. Please try refreshing the page.
          </p>
          {error.digest && (
            <p className="text-xs text-text-muted font-mono mb-6">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover"
          >
            <RefreshCw className="h-4 w-4" />
            Reload Application
          </button>
        </div>
      </body>
    </html>
  );
}
