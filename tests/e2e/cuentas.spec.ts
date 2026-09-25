import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Request } from "@playwright/test";
import { CLAVE_SESION, FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso } from "./support/fake-supabase";

/**
 * Cuentas y acceso con Supabase simulado (support/fake-supabase.ts).
 *
 * Lo que se protege, que antes fallaba:
 *   - Entrar desde "Comprar" (`/login?next=`) llevaba al panel y el comprador
 *     perdía el evento; "Regístrate" tampoco reenviaba `next`.
 *   - Con sesión, las páginas de alta seguían ofreciendo crear otra cuenta.
 *   - Una cuenta sin rol (un local al que se ha retirado el acceso) veía una
 *     pantalla negra sin salida.
 *   - Un enlace de recuperación caducado acababa en un 404 en inglés.
 *   - El enlace nuevo de recuperación (`?token_hash=`) no lo leía nadie.
 *
 * Ola 3 (cuentas):
 *   - Con «Confirm email» activado signUp no abre sesión: el alta intentaba
 *     entrar igualmente y fallaba. Ahora pide revisar el correo, con reenvío
 *     y enlace al login, y los datos del formulario viajan en los metadatos.
 *   - Entrar sin haber confirmado el email deja pedir otro enlace.
 *   - Ajustes: un cliente nuevo pasa a local; una devolución en curso impide
 *     borrar la cuenta (y se dice); «Descargar mis datos» guarda el JSON.
 *
 *   npm run test:e2e:partner
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

type RespuestaPropia = { status?: number; body?: unknown };

/**
 * Contesta `ruta` del Supabase falso por encima de support/fake-supabase.ts
 * (en Playwright la última ruta registrada va primero). `undefined` = lo
 * contesta el falso.
 */
async function contestar(page: Page, ruta: string, manejar: (req: Request) => RespuestaPropia | undefined) {
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

const cuerpoJson = (req: Request): Record<string, unknown> => {
  try {
    return (req.postDataJSON() as Record<string, unknown> | null) ?? {};
  } catch {
    return {};
  }
};

/** Lo que devuelve GoTrue a signUp con «Confirm email» activado: el usuario, sin sesión. */
const usuarioSinConfirmar = (email: string, metadatos: unknown) => {
  const ahora = new Date().toISOString();
  return {
    id: "5e2e0000-0000-4000-8000-0000000000c1",
    aud: "authenticated",
    role: "",
    email,
    phone: "",
    confirmation_sent_at: ahora,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: metadatos ?? {},
    identities: [
      {
        identity_id: "5e2e0000-0000-4000-8000-0000000000c2",
        id: "5e2e0000-0000-4000-8000-0000000000c1",
        user_id: "5e2e0000-0000-4000-8000-0000000000c1",
        identity_data: { email, email_verified: false, sub: "5e2e0000-0000-4000-8000-0000000000c1" },
        provider: "email",
        created_at: ahora,
        updated_at: ahora,
      },
    ],
    created_at: ahora,
    updated_at: ahora,
    is_anonymous: false,
  };
};

/** App del cliente → Perfil → Ajustes de la cuenta (escritorio). */
async function abrirAjustesDeCliente(page: Page) {
  await page.goto("/#/client-dashboard");
  // La primera carga de Vite en frío puede tardar.
  await expect(page.getByRole("textbox", { name: "Buscar locales" })).toBeVisible({ timeout: 90_000 });
  await page.locator("aside").getByRole("button", { name: "Abrir perfil" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Ajustes de la cuenta/ }).click();
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
}

// La primera carga de Vite en frío puede tardar: también con playwright.config.ts (30 s por test).
test.describe.configure({ timeout: 180_000 });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const errores = (page: import("@playwright/test").Page) => {
  const lista: string[] = [];
  page.on("pageerror", (err) => lista.push(err.stack ?? `${err.name}: ${err.message}`));
  return lista;
};

test("entrar desde /login?next= vuelve a next, y «Regístrate» lo reenvía", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/login?next=%2Fcalendar");

  const email = page.locator('input[type="email"]');
  // La primera carga de Vite en frío (optimización de dependencias) puede tardar.
  await expect(email).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "Regístrate como cliente" })).toHaveAttribute(
    "href",
    /register-client\?next=%2Fcalendar$/,
  );

  await email.fill("local@e2e.pasify.test");
  await page.locator('input[type="password"]').fill("contraseña-e2e");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // Ni el panel (LoginRoute al llegar la sesión) ni el login: el evento.
  await expect(page).toHaveURL(/#\/calendar$/, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/#\/calendar$/);
  expect(fallos).toEqual([]);
});

