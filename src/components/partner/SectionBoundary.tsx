import type { ReactNode } from "react";
import { AlertTriangle, LayoutDashboard, RefreshCcw, RotateCw } from "lucide-react";
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
 * Las secciones pesadas se cargan aparte (React.lazy). Si su fichero no se
 * puede descargar (sin red, o se ha publicado una versión nueva y el
 * fichero antiguo ya no existe), "Reintentar" no sirve: React recuerda el
 * fallo de la descarga. Entonces se ofrece recargar la página.
 *
 * Úsese con `key` = id de la sección, para que cambiar de sección monte un
 * boundary limpio.
 *
 * El aviso sustituye a la sección entera, título incluido: por eso su
 * encabezado es el h1 de la vista (y el que recibe el foco al cambiar de
 * sección). Fuera de <main>, como el del asistente de alta, va con
 * `nivelTitulo={2}` para no dejar dos h1.
 */
interface SectionBoundaryProps {
  /** Id de la sección (tag `partner_section` en Sentry). */
  sectionId: string;
  /** Vuelve a Métricas. Sin él (p. ej. si la que falla es Métricas) no se ofrece el botón. */
  onGoHome?: () => void;
  /** Texto del botón de onGoHome (por defecto, "Ir a Métricas"). */
  goHomeLabel?: string;
  /** Nivel del encabezado del aviso (por defecto 1: ocupa el sitio de la sección). */
  nivelTitulo?: 1 | 2;
  children: ReactNode;
}

/** Fallo al descargar un chunk de React.lazy (import dinámico). */
const CHUNK_ERROR_RE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .* failed|dynamically imported module/i;

const isChunkLoadError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return CHUNK_ERROR_RE.test(message) || (error instanceof Error && error.name === "ChunkLoadError");
};

export const SectionBoundary = ({
  sectionId,
  onGoHome,
  goHomeLabel = "Ir a Métricas",
  nivelTitulo = 1,
  children,
}: SectionBoundaryProps) => (
  <Sentry.ErrorBoundary
    beforeCapture={(scope) => {
      scope.setTag("partner_section", sectionId);
    }}
    fallback={({ error, resetError }) => {
      const chunk = isChunkLoadError(error);
      const Titulo = nivelTitulo === 1 ? "h1" : "h2";
      return (
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
          <Titulo className="text-xl font-semibold tracking-tight text-foreground">
            Esta sección ha fallado
          </Titulo>
          <p className="mt-2 text-sm text-muted-foreground">
            {chunk
              ? "No se ha podido descargar esta parte del panel: puede que no haya conexión o que haya una versión nueva. Recarga la página para seguir."
              : "Algo no ha ido bien al mostrarla. El resto del panel sigue funcionando: puedes reintentarlo."}
          </p>
          {/* 44 px de alto en móvil (zona táctil). */}
          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {chunk ? (
              <Button type="button" className="h-11 sm:h-10" onClick={() => window.location.reload()}>
                <RotateCw className="mr-2 h-4 w-4" />
                Recargar
              </Button>
            ) : (
              <Button type="button" className="h-11 sm:h-10" onClick={() => resetError()}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Reintentar
              </Button>
            )}
            {onGoHome && (
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-10"
                onClick={() => {
                  resetError();
                  onGoHome();
                }}
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                {goHomeLabel}
              </Button>
            )}
          </div>
        </div>
      );
    }}
  >
    {children}
  </Sentry.ErrorBoundary>
);

export default SectionBoundary;
