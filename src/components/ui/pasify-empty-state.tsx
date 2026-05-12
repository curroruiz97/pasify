import { ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface ActionConfig {
  label: string;
  onClick: () => void;
  variant?: "primary" | "ghost";
}

interface PasifyEmptyStateProps {
  /** Icono central (Lucide component pasado como children). */
  icon?: ReactNode;
  /** Eyebrow mono uppercase (default: "Vacío"). */
  eyebrow?: string;
  /** Título grande, acepta nodes para Instrument Serif italic. */
  title: ReactNode;
  /** Subtitle muted. */
  subtitle?: ReactNode;
  /** Botón primario. */
  action?: ActionConfig;
  /** Botón secundario. */
  secondaryAction?: ActionConfig;
  /** Loading state: muestra spinner en lugar del icono. */
  spin?: boolean;
  /** Compact: reduce padding (uso en listas internas). */
  compact?: boolean;
}

const monoStyle = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/**
 * Empty state editorial Pasify — halo pulsante terracota, eyebrow mono,
 * título Geist con espacio para italic Instrument Serif, subtitle ink-3,
 * CTAs warm gradient + ghost. Diseñado para dashboards y listas vacías.
 */
export const PasifyEmptyState = ({
  icon,
  eyebrow = "Vacío",
  title,
  subtitle,
  action,
  secondaryAction,
  spin,
  compact,
}: PasifyEmptyStateProps) => {
  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-card text-center ${
        compact ? "px-6 py-10" : "px-6 py-16 md:py-20"
      }`}
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      {/* Halo terracota top */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full"
        style={{ background: "rgba(232,84,42,0.16)", filter: "blur(70px)" }}
      />

      {icon && (
        <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
          {!spin && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
              style={{ background: "rgba(232,84,42,0.3)" }}
            />
          )}
          <div
            className="relative flex h-16 w-16 items-center justify-center rounded-full text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.6)",
            }}
          >
            {spin ? <Loader2 className="h-7 w-7 animate-spin" /> : icon}
          </div>
        </div>
      )}

      <div
        className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...monoStyle, letterSpacing: "0.22em" }}
      >
        <span className="inline-block h-px w-5 bg-orange-500/70" />
        {eyebrow}
        <span className="inline-block h-px w-5 bg-orange-500/70" />
      </div>

      <h3 className="max-w-md text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
        {title}
      </h3>

      {subtitle && (
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="group/cta inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                letterSpacing: "-0.005em",
              }}
            >
              {action.label}
              <span
                aria-hidden="true"
                className="inline-block transition-transform duration-200 group-hover/cta:translate-x-1"
              >
                →
              </span>
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PasifyEmptyState;