test("con sesión, las páginas de alta llevan al panel", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page);
  for (const alta of ["/#/register-client", "/#/register-partner"]) {
    await page.goto(alta);
    await expect(page, `${alta} con sesión`).toHaveURL(/#\/partner-dashboard$/, { timeout: 90_000 });
  }
  expect(fallos).toEqual([]);
});

test("una cuenta sin rol ve con quién hablar y puede cerrar sesión", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: [], sembrarSesion: "una-vez" });
  await page.goto("/#/partner-dashboard");

  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "comunicacion@avenuemedia.io" })).toBeVisible();

  // La raíz tampoco se queda en negro.
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect.poll(() => page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_SESION)).toBeNull();
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toHaveCount(0);
  expect(fallos).toEqual([]);
});

test("un enlace de recuperación caducado lleva a pedir otro, en español", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  // Lo que devuelve GoTrue con un enlace usado o caducado.
  await page.goto(
    "/#/update-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );

  await expect(page).toHaveURL(/#\/reset-password\?enlace=caducado$/, { timeout: 90_000 });
  await expect(page.getByText("El enlace ha caducado o ya se ha usado. Pide uno nuevo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar enlace" })).toBeVisible();
  expect(fallos).toEqual([]);
});

test("el enlace nuevo de recuperación (token_hash) deja poner la contraseña", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");

  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 90_000 });
  // El token sirve una vez: fuera de la barra de direcciones.
  await expect(page).toHaveURL(/#\/update-password$/);

  // Mínimo 8 caracteres, avisado en español.
  await page.locator("#password").fill("corta12");
  await page.locator("#confirmPassword").fill("corta12");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("La contraseña debe tener al menos 8 caracteres.")).toBeVisible();

  await page.locator("#password").fill("nueva-contraseña-e2e");
  await page.locator("#confirmPassword").fill("nueva-contraseña-e2e");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("heading", { name: "Contraseña cambiada" })).toBeVisible({ timeout: 15_000 });
  expect(fallos).toEqual([]);
});

test("una ruta que no existe dice 404 en español y lleva al inicio", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/no-existe");

  await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "Volver al inicio" })).toBeVisible();
  expect(fallos).toEqual([]);
});

// ---------------------------------------------------------------------------
// Ola 3 · cuentas
// ---------------------------------------------------------------------------

