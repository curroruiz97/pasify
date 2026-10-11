import { expect, test, type Page } from "@playwright/test";
import { instalarSupabaseFalso } from "./support/fake-supabase";
import { contestar, cuerpoJson } from "./support/contestar";

/**
 * Cola de reembolsos del admin con Supabase simulado.
 *
 * Aprobar, Reintentar y Retomar mueven dinero en Stripe y no se deshacen: antes
 * lanzaban la edge function con un solo clic. Ahora piden una confirmación con
 * el importe y el comprador, y no llega nada al servidor hasta confirmar.
 *
 *   npm run test:e2e:partner
 */

const ID_PENDIENTE = "4e2e0000-0000-4000-8000-0000000000a1";
const ID_FALLIDO = "4e2e0000-0000-4000-8000-0000000000a2";
const ID_SIN_EJECUTAR = "4e2e0000-0000-4000-8000-0000000000a3";

const fila = (r: { id: string; amount_cents: number; status: string; queue: string; fallo?: string }) => ({
  id: r.id,
  ticket_id: "4e2e0000-0000-4000-8000-0000000000b1",
  event_id: "4e2e0000-0000-4000-8000-0000000000c1",
  requester_email: "comprador@example.com",
  amount_cents: r.amount_cents,
  currency: "EUR",
  reason: "No puedo asistir",
  reason_code: null,
  status: r.status,
  auto_approved: false,
  decided_at: null,
  decision_note: null,
  stripe_refund_id: null,
  stripe_refund_status: null,
  stripe_failure_reason: r.fallo ?? null,
  processed_at: null,
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
  retry_count: 0,
  event_title: "Noche de prueba",
  event_date: "2026-10-20T22:00:00Z",
  venue_name: "Sala E2E",
  queue: r.queue,
});

const COLAS: Record<string, ReturnType<typeof fila>[]> = {
  pending: [fila({ id: ID_PENDIENTE, amount_cents: 2500, status: "pending", queue: "pending" })],
  attention: [
    fila({ id: ID_FALLIDO, amount_cents: 2500, status: "failed", queue: "attention", fallo: "declined" }),
    fila({ id: ID_SIN_EJECUTAR, amount_cents: 3000, status: "approved", queue: "attention" }),
  ],
};

interface Llamadas {
  decideRefund: Record<string, unknown>[];
  processRefund: Record<string, unknown>[];
  retryRpc: Record<string, unknown>[];
}

async function abrirReembolsos(page: Page): Promise<Llamadas> {
  const llamadas: Llamadas = { decideRefund: [], processRefund: [], retryRpc: [] };
  await instalarSupabaseFalso(page, { roles: ["admin"] });

  await contestar(page, "/rest/v1/rpc/admin_refund_queue_counts", () => ({
    body: [
      { queue: "pending", total: COLAS.pending.length },
      { queue: "attention", total: COLAS.attention.length },
    ],
  }));
  await contestar(page, "/rest/v1/rpc/admin_refund_queue", (req) => {
    const cola = String(cuerpoJson(req)._queue ?? "pending");
    const filas = COLAS[cola] ?? [];
    return { body: filas.map((f) => ({ ...f, total_count: filas.length })) };
  });
  await contestar(page, "/functions/v1/decide-refund", (req) => {
    llamadas.decideRefund.push(cuerpoJson(req));
    return { body: { status: "refunded" } };
  });
  await contestar(page, "/functions/v1/process-refund", (req) => {
    llamadas.processRefund.push(cuerpoJson(req));
    return { body: { status: "processing", stripe_refund_id: "re_e2e" } };
  });
  await contestar(page, "/rest/v1/rpc/admin_retry_refund", (req) => {
    llamadas.retryRpc.push(cuerpoJson(req));
    return { body: null };
  });

  await page.goto("/#/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 90_000 });
  // «Reembolsos» cuelga del grupo desplegable «Gobierno».
  const menu = page.locator("aside nav");
  await menu.getByRole("button", { name: "Gobierno" }).click();
  await menu.getByRole("button", { name: /^Reembolsos/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reembolsos" })).toBeVisible();
  return llamadas;
}

test("aprobar pide confirmación con el importe y no llega a Stripe hasta confirmar", async ({ page }) => {
  const llamadas = await abrirReembolsos(page);
  await expect(page.getByText("Noche de prueba")).toBeVisible();

  await page.getByRole("button", { name: "Aprobar" }).click();
  const dialogo = page.getByRole("alertdialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole("heading", { name: "¿Aprobar y reembolsar 25,00 €?" })).toBeVisible();
  await expect(dialogo).toContainText("no se puede deshacer");
  await expect(dialogo).toContainText("comprador@example.com");
  await expect(dialogo).toContainText("Noche de prueba");

  // Cancelar no lanza nada.
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toBeHidden();
  expect(llamadas.decideRefund, "Cancelar no debe llamar a decide-refund").toHaveLength(0);

  // Confirmar lanza exactamente una llamada, con la decisión «approve».
  await page.getByRole("button", { name: "Aprobar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar y reembolsar 25,00 €" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect.poll(() => llamadas.decideRefund.length).toBe(1);
  expect(llamadas.decideRefund[0]).toMatchObject({ request_id: ID_PENDIENTE, decision: "approve" });
  await expect(page.getByText("Reembolso hecho")).toBeVisible();
});

test("reintentar y retomar también piden confirmación antes de tocar Stripe", async ({ page }) => {
  const llamadas = await abrirReembolsos(page);
  await page.getByRole("tab", { name: /Con incidencia/ }).click();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

  // Reintentar: el diálogo se abre y Cancelar no llama ni a la RPC ni a process-refund.
  await page.getByRole("button", { name: "Reintentar" }).click();
  const reintentar = page.getByRole("alertdialog");
  await expect(reintentar.getByRole("heading", { name: "¿Reintentar el reembolso de 25,00 €?" })).toBeVisible();
  await reintentar.getByRole("button", { name: "Cancelar" }).click();
  await expect(reintentar).toBeHidden();
  expect(llamadas.retryRpc, "Cancelar no debe reabrir la solicitud").toHaveLength(0);
  expect(llamadas.processRefund, "Cancelar no debe llamar a process-refund").toHaveLength(0);

  // Retomar: solo tras confirmar se llama a process-refund, una vez, con la solicitud correcta.
  await page.getByRole("button", { name: "Retomar" }).click();
  const retomar = page.getByRole("alertdialog");
  await expect(retomar.getByRole("heading", { name: "¿Retomar el reembolso de 30,00 €?" })).toBeVisible();
  expect(llamadas.processRefund).toHaveLength(0);
  await retomar.getByRole("button", { name: "Retomar reembolso" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect.poll(() => llamadas.processRefund.length).toBe(1);
  expect(llamadas.processRefund[0]).toMatchObject({ request_id: ID_SIN_EJECUTAR });
  expect(llamadas.retryRpc).toHaveLength(0);
});
