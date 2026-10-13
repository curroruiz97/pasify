import { useEffect, useState } from "react";

/**
 * ¿Se cumple esta media query? Se actualiza al cambiar el tamaño de la ventana
 * o girar el dispositivo. Para decidir QUÉ componente se pinta (un diálogo en
 * escritorio, una hoja desde abajo en el móvil); si solo cambia el aspecto,
 * mejor las clases responsive de Tailwind.
 *
 * Sin `matchMedia` (pruebas, un navegador muy viejo) devuelve `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const lee = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback);
  const [coincide, setCoincide] = useState(lee);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const lista = window.matchMedia(query);
    const alCambiar = () => setCoincide(lista.matches);
    alCambiar();
    lista.addEventListener("change", alCambiar);
    return () => lista.removeEventListener("change", alCambiar);
  }, [query]);

  return coincide;
}

/** Escritorio: el ancho de `lg` de Tailwind (1024 px) o más. */
export const useIsDesktop = (): boolean => useMediaQuery("(min-width: 1024px)");
