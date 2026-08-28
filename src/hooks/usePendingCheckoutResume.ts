import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { capacitorStorage } from "@/lib/capacitorStorage";
import { buildAppUrl } from "@/lib/redirect-url";
import { toast } from "sonner";

/**
 * Pasify · confirmacion de compra al volver a la app.
 *
 * EL PROBLEMA
 * En la app nativa, Stripe Checkout se abre en Safari, fuera de la WebView.
 * Cuando el pago termina, el usuario vuelve a la app a mano. La unica red de
 * seguridad que existia vivia en /ticket/success, que en nativo no se abre
 * nunca: esa pantalla es la que llamaba a `confirm-checkout-session` cuando
 * el webhook de Stripe no llegaba.
 *
 * Y el webhook puede perfectamente no llegar. Los endpoints de webhook de
 * Stripe son distintos en modo prueba y en produccion; si solo esta dado de
 * alta uno de los dos, los pedidos del otro modo se quedan en `pending` para
 * siempre y la entrada nunca aparece en la pestaña Tickets, aunque el cobro
 * se haya hecho. Es exactamente lo que pasaba en la build 5.
 *
 * LA SOLUCION
 * Al lanzar el checkout guardamos la sesion de Stripe. Cuando la app vuelve
 * a primer plano, preguntamos al servidor si esa sesion esta pagada. La
 * funcion `confirm-checkout-session` consulta a Stripe directamente y llama a
 * la misma RPC `mark_order_paid` que usa el webhook, con early-return si ya
 * estaba pagada — asi que llamarla de mas es inofensivo y los dos caminos
 * acaban en el mismo estado.
 *
 * Esto no sustituye al webhook: lo respalda. El webhook sigue haciendo falta
 * para las compras desde la web y para cuando el usuario no vuelve a abrir
 * la app.
 */

const KEY = "pasify.pending_checkout";
/** El pedido caduca a los 30 min en `ticket_orders.expires_at`. Damos algo
 *  mas de margen y despues dejamos de reintentar. */
const MAX_EDAD_MS = 45 * 60 * 1000;

interface PendingCheckout {
  sessionId: string;
  orderId?: string;
  startedAt: number;
}

/** Llamar justo antes de mandar al usuario a Stripe Checkout. */
export async function recordPendingCheckout(sessionId: string, orderId?: string) {
  if (!sessionId) return;
  const payload: PendingCheckout = { sessionId, orderId, startedAt: Date.now() };
  await capacitorStorage.setItem(KEY, JSON.stringify(payload));
}

async function readPending(): Promise<PendingCheckout | null> {
  try {
    const raw = await capacitorStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCheckout;
    if (!parsed?.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Monta el listener. Se usa una sola vez, en la raiz de la app.
 * Solo hace algo en nativo: en web el retorno de Stripe cae en
 * /ticket/success, que ya se encarga.
 */
export function usePendingCheckoutResume() {
  const comprobando = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const comprobar = async () => {
      if (comprobando.current) return;
      const pending = await readPending();
      if (!pending) return;

      if (Date.now() - pending.startedAt > MAX_EDAD_MS) {
        await capacitorStorage.removeItem(KEY);
        return;
      }

      // Sin sesion no podemos preguntar: la funcion exige usuario autenticado.
      // Dejamos la marca puesta y lo reintentamos en el proximo resume.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      comprobando.current = true;
      try {
        const { data, error } = await supabase.functions.invoke("confirm-checkout-session", {
          body: { session_id: pending.sessionId },
        });
        if (error) throw error;

        const estado = (data as { status?: string } | null)?.status;

        if (estado === "paid") {
          await capacitorStorage.removeItem(KEY);
          toast.success("Entrada confirmada", {
            description: "Ya la tienes en la pestaña Tickets, con su código QR.",
          });
          // Recarga completa: la lista de tickets se carga en un efecto al
          // montar, no con react-query, asi que no basta con invalidar.
          window.location.assign(buildAppUrl("/client-dashboard"));
          return;
        }

        if (estado === "expired") {
          await capacitorStorage.removeItem(KEY);
          toast("La compra no se completó", {
            description: "No se ha cobrado nada. Puedes volver a intentarlo.",
          });
          return;
        }
        // 'pending': el usuario aun no ha pagado o Stripe tarda. Mantenemos la
        // marca y lo reintentamos la proxima vez que vuelva a la app.
      } catch (err) {
        // Silencioso a proposito: esto corre en segundo plano cada vez que la
        // app vuelve a primer plano. Un toast rojo aqui seria ruido para el
        // usuario, que puede ni haber comprado nada.
        console.warn("[pending-checkout] no se pudo confirmar", err);
      } finally {
        comprobando.current = false;
      }
    };

    // Al arrancar y cada vez que la app vuelve del segundo plano.
    void comprobar();
    const listener = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void comprobar();
    });

    return () => {
      void listener.then((l) => l.remove());
    };
  }, []);
}
