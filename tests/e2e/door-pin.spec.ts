import { expect, test, type Locator, type Page } from "@playwright/test";
import QRCode from "qrcode";
import {
  createRequestIdGate,
  esFuncionNoEncontrada,
  newRequestId,
  REQUEST_ID_RECHECK_MS,
  type CryptoLike,
  type RpcErrorLike,
} from "../../src/lib/scanRequest";
import { CLAVE_SESION, FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

/**
 * Modo puerta (/door) con Supabase simulado: el PIN no se puede saltar y los
 * reintentos de escaneo no dan «Entrada ya usada».
 *
 * Lo que se protege, que antes fallaba:
 *   - Sin red, «¿Has olvidado el PIN? Cerrar sesión» quitaba el bloqueo y
 *     luego signOut fallaba: la sesión seguía viva, /login llevaba al panel y,
 *     aunque no, bastaba con recargar. Ahora la sesión sale del dispositivo
 *     aunque no haya red, y el bloqueo solo se quita cuando ya no hay sesión.
 *   - Con la puerta bloqueada, /update-password (cambiar la contraseña del
 *     dueño sin la actual) y /login quedaban fuera del bloqueo.
 *   - Los PIN fallidos se contaban en memoria: recargar reiniciaba la cuenta.
 *   - Con mala cobertura la RPC de escaneo se ejecutaba y marcaba la entrada
 *     mientras el móvil mostraba «Sin conexión»; al reintentar salía «Entrada
 *     ya usada» y el portero podía negar el paso a un invitado legítimo. Ahora
 *     cada lectura lleva su `_request_id` (UUID nuevo) y «Reintentar» reenvía
 *     el mismo; una lectura nueva, aunque sea del mismo QR, lleva otro. Al final
 *     del fichero, con la BD simulada como la de la migración 20260929130000.
 *
 * La sesión se siembra una sola vez por pestaña (sembrarSesion: "una-vez"):
 * si no, cada recarga la volvería a poner y "tras recargar" no probaría nada.
 *
 *   npm run test:e2e:partner
 */

const PIN = "2468";
const PIN_MALO = "1111";

test.afterEach(async ({ page }) => {
  await page.context().setOffline(false);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

interface Puerta {
  supabase: SupabaseFalso;
  /** `pageerror` desde que se abrió la app. */
  errores: string[];
}

const leer = (page: Page, clave: string) => page.evaluate((k) => window.localStorage.getItem(k), clave);

/** Fallos de PIN guardados en el dispositivo (doorLock.ts). */
const fallosGuardados = async (page: Page) => {
  const valor = await leer(page, "pasify.door.fails");
  return valor ? (JSON.parse(valor) as { count: number }).count : 0;
};

const botonSalirDeCabecera = (page: Page) => page.locator("header").getByRole("button", { name: "Salir" });

/**
 * Entra en /door con la sesión del local y activa el modo puerta con PIN.
 * `antesDeEntrar`: rutas o scripts propios del test, antes de cargar la app.
 */
async function bloquearPuerta(page: Page, antesDeEntrar?: () => Promise<void>): Promise<Puerta> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, { sembrarSesion: "una-vez" });
  await antesDeEntrar?.();

  await page.goto("/#/door");
  const pin = page.getByPlaceholder("PIN (4 a 6 cifras)");
  // La primera carga de Vite en frío (optimización de dependencias) puede tardar.
  await expect(pin).toBeVisible({ timeout: 90_000 });
  await pin.fill(PIN);
  await page.getByPlaceholder("Repite el PIN").fill(PIN);
  await page.getByRole("button", { name: "Activar" }).click();
  await expect(botonSalirDeCabecera(page)).toBeVisible();
  expect(await leer(page, "pasify.door.active")).toBe(IDS.usuario);
  return { supabase, errores };
}

async function abrirSalida(page: Page): Promise<Locator> {
  await botonSalirDeCabecera(page).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText("Salir del modo puerta")).toBeVisible();
  return dialogo;
}

/**
 * Tras «¿Has olvidado el PIN?»: sesión fuera del dispositivo, en /login, y ni
 * recargando ni yendo a mano se vuelve a entrar al panel o a la puerta.
 */
