"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title?: string;
  description?: string;
  itemName?: string;
}

export function DeleteDialog({
  open,
  onClose,
  onConfirm,
  title = "Delete Confirmation",
  description = "This action cannot be undone. The item will be permanently removed.",
  itemName,
}: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDeleting) onClose();
    },
    [onClose, isDeleting],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && !isDeleting) onClose();
  };

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[40] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-elevated shadow-2xl">
        <div className="px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-critical/10">
              <AlertTriangle className="h-5 w-5 text-critical" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-medium text-text-primary">{title}</h3>
              <p className="mt-1 text-sm text-text-secondary">
                {description}
                {itemName && (
                  <span className="mt-1 block font-mono text-xs text-text-muted">
                    &ldquo;{itemName}&rdquo;
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:bg-hover transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className={cn(
              "flex items-center gap-2 rounded-md bg-critical px-4 py-2 text-sm text-text-primary font-medium hover:bg-critical/90 transition-colors disabled:opacity-50",
            )}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
