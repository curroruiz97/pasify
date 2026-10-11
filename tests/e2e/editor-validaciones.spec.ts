import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso } from "./support/fake-supabase";

/**
 * Editor de eventos (WP11 A): validaciones de cupo, máximo por usuario y
 * precio, fecha y hora (fin igual al inicio, eventos de más de 14 h, HH:mm
 * válida, cambio de hora) y confirmación al publicar con el inicio pasado.
 *
 * Supabase simulado (support/fake-supabase.ts). Para llegar a un paso o a una
 * fecha concreta sin recorrer el calendario, algunos tests siembran el
 * borrador de «Nuevo evento» (lib/drafts) en localStorage; el resto lo
 * rellenan a mano.
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

// ---------------------------------------------------------------------------
// Borrador de «Nuevo evento» sembrado en localStorage
// ---------------------------------------------------------------------------

interface TipoSemilla {
  name?: string;
  priceEur?: string;
  capacity?: string;
  perUserMax?: string;
}

interface Semilla {
  /** Paso en el que se abre el asistente (0 a 5). */
  step: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  tiers?: TipoSemilla[];
}

const CLAVE_BORRADOR = `pasify.draft.${IDS.usuario}.evento.${IDS.usuario}`;

/** Borrador completo y válido (BorradorEvento de EventEditorWizard) con lo que pida el test. */
function borradorDe(s: Semilla) {
  return {
    v: 1,
    step: s.step,
    title: "Noche de prueba",
    description: "",
    dateTime: { date: s.date ?? "2099-06-12", startTime: s.startTime ?? "23:30", endTime: s.endTime ?? "06:00" },
    location: { city: "Madrid", venueName: "Sala E2E · Principal", address: "Calle de Prueba 1" },
    tiers: (s.tiers ?? [{}]).map((t, i) => ({
      _key: `tipo-${i}`,
      name: "General",
      description: "",
      priceEur: "15.00",
      capacity: "",
      perUserMax: "4",
      active: true,
      refundMode: "none",
      refundHours: "48",
      transferAllowed: true,
      ...t,
    })),
    imageUrl: "",
    willPublish: true,
    venueId: IDS.local,
    timeZone: "Europe/Madrid",
  };
}

/** Siembra el borrador antes de que cargue la app. */
async function sembrarBorrador(page: Page, s: Semilla) {
  await page.addInitScript(
    ({ clave, borrador }) => {
      try {
        window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: borrador }));
      } catch {
        /* sin storage */
      }
    },
    { clave: CLAVE_BORRADOR, borrador: borradorDe(s) },
  );
}

/** Siembra el borrador con la app ya cargada (antes de volver a abrir «Nuevo evento»). */
async function sembrarBorradorAhora(page: Page, s: Semilla) {
  await page.evaluate(
    ({ clave, borrador }) => window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: borrador })),
    { clave: CLAVE_BORRADOR, borrador: borradorDe(s) },
  );
}

// ---------------------------------------------------------------------------
// Panel y editor
// ---------------------------------------------------------------------------

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

/** «Mis eventos» → «Nuevo evento». */
async function abrirNuevoEvento(page: Page): Promise<Locator> {
  await page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo evento" });
  await expect(editor.getByText(/^Paso \d\d \/ 06$/)).toBeVisible();
  return editor;
}

