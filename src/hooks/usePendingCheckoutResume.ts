import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { capacitorStorage } from "@/lib/capacitorStorage";
import { buildAppUrl } from "@/lib/redirect-url";
import { parseEdgeError } from "@/components/tickets/ticketUtils";
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
 *
 * Este modulo tambien exporta `confirmCheckoutSession` (la llamada en si) y
 * `useCheckoutConfirmation` (sondeo con reintentos), que usan las paginas de
 * vuelta de Stripe: /ticket/success (web) y /ticket/gracias (Safari, nativo).
 */

const KEY = "pasify.pending_checkout";
/** El pedido caduca a los 30 min en `ticket_orders.expires_at`. Damos algo
 *  mas de margen y despues dejamos de reintentar. */
const MAX_EDAD_MS = 45 * 60 * 1000;

/** Evento de ventana que avisa a la cartera de que hay entradas nuevas. */
export const TICKETS_UPDATED_EVENT = "pasify:tickets-updated";

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

// ============================================================================
// confirm-checkout-session
// ============================================================================

/**
 * Resultado plano (no unión discriminada: con `strictNullChecks: false` TS no
 * estrecha por `if (!res.ok)`). `ok` → `status` trae el estado del pedido;
 * si no, `httpStatus` (0 = sin red), `code` y `message` describen el error.
 */
export interface ConfirmCheckoutResult {
  ok: boolean;
  status: string | null;
  orderId: string | null;
  httpStatus: number;
  code: string | null;
  message: string | null;
}

/**
 * Pregunta al servidor en qué estado está la sesión de Stripe (y, si Stripe
 * dice que está pagada, la marca como pagada). Funciona SIN sesión de
 * Supabase siempre que `session_id` y `order_id` casen: así puede usarse
 * desde Safari tras pagar en la app nativa. Si hay sesión, se manda también.
 *
 * Estados que devuelve el servidor: 'paid' | 'pending' | 'expired'.
 */
export async function confirmCheckoutSession(
  sessionId: string,
  orderId?: string | null
): Promise<ConfirmCheckoutResult> {
  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
  };
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch {
    /* sin sesion: la funcion acepta la llamada si session_id y order_id casan */
  }

  let resp: Response;
  try {
    resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-checkout-session`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: sessionId,
          ...(orderId ? { order_id: orderId } : {}),
        }),
      }
    );
  } catch {
    return {
      ok: false,
      status: null,
      orderId: null,
      httpStatus: 0,
      code: "network_error",
      message: null,
    };
  }

  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (resp.ok && typeof b.status === "string") {
    return {
      ok: true,
      status: b.status,
      orderId: typeof b.order_id === "string" ? b.order_id : null,
      httpStatus: resp.status,
      code: null,
      message: null,
    };
  }
  const { code, message } = parseEdgeError(body);
  return {
    ok: false,
    status: null,
    orderId: null,
    // 200 sin `status` también es un fallo (respuesta inesperada): transitorio.
    httpStatus: resp.ok ? 502 : resp.status,
    code,
    message,
  };
}

// ============================================================================
// useCheckoutConfirmation — sondeo con reintentos para las paginas de vuelta
// ============================================================================

export type CheckoutConfirmationState =
  /** No hay session_id en la URL: no hay nada que comprobar. */
  | { phase: "idle" }
  | { phase: "checking" }
  /** Stripe aun no confirma. `exhausted`: se acabaron los reintentos automaticos. */
  | { phase: "pending"; exhausted: boolean }
  | { phase: "paid"; orderId: string | null }
  | { phase: "expired"; orderId: string | null }
  /** El servidor no acepta la llamada sin sesion (401): no se puede comprobar aqui. */
  | { phase: "unverifiable" }
  | { phase: "error"; httpStatus: number; code: string | null };

/** Esperas entre intentos (~70 s en total). Con pago con tarjeta Stripe suele
 *  confirmar a la primera; esto es solo red de seguridad. */
const RETRY_DELAYS_MS = [2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000];

export function useCheckoutConfirmation(sessionId: string | null, orderId: string | null) {
  const [state, setState] = useState<CheckoutConfirmationState>(
    sessionId ? { phase: "checking" } : { phase: "idle" }
  );
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setState({ phase: "idle" });
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;

    const scheduleRetry = () => {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) return false;
      timer = window.setTimeout(() => void check(), delay);
      return true;
    };

    const check = async () => {
      attempt += 1;
      const res = await confirmCheckoutSession(sessionId, orderId);
      if (cancelled) return;

      if (res.ok) {
        const confirmedOrderId = res.orderId ?? orderId;
        if (res.status === "paid") {
          setState({ phase: "paid", orderId: confirmedOrderId });
          return;
        }
        if (res.status === "expired" || res.status === "failed") {
          setState({ phase: "expired", orderId: confirmedOrderId });
          return;
        }
        // 'pending' (o un estado que no conocemos): seguimos preguntando.
        const willRetry = scheduleRetry();
        setState({ phase: "pending", exhausted: !willRetry });
        return;
      }

      if (res.httpStatus === 401) {
        setState({ phase: "unverifiable" });
        return;
      }
      // Red caida, 5xx o rate limit: transitorio, reintentamos.
      const transient =
        res.httpStatus === 0 || res.httpStatus === 429 || res.httpStatus >= 500;
      if (transient && scheduleRetry()) {
        setState((prev) => (prev.phase === "pending" ? prev : { phase: "checking" }));
        return;
      }
      setState({ phase: "error", httpStatus: res.httpStatus, code: res.code });
    };

    setState({ phase: "checking" });
    void check();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId, orderId, run]);

  const retry = useCallback(() => setRun((n) => n + 1), []);
  return { state, retry };
}

// ============================================================================
// usePendingCheckoutResume — reanudacion al volver a la app nativa
// ============================================================================

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

      // Sin sesion la funcion solo acepta la llamada si le mandamos tambien
      // el order_id (marcas guardadas por builds antiguas no lo tienen).
      // Dejamos la marca puesta y lo reintentamos en el proximo resume.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session && !pending.orderId) return;

      comprobando.current = true;
      try {
        const res = await confirmCheckoutSession(pending.sessionId, pending.orderId);

        if (!res.ok) {
          // Pedido inexistente o que no es nuestro: reintentar no lo arregla.
          if (res.httpStatus === 400 || res.httpStatus === 403 || res.httpStatus === 404) {
            await capacitorStorage.removeItem(KEY);
          }
          console.warn("[pending-checkout] no se pudo confirmar", res);
          return;
        }

        if (res.status === "paid") {
          await capacitorStorage.removeItem(KEY);
          toast.success("Entrada confirmada", {
            description: "Ya la tienes en Mis entradas, con su código QR.",
          });
          // La cartera recarga al oir este evento (si ya estaba montada) y el
          // parametro `wallet` la abre (si no lo estaba).
          window.dispatchEvent(new CustomEvent(TICKETS_UPDATED_EVENT));
          if (session) window.location.assign(buildAppUrl("/client-dashboard?wallet=1"));
          return;
        }

        if (res.status === "expired" || res.status === "failed") {
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
