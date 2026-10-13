import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  CLAVE_SESION,
  FAKE_SUPABASE_URL,
  IDS,
  crearDatos,
  instalarSupabaseFalso,
  simularAppNativa,
} from "./support/fake-supabase";

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
 *   - El enlace de recuperación (el nuevo y el antiguo con tokens) abría la
 *     sesión nada más cargar, sin decir de qué cuenta: quien reenviase a una
 *     víctima la URL de su propio enlace la dejaba dentro de la cuenta del
 *     atacante. Ahora sale una tarjeta, la sesión solo se abre al pulsar
 *     «Continuar», se dice la cuenta («No soy yo»), y al cambiar la contraseña
 *     se cierran las demás sesiones y la de este dispositivo.
 *   - Un enlace guardado a una ruta protegida, sin sesión, acababa en el panel
 *     por defecto: ahora el login lleva `?next=` (salvo /door).
 *   - Una cuenta antigua sin rol reclamaba el rol al entrar, pero la app no se
 *     enteraba y enseñaba «Tu cuenta no tiene acceso».
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
 * contesta el falso. El manejador puede ser asíncrono (para hacerse esperar).
 */
async function contestar(
  page: Page,
  ruta: string,
  manejar: (req: Request) => RespuestaPropia | undefined | Promise<RespuestaPropia | undefined>,
) {
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
      const respuesta = await manejar(req);
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

/** Sesión guardada en el navegador (null = ninguna). */
const sesionGuardada = (page: Page) => page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_SESION);

/** Tokens de recuperación apartados por main.tsx en sessionStorage. */
const tokensApartados = (page: Page) =>
  page.evaluate(() => [
    window.sessionStorage.getItem("recovery_access_token"),
    window.sessionStorage.getItem("recovery_refresh_token"),
  ]);

/**
 * Lo que la app pide a Auth y cambia o comprueba la sesión, en orden:
 * "POST /auth/v1/verify", "GET /auth/v1/user", "PUT /auth/v1/user" y
 * "POST /auth/v1/logout?scope=local" (el scope se ve en la URL).
 */
function espiarAuth(page: Page): string[] {
  const peticiones: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== ORIGEN_SUPABASE || req.method() === "OPTIONS") return;
    if (!/^\/auth\/v1\/(verify|user|logout|token)$/.test(url.pathname)) return;
    peticiones.push(`${req.method()} ${url.pathname}${url.pathname.endsWith("/logout") ? url.search : ""}`);
  });
  return peticiones;
}

/**
 * Access token de un enlace de recuperación antiguo: el JWT de la sesión de
 * prueba con el `email` del payload que se pida (sin `email` si es undefined).
 * La firma da igual: el Supabase falso no la comprueba.
 */
function jwtDeEnlace(email: string | undefined): string {
  const [cabecera, payload, firma] = crearDatos(Date.now()).sesion.access_token.split(".");
  const datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  if (email === undefined) delete datos.email;
  else datos.email = email;
  return [cabecera, Buffer.from(JSON.stringify(datos)).toString("base64url"), firma].join(".");
}

const tarjetaDeRecuperacion = (page: Page) => page.getByRole("heading", { name: "Enlace de recuperación" });

/** Lo que dice la tarjeta cuando no sabe de qué cuenta es el enlace. */
const TEXTO_TARJETA_GENERICO = "Vas a poner una contraseña nueva en la cuenta a la que enviamos este enlace.";