/** «Mis eventos» → «Acciones del evento» → «Editar evento» del evento con ese título. */
async function abrirEdicion(page: Page, titulo: string): Promise<Locator> {
  await page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();
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

/** Marca de «el evento acaba al día siguiente» (el subtítulo del paso dice algo parecido, de ahí la frase entera). */
const cruzaMedianoche = (editor: Locator) => editor.getByText("El evento cruza medianoche · finaliza al día siguiente");

/** «Siguiente»: devuelve el botón para poder pulsarlo. */
const siguiente = (editor: Locator) => editor.getByRole("button", { name: "Siguiente" });

/** Día 15 del mes siguiente en el calendario del editor (siempre futuro y sin repetirse en la rejilla). */
async function elegirDiaDelMesQueViene(page: Page, editor: Locator) {
  await editor.locator("#evt-date").click();
  await page.locator("button[name='next-month']").click();
  await page.getByRole("gridcell", { name: "15", exact: true }).click();
}

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

/** Nuevo evento recién abierto → título → «Cuándo y dónde» con un día futuro elegido. */
async function llegarACuandoYDonde(page: Page): Promise<Locator> {
  const editor = await abrirNuevoEvento(page);
  await editor.locator("#evt-title").fill("Fiesta de prueba");
  await siguiente(editor).click();
  await expect(paso(editor, 2)).toBeVisible();
  await elegirDiaDelMesQueViene(page, editor);
  return editor;
}

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
// Punto 1 · cupo y «máx. por usuario»
// ---------------------------------------------------------------------------

const MSG_CUPO = "Escribe un número entero de 1 o más, o déjalo vacío para no poner límite.";
const MSG_MAX = "Escribe un número entero entre 1 y 10.";

test.describe("cupo y máximo por usuario", () => {
  test("lo que no es un entero válido se marca en el campo y no deja pasar de paso", async ({ page }) => {
    await sembrarBorrador(page, { step: 2 });
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 3)).toBeVisible();
    const cupo = editor.getByLabel("Cupo");
    const maximo = editor.getByLabel("Máx. por usuario");

    // Cupo: decimales, negativos, cero y notación científica (parseInt los leía como 2, -3, 0 y 1).
    for (const mal of ["2.5", "-3", "0", "1e3"]) {
      await cupo.fill(mal);
      await expect(editor.getByText(MSG_CUPO), `cupo «${mal}» sin aviso en el campo`).toBeVisible();
      await expect(cupo).toHaveAttribute("aria-invalid", "true");
      await siguiente(editor).click();
      await expect(page.getByText(/El cupo de "General" no es válido/).first()).toBeVisible();
      await expect(paso(editor, 3), `cupo «${mal}» deja avanzar`).toBeVisible();
    }
    // Vacío es «sin límite»; un entero vale.
    await cupo.fill("");
    await expect(editor.getByText(MSG_CUPO)).toHaveCount(0);
    await cupo.fill("120");
    await expect(editor.getByText(MSG_CUPO)).toHaveCount(0);
    await expect(cupo).not.toHaveAttribute("aria-invalid", "true");

    // Máximo por usuario: 0 y negativos dejaban el tipo sin poder venderse; vacío y más de 10, tampoco.
    for (const mal of ["0", "-1", "11", "2.5", ""]) {
      await maximo.fill(mal);
      await expect(editor.getByText(MSG_MAX), `máximo «${mal}» sin aviso en el campo`).toBeVisible();
      await expect(maximo).toHaveAttribute("aria-invalid", "true");
      await siguiente(editor).click();
      await expect(page.getByText(/El máximo por usuario de "General" no es válido/).first()).toBeVisible();
      await expect(paso(editor, 3), `máximo «${mal}» deja avanzar`).toBeVisible();
    }
    await maximo.fill("10");
    await expect(editor.getByText(MSG_MAX)).toHaveCount(0);
    await siguiente(editor).click();
    await expect(paso(editor, 4)).toBeVisible();
  });

  test("un cupo menor que lo ya vendido se marca en el campo (edición con ventas)", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirEdicion(page, "Concierto E2E");
    // El evento de prueba no trae dirección: sin ella no se llega al paso de tipos.
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await editor.getByLabel("Ubicación exacta").fill("Calle de Prueba 1");
    await editor.getByRole("button", { name: /Tipos de entrada/ }).click();

    const cupo = editor.getByLabel(/^Cupo/);
    await expect(cupo).toHaveValue("200");
    await cupo.fill("30");
    await expect(editor.getByText("No puede ser menor que las entradas ya vendidas (40).")).toBeVisible();
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();
    await cupo.fill("40");
    await expect(editor.getByText(/No puede ser menor/)).toHaveCount(0);
    await siguiente(editor).click();
    await expect(paso(editor, 4)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Punto 2 · precio
// ---------------------------------------------------------------------------

test.describe("precio", () => {
  test("solo cifras con hasta dos decimales; el mínimo de cobro es 0,50 € (o gratis)", async ({ page }) => {
    await sembrarBorrador(page, { step: 2 });
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    const precio = editor.getByLabel(/^Precio/);
    const MSG_PRECIO = "Escribe el precio en euros con hasta dos decimales, por ejemplo 12,50.";

    // «12.999» se redondeaba a 13 €, «1e3» pasaba por 1.000 € y «0.001» se quedaba en 0 € (gratis).
    for (const mal of ["12.999", "1e3", "0.001"]) {
      await precio.fill(mal);
      await expect(editor.getByText(MSG_PRECIO), `precio «${mal}» sin aviso en el campo`).toBeVisible();
      await expect(precio).toHaveAttribute("aria-invalid", "true");
      await siguiente(editor).click();
      await expect(page.getByText(/El precio del ticket "General" no es válido/).first()).toBeVisible();
      await expect(paso(editor, 3), `precio «${mal}» deja avanzar`).toBeVisible();
    }

    // Entre 0,01 y 0,49 € Stripe no cobra.
    await precio.fill("0.30");
    await expect(editor.getByText("El mínimo que se puede cobrar es 0,50 €.")).toBeVisible();
    await expect(editor.getByText(MSG_PRECIO)).toHaveCount(0);
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();

    // 0 € (gratis), 0,50 € y un precio normal valen.
    for (const bien of ["0", "0.50", "12.5"]) {
      await precio.fill(bien);
      await expect(editor.getByText(MSG_PRECIO), `precio «${bien}» marcado`).toHaveCount(0);
      await expect(editor.getByText("El mínimo que se puede cobrar es 0,50 €.")).toHaveCount(0);
    }
    await siguiente(editor).click();
    await expect(paso(editor, 4)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Punto 3 · fecha y hora
// ---------------------------------------------------------------------------

test.describe("fecha y hora", () => {
  test("un fin igual al inicio no se convierte en 24 h: se rechaza", async ({ page }) => {
    await abrirPanel(page);
    const editor = await llegarACuandoYDonde(page);
    // Por defecto 23:30 → 06:00 (cruza medianoche). Fin = inicio.
    await expect(cruzaMedianoche(editor)).toBeVisible();
    await elegirHora(page, editor, "#evt-end", "23:30");

    await expect(editor.getByTestId("evt-error-horas")).toContainText("La hora de finalización es la misma que la de inicio");
    await expect(cruzaMedianoche(editor), "se dio por bueno un evento de 24 h").toHaveCount(0);
    await siguiente(editor).click();
    await expect(page.getByText(/La hora de finalización es la misma que la de inicio/).first()).toBeVisible();
    await expect(paso(editor, 2), "dejó avanzar con fin = inicio").toBeVisible();

    // Otra hora de fin y sigue.
    await elegirHora(page, editor, "#evt-end", "06:00");
    await expect(editor.getByTestId("evt-error-horas")).toHaveCount(0);
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();
  });

  test("más de 14 horas avisa pero no bloquea", async ({ page }) => {
    await abrirPanel(page);
    const editor = await llegarACuandoYDonde(page);
    // 23:30 → 06:00 son 6,5 h: nada que avisar.
    await expect(editor.getByTestId("evt-aviso-horario")).toHaveCount(0);

    // 10:00 → 06:00 del día siguiente son 20 h.
    await elegirHora(page, editor, "#evt-start", "10:00");
    const aviso = editor.getByTestId("evt-aviso-horario");
    await expect(aviso).toHaveCount(1);
    await expect(aviso).toContainText("El evento dura 20 h (de 10:00 a 06:00 del día siguiente)");
    // Solo avisa: se puede seguir.
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();

    // Con una hora de fin razonable el aviso desaparece.
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await elegirHora(page, editor, "#evt-end", "14:00");
    await expect(editor.getByTestId("evt-aviso-horario")).toHaveCount(0);
  });

  test("una hora que no es HH:mm (borrador dañado) no mueve el evento de día en silencio", async ({ page }) => {
    // 25:61 se leía como 26:01 del día siguiente; el selector la enseñaba como 23:59.
    await sembrarBorrador(page, { step: 1, date: "2099-06-12", startTime: "25:61" });
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 2)).toBeVisible();

    await expect(editor.getByTestId("evt-error-horas")).toContainText("La hora de inicio no es válida");
    await siguiente(editor).click();
    await expect(page.getByText(/La hora de inicio no es válida/).first()).toBeVisible();
    await expect(paso(editor, 2), "dejó avanzar con una hora de inicio imposible").toBeVisible();

    // Elegirla de nuevo lo arregla.
    await elegirHora(page, editor, "#evt-start", "23:30");
    await expect(editor.getByTestId("evt-error-horas")).toHaveCount(0);
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();
  });

  // Europe/Madrid: el último domingo de marzo los relojes pasan de las 02:00 a las
  // 03:00 (02:30 no existe) y el último de octubre de las 03:00 a las 02:00 (02:30
  // pasa dos veces). Se guardaba la hora corrida o la segunda vez sin decir nada.
  const CAMBIOS_DE_HORA = [
    {
      nombre: "salto de primavera: la hora de inicio no existe",
      semilla: { date: "2027-03-28", startTime: "02:30", endTime: "06:00" },
      texto: ["La hora de inicio (02:30) no existe ese día en Madrid", "El evento empezará a las 03:30"],
      // Una hora que sí existe ese mismo día no avisa.
      arreglo: { id: "#evt-start" as const, hora: "04:00" },
    },
    {
      nombre: "cambio de otoño: la hora de inicio se repite",
      semilla: { date: "2026-10-25", startTime: "02:30", endTime: "06:00" },
      texto: ["La hora de inicio (02:30) se repite ese día en Madrid", "Se toma la segunda"],
      arreglo: { id: "#evt-start" as const, hora: "04:00" },
    },
    {
      nombre: "salto de primavera: la hora de fin no existe",
      semilla: { date: "2027-03-27", startTime: "23:30", endTime: "02:30" },
      texto: ["La hora de finalización (02:30) no existe ese día en Madrid", "El evento terminará a las 03:30"],
      arreglo: { id: "#evt-end" as const, hora: "05:00" },
    },
  ];
  for (const c of CAMBIOS_DE_HORA) {
    test(`cambio de hora · ${c.nombre}`, async ({ page }) => {
      await sembrarBorrador(page, { step: 1, ...c.semilla });
      await abrirPanel(page);
      const editor = await abrirNuevoEvento(page);
      await expect(paso(editor, 2)).toBeVisible();
      const aviso = editor.getByTestId("evt-aviso-horario");
      await expect(aviso).toHaveCount(1);
      for (const parte of c.texto) await expect(aviso).toContainText(parte);
      // Solo avisa: se puede seguir (y volver).
      await siguiente(editor).click();
      await expect(paso(editor, 3)).toBeVisible();
      await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
      await expect(aviso).toHaveCount(1);

      // Con una hora que sí existe ese día, el aviso se va.
      await elegirHora(page, editor, c.arreglo.id, c.arreglo.hora);
      await expect(aviso).toHaveCount(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Punto 3e · publicar con el inicio ya pasado
// ---------------------------------------------------------------------------

test.describe("publicar con el inicio pasado", () => {
  test("pide confirmación al publicar; un borrador con fecha pasada se guarda sin preguntar", async ({ page }) => {
    let creacion!: Awaited<ReturnType<typeof simularCreacion>>;
    await sembrarBorrador(page, { step: 5, date: "2020-03-14", startTime: "23:30", endTime: "06:00" });
    await abrirPanel(page, async () => {
      creacion = await simularCreacion(page);
    });

    // 1) «Guardar borrador» con fecha pasada: sin preguntas (borradores históricos para gestión interna).
    let editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 6)).toBeVisible();
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado").first()).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(creacion.eventos).toHaveLength(1);
    expect(creacion.eventos[0]).toMatchObject({ status: "draft" });

    // 2) «Publicar evento»: pregunta y no escribe nada hasta que se acepta.
    await sembrarBorradorAhora(page, { step: 5, date: "2020-03-14", startTime: "23:30", endTime: "06:00" });
    editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 6)).toBeVisible();
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    const aviso = page.getByRole("alertdialog");
    await expect(aviso).toContainText("¿Publicar un evento que ya ha empezado?");
    await expect(aviso).toContainText("ya ha terminado, así que nadie podrá comprar entradas");
    expect(creacion.eventos, "publicó sin preguntar").toHaveLength(1);

    // 3) «Revisar la fecha»: cierra, lleva a «Cuándo y dónde» y sigue sin escribir.
    await aviso.getByRole("button", { name: "Revisar la fecha" }).click();
    await expect(aviso).toHaveCount(0);
    await expect(paso(editor, 2)).toBeVisible();
    expect(creacion.eventos).toHaveLength(1);

    // 4) De vuelta al resumen, «Publicar igualmente» sí publica, una vez.
    await editor.getByRole("button", { name: /Resumen$/ }).first().click();
    await expect(paso(editor, 6)).toBeVisible();
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await aviso.getByRole("button", { name: "Publicar igualmente" }).click();
    await expect(page.getByText("Evento publicado").first()).toBeVisible();
    expect(creacion.eventos).toHaveLength(2);
    expect(creacion.eventos[1]).toMatchObject({ status: "published" });
    expect(String(creacion.eventos[1].date_start)).toMatch(/^2020-03-14T/);
  });

  test("con fecha futura se publica sin preguntar y se guarda lo escrito (cupo, máximo y precio)", async ({ page }) => {
    let creacion!: Awaited<ReturnType<typeof simularCreacion>>;
    await abrirPanel(page, async () => {
      creacion = await simularCreacion(page);
    });
    const editor = await llegarACuandoYDonde(page);
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();

    // Un cupo con decimales se rechaza; corregido, se guarda tal cual.
    const cupo = editor.getByLabel("Cupo");
    await cupo.fill("2.5");
    await expect(editor.getByText(MSG_CUPO)).toBeVisible();
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();
    await cupo.fill("120");
    await editor.getByLabel("Máx. por usuario").fill("3");
    await editor.getByLabel(/^Precio/).fill("12.5");
    for (const n of [4, 5, 6]) {
      await siguiente(editor).click();
      await expect(paso(editor, n)).toBeVisible();
    }

    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText("Evento publicado").first()).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(creacion.eventos).toHaveLength(1);
    expect(creacion.eventos[0]).toMatchObject({ status: "published", price_cents: 1250 });
    expect(creacion.tipos).toHaveLength(1);
    expect(creacion.tipos[0]).toMatchObject({ capacity: 120, per_user_max: 3, price_cents: 1250 });
  });
});
