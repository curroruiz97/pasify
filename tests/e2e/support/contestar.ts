import type { Page, Request } from "@playwright/test";
import { FAKE_SUPABASE_URL } from "./fake-supabase";

/**
 * Contesta una ruta concreta del Supabase falso (REST, RPC o functions) por
 * encima de support/fake-supabase.ts: en Playwright la última ruta registrada
 * va primero. Sirve para preparar la respuesta de una RPC o de una edge
 * function y para contar cuántas veces se llama.
 *
 * `manejar` devuelve la respuesta o `undefined` para que la conteste el falso.
 * Los OPTIONS (preflight de CORS) se contestan aquí.
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

export type RespuestaPropia = { status?: number; body?: unknown };

export async function contestar(page: Page, ruta: string, manejar: (req: Request) => RespuestaPropia | undefined) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === ruta,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") {
        const cabeceras = req.headers();
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": cabeceras["origin"] ?? "*",
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": cabeceras["access-control-request-method"] ?? "GET, POST",
            "access-control-allow-headers": cabeceras["access-control-request-headers"] ?? "*",
          },
        });
      }
      const respuesta = manejar(req);
      if (respuesta === undefined) return route.fallback();
      const cuerpo = respuesta.body === undefined ? "" : JSON.stringify(respuesta.body);
      await route.fulfill({
        status: respuesta.status ?? 200,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "content-range, x-supabase-api-version",
          ...(cuerpo ? { "content-type": "application/json; charset=utf-8" } : {}),
        },
        body: cuerpo,
      });
    },
  );
}

/** El cuerpo JSON de la petición (RPC y functions), o {} si no hay o no es JSON. */
export const cuerpoJson = (req: Request): Record<string, unknown> => {
  try {
    return (req.postDataJSON() as Record<string, unknown> | null) ?? {};
  } catch {
    return {};
  }
};
