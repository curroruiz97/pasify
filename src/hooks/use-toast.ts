/**
 * Compatibility shim — espone l'API `toast()` / `useToast()` di shadcn ma
 * renderizza tramite Sonner. Permette di migrare gradualmente le 59 chiamate
 * sparse senza un big-bang refactor.
 *
 * Le `variant` storiche vengono mappate sulle varianti Sonner:
 *   - "destructive" → toast.error
 *   - "default"     → toast (info)
 *
 * Per nuovi sviluppi preferire l'import diretto da "sonner":
 *   import { toast } from "sonner";
 *   toast.success("Ok");
 */

import * as React from "react";
import { toast as sonner } from "sonner";

type ToastVariant = "default" | "destructive";

interface LegacyToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

const renderText = (node: React.ReactNode): string =>
  typeof node === "string" || typeof node === "number" ? String(node) : "";

function toast(input: LegacyToastInput) {
  const title = renderText(input.title);
  const description = renderText(input.description);
  const opts = {
    description: description || undefined,
    duration: input.duration,
  };

  let id: string | number;
  if (input.variant === "destructive") {
    id = sonner.error(title || description || "Error", opts);
  } else {
    id = sonner(title || description || "", opts);
  }

  return {
    id: String(id),
    dismiss: () => sonner.dismiss(id),
    update: (next: LegacyToastInput) => {
      sonner.dismiss(id);
      toast(next);
    },
  };
}

function useToast() {
  return {
    toasts: [] as const, // legacy compat (Toaster shadcn non più necessario)
    toast,
    dismiss: (toastId?: string) => sonner.dismiss(toastId),
  };
}

export { useToast, toast };
