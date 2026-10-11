import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso } from "./support/fake-supabase";

/**
 * Editor de eventos (WP11 B): el borrador de «Nuevo evento» no se pierde, las
 * imágenes del local (logo y portada) se reducen y solo admiten JPG, PNG y
 * WebP, y el editor y el diálogo de cancelar avisan de lo que verán o
 * recibirán los compradores.
 *
 * Supabase simulado (support/fake-supabase.ts).
 *
 * Solo corre con su propia config (arranca Vite con el Supabase falso):
 *   npm run test:e2e:partner
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

type Fila = Record<string, unknown>;

let erroresJs: string[] = [];

test.afterEach(async ({ page }) => {
  // Respuestas aún en vuelo al cerrar la página: que no fallen en el cierre.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  expect(erroresJs, "Errores JS en la página").toEqual([]);
});

async function responderJson(route: Route, json: unknown, status = 200) {
  const req = route.request();
  await route.fulfill({
    status,
    headers: {
      "access-control-allow-origin": req.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-expose-headers": "content-range, x-supabase-api-version",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(json),
  });
}

async function abrirPanel(page: Page, antesDeEntrar?: () => Promise<void>) {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page);
  await antesDeEntrar?.();
  await page.goto("/#/partner-dashboard");
  // La primera carga de Vite en frío (optimización de dependencias) puede tardar.
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 90_000 });
  return supabase;
}

const irAMisEventos = (page: Page) =>
  page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();

/** «Mis eventos» → «Nuevo evento». */
async function abrirNuevoEvento(page: Page): Promise<Locator> {
  await irAMisEventos(page);
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo evento" });
  await expect(editor.getByText(/^Paso \d\d \/ 06$/)).toBeVisible();
  return editor;
}

/**
 * «Mis eventos» (en su pestaña, si no es la de Próximos) → «Acciones del
 * evento» → «Editar evento» del evento con ese título.
 */
async function abrirEdicion(page: Page, titulo: string, pestana?: string): Promise<Locator> {
  await irAMisEventos(page);
  if (pestana) {
    await page.getByRole("tablist", { name: "Eventos por estado" }).getByRole("tab", { name: new RegExp(`^${pestana}`) }).click();
  }
  await page
    .locator("main table tbody tr")
    .filter({ hasText: titulo })
    .getByRole("button", { name: "Acciones del evento" })
    .click();
  await page.getByRole("menuitem", { name: "Editar evento" }).click();
  const editor = page.getByRole("dialog", { name: "Editar evento" });
  await expect(editor.locator("#evt-title")).toHaveValue(titulo);
  return editor;
}

const paso = (editor: Locator, n: number) => editor.getByText(`Paso ${String(n).padStart(2, "0")} / 06`);
const siguiente = (editor: Locator) => editor.getByRole("button", { name: "Siguiente" });

/** Hora «HH:mm» en el selector de horas (columna de horas, luego la de minutos). */
async function elegirHora(page: Page, editor: Locator, id: "#evt-start" | "#evt-end", hhmm: string) {
  const [hh, mm] = hhmm.split(":");
  await editor.locator(id).click();
  const selector = page.locator("[data-radix-popper-content-wrapper]").last();
  await selector.getByRole("button", { name: hh, exact: true }).first().click();
  // Al elegir los minutos se cierra.
  await selector.getByRole("button", { name: mm, exact: true }).last().click();
  await expect(selector).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Punto 4 · el borrador de «Nuevo evento» no se pierde
// ---------------------------------------------------------------------------

/** Clave del borrador de «Nuevo evento» del local de prueba (lib/drafts: pasify.draft.<uid>.<formulario>). */
const CLAVE_BORRADOR = `pasify.draft.${IDS.usuario}.evento.${IDS.usuario}`;

/** Borrador guardado en el dispositivo (null si no hay). */
const leerBorrador = (page: Page) =>
  page.evaluate((clave) => {
    const raw = window.localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as { savedAt: number; data: { title: string } }) : null;
  }, CLAVE_BORRADOR);

