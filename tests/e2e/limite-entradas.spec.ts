import { expect, test, type Page } from "@playwright/test";
import {
  MAX_TICKETS_PER_BUYER_EVENT,
  allowanceHint,
  capByAllowance,
  type TicketAllowance,
} from "../../src/components/tickets/ticketUtils";
import { EVENTO, T, prepararCompra, type Compra } from "./support/compra-falsa";

/**
 * Máximo de 10 entradas por persona y evento (A2).
 *
 * Qué se protege:
 *   - el servidor es quien manda (create_ticket_order / create_free_ticket_order,
 *     tests/db/o6_limite_entradas.sql): aquí se comprueba lo que ve y hace quien
 *     compra: el selector resta lo que ya tiene, no deja pasar de 10 entre todos
 *     los tipos, avisa con claridad y, si el servidor rechaza (otra pestaña,
 *     petición manipulada), enseña su mensaje y se reajusta;
 *   - sin el dato (la RPC aún no existe en la BD, o falla) el selector sigue
 *     funcionando y no promete nada que el servidor no cumpla.
 *
 * Supabase y Stripe simulados (support/compra-falsa.ts): no hay pagos reales.
 *   npm run test:e2e:partner
 */

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const allowance = (held: number, limit = MAX_TICKETS_PER_BUYER_EVENT): TicketAllowance => ({
  limit,
  held,
  remaining: Math.max(0, limit - held),
});

test.describe("lógica pura (ticketUtils)", () => {
  test("capByAllowance: lo que deja el tipo y lo que deja el límite por evento", () => {
    expect(capByAllowance(10, null)).toBe(10);
    expect(capByAllowance(10, undefined)).toBe(10);
    expect(capByAllowance(10, allowance(0))).toBe(10);
    expect(capByAllowance(10, allowance(7))).toBe(3);
    expect(capByAllowance(2, allowance(7))).toBe(2); // manda el tipo (quedan 2)
    expect(capByAllowance(10, allowance(10))).toBe(0);
    expect(capByAllowance(10, allowance(14))).toBe(0); // nunca negativo
    expect(capByAllowance(0, allowance(0))).toBe(0);
  });

  test("allowanceHint: qué se le dice a quien compra", () => {
    expect(allowanceHint(null, 10)).toBe("Máx. 10 por persona y evento");
    expect(allowanceHint(allowance(0), 10)).toBe("Máx. 10 por persona y evento");
    // Con un tipo que limita más, el tope por evento no se nombra.
    expect(allowanceHint(allowance(0), 4)).toBeNull();
    expect(allowanceHint(allowance(4), 10)).toBe("Ya tienes 4 · puedes añadir hasta 6 más");
    expect(allowanceHint(allowance(9), 10)).toBe("Ya tienes 9 · puedes añadir hasta 1 más");
    // Si el tipo limita más que el tope por evento, la cifra es la del tipo.
    expect(allowanceHint(allowance(2), 3)).toBe("Ya tienes 2 · puedes añadir hasta 3 más");
    expect(allowanceHint(allowance(10), 10)).toBe("Ya tienes 10: el máximo por persona y evento");
  });
});

async function abrirSelector(page: Page, compra: Compra) {
  await page.goto(`/#/e/${EVENTO}`);
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Conseguir entradas" }).click();
  const selector = page.getByRole("dialog");
  await expect(selector.getByRole("radiogroup", { name: "Tipo de entrada" })).toBeVisible();
  expect(compra.errores, "Errores JS").toEqual([]);
  return selector;
}

const cantidad = (selector: ReturnType<Page["getByRole"]>) => selector.getByLabel("Cantidad de entradas");

test("página del evento: dice que el máximo es de 10 por persona y evento", async ({ page }) => {
  await prepararCompra(page);
  await page.goto(`/#/e/${EVENTO}`);
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Máximo 10 entradas por persona y evento.")).toBeVisible();
});

test("sin entradas previas: hasta 10 en un tipo y el aviso del tope por persona y evento", async ({ page }) => {
  const compra = await prepararCompra(page);
  const selector = await abrirSelector(page, compra);

  await expect(selector.getByText("Máx. 10 por persona y evento")).toBeVisible();
  const mas = selector.getByRole("button", { name: "Añadir una entrada" });
  for (let i = 0; i < 9; i++) await mas.click();
  await expect(cantidad(selector)).toContainText("10");
  await expect(mas).toBeDisabled();
  await expect(selector.getByTestId("limite-entradas")).toHaveCount(0);
  expect(compra.peticionesAllowance, "el selector pide cuántas lleva").toBeGreaterThan(0);
});

test("ya tiene 7: el selector solo deja añadir 3, también en el tipo gratis, y manda esa cantidad", async ({ page }) => {
  const compra = await prepararCompra(page);
  compra.allowance.held = 7;
  const selector = await abrirSelector(page, compra);

  await expect(selector.getByText("Ya tienes 7 · puedes añadir hasta 3 más")).toBeVisible();
  const mas = selector.getByRole("button", { name: "Añadir una entrada" });
  await mas.click();
  await mas.click();
  await expect(cantidad(selector)).toContainText("3");
  await expect(mas).toBeDisabled();

  // El límite es por evento, no por tipo: el gratis tampoco pasa.
  await selector.getByRole("radio", { name: /Invitación/ }).click();
  await expect(selector.getByText("Ya tienes 7 · puedes añadir hasta 3 más")).toBeVisible();
  await expect(cantidad(selector)).toContainText("3");
  await expect(mas).toBeDisabled();

  await selector.getByRole("button", { name: "Conseguir gratis" }).click();
  await expect.poll(() => compra.pagos.length).toBe(1);
  await expect(page).toHaveURL(new RegExp(`#/ticket/success\\?order_id=${T.pedidoGratis}&free=1$`));
  expect(compra.pagos).toHaveLength(1);
  expect(compra.pagos[0]).toMatchObject({ event_id: EVENTO, tier_id: T.gratis, qty: 3 });
});