/** Lo que GoTrue contesta a verifyOtp con un enlace caducado o ya usado. */
const ENLACE_CADUCADO = {
  status: 403,
  body: { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" },
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

test("una ruta protegida sin sesión lleva al login con next, y entrar devuelve a ella", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });

  // Cada panel, también con su query.
  for (const [ruta, next] of [
    ["/#/client-dashboard", "%2Fclient-dashboard"],
    ["/#/admin", "%2Fadmin"],
    ["/#/client-dashboard?tab=entradas", "%2Fclient-dashboard%3Ftab%3Dentradas"],
  ] as const) {
    await page.goto(ruta);
    await expect(page, `${ruta} sin sesión`).toHaveURL(new RegExp(`#/login\\?next=${next}$`), { timeout: 90_000 });
  }

  await page.goto("/#/partner-dashboard/eventos");
  await expect(page).toHaveURL(/#\/login\?next=%2Fpartner-dashboard%2Feventos$/, { timeout: 15_000 });
  await page.locator('input[type="email"]').fill("local@e2e.pasify.test");
  await page.locator('input[type="password"]').fill("contraseña-e2e");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // Al enlace guardado, no al panel por defecto.
  await expect(page).toHaveURL(/#\/partner-dashboard\/eventos$/, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/#\/partner-dashboard\/eventos$/);
  expect(fallos).toEqual([]);
});

test("cerrar sesión desde un panel va al login a secas, sin next", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: [], sembrarSesion: "una-vez" });
  await page.goto("/#/partner-dashboard/eventos");
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible({ timeout: 90_000 });

  // Había usuario en esta pantalla: no es «llegué sin sesión», no se guarda el destino.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/#\/login$/);
  expect(fallos).toEqual([]);
});

test("si la sesión se cierra en otra pestaña, el panel abierto va al login a secas, sin next", async ({
  page,
  context,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: [], sembrarSesion: "una-vez" });
  await page.goto("/#/partner-dashboard/eventos");
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible({ timeout: 90_000 });

  // La misma sesión (localStorage compartido) en otra pestaña, donde se cierra.
  const otra = await context.newPage();
  await instalarSupabaseFalso(otra, { roles: [], sembrarSesion: "nunca" });
  await otra.goto("/#/partner-dashboard/eventos");
  await expect(otra.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible({ timeout: 30_000 });
  await otra.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(otra).toHaveURL(/#\/login$/, { timeout: 15_000 });

  // Esta pestaña se entera por auth-js (BroadcastChannel) sin que nadie la lleve a ninguna parte:
  // había usuario en esta pantalla, así que no se guarda el destino.
  await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/#\/login$/);
  expect(fallos).toEqual([]);
});

test("entrar con una cuenta antigua sin rol: se reclama y se entra al panel sin «Tu cuenta no tiene acceso»", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  let reclamado = false;
  const reclamos: Array<Record<string, unknown>> = [];
  await contestar(page, "/rest/v1/rpc/get_user_roles", () => ({ body: reclamado ? ["partner"] : [] }));
  // La carga de roles de useAuth (get_user_roles + is_super_admin a la vez) se
  // queda en vuelo con lo de antes de reclamar, como pasa con una red lenta. Sin
  // volver a pedir los roles tras reclamar, el panel comparte esa petición y
  // enseña «Tu cuenta no tiene acceso» hasta el siguiente SIGNED_IN.
  await contestar(page, "/rest/v1/rpc/is_super_admin", async () => {
    await new Promise((resolver) => setTimeout(resolver, 2_500));
    return { body: false };
  });
  await contestar(page, "/rest/v1/rpc/claim_initial_role", (req) => {
    reclamos.push(cuerpoJson(req));
    reclamado = true;
    return { body: null };
  });

  await page.goto("/#/login");
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 90_000 });
  await page.locator('input[type="email"]').fill("local@e2e.pasify.test");
  await page.locator('input[type="password"]').fill("contraseña-e2e");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // useAuth ya había leído los roles vacíos: Login los vuelve a pedir tras reclamar.
  await expect(page).toHaveURL(/#\/partner-dashboard$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toHaveCount(0);
  expect(reclamos).toEqual([{ _role: "partner" }]);
  expect(fallos).toEqual([]);
});