/** Como cuando el usuario cambia de app o de pestaña (la misma emulación que partner-cache.spec.ts). */
const ocultarPestana = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });

/** Borrador completo y válido (BorradorEvento de EventEditorWizard) con un título y un paso dados (0 a 5). */
const borradorDe = (titulo: string, pasoInicial: number, fecha = "2099-06-12") => ({
  v: 1,
  step: pasoInicial,
  title: titulo,
  description: "",
  dateTime: { date: fecha, startTime: "23:30", endTime: "06:00" },
  location: { city: "Madrid", venueName: "Sala E2E · Principal", address: "Calle de Prueba 1" },
  tiers: [
    {
      _key: "tipo-0",
      name: "General",
      description: "",
      priceEur: "15.00",
      capacity: "",
      perUserMax: "4",
      active: true,
      refundMode: "none",
      refundHours: "48",
      transferAllowed: true,
    },
  ],
  imageUrl: "",
  willPublish: false,
  venueId: IDS.local,
  timeZone: "Europe/Madrid",
});

test.describe("borrador de «Nuevo evento»", () => {
  test("recargar la página justo después de escribir no pierde lo escrito", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Recién escrito");
    // Sin esperar a la pausa de 400 ms con la que se guarda.
    await page.reload();

    const dialogo = page.getByRole("dialog", { name: "Nuevo evento" });
    await expect(dialogo.locator("#evt-title")).toHaveValue("Recién escrito", { timeout: 30_000 });
    await expect(dialogo.getByText(/Borrador recuperado/)).toBeVisible();
  });

  test("al ocultar la pestaña se guarda ya, sin esperar a la pausa", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Al cambiar de app");
    await ocultarPestana(page);
    expect((await leerBorrador(page))?.data.title, "no se guardó al ocultar la pestaña").toBe("Al cambiar de app");
  });

  test("al irse la página (pagehide) se guarda ya, sin esperar a la pausa", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Al salir");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    expect((await leerBorrador(page))?.data.title, "no se guardó con pagehide").toBe("Al salir");
  });

  test("al cerrar el asistente se guarda lo último y se recupera al volver a abrirlo", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Al cerrar");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Nuevo evento" })).toHaveCount(0);
    expect((await leerBorrador(page))?.data.title, "se perdió lo último al cerrar").toBe("Al cerrar");

    await page.getByRole("button", { name: "Nuevo evento" }).click();
    await expect(page.getByRole("dialog", { name: "Nuevo evento" }).locator("#evt-title")).toHaveValue("Al cerrar");
  });

  test("si el dispositivo no deja guardar, se avisa una sola vez", async ({ page }) => {
    // Almacenamiento lleno: los borradores no caben.
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, clave: string, valor: string) {
        if (String(clave).startsWith("pasify.draft.")) {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return original.call(this, clave, valor);
      };
    });
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    const titulo = editor.locator("#evt-title");
    const aviso = page.getByText("No se puede guardar el borrador");

    await titulo.fill("Sin espacio");
    await expect(aviso).toBeVisible();
    // Más cambios: no vuelve a avisar.
    await titulo.fill("Sin espacio todavía");
    await page.waitForTimeout(800);
    await expect(aviso).toHaveCount(1);
    // Ni cuando el primer aviso ya se ha ido.
    await expect(aviso).toHaveCount(0, { timeout: 15_000 });
    await titulo.fill("Sin espacio otra vez");
    await page.waitForTimeout(800);
    await expect(aviso).toHaveCount(0);
    // El formulario sigue funcionando.
    await expect(titulo).toHaveValue("Sin espacio otra vez");
  });

  test("no pisa un borrador guardado después (otra pestaña)", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Mío");
    // Otra pestaña guarda un borrador más nuevo mientras este espera su pausa.
    await page.evaluate(
      ({ clave, borrador }) =>
        window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now() + 1_000, data: borrador })),
      { clave: CLAVE_BORRADOR, borrador: borradorDe("De otra pestaña", 0) },
    );
    await ocultarPestana(page);
    expect((await leerBorrador(page))?.data.title).toBe("De otra pestaña");
    // Y la pausa de 400 ms tampoco lo pisa.
    await page.waitForTimeout(700);
    expect((await leerBorrador(page))?.data.title, "pisó el borrador más nuevo").toBe("De otra pestaña");
  });

  test("guardar el evento no deja su borrador por detrás, aunque se haya tocado un instante antes", async ({ page }) => {
    await page.addInitScript(
      ({ clave, borrador }) =>
        window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: borrador })),
      { clave: CLAVE_BORRADOR, borrador: borradorDe("Para guardar", 0) },
    );
    let creacion!: Awaited<ReturnType<typeof simularCreacion>>;
    await abrirPanel(page, async () => {
      creacion = await simularCreacion(page);
    });
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 1)).toBeVisible();
    // Lo que se escribe se guarda al ocultar la pestaña, sin esperar a la pausa.
    await editor.locator("#evt-title").fill("Para guardar (retocado)");
    await ocultarPestana(page);
    expect((await leerBorrador(page))?.data.title).toBe("Para guardar (retocado)");

    // Cada cambio de paso deja un borrador pendiente de escribir: al guardar el
    // evento, el último pendiente no puede revivir el borrador.
    for (const n of [2, 3, 4, 5, 6]) {
      await siguiente(editor).click();
      await expect(paso(editor, n)).toBeVisible();
    }
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado").first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Nuevo evento" })).toHaveCount(0);
    expect(creacion.eventos).toHaveLength(1);

    // Pasada la pausa, el borrador del evento ya guardado no ha vuelto.
    await page.waitForTimeout(800);
    expect(await leerBorrador(page), "el borrador reapareció tras guardar").toBeNull();
  });
});

