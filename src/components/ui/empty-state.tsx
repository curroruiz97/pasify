import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Empty state riutilizzabile con illustrazione composta da icone Lucide
 * + decorazioni gradient. Sostituisce i muri "icona grigia + testo" sparsi.
 *
 * Esempio:
 *   <EmptyState
 *     icon={Calendar}
 *     title="Aún no hay eventos"
 *     description="Crea tu primer evento para empezar a recibir reservas."
 *     actionLabel="Crear evento"
 *     onAction={() => setOpen(true)}
 *     variant="primary"
 *   />
 */

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "default" | "primary" | "success" | "warning";
  className?: string;
}

const VARIANT_STYLES = {
  default: {
    bg: "from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900",
    iconBg: "bg-white dark:bg-slate-900",
    iconColor: "text-slate-400 dark:text-slate-500",
    glow: "bg-slate-200/40",
  },
  primary: {
    bg: "from-sky-100 to-blue-50 dark:from-sky-900/30 dark:to-blue-950/40",
    iconBg: "bg-white dark:bg-slate-900",
    iconColor: "text-sky-500",
    glow: "bg-sky-300/30",
  },
  success: {
    bg: "from-emerald-100 to-green-50 dark:from-emerald-900/30 dark:to-green-950/40",
    iconBg: "bg-white dark:bg-slate-900",
    iconColor: "text-emerald-500",
    glow: "bg-emerald-300/30",
  },
  warning: {
    bg: "from-amber-100 to-orange-50 dark:from-amber-900/30 dark:to-orange-950/40",
    iconBg: "bg-white dark:bg-slate-900",
    iconColor: "text-amber-500",
    glow: "bg-amber-300/30",
  },
};

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  variant = "default",
  className,
}: EmptyStateProps) => {
  const v = VARIANT_STYLES[variant];

  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-6 text-center", className)}>
      {/* Illustration: icon ring with gradient bg + glow */}
      <div className="relative mb-5">
        <div
          className={cn("absolute inset-0 rounded-full blur-2xl opacity-60", v.glow)}
          style={{ width: 96, height: 96, transform: "translate(-8px, -4px)" }}
        />
        <div
          className={cn(
            "relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br shadow-sm ring-1 ring-black/5",
            v.bg,
          )}
        >
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl shadow", v.iconBg)}>
            <Icon className={cn("h-6 w-6", v.iconColor)} strokeWidth={2} />
          </div>
        </div>
      </div>

      <h3 className="mb-1.5 text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}

      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          variant={variant === "default" ? "default" : "default"}
          size="sm"
          className="mt-5 rounded-full px-5"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