test("con localStorage sin espacio (setItem lanza) se puede entrar: la sesión vive en memoria", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  // Almacenamiento lleno (o Safari privado antiguo): toda escritura lanza. Antes
  // el login fallaba con «No hemos podido completarlo» porque la sesión no se guardaba.
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
  });
  await page.goto("/#/login");
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 90_000 });
  await page.locator('input[type="email"]').fill("local@e2e.pasify.test");
  await page.locator('input[type="password"]').fill("contraseña-e2e");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/#\/partner-dashboard$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 30_000 });
  // No llegó a localStorage: vive en memoria hasta recargar la pestaña.
  expect(await sesionGuardada(page)).toBeNull();
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

/** Rellena el formulario de contraseña nueva, con el aviso en español si es corta, y la guarda. */
async function ponerContrasenaNueva(page: Page) {
  // Mínimo 8 caracteres, avisado en español.
  await page.locator("#password").fill("corta12");
  await page.locator("#confirmPassword").fill("corta12");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("La contraseña debe tener al menos 8 caracteres.")).toBeVisible();

  await page.locator("#password").fill("nueva-contraseña-e2e");
  await page.locator("#confirmPassword").fill("nueva-contraseña-e2e");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
}

test("el enlace nuevo de recuperación (token_hash) pide confirmar y no abre sesión hasta «Continuar»", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const auth = espiarAuth(page);
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");

  // Primero la tarjeta. El token sale de la barra de direcciones y no pasa nada
  // más: ni verifyOtp ni sesión guardada.
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await expect(page).toHaveURL(/#\/update-password$/);
  await expect(page.getByText("Establece tu nueva contraseña")).toHaveCount(0);
  await expect(page.getByText(TEXTO_TARJETA_GENERICO)).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(auth).toEqual([]);
  expect(await sesionGuardada(page)).toBeNull();

  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  // La cuenta que dice el servidor, y una salida.
  await expect(page.getByText("Cambiarás la contraseña de")).toContainText("local@e2e.pasify.test");
  await expect(page.getByRole("button", { name: "No soy yo" })).toBeVisible();
  expect(auth).toEqual(["POST /auth/v1/verify"]);

  await ponerContrasenaNueva(page);

  // Cambiada: se cierran las demás sesiones, después la de este dispositivo, y a entrar con la nueva.
  await expect(page).toHaveURL(/#\/login\?aviso=contrasena$/, { timeout: 15_000 });
  await expect(page.getByText("Contraseña cambiada. Entra con la nueva.")).toBeVisible();
  expect(auth).toEqual([
    "POST /auth/v1/verify",
    "PUT /auth/v1/user",
    "POST /auth/v1/logout?scope=others",
    "POST /auth/v1/logout?scope=local",
  ]);
  expect(await sesionGuardada(page)).toBeNull();
  expect(fallos).toEqual([]);
});

// El enlace antiguo: GoTrue pone los tokens en el hash (con la ruta delante o
// sin ella; en el segundo caso los aparta main.tsx antes de que HashRouter
// pise el hash) y, según la configuración, también pueden llegar en la query
// (main.tsx los aparta y quita la query en el sitio, sin recargar).
const ENLACES_ANTIGUOS: Array<[string, (accessToken: string) => string]> = [
  [
    "con la ruta delante",
    (jwt) =>
      `/#/update-password#access_token=${jwt}&expires_in=86400&refresh_token=e2e-refresh-token&token_type=bearer&type=recovery`,
  ],
  [
    "sin ruta, lo aparta main.tsx",
    (jwt) => `/#access_token=${jwt}&expires_in=86400&refresh_token=e2e-refresh-token&token_type=bearer&type=recovery`,
  ],
  [
    "en la query, main.tsx los aparta sin recargar",
    (jwt) => `/?access_token=${jwt}&expires_in=86400&refresh_token=e2e-refresh-token&token_type=bearer&type=recovery`,
  ],
];

for (const [formato, enlace] of ENLACES_ANTIGUOS) {
  test(`el enlace antiguo (${formato}) enseña su email y no abre sesión hasta «Continuar»`, async ({ page }) => {
    const fallos = errores(page);
    await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
    const auth = espiarAuth(page);
    await page.goto(enlace(jwtDeEnlace("local@e2e.pasify.test")));

    await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
    // El email sale del payload del JWT, sin red.
    await expect(page.getByText("Vas a cambiar la contraseña de")).toContainText("local@e2e.pasify.test");
    // Los tokens ya no están ni en la barra de direcciones ni en sessionStorage.
    await expect(page).toHaveURL(/#\/update-password$/);
    expect(await tokensApartados(page)).toEqual([null, null]);
    await page.waitForTimeout(1_000);
    expect(auth).toEqual([]);
    expect(await sesionGuardada(page)).toBeNull();

    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Cambiarás la contraseña de")).toContainText("local@e2e.pasify.test");
    // Es la cuenta que decía el enlace: ningún aviso de cuenta distinta.
    await expect(page.getByText(/El enlace decía que era para/)).toHaveCount(0);
    expect(await sesionGuardada(page)).not.toBeNull();

    await ponerContrasenaNueva(page);

    await expect(page).toHaveURL(/#\/login\?aviso=contrasena$/, { timeout: 15_000 });
    await expect(page.getByText("Contraseña cambiada. Entra con la nueva.")).toBeVisible();
    expect(auth).toEqual([
      "GET /auth/v1/user", // setSession comprueba el access token
      "PUT /auth/v1/user",
      "POST /auth/v1/logout?scope=others",
      "POST /auth/v1/logout?scope=local",
    ]);
    expect(await sesionGuardada(page)).toBeNull();
    expect(fallos).toEqual([]);
  });
}

// Con tokens en la query, main.tsx los aparta y quita la query en el sitio
// (history.replaceState). Si en vez de eso recargase la página
// (location.replace), hasta que llegase la navegación el documento viejo
// seguiría vivo con los tokens en su URL: auth-js los lee y los usa
// (GET /auth/v1/user) antes de que nadie pulse «Continuar». Pasaba en la CI,
// donde la recarga tarda más que el arranque de auth-js; aquí la retrasamos a
// propósito para que no dependa de la máquina.
test("el enlace antiguo en la query no llega a auth-js aunque una recarga tardase", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const auth = espiarAuth(page);
  let documentos = 0;
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      documentos += 1;
      if (documentos > 1) await new Promise((resolver) => setTimeout(resolver, 8_000));
      return route.fallback();
    },
  );
  await page.goto(
    `/?access_token=${jwtDeEnlace("local@e2e.pasify.test")}&expires_in=86400&refresh_token=e2e-refresh-token&token_type=bearer&type=recovery`,
  );

  await page.waitForTimeout(1_500);
  expect(auth).toEqual([]);
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(/#\/update-password$/);
  expect(documentos).toBe(1); // sin recarga
  expect(await sesionGuardada(page)).toBeNull();
  expect(fallos).toEqual([]);
});

test("«No soy yo» cierra la sesión del enlace y va al login sin cambiar nada", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const auth = espiarAuth(page);
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  expect(await sesionGuardada(page)).not.toBeNull();

  await page.getByRole("button", { name: "No soy yo" }).click();
  await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  await expect(page.locator('input[type="email"]')).toBeVisible();
  expect(await sesionGuardada(page)).toBeNull();
  expect(auth).toEqual(["POST /auth/v1/verify", "POST /auth/v1/logout?scope=local"]);
  expect(fallos).toEqual([]);
});