test("un tipo con poco stock sigue mandando: ya tiene 2, quedan 2 de VIP", async ({ page }) => {
  const compra = await prepararCompra(page);
  compra.allowance.held = 2;
  const selector = await abrirSelector(page, compra);

  await selector.getByRole("radio", { name: /VIP/ }).click();
  const mas = selector.getByRole("button", { name: "Añadir una entrada" });
  await mas.click();
  await expect(cantidad(selector)).toContainText("2");
  await expect(mas).toBeDisabled();
  // Lo que limita es el stock, no el tope por persona: «Últimas entradas».
  await expect(selector.getByText("Últimas entradas").first()).toBeVisible();
});

test("ya tiene 10: no se puede comprar nada, se explica y se lleva a Mis entradas", async ({ page }) => {
  const compra = await prepararCompra(page);
  compra.allowance.held = 10;
  const selector = await abrirSelector(page, compra);

  const aviso = selector.getByTestId("limite-entradas");
  await expect(aviso).toContainText("Has alcanzado el máximo de 10 entradas por persona en este evento.");
  await expect(aviso).toContainText("Ya tienes 10");
  await expect(aviso.getByRole("link", { name: "Mis entradas" })).toHaveAttribute(
    "href",
    new RegExp(`#/client-dashboard\\?wallet=${EVENTO}$`),
  );
  await expect(selector.getByRole("button", { name: "Añadir una entrada" })).toHaveCount(0);
  const cta = selector.getByRole("button", { name: "Límite de entradas alcanzado" });
  await expect(cta).toBeDisabled();
  // Ningún tipo se puede comprar, ni el gratis: no sale nada hacia el servidor.
  await selector.getByRole("radio", { name: /Invitación/ }).click();
  await expect(selector.getByRole("button", { name: "Límite de entradas alcanzado" })).toBeDisabled();
  expect(compra.pagos).toHaveLength(0);
});

test("el servidor rechaza (otra pestaña, petición manipulada): enseña su mensaje y el selector se reajusta", async ({ page }) => {
  const compra = await prepararCompra(page);
  // El selector se abre creyendo que no lleva ninguna…
  compra.allowance.held = 0;
  // …pero entre tanto compró 8 en otra pestaña: el servidor rechaza 3 y dice cuántas caben.
  compra.checkout = () => {
    compra.allowance.held = 8;
    return {
      status: 409,
      json: {
        error: "qty_exceeds_event_limit",
        message: "Solo puedes añadir 2 entradas más a este evento: el máximo es 10 por persona.",
        limit: 10,
        remaining: 2,
      },
    };
  };
  const selector = await abrirSelector(page, compra);
  const mas = selector.getByRole("button", { name: "Añadir una entrada" });
  await mas.click();
  await mas.click();
  await expect(cantidad(selector)).toContainText("3");

  await selector.getByRole("button", { name: /Continuar al pago/ }).click();
  await expect.poll(() => compra.pagos.length).toBe(1);
  expect(compra.pagos[0]).toMatchObject({ event_id: EVENTO, tier_id: T.general, qty: 3 });

  // El mensaje del servidor, tal cual.
  await expect(page.getByText("Solo puedes añadir 2 entradas más a este evento: el máximo es 10 por persona.").first()).toBeVisible();
  // Y el selector se ajusta a lo que dice ahora la BD: ya lleva 8, caben 2.
  await expect(selector.getByText("Ya tienes 8 · puedes añadir hasta 2 más")).toBeVisible();
  await expect(cantidad(selector)).toContainText("2");
  await expect(selector.getByRole("button", { name: "Añadir una entrada" })).toBeDisabled();
  expect(compra.peticionesAllowance).toBeGreaterThanOrEqual(2);
});

test("sin event_ticket_allowance (BD vieja o fallo): el selector funciona y el servidor sigue mandando", async ({ page }) => {
  const compra = await prepararCompra(page);
  compra.allowance.fallo = true;
  compra.checkout = () => ({
    status: 409,
    json: { error: "qty_exceeds_event_limit", message: "Has alcanzado el máximo de 10 entradas por persona en este evento." },
  });
  const selector = await abrirSelector(page, compra);

  // Sin el dato no se inventa ninguna cifra de «lo que ya tienes».
  await expect(selector.getByText("Máx. 10 por persona y evento")).toBeVisible();
  await expect(selector.getByText(/Ya tienes/)).toHaveCount(0);
  await expect(selector.getByTestId("limite-entradas")).toHaveCount(0);

  await selector.getByRole("button", { name: /Continuar al pago/ }).click();
  await expect(page.getByText("Has alcanzado el máximo de 10 entradas por persona en este evento.").first()).toBeVisible();
  expect(compra.pagos).toHaveLength(1);
  expect(compra.errores, "Errores JS").toEqual([]);
});
