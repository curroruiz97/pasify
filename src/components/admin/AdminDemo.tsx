import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Piezas del modo demo del panel de admin (flag admin_showcase).
 *
 * Los módulos maqueta (Organizaciones, Finanzas, Inteligencia, Trust &
 * Safety, Compliance, Benchmarks, Live Pulse) solo se ven en modo demo, con
 * la franja "DEMO · datos ficticios" arriba y sus botones sin efecto
 * desactivados con el rótulo "Demo".
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** Franja de las secciones maqueta: nadie debe confundirlas con datos reales. */
export const DemoBanner = ({ children }: { children?: ReactNode }) => (
  <div
    role="note"
    className="mb-6 flex flex-col gap-1 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
    style={{ background: "rgba(232,176,76,0.12)", borderColor: "rgba(232,176,76,0.45)" }}
  >
    <span
      className="shrink-0 text-[11px] font-semibold uppercase"
      style={{ ...mono, letterSpacing: "0.22em", color: "#E8B04C" }}
    >
      DEMO · datos ficticios
    </span>
    <span className="text-[12px] text-muted-foreground">
      {children ??
        "Módulo de demostración: los locales, personas, cifras y alertas son inventados y los botones no hacen nada."}
    </span>
  </div>
);

/** Rótulo de una acción de maqueta. */
export const DemoTag = () => (
  <span
    className="ml-1.5 rounded border border-current px-1 py-px text-[9px] font-medium uppercase leading-none opacity-70"
    style={{ ...mono, letterSpacing: "0.14em" }}
  >
    Demo
  </span>
);

/** Botón de maqueta: siempre desactivado y con el rótulo "Demo". */
export const DemoButton = ({ children, ...props }: Omit<ButtonProps, "disabled" | "onClick">) => (
  <Button {...props} disabled aria-disabled="true" title="Maqueta: este botón no hace nada">
    {children}
    <DemoTag />
  </Button>
);