test("si el servidor no deja cerrar la sesión, la del enlace se borra igualmente de este dispositivo", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  // Con un 500, auth-js deja la sesión abierta (solo la borra con 401, 403 o 404).
  await contestar(page, "/auth/v1/logout", () => ({ status: 500, body: { code: 500, msg: "Error interno" } }));
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  await ponerContrasenaNueva(page);

  // La contraseña ya está cambiada: termina en /login y sin sesión en este dispositivo.
  await expect(page).toHaveURL(/#\/login\?aviso=contrasena$/, { timeout: 30_000 });
  await expect(page.getByText("Contraseña cambiada. Entra con la nueva.")).toBeVisible();
  expect(await sesionGuardada(page)).toBeNull();
  expect(fallos).toEqual([]);
});

test("el email de la tarjeta es solo informativo: si la cuenta real es otra, el formulario lo avisa", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const auth = espiarAuth(page);
  // Con ñ: el payload es UTF-8 en base64url, no Latin-1.
  const jwt = jwtDeEnlace("peña@e2e.pasify.test");
  await page.goto(`/#/update-password#access_token=${jwt}&refresh_token=e2e-refresh-token&type=recovery`);

  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Vas a cambiar la contraseña de")).toContainText("peña@e2e.pasify.test");

  // El servidor devuelve otra cuenta (el falso siempre es local@…): manda el servidor.
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Cambiarás la contraseña de")).toContainText("local@e2e.pasify.test");
  await expect(page.getByRole("alert")).toContainText("El enlace decía que era para peña@e2e.pasify.test");

  await page.getByRole("button", { name: "No soy yo" }).click();
  await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  expect(await sesionGuardada(page)).toBeNull();
  expect(auth).not.toContain("PUT /auth/v1/user");
  expect(fallos).toEqual([]);
});

