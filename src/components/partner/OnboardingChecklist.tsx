import { CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Lista de primeros pasos del local (WP2.9 del plan): sustituye al asistente
 * de alta a pantalla completa, que bloqueaba el panel hasta rellenar cinco
 * pasos. Cada paso abre lo que hace falta y desaparece al completarse.
 */

export interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
}

export const OnboardingChecklist = ({
  steps,
  onDismiss,
}: {
  steps: ChecklistStep[];
  onDismiss: () => void;
}) => {
  const doneCount = steps.filter((s) => s.done).length;
  if (steps.length === 0 || doneCount === steps.length) return null;

  return (
    <section className="mb-6 rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Pon en marcha tu local</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {doneCount} de {steps.length} pasos hechos. Puedes usar el panel mientras tanto.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Ocultar los primeros pasos"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div>
                <div className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}>
                  {s.title}
                </div>
                {!s.done && <div className="text-xs text-muted-foreground">{s.description}</div>}
              </div>
            </div>
            {!s.done && (
              <Button size="sm" variant="outline" className="shrink-0" onClick={s.onAction}>
                {s.actionLabel}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};

export default OnboardingChecklist;
