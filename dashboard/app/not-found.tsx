"use client";

import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div
      role="region"
      aria-label="not-found"
      className="flex min-h-[60vh] items-center justify-center"
    >
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(255, 255, 255, 0.04)" }}
          >
            <FileQuestion
              className="h-10 w-10"
              style={{ color: "var(--text-muted)" }}
            />
          </div>
        </div>

        <h1
          className="mb-3 font-mono text-3xl font-semibold text-text-primary"
        >
          Page Not Found
        </h1>

        <p className="mb-8 text-text-secondary">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-md border border-border bg-surface px-6 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-hover"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