test("si el JWT del enlace no trae email, la tarjeta es genérica y el formulario dice la cuenta del servidor", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto(
    `/#/update-password#access_token=${jwtDeEnlace(undefined)}&refresh_token=e2e-refresh-token&type=recovery`,
  );

  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(TEXTO_TARJETA_GENERICO)).toBeVisible();

  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Cambiarás la contraseña de")).toContainText("local@e2e.pasify.test");
  // Sin email en el enlace no hay con qué comparar: ningún aviso.
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(fallos).toEqual([]);
});

test("si lo que viene en el enlace ni siquiera es un JWT, la tarjeta no se rompe y «Continuar» lleva a pedir otro enlace", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const auth = espiarAuth(page);
  await page.goto("/#/update-password#access_token=esto-no-es-un-jwt&refresh_token=e2e-refresh-token&type=recovery");

  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(TEXTO_TARJETA_GENERICO)).toBeVisible();
  expect(await sesionGuardada(page)).toBeNull();
  expect(auth).toEqual([]);

  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/#\/reset-password\?enlace=caducado$/, { timeout: 15_000 });
  await expect(page.getByText("El enlace ha caducado o ya se ha usado. Pide uno nuevo.")).toBeVisible();
  expect(await sesionGuardada(page)).toBeNull();
  expect(fallos).toEqual([]);
});

test("con otra sesión abierta, la tarjeta avisa de que se cerrará y «Continuar» la cierra antes de abrir la del enlace", async ({
  page,
}) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page); // sesión del local sembrada
  const auth = espiarAuth(page);
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");

  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Se cerrará la sesión de")).toContainText("local@e2e.pasify.test");
  // Hasta «Continuar» sigue abierta.
  expect(await sesionGuardada(page)).not.toBeNull();
  expect(auth.filter((p) => /logout|verify/.test(p))).toEqual([]);

  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  expect(auth.filter((p) => /logout|verify/.test(p))).toEqual([
    "POST /auth/v1/logout?scope=local",
    "POST /auth/v1/verify",
  ]);
  expect(fallos).toEqual([]);
});

test("«Cancelar» en la tarjeta no toca la sesión que hubiera abierta", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page);
  const auth = espiarAuth(page);
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Cancelar" }).click();
  // A su panel, con la sesión de siempre.
  await expect(page).toHaveURL(/#\/partner-dashboard$/, { timeout: 30_000 });
  expect(await sesionGuardada(page)).not.toBeNull();
  expect(auth.filter((p) => /logout|verify/.test(p))).toEqual([]);
  expect(fallos).toEqual([]);
});

