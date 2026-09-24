import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Actualizando…" discreto mientras se refrescan en segundo plano unos datos
 * que ya se están enseñando (la caché pinta lo de antes y trae lo nuevo).
 *
 * Solo aparece si el refresco dura más de `delayMs`: la mayoría terminan antes
 * y así no parpadea nada. Nunca sustituye al contenido.
 */
export const RefreshIndicator = ({
  active,
  label = "Actualizando…",
  delayMs = 350,
  className,
}: {
  active: boolean;
  label?: string;
  delayMs?: number;
  className?: string;
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);

  if (!visible) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2.5 py-0.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
};

export default RefreshIndicator;
