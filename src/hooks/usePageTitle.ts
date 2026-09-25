import { useEffect, useRef, type RefObject } from "react";

/**
 * El título de la página, en sus dos sitios:
 *
 *   - La pestaña (`document.title`): usePageTitle.
 *   - El encabezado (h1) de la sección: useFocoAlTitulo le lleva el foco al
 *     cambiar de sección, y useCajonDeNavegacion evita que el cajón del menú
 *     se lo quite al cerrarse.
 */

/** «Mis entradas · Pasify». */
export const tituloDePagina = (texto: string) => `${texto} · Pasify`;

/**
 * Pone el título de la pestaña («<texto> · Pasify») mientras el componente
 * está montado y, al desmontarse, deja el que había antes.
 *
 * Sin texto (null, undefined o vacío) no lo toca: una página que aún está
 * cargando su dato (el nombre del evento o del local) deja el anterior y lo
 * cambia en cuanto lo tiene.
 */
export function usePageTitle(texto: string | null | undefined): void {
  useEffect(() => {
    const anterior = document.title;
    return () => {
      document.title = anterior;
    };
  }, []);

  useEffect(() => {
    const limpio = texto?.trim();
    if (limpio) document.title = tituloDePagina(limpio);
  }, [texto]);
}

/**
 * Tiempo máximo esperando a que la sección nueva pinte su h1 (las pesadas se
 * descargan aparte) o a que termine de cerrarse el diálogo que tapa la página.
 */
const ESPERA_MAXIMA_MS = 4_000;

/**
 * Al cambiar de sección (`clave`), lleva el foco al título (el h1) de la
 * nueva, dentro de `contenedor` (el <main> del panel): el lector de pantalla
 * lo anuncia y el teclado sigue desde ahí, en vez de quedarse en el menú. En
 * la primera carga no hace nada: el foco empieza arriba, en «Saltar al
 * contenido».
 *
 *   - Si la sección aún no ha pintado su h1, o un diálogo modal (el cajón del
 *     menú, cerrándose) tapa la página con aria-hidden, espera un poco.
 *   - Si entretanto el usuario lleva el foco a otra parte, no se lo quita.
 *   - Si no aparece ningún h1 a tiempo, el foco va al propio contenedor.
 *
 * El h1 recibe tabindex="-1" (enfocable por código, fuera del orden del Tab).
 */
export function useFocoAlTitulo(clave: string, contenedor: RefObject<HTMLElement>): void {
  const claveAnterior = useRef(clave);

  useEffect(() => {
    if (claveAnterior.current === clave) return;
    claveAnterior.current = clave;

    // Donde estaba el foco al cambiar: el botón del menú que se ha pulsado.
    const origen = document.activeElement;
    const limite = performance.now() + ESPERA_MAXIMA_MS;
    let frame = 0;

    const intentar = () => {
      frame = 0;
      const raiz = contenedor.current;
      if (!raiz?.isConnected) return;
      const activo = document.activeElement;
      if (activo && activo !== document.body && activo !== origen) return;
      const tapada = raiz.closest('[aria-hidden="true"]') !== null;
      const titulo = tapada ? null : raiz.querySelector<HTMLElement>("h1");
      if (titulo) {
        enfocar(titulo);
      } else if (performance.now() < limite) {
        frame = requestAnimationFrame(intentar);
      } else if (!tapada) {
        enfocar(raiz);
      }
    };

    intentar();
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [clave, contenedor]);
}

function enfocar(elemento: HTMLElement) {
  if (!elemento.hasAttribute("tabindex")) elemento.setAttribute("tabindex", "-1");
  elemento.focus();
}

/**
 * Props para el SheetContent del cajón del menú (móvil). Al cerrarse, un
 * diálogo devuelve el foco al botón que lo abrió; si desde el cajón se ha
 * cambiado de sección, eso le quitaría el foco al título de la nueva (lo pone
 * ahí useFocoAlTitulo). Si se cierra sin cambiar de sección (Escape, la X,
 * tocar fuera o la misma sección), el foco vuelve al botón como siempre.
 */
export function useCajonDeNavegacion(seccion: string) {
  const seccionAlAbrir = useRef(seccion);
  return {
    onOpenAutoFocus: () => {
      seccionAlAbrir.current = seccion;
    },
    onCloseAutoFocus: (evento: Event) => {
      if (seccion !== seccionAlAbrir.current) evento.preventDefault();
    },
  };
}