/** Escrituras de «Nuevo evento»: el evento y sus tipos, con lo que mandó la app. */
async function simularCreacion(page: Page) {
  const eventos: Fila[] = [];
  const tipos: Fila[] = [];
  await page.route(
    (url) =>
      url.origin === ORIGEN_SUPABASE && (url.pathname === "/rest/v1/events" || url.pathname === "/rest/v1/ticket_tiers"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      const cuerpo = req.postDataJSON() as Fila | Fila[];
      if (new URL(req.url()).pathname.endsWith("/events")) {
        eventos.push(cuerpo as Fila);
        return responderJson(route, [{ id: "5e2e0000-0000-4000-8000-0000000000e1" }], 201);
      }
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      tipos.push(...filas);
      return responderJson(
        route,
        filas.map((_, i) => ({ id: `5e2e0000-0000-4000-8000-0000000000f${i}` })),
        201,
      );
    },
  );
  return { eventos, tipos };
}

// ---------------------------------------------------------------------------
// Punto 5 · imágenes del local (logo y portada)
// ---------------------------------------------------------------------------

/** Imagen de prueba generada en el navegador (un color liso comprime a casi nada, pero tiene sus dimensiones). */
async function crearImagen(
  page: Page,
  { ancho, alto, tipo, conTransparencia }: { ancho: number; alto: number; tipo: string; conTransparencia?: boolean },
): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ ancho, alto, tipo, conTransparencia }) => {
      const canvas = document.createElement("canvas");
      canvas.width = ancho;
      canvas.height = alto;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#e8542a";
      // Con transparencia, solo el centro está pintado.
      if (conTransparencia) ctx.fillRect(ancho / 4, alto / 4, ancho / 2, alto / 2);
      else ctx.fillRect(0, 0, ancho, alto);
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), tipo, 0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { ancho, alto, tipo, conTransparencia },
  );
  return Buffer.from(bytes);
}

/** Ancho y alto de un PNG (cabecera IHDR) dentro de un cuerpo multipart. */
function dimensionesPng(cuerpo: Buffer): { ancho: number; alto: number } | null {
  const i = cuerpo.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return i < 0 ? null : { ancho: cuerpo.readUInt32BE(i + 16), alto: cuerpo.readUInt32BE(i + 20) };
}