async function comprobarSesionCerrada(page: Page, supabase: SupabaseFalso) {
  await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  await expect(page.locator('input[type="email"]')).toBeVisible();
  expect(await leer(page, CLAVE_SESION), "La sesión sigue guardada en el dispositivo").toBeNull();
  // Ya sin sesión el bloqueo sobra: para volver a entrar hace falta la contraseña.
  await expect.poll(() => leer(page, "pasify.door.active")).toBeNull();

  // Vuelve la cobertura y se recarga: sigue fuera.
  await page.context().setOffline(false);
  supabase.sinRed = false;
  await page.reload();
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
  for (const ruta of ["/#/partner-dashboard", "/#/door"]) {
    await page.goto(ruta);
    await expect(page, `${ruta} con la sesión cerrada`).toHaveURL(/#\/login$/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toHaveCount(0);
  expect(await leer(page, CLAVE_SESION)).toBeNull();
}

test("en modo avión, «¿Has olvidado el PIN?» cierra la sesión de verdad: ni panel ni tras recargar", async ({
  page,
}) => {
  const { supabase, errores } = await bloquearPuerta(page);

  // Modo avión: navigator.onLine a false y, además, el Supabase falso sin
  // contestar (con setOffline, Playwright sigue sirviendo lo que pasa por
  // page.route, y el signOut de siempre habría funcionado).
  await page.context().setOffline(true);
  supabase.sinRed = true;
  const dialogo = await abrirSalida(page);
  await dialogo.getByRole("button", { name: /¿Has olvidado el PIN\?/ }).click();

  await comprobarSesionCerrada(page, supabase);
  expect(supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
  expect(errores).toEqual([]);
});

test("sin respuesta del servidor (el móvil cree tener red) también cierra la sesión", async ({ page }) => {
  const { supabase, errores } = await bloquearPuerta(page);

  supabase.sinRed = true;
  const dialogo = await abrirSalida(page);
  await dialogo.getByRole("button", { name: /¿Has olvidado el PIN\?/ }).click();

  await comprobarSesionCerrada(page, supabase);
  expect(errores).toEqual([]);
});

test("con la puerta bloqueada, /update-password, /login, / y el panel llevan a /door", async ({ page }) => {
  const { errores } = await bloquearPuerta(page);

  for (const ruta of ["/#/update-password", "/#/login", "/#/", "/#/partner-dashboard", "/#/partner-dashboard/eventos"]) {
    await page.goto(ruta);
    await expect(page, `${ruta} no lleva a /door`).toHaveURL(/#\/door$/);
    await expect(botonSalirDeCabecera(page)).toBeVisible();
  }
  await expect(page.getByText("Establece tu nueva contraseña")).toHaveCount(0);

  // Y al recargar, igual.
  await page.goto("/#/update-password");
  await page.reload();
  await expect(page).toHaveURL(/#\/door$/, { timeout: 30_000 });
  await expect(botonSalirDeCabecera(page)).toBeVisible();
  expect(errores).toEqual([]);
});

test("los PIN fallidos y la espera no se reinician al recargar", async ({ page }) => {
  const { errores } = await bloquearPuerta(page);

  const dialogo = await abrirSalida(page);
  const campo = dialogo.getByPlaceholder("PIN", { exact: true });
  for (let intento = 1; intento <= 5; intento++) {
    await campo.fill(PIN_MALO);
    await dialogo.getByRole("button", { name: "Salir", exact: true }).click();
    await expect.poll(() => fallosGuardados(page)).toBe(intento);
  }
  const espera = dialogo.getByText(/Demasiados intentos\. Espera \d+ s\./);
  await expect(espera).toBeVisible();
  await expect(campo).toBeDisabled();

  await page.reload();
  await expect(botonSalirDeCabecera(page)).toBeVisible({ timeout: 30_000 });
  const tras = await abrirSalida(page);
  await expect(tras.getByText(/Demasiados intentos\. Espera \d+ s\./)).toBeVisible();
  await expect(tras.getByPlaceholder("PIN", { exact: true })).toBeDisabled();
  expect(await fallosGuardados(page)).toBe(5);
  expect(await leer(page, "pasify.door.active")).toBe(IDS.usuario);
  expect(errores).toEqual([]);
});

test("con el PIN correcto se sale al panel", async ({ page }) => {
  const { errores } = await bloquearPuerta(page);

  const dialogo = await abrirSalida(page);
  await dialogo.getByPlaceholder("PIN", { exact: true }).fill(PIN);
  await dialogo.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(/#\/partner-dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 30_000 });
  expect(await leer(page, "pasify.door.active")).toBeNull();
  expect(errores).toEqual([]);
});

// ---------------------------------------------------------------------------
// Escaneo: el `_request_id` de cada lectura (scan_ticket y scan_ticket_by_code)
// ---------------------------------------------------------------------------

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

/** qr_token de la entrada de prueba y el código corto que el cliente ve bajo su QR. */
const TOKEN = "5e2e0000-0000-4000-8000-0000000009a1";
const CODIGO = "5e2e0000";
/** UUID v4 canónico: `_request_id` es un parámetro UUID y la BD rechaza cualquier otra cosa (22P02). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface LlamadaDeEscaneo {
  rpc: "scan_ticket" | "scan_ticket_by_code";
  args: Record<string, unknown>;
}

type RespuestaRpc = { status?: number; json: unknown };
/**
 * Qué hace la red con una llamada: contestar, "cortar" (la RPC ya se ejecutó
 * pero la respuesta no llega: mala cobertura) o "colgar" (ni respuesta ni
 * corte: salta el timeout del escáner).
 */
type Decision = RespuestaRpc | "cortar" | "colgar";

const idDe = (llamada: LlamadaDeEscaneo) => llamada.args._request_id;

/** PostgREST cuando la función no tiene un parámetro: 404 con PGRST202. */
const funcionNoEncontrada = (llamada: LlamadaDeEscaneo): RespuestaRpc => {
  const parametros = Object.keys(llamada.args).sort().join(", ");
  return {
    status: 404,
    json: {
      code: "PGRST202",
      details: `Searched for the function public.${llamada.rpc} with parameters ${parametros} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
      hint: null,
      message: `Could not find the function public.${llamada.rpc}(${parametros}) in the schema cache`,
    },
  };
};

/**
 * La BD de la puerta, con o sin la migración 20260929130000 (idempotencia):
 *   - la entrada se marca una vez y guarda el `_request_id` de esa llamada;
 *   - ya usada, el MISMO `_request_id` devuelve otra vez el éxito (forced =
 *     false, con la hora del primero) y cualquier otro, o ninguno, da
 *     `already_used`;
 *   - sin la migración, un `_request_id` hace que PostgREST no encuentre la
 *     función (PGRST202, 404).
 */
function servidorDePuerta({ admiteRequestId = true }: { admiteRequestId?: boolean } = {}) {
  let marcadas = 0;
  let usadaCon: string | null = null;
  let usadaEn = "";
  const fila = (extra: Record<string, unknown>) => ({
    success: true,
    result: "success",
    ticket_id: "5e2e0000-0000-4000-8000-0000000009b1",
    event_id: IDS.eventoHoy,
    event_title: "Noche E2E",
    buyer_first_name: "Ana",
    buyer_last_name: "García",
    buyer_email: null,
    tier_name: "General",
    scanned_at: new Date().toISOString(),
    already_used_at: null,
    event_date_start: new Date(Date.now() - 3_600_000).toISOString(),
    forced: false,
    ...extra,
  });
  return {
    /** Veces que se ha marcado la entrada (un éxito repetido no cuenta). */
    get marcadas() {
      return marcadas;
    },
    escanear(llamada: LlamadaDeEscaneo): RespuestaRpc {
      const enviado = idDe(llamada);
      const id = typeof enviado === "string" ? enviado : null;
      if (id !== null && !admiteRequestId) return funcionNoEncontrada(llamada);
      if (marcadas === 0) {
        marcadas = 1;
        usadaCon = id;
        usadaEn = new Date().toISOString();
        return { json: [fila({ scanned_at: usadaEn })] };
      }
      if (id !== null && id === usadaCon) return { json: [fila({ scanned_at: usadaEn })] };
      return { json: [fila({ success: false, result: "already_used", already_used_at: usadaEn })] };
    },
  };
}

/**
 * Contesta scan_ticket y scan_ticket_by_code por encima del Supabase falso (en
 * Playwright la última ruta registrada va primero) y apunta cada llamada.
 */
async function interceptarEscaneos(
  page: Page,
  decidir: (llamada: LlamadaDeEscaneo, n: number) => Decision,
): Promise<LlamadaDeEscaneo[]> {
  const llamadas: LlamadaDeEscaneo[] = [];
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && /^\/rest\/v1\/rpc\/scan_ticket(_by_code)?$/.test(url.pathname),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fallback();
      const llamada: LlamadaDeEscaneo = {
        rpc: new URL(req.url()).pathname.endsWith("_by_code") ? "scan_ticket_by_code" : "scan_ticket",
        args: (req.postDataJSON() as Record<string, unknown> | null) ?? {},
      };
      llamadas.push(llamada);
      const decision = decidir(llamada, llamadas.length);
      if (decision === "cortar") return route.abort("connectionreset");
      if (decision === "colgar") return;
      await route.fulfill({
        status: decision.status ?? 200,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "content-range, x-supabase-api-version",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(decision.json),
      });
    },
  );
  return llamadas;
}

/** Puerta activada, con el evento de esta noche elegido y «Código manual» abierto. */
async function abrirEscaner(page: Page, antesDeEntrar?: () => Promise<void>): Promise<Puerta> {
  const puerta = await bloquearPuerta(page, antesDeEntrar);
  await expect(page.getByRole("combobox", { name: "Evento en puerta" })).toContainText("Noche E2E", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Código manual" }).click();
  await expect(page.getByLabel("Código de la entrada")).toBeVisible();
  return puerta;
}

/** Escribe el código corto (o el QR completo) en «Código manual» y valida. */
async function teclear(page: Page, texto: string) {
  await page.getByLabel("Código de la entrada").fill(texto);
  await page.getByRole("button", { name: "Validar", exact: true }).click();
}

/** Resultado a pantalla completa (verde o rojo). */
const resultado = (page: Page) => page.getByRole("alertdialog");
const titulo = (page: Page, nombre: string | RegExp) => resultado(page).getByRole("heading", { name: nombre });

/**
 * Cámara falsa para la vía principal de la puerta: getUserMedia devuelve el
 * stream de un <canvas> con el QR de `texto` dibujado, y qr-scanner lo lee de
 * verdad. `window.__quitarQr()` lo retira (deja de haber lecturas).
 */
async function camaraConQr(page: Page, texto: string) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  await page.addInitScript(
    ({ lado, modulos }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const escala = 8;
      let visible = true;
      const dibujar = () => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!visible) return;
        ctx.fillStyle = "#000";
        const x0 = Math.floor((canvas.width - lado * escala) / 2);
        const y0 = Math.floor((canvas.height - lado * escala) / 2);
        for (let y = 0; y < lado; y++) {
          for (let x = 0; x < lado; x++) {
            if (modulos[y * lado + x]) ctx.fillRect(x0 + x * escala, y0 + y * escala, escala, escala);
          }
        }
      };
      dibujar();
      // Un canvas solo emite fotogramas cuando se redibuja.
      window.setInterval(dibujar, 100);
      (window as unknown as { __quitarQr: () => void }).__quitarQr = () => {
        visible = false;
      };
      navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
    },
    { lado: qr.modules.size, modulos: Array.from(qr.modules.data as ArrayLike<number>) },
  );
}

test.describe("escaneo: _request_id de cada lectura", () => {
  test("dos lecturas del mismo código o QR llevan _request_id distintos: la segunda no pasa por reintento", async ({
    page,
  }) => {
    const { errores } = await abrirEscaner(page);
    const servidor = servidorDePuerta();
    const llamadas = await interceptarEscaneos(page, (llamada) => servidor.escanear(llamada));

    // Primera lectura (código corto): entra y la pantalla verde se cierra sola.
    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada válida")).toBeVisible();
    await expect(resultado(page)).toHaveCount(0);

    // Otro invitado con la misma entrada: otra lectura, otro _request_id, ya usada.
    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada ya usada")).toBeVisible();
    await resultado(page).getByRole("button", { name: "Escanear siguiente" }).click();

    // Y con el QR completo (scan_ticket), igual.
    await teclear(page, TOKEN);
    await expect(titulo(page, "Entrada ya usada")).toBeVisible();

    expect(llamadas.map((l) => l.rpc)).toEqual(["scan_ticket_by_code", "scan_ticket_by_code", "scan_ticket"]);
    const ids = llamadas.map(idDe);
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size, "Cada lectura necesita su propio _request_id").toBe(3);
    expect(servidor.marcadas).toBe(1);
    expect(errores).toEqual([]);
  });

  for (const [modo, texto, rpc] of [
    ["código corto", CODIGO, "scan_ticket_by_code"],
    ["QR completo", TOKEN, "scan_ticket"],
  ] as const) {
    test(`si la respuesta se pierde, «Reintentar» reenvía el mismo _request_id y el éxito repetido sale en verde (${modo})`, async ({
      page,
    }) => {
      const { errores } = await abrirEscaner(page);
      const servidor = servidorDePuerta();
      const llamadas = await interceptarEscaneos(page, (llamada, n) => {
        const respuesta = servidor.escanear(llamada); // la RPC se ejecuta en la BD…
        return n === 1 ? "cortar" : respuesta; // …pero al móvil no le llega la primera respuesta
      });

      await teclear(page, texto);
      await expect(titulo(page, /Sin conexión: no se ha validado/)).toBeVisible();
      expect(servidor.marcadas, "La RPC sí llegó a ejecutarse").toBe(1);

      await resultado(page).getByRole("button", { name: "Reintentar" }).click();
      // El éxito idempotente se ve como un éxito: verde, con el tipo y el titular.
      await expect(titulo(page, "Entrada válida")).toBeVisible();
      await expect(resultado(page)).toContainText("General");
      await expect(resultado(page)).toContainText("Ana García");
      await expect(titulo(page, "Entrada ya usada")).toHaveCount(0);

      expect(llamadas.map((l) => l.rpc)).toEqual([rpc, rpc]);
      expect(idDe(llamadas[0])).toMatch(UUID_V4);
      expect(idDe(llamadas[1])).toBe(idDe(llamadas[0]));
      expect(servidor.marcadas).toBe(1);

      // Una lectura NUEVA de la misma entrada no es un reintento: otro _request_id, ya usada.
      await expect(resultado(page)).toHaveCount(0);
      await teclear(page, texto);
      await expect(titulo(page, "Entrada ya usada")).toBeVisible();
      expect(idDe(llamadas[2])).toMatch(UUID_V4);
      expect(idDe(llamadas[2])).not.toBe(idDe(llamadas[0]));
      expect(errores).toEqual([]);
    });
  }

  test("sin respuesta salta a los 8 s y «Reintentar» reenvía el mismo _request_id", async ({ page }) => {
    const { errores } = await abrirEscaner(page);
    const servidor = servidorDePuerta();
    const llamadas = await interceptarEscaneos(page, (llamada, n) => {
      const respuesta = servidor.escanear(llamada); // la BD marca la entrada…
      return n === 1 ? "colgar" : respuesta; // …pero la primera respuesta no llega a tiempo
    });

    const inicio = Date.now();
    await teclear(page, CODIGO);
    await expect(titulo(page, /Sin conexión: no se ha validado/)).toBeVisible({ timeout: 15_000 });
    // El timeout era de 5 s: el aviso no puede salir antes de los 8 s de pedirla.
    expect(Date.now() - inicio, "Timeout de la RPC de escaneo").toBeGreaterThanOrEqual(8_000);
    expect(servidor.marcadas).toBe(1);

    await resultado(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(titulo(page, "Entrada válida")).toBeVisible();
    expect(llamadas).toHaveLength(2);
    expect(idDe(llamadas[0])).toMatch(UUID_V4);
    expect(idDe(llamadas[1])).toBe(idDe(llamadas[0]));
    expect(servidor.marcadas).toBe(1);
    expect(errores).toEqual([]);
  });

  test("con una BD sin _request_id (PGRST202) se repite la lectura sin él y las siguientes ya no lo envían", async ({
    page,
  }) => {
    const { errores } = await abrirEscaner(page);
    const servidor = servidorDePuerta({ admiteRequestId: false });
    const llamadas = await interceptarEscaneos(page, (llamada) => servidor.escanear(llamada));

    // La primera lectura va con _request_id, la BD no lo conoce y se repite sin él: funciona.
    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada válida")).toBeVisible();
    await expect(resultado(page)).toHaveCount(0);

    // Las siguientes (de las dos RPC) ya salen sin _request_id y se comportan como siempre.
    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada ya usada")).toBeVisible();
    await resultado(page).getByRole("button", { name: "Escanear siguiente" }).click();
    await teclear(page, TOKEN);
    await expect(titulo(page, "Entrada ya usada")).toBeVisible();

    expect(llamadas.map((l) => ("_request_id" in l.args ? "con _request_id" : "sin _request_id"))).toEqual([
      "con _request_id",
      "sin _request_id",
      "sin _request_id",
      "sin _request_id",
    ]);
    expect(idDe(llamadas[0])).toMatch(UUID_V4);
    // Sin el parámetro, la petición es exactamente la de antes.
    expect(Object.keys(llamadas[1].args).sort()).toEqual(["_code", "_device_info", "_event_id"]);
    expect(Object.keys(llamadas[3].args).sort()).toEqual(["_device_info", "_event_id", "_qr_token"]);
    expect(servidor.marcadas).toBe(1);
    expect(errores).toEqual([]);
  });

  test("otros errores no se toman por «función no encontrada»: ni se repite la lectura ni se enmascaran", async ({
    page,
  }) => {
    const { errores } = await abrirEscaner(page);
    const servidor = servidorDePuerta();
    const fallos = [
      // Lo que contesta PostgREST cuando la función falla por dentro o por permisos.
      { status: 400, json: { code: "P0001", details: null, hint: null, message: "Not authenticated" }, texto: "Not authenticated" },
      { status: 401, json: { code: "PGRST301", details: null, hint: null, message: "JWT expired" }, texto: "JWT expired" },
      // Dos que se parecen a «no encontrada» y no lo son.
      {
        status: 300,
        json: {
          code: "PGRST203",
          details: null,
          hint: "Try renaming the parameters or the function itself in the database so function overloading can be resolved",
          message: "Could not choose the best candidate function between: public.scan_ticket(a), public.scan_ticket(b)",
        },
        texto: "Could not choose the best candidate function",
      },
      {
        status: 404,
        json: { code: "42883", details: null, hint: null, message: "function public.has_org_role(uuid) does not exist" },
        texto: "has_org_role",
      },
      // Un 404 de la pasarela, sin código de PostgREST.
      { status: 404, json: { message: "no Route matched with those values" }, texto: "no Route matched" },
    ];
    const llamadas = await interceptarEscaneos(page, (llamada, n) =>
      n <= fallos.length ? fallos[n - 1] : servidor.escanear(llamada),
    );

    for (const [i, fallo] of fallos.entries()) {
      await teclear(page, CODIGO);
      await expect(titulo(page, "No se pudo validar")).toBeVisible();
      await expect(resultado(page)).toContainText(fallo.texto);
      expect(llamadas, `Tras el error ${i + 1} no debe haber una segunda llamada`).toHaveLength(i + 1);
      await resultado(page).getByRole("button", { name: "Cerrar" }).click();
      await expect(resultado(page)).toHaveCount(0);
    }

    // Ninguno de ellos ha hecho creer que la BD no admite _request_id: la siguiente lectura lo envía.
    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada válida")).toBeVisible();
    expect(llamadas).toHaveLength(fallos.length + 1);
    expect(llamadas.every((l) => typeof idDe(l) === "string")).toBe(true);
    expect(errores).toEqual([]);
  });

  test("un error de la función reintenta con el mismo _request_id", async ({ page }) => {
    const { errores } = await abrirEscaner(page);
    const servidor = servidorDePuerta();
    const llamadas = await interceptarEscaneos(page, (llamada, n) =>
      n === 1
        ? {
            status: 500,
            json: { code: "XX000", details: null, hint: null, message: "canceling statement due to statement timeout" },
          }
        : servidor.escanear(llamada),
    );

    await teclear(page, CODIGO);
    await expect(titulo(page, "No se pudo validar")).toBeVisible();
    await resultado(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(titulo(page, "Entrada válida")).toBeVisible();

    expect(llamadas).toHaveLength(2);
    expect(idDe(llamadas[0])).toMatch(UUID_V4);
    expect(idDe(llamadas[1])).toBe(idDe(llamadas[0]));
    expect(errores).toEqual([]);
  });

  test("sin crypto.randomUUID (WebView antiguo o contexto no seguro) la lectura sigue llevando un UUID v4 válido", async ({
    page,
  }) => {
    const { errores } = await abrirEscaner(page, async () => {
      await page.addInitScript(() => {
        delete (Crypto.prototype as Partial<Crypto>).randomUUID;
      });
    });
    expect(await page.evaluate(() => typeof crypto.randomUUID), "El script de prueba no ha quitado randomUUID").toBe(
      "undefined",
    );
    const servidor = servidorDePuerta();
    const llamadas = await interceptarEscaneos(page, (llamada) => servidor.escanear(llamada));

    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada válida")).toBeVisible();
    await expect(resultado(page)).toHaveCount(0);
    await teclear(page, CODIGO);
    await expect(titulo(page, "Entrada ya usada")).toBeVisible();

    expect(llamadas).toHaveLength(2);
    expect(idDe(llamadas[0])).toMatch(UUID_V4);
    expect(idDe(llamadas[1])).toMatch(UUID_V4);
    expect(idDe(llamadas[1])).not.toBe(idDe(llamadas[0]));
    expect(errores).toEqual([]);
  });

  test("con la cámara: «Reintentar» reenvía el mismo _request_id y una pasada nueva del mismo QR lleva otro", async ({
    page,
  }) => {
    const servidor = servidorDePuerta();
    let llamadas: LlamadaDeEscaneo[] = [];
    const { errores } = await bloquearPuerta(page, async () => {
      await camaraConQr(page, TOKEN);
      llamadas = await interceptarEscaneos(page, (llamada, n) => {
        const respuesta = servidor.escanear(llamada); // la RPC se ejecuta en la BD…
        return n === 1 ? "cortar" : respuesta; // …pero al móvil no le llega la primera respuesta
      });
    });

    // La cámara lee el QR sola.
    await expect(titulo(page, /Sin conexión: no se ha validado/)).toBeVisible({ timeout: 30_000 });
    expect(servidor.marcadas, "La RPC sí llegó a ejecutarse").toBe(1);
    await resultado(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(titulo(page, "Entrada válida")).toBeVisible();

    // El QR sigue delante de la cámara: pasado el enfriamiento (2,5 s) se lee otra vez. Es otra
    // lectura, no un reintento: otro _request_id y la entrada ya está usada.
    await expect(titulo(page, "Entrada ya usada")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (window as unknown as { __quitarQr: () => void }).__quitarQr());

    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    expect(llamadas.every((l) => l.rpc === "scan_ticket" && l.args._qr_token === TOKEN)).toBe(true);
    expect(idDe(llamadas[0])).toMatch(UUID_V4);
    expect(idDe(llamadas[1])).toBe(idDe(llamadas[0]));
    expect(idDe(llamadas[2])).toMatch(UUID_V4);
    expect(idDe(llamadas[2])).not.toBe(idDe(llamadas[0]));
    expect(servidor.marcadas).toBe(1);
    expect(errores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanRequest.ts sin navegador: la parte pura (UUID y decisión de reintentar)
// ---------------------------------------------------------------------------

test.describe("scanRequest (sin navegador)", () => {
  test("newRequestId da un UUID v4 canónico y distinto cada vez, con o sin crypto.randomUUID", () => {
    const sinRandomUUID: CryptoLike = { getRandomValues: (a) => crypto.getRandomValues(a) };
    const randomUUIDQuePeta: CryptoLike = {
      randomUUID: () => {
        throw new Error("contexto no seguro");
      },
      getRandomValues: (a) => crypto.getRandomValues(a),
    };
    const getRandomValuesQuePeta: CryptoLike = {
      getRandomValues: () => {
        throw new Error("sin azar del sistema");
      },
    };
    const casos: [string, CryptoLike | undefined][] = [
      ["crypto del entorno", undefined],
      ["sin randomUUID (Safari < 15.4, Android WebView < 92, http)", sinRandomUUID],
      ["randomUUID que lanza", randomUUIDQuePeta],
      ["sin crypto: Math.random", {}],
      ["getRandomValues que lanza: Math.random", getRandomValuesQuePeta],
    ];
    for (const [nombre, api] of casos) {
      const ids = Array.from({ length: 1_000 }, () => newRequestId(api));
      for (const id of ids) expect(id, nombre).toMatch(UUID_V4);
      expect(new Set(ids).size, `${nombre}: ids repetidos`).toBe(ids.length);
    }
    // Si randomUUID funciona se usa tal cual.
    expect(newRequestId({ randomUUID: () => "11111111-2222-4333-8444-555555555555" })).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
  });

  test("esFuncionNoEncontrada: PGRST202 y el mensaje de PostgREST, y nada más", () => {
    const si: RpcErrorLike[] = [
      {
        code: "PGRST202",
        message: "Could not find the function public.scan_ticket(_device_info, _qr_token, _request_id) in the schema cache",
      },
      { code: "PGRST202", message: "" },
      { code: "PGRST202" },
      { message: "Could not find the function public.scan_ticket_by_code(_code) in the schema cache" },
    ];
    const no: (RpcErrorLike | null | undefined)[] = [
      null,
      undefined,
      {},
      {
        code: "PGRST203",
        message: "Could not choose the best candidate function between: public.scan_ticket(a), public.scan_ticket(b)",
      },
      { code: "42883", message: "function public.has_org_role(uuid) does not exist" },
      { code: "22P02", message: 'invalid input syntax for type uuid: "no-es-un-uuid"' },
      { code: "P0001", message: "Not authenticated" },
      { code: "PGRST301", message: "JWT expired" },
      { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      { code: "", message: "TypeError: Failed to fetch" },
      { message: "no Route matched with those values" },
    ];
    for (const error of si) expect(esFuncionNoEncontrada(error), JSON.stringify(error)).toBe(true);
    for (const error of no) expect(esFuncionNoEncontrada(error), JSON.stringify(error)).toBe(false);
  });

  /**
   * Una llamada simulada: apunta con qué `_request_id` se hizo y contesta según
   * `responder`. La llamada sin id se apunta como texto: toEqual ignora los
   * `undefined` de un array y no vería una repetición de más.
   */
  const SIN_ID = "(sin _request_id)";
  const servidorSimulado = (responder: (id: string | undefined, n: number) => { error: RpcErrorLike | null }) => {
    const enviados: string[] = [];
    return {
      enviados,
      request: async (id?: string) => {
        enviados.push(id ?? SIN_ID);
        return responder(id, enviados.length);
      },
    };
  };
  const noEncontrada: RpcErrorLike = {
    code: "PGRST202",
    message: "Could not find the function public.scan_ticket(…) in the schema cache",
  };
  const sinParametro = (id: string | undefined) => ({ error: id === undefined ? null : noEncontrada });

  test("el servidor admite _request_id: una sola llamada, con el id", async () => {
    const gate = createRequestIdGate();
    const s = servidorSimulado(() => ({ error: null }));
    await gate.send(s.request, "id-1");
    await gate.send(s.request, "id-2");
    expect(s.enviados).toEqual(["id-1", "id-2"]);
  });

  test("el servidor no admite _request_id: repite una vez sin él, lo recuerda y a los 10 min lo vuelve a probar", async () => {
    let ahora = 1_000_000;
    const gate = createRequestIdGate({ now: () => ahora });
    let migrada = false;
    const s = servidorSimulado((id) => (migrada ? { error: null } : sinParametro(id)));

    const primera = await gate.send(s.request, "id-1");
    expect(primera.error).toBeNull(); // devuelve la respuesta de la repetición sin id
    expect(s.enviados).toEqual(["id-1", SIN_ID]);

    ahora += 60_000;
    await gate.send(s.request, "id-2");
    expect(s.enviados, "recordado: ya no se prueba").toEqual(["id-1", SIN_ID, SIN_ID]);

    ahora += REQUEST_ID_RECHECK_MS; // pasado el plazo se vuelve a probar…
    await gate.send(s.request, "id-3");
    expect(s.enviados).toEqual(["id-1", SIN_ID, SIN_ID, "id-3", SIN_ID]);

    migrada = true; // …y cuando la BD ya lo admite, se usa y no se repite
    ahora += REQUEST_ID_RECHECK_MS;
    await gate.send(s.request, "id-4");
    await gate.send(s.request, "id-5");
    expect(s.enviados.slice(5)).toEqual(["id-4", "id-5"]);
  });

  test("si el reloj del móvil retrocede, lo recordado no se queda para siempre", async () => {
    let ahora = 10_000_000;
    const gate = createRequestIdGate({ now: () => ahora });
    const s = servidorSimulado(sinParametro);
    await gate.send(s.request, "id-1"); // se recuerda a las 10_000_000
    ahora -= 3_600_000; // alguien corrige la hora del móvil una hora atrás
    await gate.send(s.request, "id-2");
    expect(s.enviados).toEqual(["id-1", SIN_ID, "id-2", SIN_ID]);
  });

  test("otros errores se devuelven tal cual: sin repetir y sin recordar nada", async () => {
    const gate = createRequestIdGate();
    const errores: RpcErrorLike[] = [
      { code: "P0001", message: "Not authenticated" },
      { code: "PGRST203", message: "Could not choose the best candidate function between: a, b" },
      { code: "42883", message: "function public.has_org_role(uuid) does not exist" },
      { code: "", message: "TypeError: Failed to fetch" },
    ];
    for (const [i, error] of errores.entries()) {
      const s = servidorSimulado(() => ({ error }));
      const respuesta = await gate.send(s.request, `id-${i}`);
      expect(respuesta.error).toBe(error);
      expect(s.enviados).toEqual([`id-${i}`]);
    }
    // Tras todos esos errores, un servidor normal sigue recibiendo _request_id.
    const s = servidorSimulado(() => ({ error: null }));
    await gate.send(s.request, "id-final");
    expect(s.enviados).toEqual(["id-final"]);
  });

  test("si sin _request_id tampoco encuentra la función, se enseña ese error y no se recuerda nada", async () => {
    const gate = createRequestIdGate();
    const s = servidorSimulado(() => ({ error: noEncontrada }));
    const respuesta = await gate.send(s.request, "id-1");
    expect(respuesta.error).toBe(noEncontrada);
    expect(s.enviados).toEqual(["id-1", SIN_ID]);
    await gate.send(s.request, "id-2");
    expect(s.enviados, "la culpa no era de _request_id: se sigue enviando").toEqual([
      "id-1",
      SIN_ID,
      "id-2",
      SIN_ID,
    ]);
  });

  test("pasado el plazo de la lectura no se lanza la repetición", async () => {
    let ahora = 5_000;
    const gate = createRequestIdGate({ now: () => ahora });
    const s = servidorSimulado((id) => {
      ahora += 9_000; // la primera respuesta tarda 9 s
      return sinParametro(id);
    });
    const respuesta = await gate.send(s.request, "id-1", 5_000 + 8_000);
    expect(respuesta.error).toBe(noEncontrada);
    expect(s.enviados, "nadie esperaría esa respuesta: la entrada se marcaría a escondidas").toEqual(["id-1"]);
  });

  test("una llamada que se rechaza (no devuelve error) se propaga sin repetir", async () => {
    const gate = createRequestIdGate();
    const enviados: string[] = [];
    const rota = async (id?: string): Promise<{ error: RpcErrorLike | null }> => {
      enviados.push(id ?? SIN_ID);
      throw new Error("boom");
    };
    await expect(gate.send(rota, "id-1")).rejects.toThrow("boom");
    expect(enviados).toEqual(["id-1"]);
  });
});
