import type { ReactNode } from "react";
import { AlertTriangle, LayoutDashboard, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sentry } from "@/lib/sentry";

/**
 * SectionBoundary — red de seguridad de cada sección del panel de local.
 *
 * Un error de render en una sección (un dato con forma inesperada, una
 * variable fuera de ámbito como la de a70fde8) tumbaba el panel entero:
 * pantalla en blanco sin salida, justo lo que un revisor de Apple anota como
 * "la app falla". Con esto el fallo queda acotado a la sección, se reporta a
 * Sentry con la sección como tag y el usuario puede reintentar o volver a
 * Métricas.
 *
 * Úsese con `key` = id de la sección, para que cambiar de sección monte un
 * boundary limpio.
 */
interface SectionBoundaryProps {
  /** Id de la sección (tag `partner_section` en Sentry). */
  sectionId: string;
  /** Vuelve a Métricas. Sin él (p. ej. si la que falla es Métricas) no se ofrece el botón. */
  onGoHome?: () => void;
  children: ReactNode;
}

export const SectionBoundary = ({ sectionId, onGoHome, children }: SectionBoundaryProps) => (
  <Sentry.ErrorBoundary
    beforeCapture={(scope) => {
      scope.setTag("partner_section", sectionId);
    }}
    fallback={({ resetError }) => (
      <div
        role="alert"
        className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-border bg-card px-6 py-12 text-center"
      >
        <div
          className="mb-4 grid h-12 w-12 place-items-center rounded-2xl text-white"
          style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)" }}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Esta sección ha fallado
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo no ha ido bien al mostrarla. El resto del panel sigue funcionando: puedes
          reintentarlo o volver a Métricas.
        </p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button type="button" onClick={() => resetError()}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
          {onGoHome && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetError();
                onGoHome();
              }}
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Ir a Métricas
            </Button>
          )}
        </div>
      </div>
    )}
  >
    {children}
  </Sentry.ErrorBoundary>
);

export default SectionBoundary;