test("alta de cliente con «Confirm email»: pide revisar el correo y no entra", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const altas: Array<Record<string, unknown>> = [];
  await contestar(page, "/auth/v1/signup", (req) => {
    const cuerpo = cuerpoJson(req);
    altas.push({ ...cuerpo, redirect_to: new URL(req.url()).searchParams.get("redirect_to") });
    return { body: usuarioSinConfirmar(String(cuerpo.email), cuerpo.data) };
  });

  await page.goto("/#/register-client?next=%2Fcalendar&ref=abcd1234");
  await expect(page.locator("#email")).toBeVisible({ timeout: 90_000 });
  await page.locator("#email").fill("nueva@e2e.pasify.test");
  await page.locator("#firstName").fill("Clara");
  await page.locator("#lastName").fill("Nueva");
  await page.locator("#password").fill("contraseña-e2e");
  await page.locator("#confirmPassword").fill("contraseña-e2e");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Revisa tu correo para confirmar tu cuenta" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("nueva@e2e.pasify.test")).toBeVisible();
  // El reenvío, pasado un minuto (GoTrue deja uno por minuto)
  await expect(page.getByRole("button", { name: /Reenviar el email en \d+ s/ })).toBeDisabled();
  // Al login, sin perder el evento
  await expect(page.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute(
    "href",
    /login\?next=%2Fcalendar$/,
  );
  // Sin sesión: no ha intentado entrar con la contraseña
  expect(await page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_SESION)).toBeNull();

  // El formulario (y la invitación) viajan en los metadatos; la contraseña no.
  expect(altas).toHaveLength(1);
  expect(altas[0].data).toMatchObject({
    initial_role: "client",
    first_name: "Clara",
    last_name: "Nueva",
    country: "ES",
    ref: "ABCD1234",
  });
  expect(JSON.stringify(altas[0].data)).not.toContain("contraseña-e2e");
  // El enlace del email vuelve a la raíz de la web (sin ruta de HashRouter)
  expect(String(altas[0].redirect_to)).toMatch(/^https?:\/\/[^/#]+\/$/);
  expect(fallos).toEqual([]);
});

test("alta de local con «Confirm email»: los datos del negocio viajan en los metadatos", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const altas: Array<Record<string, unknown>> = [];
  const rpcs: string[] = [];
  await contestar(page, "/auth/v1/signup", (req) => {
    const cuerpo = cuerpoJson(req);
    altas.push(cuerpo);
    return { body: usuarioSinConfirmar(String(cuerpo.email), cuerpo.data) };
  });
  // Sin sesión no se crea nada desde el navegador: lo hará PartnerGate al entrar.
  for (const rpc of ["complete_partner_signup", "create_organization", "claim_partner_free_plan"]) {
    await contestar(page, `/rest/v1/rpc/${rpc}`, () => {
      rpcs.push(rpc);
      return { body: null };
    });
  }

  await page.goto("/#/register-partner");
  await expect(page.locator("#email")).toBeVisible({ timeout: 90_000 });
  await page.locator("#email").fill("local-nuevo@e2e.pasify.test");
  await page.locator("#businessName").fill("Sala Nueva E2E");
  await page.locator("#password").fill("contraseña-e2e");
  await page.locator("#confirmPassword").fill("contraseña-e2e");
  await page.getByRole("button", { name: "Crear cuenta de local" }).click();

  await expect(page.getByRole("heading", { name: "Revisa tu correo para confirmar tu cuenta" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute("href", /#\/login$/);
  expect(altas).toHaveLength(1);
  expect(altas[0].data).toMatchObject({ initial_role: "partner", business_name: "Sala Nueva E2E", business_country: "ES" });
  expect(rpcs).toEqual([]);
  expect(fallos).toEqual([]);
});

test("entrar sin haber confirmado el email deja pedir otro enlace", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const reenvios: Array<Record<string, unknown>> = [];
  // Lo que responde GoTrue al entrar con un email sin confirmar.
  await contestar(page, "/auth/v1/token", () => ({
    status: 400,
    body: { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" },
  }));
  await contestar(page, "/auth/v1/resend", (req) => {
    reenvios.push(cuerpoJson(req));
    return { body: {} };
  });

  await page.goto("/#/login");
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 90_000 });
  await page.locator('input[type="email"]').fill("sin-confirmar@e2e.pasify.test");
  await page.locator('input[type="password"]').fill("contraseña-e2e");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page.getByText(/Todavía no has confirmado tu email/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Reenviar el enlace" }).click();
  await expect(page.getByText("Te hemos enviado otro enlace a sin-confirmar@e2e.pasify.test. Ábrelo y vuelve a entrar.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Reenviar el enlace en \d+ s/ })).toBeDisabled();
  expect(reenvios).toEqual([expect.objectContaining({ type: "signup", email: "sin-confirmar@e2e.pasify.test" })]);
  expect(fallos).toEqual([]);
});

test("Ajustes: un cliente nuevo pasa a local y entra en el panel del local", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: ["client"] });
  let convertido = false;
  const conversiones: Array<Record<string, unknown>> = [];
  await contestar(page, "/rest/v1/rpc/get_user_roles", () => ({ body: convertido ? ["partner"] : ["client"] }));
  await contestar(page, "/rest/v1/rpc/partner_conversion_status", () => ({
    body: convertido ? { eligible: false, reason: "not_client" } : { eligible: true, reason: null },
  }));
  await contestar(page, "/rest/v1/rpc/convert_new_client_to_partner", (req) => {
    conversiones.push(cuerpoJson(req));
    convertido = true;
    return { body: { role: "partner", org_id: IDS.org } };
  });

  await abrirAjustesDeCliente(page);
  await expect(page.getByRole("heading", { name: "¿Tienes un local?" })).toBeVisible();
  await page.getByRole("button", { name: /^Crea tu cuenta de local/ }).click();
  const crear = page.getByRole("button", { name: "Crear cuenta de local" });
  // Sin nombre no se puede
  await expect(crear).toBeDisabled();
  await page.getByRole("textbox", { name: "Nombre de tu local" }).fill("Sala Nueva E2E");
  await crear.click();

  // Roles refrescados sin recargar: al panel del local.
  await expect(page).toHaveURL(/#\/partner-dashboard/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Métricas" })).toBeVisible({ timeout: 30_000 });
  expect(conversiones).toEqual([{ _business_name: "Sala Nueva E2E" }]);
  expect(fallos).toEqual([]);
});

test("Ajustes: a un cliente que no puede pasar a local no se le ofrece", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: ["client"] });
  await contestar(page, "/rest/v1/rpc/partner_conversion_status", () => ({
    body: { eligible: false, reason: "has_purchases" },
  }));
  await abrirAjustesDeCliente(page);
  await expect(page.getByRole("button", { name: /Eliminar mi cuenta/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Tienes un local?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Crea tu cuenta de local/ })).toHaveCount(0);
  expect(fallos).toEqual([]);
});

