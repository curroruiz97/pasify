import { test, expect } from "@playwright/test";

/**
 * Test de regresión para el bug P0.1 del plan de hardening.
 *
 * Bug histórico: `src/main.tsx` despachaba `pasify:push-received` pero
 * el listener en `src/App.tsx` esperaba `foreground-push`. Por nombres
 * distintos, las notificaciones FCM foreground NUNCA llegaban al toast
 * in-app. Fix: renombrar el dispatch en main.tsx para que coincida.
 *
 * Este test simula la parte client-side disparando el CustomEvent
 * `foreground-push` desde dentro del navegador (vía `page.evaluate`) y
 * verifica que el toast Sonner aparece con título + body.
 *
 * Limitaciones:
 *   - No prueba el camino real desde FCM/PushNotifications.addListener.
 *     Eso ocurre solo en native (Capacitor) y queda cubierto por QA
 *     manual + el dispatch en main.tsx (también testeado por boot).
 *   - El listener filtra notif.data.type === "event" | "discount" (esos
 *     usan UI específica). Aquí usamos `type: "system"` para que NO se
 *     filtre.
 */

test.describe("foreground-push event → toast in-app", () => {
  test("dispara el CustomEvent y aparece toast con título y body", async ({
    page,
  }) => {
    await page.goto("/");

    // Esperar a que la app monte el listener (useEffect en App.tsx).
    // Usamos un selector tonto para garantizar hidratación.
    await expect(page.locator("body")).toBeVisible();
    await page.waitForTimeout(800);

    // Disparar el evento foreground-push igual que lo haría main.tsx
    // tras recibir una notificación push del SO.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("foreground-push", {
          detail: {
            title: "Pasify · Notificación de prueba",
            body: "Mensaje del cuerpo de la notificación",
            data: { type: "system" },
          },
        }),
      );
    });

    // El listener en App.tsx llama sonnerToast(title, { description: body }).
    // El toaster Sonner renderiza en data-sonner-toaster.
    await expect(
      page.getByText("Pasify · Notificación de prueba"),
    ).toBeVisible({ timeout: 4000 });
    await expect(
      page.getByText("Mensaje del cuerpo de la notificación"),
    ).toBeVisible();
  });

  test("notif type=event NO dispara toast (filtrada por App.tsx)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    await page.waitForTimeout(800);

    // El listener filtra explícitamente data.type in ['event','discount'].
    // Esas notif tienen UI propia y no deben mostrar toast genérico.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("foreground-push", {
          detail: {
            title: "Evento filtrado",
            body: "Este body no debería mostrarse como toast",
            data: { type: "event" },
          },
        }),
      );
    });

    // Esperamos un poco y comprobamos que el title NO aparece.
    await page.waitForTimeout(800);
    await expect(page.getByText("Evento filtrado")).not.toBeVisible();
  });
});