test("salir de la pantalla sin terminar cierra la sesión que abrió el enlace", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  const auth = espiarAuth(page);
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  expect(await sesionGuardada(page)).not.toBeNull();

  // A una página pública, sin guardar la contraseña.
  await page.evaluate(() => {
    window.location.hash = "#/calendar";
  });
  await expect(page).toHaveURL(/#\/calendar$/);
  await expect.poll(() => sesionGuardada(page), { timeout: 15_000 }).toBeNull();
  expect(auth).toEqual(["POST /auth/v1/verify", "POST /auth/v1/logout?scope=local"]);
  expect(fallos).toEqual([]);
});

test("un enlace de recuperación caducado, al pulsar «Continuar», lleva a pedir otro", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await contestar(page, "/auth/v1/verify", () => ENLACE_CADUCADO);
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/#\/reset-password\?enlace=caducado$/, { timeout: 15_000 });
  await expect(page.getByText("El enlace ha caducado o ya se ha usado. Pide uno nuevo.")).toBeVisible();
  expect(await sesionGuardada(page)).toBeNull();
  expect(fallos).toEqual([]);
});

test("sin conexión al pulsar «Continuar» se puede reintentar con el mismo enlace", async ({ page }) => {
  const fallos = errores(page);
  const supabase = await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");
  await expect(tarjetaDeRecuperacion(page)).toBeVisible({ timeout: 90_000 });

  supabase.sinRed = true;
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible({ timeout: 15_000 });

  supabase.sinRed = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Cambiarás la contraseña de")).toContainText("local@e2e.pasify.test");
  expect(fallos).toEqual([]);
});

// Higiene de main.tsx y UpdatePassword: solo `type=recovery` es un enlace de
// recuperación (no es una frontera: quien arma la URL puede ponerlo).
for (const [que, sufijo] of [
  ["type=magiclink", "&type=magiclink"],
  ["la ruta update-password sin type", ""],
] as const) {
  test(`unos tokens con ${que} no se tratan como enlace de recuperación`, async ({ page }) => {
    const fallos = errores(page);
    await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
    const auth = espiarAuth(page);
    await page.goto(
      `/#/update-password?access_token=${jwtDeEnlace("local@e2e.pasify.test")}&refresh_token=e2e-refresh-token${sufijo}`,
    );

    await expect(page).toHaveURL(/#\/reset-password$/, { timeout: 90_000 });
    await expect(tarjetaDeRecuperacion(page)).toHaveCount(0);
    expect(await sesionGuardada(page)).toBeNull();
    expect(auth).toEqual([]);
    expect(fallos).toEqual([]);
  });
}

test("el aviso «Contraseña cambiada» del login lleva la nota de la app solo en la web", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/login?aviso=contrasena");

  await expect(page.getByText("Contraseña cambiada. Entra con la nueva.")).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByText("Si usas la app de Pasify, vuelve a la app e inicia sesión con la contraseña nueva."),
  ).toBeVisible();
  // Es una buena noticia, no una alerta.
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Solo hay avisos con nombre: nada de Object.prototype.
  await page.goto("/#/login?aviso=constructor");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.getByText("Contraseña cambiada. Entra con la nueva.")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(fallos).toEqual([]);
});

