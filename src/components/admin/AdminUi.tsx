import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mono } from "./adminFormat";

/** Piezas comunes de las secciones de dinero y pedidos del panel de admin. */

/** Píldora de estado (mismo estilo que la cola de reembolsos). */
export const Chip = ({ children, color }: { children: ReactNode; color: string }) => (
  <span
    className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] uppercase"
    style={{
      ...mono,
      letterSpacing: "0.16em",
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
    }}
  >
    {children}
  </span>
);

export const ErrorCard = ({
  mensaje,
  onRetry,
  className = "mb-4",
}: {
  mensaje: string;
  onRetry?: () => void;
  className?: string;
}) => (
  <div
    role="alert"
    className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${className}`}
    style={{ borderColor: "rgba(229,72,77,0.45)", background: "rgba(229,72,77,0.06)" }}
  >
    <span className="flex items-start gap-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      {mensaje}
    </span>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Reintentar
      </Button>
    )}
  </div>
);

/** Rótulo pequeño en mayúsculas (cabecera de un bloque). */
export const Eyebrow = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`text-[10px] uppercase text-muted-foreground ${className}`} style={{ ...mono, letterSpacing: "0.18em" }}>
    {children}
  </div>
);
