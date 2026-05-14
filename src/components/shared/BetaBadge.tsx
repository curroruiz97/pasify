import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * BetaBadge — etiqueta honesta para features con datos simulados.
 *
 * Pasify tiene una serie de features (Door Vision, AutoPilot, Modo en
 * vivo del cliente, refer-a-friend) cuyo backend o infra externa
 * todavía no existe pero cuya UI está en producción para enseñar la
 * dirección del producto. En lugar de fingir que funcionan, las
 * marcamos visible y consistentemente con este badge — el usuario sabe
 * que está viendo un preview, no datos reales.
 *
 * Estilo: pill mono uppercase, terracota acuoso, alineado con el resto
 * de chips editoriales del proyecto (`monoStyle`).
 *
 * Uso:
 *   <BetaBadge reason="Requiere cámaras IP + OCR. Vista con datos demo." />
 *
 * Coloca el badge cerca del título de la sección (esquina sup derecha
 * de la card o al lado del eyebrow). El tooltip aparece al hover.
 */

interface BetaBadgeProps {
  /** Texto del pill. Default "Beta · Datos simulados". */
  label?: string;
  /** Explicación detallada en el tooltip. */
  reason: string;
  /** Tamaño visual. Compact baja a font 9px. */
  variant?: "default" | "compact";
  className?: string;
}

const monoStyle: React.CSSProperties = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
  letterSpacing: "0.22em",
};

export const BetaBadge = ({
  label = "Beta · Datos simulados",
  reason,
  variant = "default",
  className,
}: BetaBadgeProps) => {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1.5 rounded-full border px-2.5 py-1 uppercase transition-colors",
              "border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/15",
              variant === "compact" ? "text-[9px]" : "text-[10px]",
              className
            )}
            style={monoStyle}
            data-pasify-beta-badge
          >
            <Sparkles
              className={cn(
                "shrink-0",
                variant === "compact" ? "h-2.5 w-2.5" : "h-3 w-3"
              )}
            />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="max-w-xs border-border bg-popover text-[12px] leading-relaxed text-foreground"
        >
          <p className="font-semibold text-orange-400">Vista previa de producto</p>
          <p className="mt-1 text-muted-foreground">{reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default BetaBadge;
