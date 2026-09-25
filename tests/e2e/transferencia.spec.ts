import { expect, test, type Page, type Request } from "@playwright/test";
import { FAKE_SUPABASE_URL, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

/**
 * Aceptar una entrada enviada (B1-11) sin backend real:
 * `/#/transferencia?token=<token>`, el enlace del email de la transferencia.
 *
 * `accept-ticket-transfer` simulada con el contrato de la Ola 2:
 *   GET  ?token=  → { event: { title, date_start, venue_name, timezone },
 *                     tier_name, from_name, to_email_masked, status }
 *   POST { token } (con JWT) → { ticket_id }
 *
 * Lo que se protege:
 *   - Sin sesión: se ve de qué es la entrada y «Inicia sesión para
 *     recibirla» lleva al login con `next` de vuelta a la transferencia.
 *   - Con sesión: «Aceptar entrada» y a la cartera (/client-dashboard/wallet).
 *   - Otra cuenta que la del email (403): cambiar de cuenta.
 *   - Estados claros: caducada, ya aceptada, cancelada y enlace no válido.
 *
 * Corre con la config del panel (Supabase falso, un worker, hora de Madrid):
 * va en su `testMatch` y en el `testIgnore` de playwright.config.ts.
 *   npx playwright test -c playwright.partner.config.ts transferencia
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;
const TEXTO_DE_FALLO = /Algo no ha ido bien|Algo ha ido mal|Esta sección ha fallado/;

const TOKEN = "7a0e0000-0000-4000-8000-000000000001";
const TICKET = "7a0e0000-0000-4000-8000-000000000002";
const EMAIL_ENMASCARADO = "lo***@e2e.pasify.test";

const transferencia = (status: string) => ({
  event: {
    title: "Concierto E2E",
    date_start: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    venue_name: "Sala E2E · Principal",
    timezone: "Europe/Madrid",
  },
  tier_name: "Anticipada",
  from_name: "Ana García",
  to_email_masked: EMAIL_ENMASCARADO,
  status,
});

interface Opciones {
  sesion: boolean;
  estado?: string;
  /** Respuesta del POST (aceptar). Por defecto, aceptada. */
  aceptar?: { status: number; json: unknown };
}

interface Pagina {
  supabase: SupabaseFalso;
  errores: string[];
  /** Tokens pedidos por GET y cuerpos de los POST, en orden. */
  consultas: string[];
  aceptaciones: Record<string, unknown>[];
}

async function abrirTransferencia(page: Page, opciones: Opciones, token = TOKEN): Promise<Pagina> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, {
    roles: ["client"],
    sembrarSesion: opciones.sesion ? "siempre" : "nunca",
  });
  const pagina: Pagina = { supabase, errores, consultas: [], aceptaciones: [] };

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/functions/v1/accept-ticket-transfer",
    async (route) => {
      const req: Request = route.request();
      if (req.method() === "OPTIONS") return route.fallback();
      let status = 200;
      let json: unknown;
      if (req.method() === "GET") {
        pagina.consultas.push(new URL(req.url()).searchParams.get("token") ?? "");
        json = transferencia(opciones.estado ?? "pending");
      } else {
        pagina.aceptaciones.push((req.postDataJSON() as Record<string, unknown> | null) ?? {});
        const respuesta = opciones.aceptar ?? { status: 200, json: { ticket_id: TICKET } };
        status = respuesta.status;
        json = respuesta.json;
      }
      await route.fulfill({
        status,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(json),
      });
    },
  );

  await page.goto(`/#/transferencia?token=${token}`);
  return pagina;
}

async function sinFallos(page: Page, pagina: Pagina, donde: string) {
  expect(pagina.errores, `Errores JS ${donde}`).toEqual([]);
  await expect(page.getByText(TEXTO_DE_FALLO), `Pantalla de error ${donde}`).toHaveCount(0);
  expect(pagina.supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("sin sesión: se ve la entrada y «Inicia sesión para recibirla» vuelve aquí tras el login", async ({ page }) => {
  const pagina = await abrirTransferencia(page, { sesion: false });

  await expect(page.getByRole("heading", { name: /Ana García te envía una entrada/ })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Concierto E2E")).toBeVisible();
  await expect(page.getByText("Anticipada")).toBeVisible();
  await expect(page.getByText(EMAIL_ENMASCARADO).first()).toBeVisible();
  expect(pagina.consultas).toEqual([TOKEN]);
  await expect(page.getByRole("button", { name: "Aceptar entrada" })).toHaveCount(0);
  await sinFallos(page, pagina, "sin sesión");

  await page.getByRole("button", { name: "Inicia sesión para recibirla" }).click();
  await expect(page).toHaveURL(new RegExp(`#/login\\?next=%2Ftransferencia%3Ftoken%3D${TOKEN}$`));
});

test("con sesión: «Aceptar entrada» la pasa a la cuenta y lleva a la cartera", async ({ page }) => {
  const pagina = await abrirTransferencia(page, { sesion: true });

  const aceptar = page.getByRole("button", { name: "Aceptar entrada" });
  await expect(aceptar).toBeVisible({ timeout: 90_000 });
  await sinFallos(page, pagina, "antes de aceptar");
  await aceptar.click();

  await expect(page).toHaveURL(/#\/client-dashboard\/wallet$/);
  expect(pagina.aceptaciones).toEqual([{ token: TOKEN }]);
  await expect(page.getByText("Entrada recibida")).toBeVisible();
});

test("con otra cuenta (403): no se acepta y se ofrece cambiar de cuenta", async ({ page }) => {
  const pagina = await abrirTransferencia(page, {
    sesion: true,
    aceptar: { status: 403, json: { error: { message: "email_mismatch", code: "generic_error" } } },
  });

  await page.getByRole("button", { name: "Aceptar entrada" }).click({ timeout: 90_000 });
  await expect(page.getByText(/Esta entrada es para/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cambiar de cuenta" })).toBeVisible();
  await expect(page).toHaveURL(/#\/transferencia\?token=/);
  await sinFallos(page, pagina, "con otra cuenta");
});

// Estados claros: una página nueva por caso (misma URL: en la misma pestaña
// no habría navegación y se vería el estado anterior).
const ESTADOS: Array<[string, RegExp]> = [
  ["expired", /Esta transferencia ha caducado/],
  ["accepted", /Esta entrada ya se ha aceptado/],
  ["cancelled", /Se ha cancelado el envío/],
];
for (const [estado, titulo] of ESTADOS) {
  test(`estado claro: ${estado}, sin botón de aceptar`, async ({ page }) => {
    const pagina = await abrirTransferencia(page, { sesion: true, estado });
    await expect(page.getByRole("heading", { name: titulo })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Aceptar entrada" })).toHaveCount(0);
    await sinFallos(page, pagina, `con la transferencia ${estado}`);
  });
}

test("enlace no válido: sin token o mal formado, sin llamar al servidor", async ({ page }) => {
  const pagina = await abrirTransferencia(page, { sesion: false }, "no-es-un-token");
  await expect(page.getByRole("heading", { name: "Enlace no válido" })).toBeVisible({ timeout: 90_000 });
  expect(pagina.consultas).toEqual([]);
  await sinFallos(page, pagina, "con un enlace no válido");
});
