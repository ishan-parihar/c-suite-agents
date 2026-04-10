"use client";

import { useEffect } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[Route Error]", error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-label="error-boundary"
      className="flex min-h-[60vh] items-center justify-center"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-8"
        style={{ borderLeftColor: "var(--status-critical)", borderLeftWidth: "4px" }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
          >
            <AlertTriangle className="h-6 w-6" style={{ color: "var(--status-critical)" }} />
          </div>
          <div>
            <h2 className="font-mono text-xl font-semibold text-text-primary">
              Something went wrong
            </h2>
            <p className="text-sm text-text-muted">An unexpected error occurred</p>
          </div>
        </div>

        <div className="mb-6 rounded-md bg-elevated p-4 font-mono text-sm text-text-secondary">
          {error.message ?? "An unexpected error occurred"}
          {error.digest && (
            <div className="mt-2 text-xs text-text-muted">Error ID: {error.digest}</div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-hover"
          >
            Try again
          </button>
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover"
          >
            <ArrowLeft className="h-4 w-4" />
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