/** Ancho y alto de un JPEG (marcador SOF) dentro de un cuerpo multipart. */
function dimensionesJpeg(cuerpo: Buffer): { ancho: number; alto: number } | null {
  for (let i = cuerpo.indexOf(Buffer.from([0xff, 0xd8])); i >= 0 && i < cuerpo.length - 9; i++) {
    if (cuerpo[i] === 0xff && (cuerpo[i + 1] === 0xc0 || cuerpo[i + 1] === 0xc2)) {
      return { alto: cuerpo.readUInt16BE(i + 5), ancho: cuerpo.readUInt16BE(i + 7) };
    }
  }
  return null;
}

/** Subidas al bucket del branding: el cuerpo (multipart) tal como lo manda la app. */
async function capturarSubidas(page: Page) {
  const subidas: Array<{ ruta: string; cuerpo: Buffer }> = [];
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname.startsWith("/storage/v1/object/partner-branding/"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      subidas.push({ ruta: new URL(req.url()).pathname, cuerpo: req.postDataBuffer() ?? Buffer.alloc(0) });
      await responderJson(route, { Key: "partner-branding/prueba" });
    },
  );
  return subidas;
}

test.describe("imágenes del local", () => {
  /** Configuración → Branding: los selectores de archivo del logo y de la portada. */
  async function abrirBranding(page: Page) {
    await page.locator("aside").getByRole("button", { name: "Configuración" }).click();
    const archivos = page.getByRole("dialog").locator('input[type="file"]');
    await expect(archivos).toHaveCount(2);
    return { logo: archivos.nth(0), portada: archivos.nth(1) };
  }

  test("el logo se reduce antes de subirlo y un PNG sigue siendo PNG (con su transparencia)", async ({ page }) => {
    let subidas!: Awaited<ReturnType<typeof capturarSubidas>>;
    await abrirPanel(page, async () => {
      subidas = await capturarSubidas(page);
    });
    const { logo } = await abrirBranding(page);
    const original = await crearImagen(page, { ancho: 3000, alto: 3000, tipo: "image/png", conTransparencia: true });

    await logo.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: original });
    await expect(page.getByText("Imagen subida").first()).toBeVisible();

    expect(subidas).toHaveLength(1);
    const { ruta, cuerpo } = subidas[0];
    expect(ruta).toMatch(/\/logo\/\d+-[a-z0-9]+\.png$/);
    expect(cuerpo.toString("latin1"), "se subió con otro formato").toContain("Content-Type: image/png");
    const medidas = dimensionesPng(cuerpo);
    expect(medidas, "no se encontró el PNG subido").not.toBeNull();
    expect(medidas!.ancho).toBeLessThanOrEqual(512);
    expect(medidas!.alto).toBeLessThanOrEqual(512);
  });

  test("la portada se reduce antes de subirla y un JPEG sigue siendo JPEG", async ({ page }) => {
    let subidas!: Awaited<ReturnType<typeof capturarSubidas>>;
    await abrirPanel(page, async () => {
      subidas = await capturarSubidas(page);
    });
    const { portada } = await abrirBranding(page);
    const original = await crearImagen(page, { ancho: 4000, alto: 3000, tipo: "image/jpeg" });

    await portada.setInputFiles({ name: "portada.jpg", mimeType: "image/jpeg", buffer: original });
    await expect(page.getByText("Imagen subida").first()).toBeVisible();

    expect(subidas).toHaveLength(1);
    const { ruta, cuerpo } = subidas[0];
    expect(ruta).toMatch(/\/cover\/\d+-[a-z0-9]+\.jpg$/);
    expect(cuerpo.toString("latin1")).toContain("Content-Type: image/jpeg");
    const medidas = dimensionesJpeg(cuerpo);
    expect(medidas, "no se encontró el JPEG subido").not.toBeNull();
    expect(medidas!.ancho).toBeLessThanOrEqual(1600);
    expect(medidas!.alto).toBeLessThanOrEqual(900);
  });

  test("solo JPG, PNG y WebP: GIF y HEIC se rechazan con un mensaje claro, y el tamaño máximo sigue valiendo", async ({
    page,
  }) => {
    let subidas!: Awaited<ReturnType<typeof capturarSubidas>>;
    await abrirPanel(page, async () => {
      subidas = await capturarSubidas(page);
    });
    const { logo } = await abrirBranding(page);
    // El selector ya no ofrece GIF.
    await expect(logo).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");

    await logo.setInputFiles({ name: "animado.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByText("Los GIF no se admiten. Sube una imagen JPG, PNG o WebP.")).toBeVisible();

    await logo.setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from("heic") });
    await expect(page.getByText("Las fotos en formato HEIC no se admiten. Sube una imagen JPG, PNG o WebP.")).toBeVisible();

    // Más de 5 MB: como hasta ahora.
    await logo.setInputFiles({ name: "enorme.png", mimeType: "image/png", buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
    await expect(page.getByText(/Máximo 5MB\. El tuyo pesa 6\.0MB/)).toBeVisible();

    expect(subidas, "se subió algo que no debía").toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Punto 6 · avisos
// ---------------------------------------------------------------------------

test.describe("avisos", () => {
  test("editar el día, la hora o el lugar de un evento publicado con ventas avisa de que los compradores lo verán (sin ventas, no)", async ({
    page,
  }) => {
    await abrirPanel(page);
    // «Concierto E2E»: publicado y con 40 entradas vendidas.
    const editor = await abrirEdicion(page, "Concierto E2E");
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    const aviso = editor.getByTestId("aviso-cambio-con-ventas");
    // Sin tocar nada, nada que avisar.
    await expect(editor.locator("#evt-start")).toBeVisible();
    await expect(aviso).toHaveCount(0);

    // El lugar (el evento de prueba no trae dirección: ponerla ya es un cambio).
    await editor.getByLabel("Ubicación exacta").fill("Calle de Prueba 1");
    await expect(aviso).toContainText("Has cambiado el lugar de un evento publicado que ya tiene entradas vendidas");
    await expect(aviso).toContainText("Pasify no les avisa");

    // La hora, a otra distinta de la que tiene.
    const horaActual = Number((await editor.locator("#evt-start").innerText()).slice(0, 2));
    await elegirHora(page, editor, "#evt-start", `${String((horaActual + 3) % 24).padStart(2, "0")}:00`);
    await expect(aviso).toContainText("Has cambiado la hora y el lugar");

    // También al revisar, antes de guardar; y solo avisa: se guarda igual.
    await editor.getByRole("button", { name: /Resumen$/ }).first().click();
    await expect(paso(editor, 6)).toBeVisible();
    await expect(editor.getByTestId("aviso-cambio-con-ventas")).toContainText("Has cambiado la hora y el lugar");
    await expect(editor.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();

    // Un borrador (sin publicar, sin ventas) se edita sin aviso.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Editar evento" })).toHaveCount(0);
    const borrador = await abrirEdicion(page, "Borrador E2E", "Borradores");
    await borrador.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await borrador.getByLabel("Ubicación exacta").fill("Otra calle 2");
    await elegirHora(page, borrador, "#evt-start", "20:00");
    await expect(borrador.getByTestId("aviso-cambio-con-ventas")).toHaveCount(0);
  });

  test("cancelar un evento dice cuántas entradas y cuántos euros se devolverán", async ({ page }) => {
    await abrirPanel(page);
    await irAMisEventos(page);
    // «Noche E2E»: publicada; en el mock, 6 entradas de 15 €, 2 de ellas ya escaneadas.
    await page
      .locator("main table tbody tr")
      .filter({ hasText: "Noche E2E" })
      .getByRole("button", { name: "Acciones del evento" })
      .click();
    await page.getByRole("menuitem", { name: "Cancelar evento" }).click();

    const dialogo = page.getByRole("alertdialog");
    const resumen = dialogo.getByTestId("resumen-reembolso");
    await expect(resumen).toContainText("Se devolverán 4 entradas (60,00 €).");
    await expect(resumen).toContainText("2 ya han entrado y no se devuelven.");
    await expect(dialogo.getByRole("button", { name: "Cancelar evento y reembolsar" })).toBeDisabled();
  });
});