test("en la app, el aviso «Contraseña cambiada» no habla de volver a la app", async ({ page }) => {
  const fallos = errores(page);
  await simularAppNativa(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/login?aviso=contrasena");

  await expect(page.getByText("Contraseña cambiada. Entra con la nueva.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Si usas la app de Pasify/)).toHaveCount(0);
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

// ---------------------------------------------------------------------------
// Ola 4 · plan gratuito: cuenta de local cerrada o en pausa (WP9 · 9b)
//
//   - PartnerGate lanzaba complete_partner_signup siempre que el plan no daba
//     acceso, y el servidor "activaba" también un plan en pausa o de una
//     organización cerrada. Ahora el servidor contesta 55000 org_closed si está
//     cerrada y no pisa un plan en pausa, y el gate no lo lanza con `paused`.
// ---------------------------------------------------------------------------

/** La fila que lee usePartnerSubscription, con el estado dado. */
const filaSuscripcion = (status: string) => [
  {
    id: IDS.suscripcion,
    org_id: IDS.org,
    plan_code: "free",
    status,
    trial_ends_at: null,
    current_period_end: null,
    cancel_at_period_end: false,
    admin_granted_until: null,
  },
];

test("una cuenta de local cerrada ve «cuenta cerrada» (sin Reintentar) y puede cerrar sesión", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "una-vez" });
  const llamadas: string[] = [];
  // partner_close_account cancela el plan y cierra la organización.
  await contestar(page, "/rest/v1/partner_subscriptions", () => ({ body: filaSuscripcion("cancelled") }));
  // RAISE … ERRCODE '55000': PostgREST pone el SQLSTATE y el mensaje en el cuerpo.
  await contestar(page, "/rest/v1/rpc/complete_partner_signup", () => {
    llamadas.push("complete_partner_signup");
    return { status: 500, body: { code: "55000", details: null, hint: null, message: "org_closed" } };
  });

  await page.goto("/#/partner-dashboard");
  await expect(page.getByRole("heading", { name: "Esta cuenta de local está cerrada" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "comunicacion@avenuemedia.io" })).toBeVisible();
  // Reintentar no arregla una cuenta cerrada, y no es un fallo de activación.
  await expect(page.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  await expect(page.getByText("No pudimos preparar tu cuenta de local")).toHaveCount(0);
  // Una sola llamada: ni bucle ni reintento automático.
  await page.waitForTimeout(1_500);
  expect(llamadas).toEqual(["complete_partner_signup"]);

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect.poll(() => page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_SESION)).toBeNull();
  expect(fallos).toEqual([]);
});

test("un plan en pausa no se reactiva solo: avisa, no llama al servidor y deja volver a comprobar", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "una-vez" });
  const llamadas: string[] = [];
  let estado = "paused";
  await contestar(page, "/rest/v1/partner_subscriptions", () => ({ body: filaSuscripcion(estado) }));
  for (const rpc of ["complete_partner_signup", "claim_partner_free_plan"]) {
    await contestar(page, `/rest/v1/rpc/${rpc}`, () => {
      llamadas.push(rpc);
      return { body: null };
    });
  }

  await page.goto("/#/partner-dashboard");
  await expect(page.getByRole("heading", { name: "Tu plan está en pausa" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "comunicacion@avenuemedia.io" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(llamadas).toEqual([]);

  // Cuando soporte lo reactiva, «Reintentar» solo vuelve a leer el estado y entra al panel.
  estado = "active";
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Métricas" })).toBeVisible({ timeout: 30_000 });
  expect(llamadas).toEqual([]);
  expect(fallos).toEqual([]);
});

test("si tras la llamada el plan sigue sin dar acceso, no se dice que está activado", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "una-vez" });
  let llamadas = 0;
  await contestar(page, "/rest/v1/partner_subscriptions", () => ({ body: filaSuscripcion("cancelled") }));
  await contestar(page, "/rest/v1/rpc/complete_partner_signup", () => {
    llamadas++;
    return { body: null };
  });

  await page.goto("/#/partner-dashboard");
  await expect(page.getByText("No hemos podido confirmar tu plan gratuito.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/se ha activado/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "comunicacion@avenuemedia.io" })).toBeVisible();
  expect(llamadas).toBe(1);

  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect.poll(() => llamadas).toBe(2);
  await expect(page.getByText("No hemos podido confirmar tu plan gratuito.")).toBeVisible();
  expect(fallos).toEqual([]);
});