test("Ajustes: con una devolución en curso no se borra la cuenta y se dice por qué", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: ["client"] });
  const borrados: Array<Record<string, unknown>> = [];
  await contestar(page, "/functions/v1/delete-own-account", (req) => {
    borrados.push(cuerpoJson(req));
    return {
      status: 409,
      body: { error: "refund_in_progress", message: "Tienes una devolución en curso." },
    };
  });

  await abrirAjustesDeCliente(page);
  await page.getByRole("button", { name: /Eliminar mi cuenta/ }).click();
  // Antes de confirmar: qué se borra y qué se conserva (lo mismo que /eliminar-cuenta.html)
  await expect(page.getByText(/Se borra en el momento/).first()).toBeVisible();
  await expect(page.getByText(/tu foto de perfil/).first()).toBeVisible();
  await expect(page.getByText(/6 años, art\. 30 del Código de Comercio/).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Tienes una devolución en curso" })).toBeVisible({
    timeout: 15_000,
  });
  // Sin Apple no se manda código; la sesión sigue abierta
  expect(borrados).toEqual([{}]);
  expect(await page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_SESION)).not.toBeNull();
  expect(fallos).toEqual([]);
});

test("Ajustes: «Descargar mis datos» guarda el JSON del servidor y avisa del límite diario", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: ["client"] });
  let exportaciones = 0;
  await contestar(page, "/functions/v1/gdpr-export-data", () => {
    exportaciones++;
    if (exportaciones > 1) {
      return { status: 429, body: { error: { message: "rate_limit_exceeded", code: "rate_limit_exceeded" } } };
    }
    return {
      body: {
        ok: true,
        file_name: "pasify-mis-datos-2026-09-25.json",
        export: { user_id: IDS.usuario, data: { profiles: [{ id: IDS.usuario }] }, meta: { schema_version: "2.0" } },
      },
    };
  });

  await abrirAjustesDeCliente(page);
  const descarga = page.waitForEvent("download");
  await page.getByRole("button", { name: /Descargar mis datos/ }).click();
  const fichero = await descarga;
  expect(fichero.suggestedFilename()).toBe("pasify-mis-datos-2026-09-25.json");
  const contenido = JSON.parse(await readFile(await fichero.path(), "utf8")) as { user_id?: string };
  expect(contenido.user_id).toBe(IDS.usuario);

  await page.getByRole("button", { name: /Descargar mis datos/ }).click();
  await expect(page.getByText("Ya los has descargado varias veces hoy. Vuelve a intentarlo mañana.")).toBeVisible();
  expect(exportaciones).toBe(2);
  expect(fallos).toEqual([]);
});
