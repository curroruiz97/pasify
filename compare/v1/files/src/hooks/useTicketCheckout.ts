import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { buildExternalReturnUrl } from "@/lib/redirect-url";
import { loginPathWithNext } from "@/lib/eventLinks";
import {
  cancelCheckoutOrder,
  cancelIsRetryable,
  forgetWebCheckout,
  readWebCheckout,
  recordPendingCheckout,
  rememberWebCheckout,
} from "@/hooks/usePendingCheckoutResume";
import { TierPickerSheet } from "@/components/tickets/TierPickerSheet";
import { fetchEventTiers } from "@/components/tickets/tierData";
import {
  MAX_TICKETS_PER_ORDER,
  isFreeTier,
  parseEdgeError,
  type TierOption,
} from "@/components/tickets/ticketUtils";

/**
 * useTicketCheckout — hook único de compra de entradas, compartido por
 * `Calendar.tsx`, `PublicPartnerPage.tsx`, `PublicEvent.tsx` y cualquier
 * superficie con un botón "Comprar entradas".
 *
 * Flujo:
 *   1. Evento demo (`id` empieza por `demo-`) → toast informativo y salir.
 *   2. Sin sesión → `/login?next=<ruta actual>` (loginPathWithNext): desde
 *      el login se puede ir a crear cuenta sin perder la vuelta al evento.
 *   3. Carga los tipos de entrada ACTIVOS del evento con su disponibilidad
 *      real (`event_availability`, ver tierData.ts) y abre el selector
 *      (`TierPickerSheet`) SIEMPRE, aunque solo haya un tipo: el precio de la
 *      tarjeta es un "Desde" y el usuario tiene que confirmar tipo, cantidad,
 *      total y condiciones antes de pagar. Sin tipos activos → "Venta no
 *      disponible".
 *   4. Al confirmar: POST a `stripe-create-checkout` con `tier_id` y `qty`.
 *      Los rechazos del servidor (agotado, fuera de ventana, límite por
 *      persona…) se traducen a toasts en español y, si procede, se recarga la
 *      disponibilidad en el propio selector.
 *   5. Tipo a 0 €: el servidor responde `{ free: true, order_id }` con el
 *      pedido ya pagado y sus entradas emitidas. Sin Stripe: a
 *      `/ticket/success?order_id=…&free=1` (también en la app nativa).
 *   6. Si no, redirige a Stripe Checkout. En nativo Capacitor lo abre en el
 *      navegador del sistema y la app se queda aquí; antes guardamos la
 *      sesión (`recordPendingCheckout`) para confirmarla o anularla al volver.
 *      En web se apunta el pedido en esta pestaña (`rememberWebCheckout`).
 *
 * Volver sin pagar (web, B1-04): el cancel_url de Stripe es la página de la
 * que salió la compra (con `?order_id=`) y el "atrás" del navegador vuelve a
 * ella. Al montarse (o al restaurarse de la bfcache) el hook anula ese pedido
 * con `cancel-checkout` para liberar las plazas en el acto; si ya estaba
 * pagado (`already_paid`), lleva a la confirmación. En silencio si falla: la
 * reserva caduca sola, como antes.
 *
 * Devuelve `{ checkout, pendingId, checkoutSheet }`:
 *   - `pendingId`: evento con una operación en curso (cargando tipos o
 *     creando el pago), para poner el spinner en su tarjeta.
 *   - `checkoutSheet`: el selector. La superficie que usa el hook TIENE que
 *     renderizarlo (`{checkoutSheet}`), si no, `checkout()` no enseña nada.
 */

export interface TicketCheckoutInput {
  /** event_id real de la tabla events. Si empieza con `demo-` es de muestra. */
  id: string;
  /** Título del evento, para la cabecera del selector. */
  title?: string;
  /** Inicio del evento (ISO), para la cabecera del selector. */
  dateStart?: string | null;
  /** Sala, local o ciudad, para la cabecera del selector. */
  place?: string | null;
  /** Cantidad sugerida al abrir el selector (1 por defecto). */
  qty?: number;
}

export interface UseTicketCheckoutOptions {
  /**
   * La venta de un evento ha cambiado por algo que la página no ve: el
   * servidor dice que ya no se vende (retirado, local suspendido…) o se ha
   * liberado una reserva al volver sin pagar. La página puede recargarlo.
   * `eventId` es null si no se sabe de qué evento era.
   */
  onEventChanged?: (eventId: string | null) => void;
}

const NO_TIERS: TierOption[] = [];

/** Si el navegador no ha salido hacia Stripe en este tiempo, desbloqueamos. */
const REDIRECT_WATCHDOG_MS = 15_000;

/** Ruta actual del HashRouter sin query: la de vuelta si se cancela el pago. */
function currentRoutePath(): string {
  const hash = window.location.hash;
  if (!hash.startsWith("#/")) return "/calendar";
  return hash.slice(1).split("?")[0] || "/calendar";
}

/** Confirmación de un pedido que ya estaba pagado al volver atrás. */
function successPath(orderId: string, sessionId: string | null): string {
  const params = new URLSearchParams({ order_id: orderId });
  if (sessionId) params.set("session_id", sessionId);
  return `/ticket/success?${params.toString()}`;
}

/** Pedidos ya atendidos en esta carga de la página: cada vuelta se trata una vez. */
const releasedOrders = new Set<string>();

// ---------------------------------------------------------------- errores

type AfterError = "refresh" | "close";
type CheckoutErrorCopy = {
  title: string;
  description: string;
  after?: AfterError;
  /** Nuestro texto siempre, aunque el servidor mande el suyo. */
  fixed?: boolean;
  /** El evento ya no se vende: la página que lo enseña puede recargarlo. */
  eventGone?: boolean;
};

const CHECKOUT_ERRORS: Record<string, CheckoutErrorCopy> = {
  event_not_available: {
    title: "Evento no disponible",
    description: "Este evento ya no está a la venta.",
    after: "close",
    eventGone: true,
  },
  event_not_published: {
    title: "Evento no disponible",
    description: "Este evento ya no está a la venta.",
    after: "close",
    eventGone: true,
  },
  event_not_found: {
    title: "Evento no disponible",
    description: "No encontramos este evento. Puede que se haya retirado.",
    after: "close",
    eventGone: true,
  },
  event_sold_out: {
    title: "Evento agotado",
    description: "Se han vendido todas las entradas de este evento.",
    after: "close",
    eventGone: true,
  },
  tier_not_available: {
    title: "Entrada no disponible",
    description: "Este tipo de entrada ya no está a la venta. Elige otro.",
    after: "refresh",
  },
  tier_not_found: {
    title: "Entrada no disponible",
    description: "Este tipo de entrada ya no existe. Elige otro.",
    after: "refresh",
  },
  tier_sold_out: {
    title: "No quedan suficientes entradas",
    description:
      "No quedan entradas suficientes de este tipo. Prueba con menos cantidad o con otro tipo.",
    after: "refresh",
  },
  sale_not_started: {
    title: "La venta aún no ha empezado",
    description: "Este tipo de entrada todavía no está a la venta.",
    after: "refresh",
  },
  sale_ended: {
    title: "Venta cerrada",
    description: "La venta de este tipo de entrada ya ha terminado.",
    after: "refresh",
  },
  invalid_qty: {
    title: "Cantidad no válida",
    description: "Revisa el número de entradas e inténtalo de nuevo.",
    after: "refresh",
  },
  qty_exceeds_per_user_max: {
    title: "Límite de entradas por persona",
    description: "Has superado el máximo de entradas por persona para este tipo.",
    after: "refresh",
  },
  invalid_payload: {
    title: "No se pudo completar la compra",
    description: "Revisa tu selección e inténtalo de nuevo.",
    after: "refresh",
  },
  buyer_email_required: {
    title: "Falta tu email",
    description: "Añade un email a tu cuenta para poder conseguir entradas.",
    after: "close",
  },
  amount_below_minimum: {
    title: "No se puede comprar esta entrada",
    description: "El importe es inferior al mínimo que admite el pago con tarjeta (0,50 €).",
  },
  invalid_return_url: {
    title: "No se pudo iniciar el pago",
    description: "Esta versión de Pasify no puede abrir el pago. Actualiza la app o inténtalo desde pasify.es.",
    after: "close",
  },
  payment_provider_error: {
    title: "No se pudo abrir el pago",
    description: "No hemos podido abrir la pasarela de pago. No se te ha cobrado nada: inténtalo de nuevo en unos minutos.",
  },
  unauthorized: {
    title: "Sesión caducada",
    description: "Vuelve a iniciar sesión para conseguir tus entradas.",
    after: "close",
  },
  // 401 de stripe-create-checkout: la sesión caducó entre abrir el selector y pagar.
  auth_required: {
    title: "Sesión caducada",
    description: "Vuelve a iniciar sesión para conseguir tus entradas.",
    after: "close",
    fixed: true,
  },
  // 503: en producción los pagos están en modo prueba (clave de Stripe no
  // live). No se ha reservado nada; reintentar ahora no sirve.
  payments_unavailable: {
    title: "Pagos no disponibles",
    description: "Los pagos no están disponibles en este momento. Inténtalo más tarde.",
    after: "close",
    fixed: true,
  },
  rate_limit_exceeded: {
    title: "Demasiados intentos",
    description: "Espera unos minutos antes de volver a intentarlo.",
  },
  // 409: el local está suspendido (admin_set_org_suspension). No se vende nada.
  org_suspended: {
    title: "Venta no disponible",
    description: "Este local no puede vender entradas ahora mismo.",
    after: "close",
    fixed: true,
  },
  // 409: el tipo dejó de ser gratis entre abrir el selector y reservar.
  tier_not_free: {
    title: "El precio ha cambiado",
    description: "Esta entrada ya no es gratis. Revisa el precio y vuelve a intentarlo.",
    after: "refresh",
  },
};

/** `free`: tipo a 0 € (los textos genéricos hablan de reserva, no de pago). */
function describeCheckoutError(httpStatus: number, body: unknown, free: boolean): CheckoutErrorCopy {
  const { codes, message } = parseEdgeError(body);
  const knownCode = codes.find((c) => CHECKOUT_ERRORS[c]);
  const known = knownCode ? CHECKOUT_ERRORS[knownCode] : undefined;
  // Contrato del servidor: `message` de primer nivel es texto para el usuario
  // (el texto técnico del formato antiguo queda fuera, ver parseEdgeError).
  if (known) return message && !known.fixed ? { ...known, description: message } : known;
  if (httpStatus === 401) return CHECKOUT_ERRORS.unauthorized;
  if (httpStatus === 429) return CHECKOUT_ERRORS.rate_limit_exceeded;
  if (httpStatus === 503) return CHECKOUT_ERRORS.payments_unavailable;
  if (message) {
    return {
      title: "No se pudo completar la compra",
      description: message,
      after: httpStatus >= 400 && httpStatus < 500 ? "refresh" : undefined,
    };
  }
  if (httpStatus === 404) {
    // 404 sin código ni texto: la función no está desplegada.
    return free
      ? {
          title: "Reserva no disponible",
          description: "No podemos reservar entradas ahora mismo. Inténtalo en unos minutos.",
        }
      : {
          title: "Pago no disponible",
          description: "El sistema de pago no está disponible ahora mismo. Inténtalo en unos minutos.",
        };
  }
  return free
    ? {
        title: "No se pudo completar la reserva",
        description: "Ha fallado el servidor. Inténtalo de nuevo en unos minutos.",
      }
    : {
        title: "No se pudo iniciar el pago",
        description: "Ha fallado el servidor de pagos. No se te ha cobrado nada: inténtalo de nuevo en unos minutos.",
      };
}

// ---------------------------------------------------------------- hook

type PickerState = { event: TicketCheckoutInput; tiers: TierOption[] };

/** Respuesta 200 de `stripe-create-checkout`: pago en Stripe o reserva gratis. */
type CheckoutResponse = {
  url?: string;
  order_id?: string;
  session_id?: string;
  free?: boolean;
};

export const useTicketCheckout = (options: UseTicketCheckoutOptions = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Guard de reentrada síncrono: el estado de React llega tarde para un doble toque.
  const busyRef = useRef(false);
  const watchdogRef = useRef<number | undefined>(undefined);
  // Referencias estables para los listeners (pageshow) y el efecto de montaje.
  const navigateRef = useRef(navigate);
  const onEventChangedRef = useRef(options.onEventChanged);
  useEffect(() => {
    navigateRef.current = navigate;
    onEventChangedRef.current = options.onEventChanged;
  });

  const unlock = useCallback(() => {
    busyRef.current = false;
    setSubmitting(false);
    setPendingId(null);
    if (watchdogRef.current) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = undefined;
    }
  }, []);

  /**
   * El comprador ha vuelto de Stripe sin pagar (web): se anula el pedido para
   * liberar sus plazas. `orderIdFromUrl` es el `?order_id=` del cancel_url; sin
   * él (botón atrás), el pedido apuntado en esta pestaña.
   */
  const releaseAbandonedCheckout = useCallback(async (orderIdFromUrl: string | null) => {
    // En la app la vuelta es otra (usePendingCheckoutResume).
    if (Capacitor.isNativePlatform()) return;
    const marker = readWebCheckout();
    const orderId = orderIdFromUrl ?? marker?.orderId ?? null;
    if (!orderId || releasedOrders.has(orderId)) return;
    releasedOrders.add(orderId);
    const sameOrder = !!marker && marker.orderId === orderId;

    const res = await cancelCheckoutOrder(orderId);
    if (!res.ok) {
      console.warn("[useTicketCheckout] no se pudo anular el pedido abandonado", res);
      // Transitorio: la marca se queda para la próxima vuelta a la página.
      if (cancelIsRetryable(res)) releasedOrders.delete(orderId);
      else forgetWebCheckout(orderId);
      return;
    }
    forgetWebCheckout(orderId);
    if (res.status === "already_paid") {
      // Pagado de verdad: a la confirmación, con la sesión de Stripe si la
      // tenemos (la página la confirma y emite las entradas si hace falta).
      navigateRef.current(successPath(orderId, sameOrder ? marker.sessionId : null));
      return;
    }
    if (res.status === "cancelled") {
      toast("Pago cancelado", {
        description: "No se ha cobrado nada. Puedes volver a intentarlo cuando quieras.",
      });
      onEventChangedRef.current?.(sameOrder ? marker.eventId : null);
    }
    // not_pending: ya había caducado o se había anulado; nada que contar.
  }, []);

  // Al montar: vuelta por el cancel_url (`?order_id=`) o por el botón atrás
  // con recarga (la marca de esta pestaña). El parámetro sale de la URL:
  // recargar o compartir la página no debe repetirlo.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get("order_id");
    if (fromUrl) {
      params.delete("order_id");
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    }
    void releaseAbandonedCheckout(fromUrl);
    // Solo al montar: Stripe vuelve siempre con una carga nueva de la página;
    // la restauración desde la bfcache la atiende el `pageshow` de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Volver con "atrás" desde Stripe puede restaurar la página desde la
  // bfcache con el botón aún en "Preparando el pago…". Lo desbloqueamos y
  // anulamos el pedido que se quedó a medias.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      unlock();
      void releaseAbandonedCheckout(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
    };
  }, [unlock, releaseAbandonedCheckout]);

  // Sin sesión: al login, que vuelve aquí al terminar (también si desde allí
  // crea cuenta o entra con Google/Apple).
  const goToLogin = useCallback(() => {
    navigate(loginPathWithNext());
  }, [navigate]);

  const checkout = useCallback(
    async (input: TicketCheckoutInput) => {
      // Re-entrancy guard: si otra compra está en curso, ignora el click.
      if (busyRef.current) return;

      // Eventos demo: no existen en DB ni tienen ticket_tier.
      if (input.id.startsWith("demo-")) {
        toast("Evento de muestra", {
          description:
            "Este es un evento de muestra. La compra estará disponible cuando el partner publique eventos reales.",
        });
        return;
      }

      busyRef.current = true;
      setPendingId(input.id);
      try {
        // 1) Sesión obligatoria
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          goToLogin();
          return;
        }

        // 2) Tipos de entrada activos del evento, con la disponibilidad real
        const tiers = await fetchEventTiers(input.id);
        if (tiers.length === 0) {
          toast.error("Venta no disponible", {
            description:
              "Este evento aún no tiene entradas a la venta. Vuelve a probar más tarde.",
          });
          return;
        }

        // 3) Selector: el usuario confirma tipo, cantidad, total y condiciones.
        setPicker({ event: input, tiers });
        setPickerOpen(true);
      } catch (e) {
        console.error("[useTicketCheckout] no se pudieron cargar los tipos de entrada", e);
        toast.error("No se pudieron cargar las entradas", {
          description: "Comprueba tu conexión e inténtalo de nuevo.",
        });
      } finally {
        busyRef.current = false;
        setPendingId(null);
      }
    },
    [goToLogin]
  );

  const refreshTiers = useCallback(async (eventId: string) => {
    setRefreshing(true);
    try {
      const tiers = await fetchEventTiers(eventId);
      setPicker((prev) => (prev && prev.event.id === eventId ? { ...prev, tiers } : prev));
      if (tiers.length === 0) {
        // Ya no queda nada a la venta (evento retirado, local suspendido…).
        setPickerOpen(false);
        onEventChangedRef.current?.(eventId);
      }
    } catch (e) {
      console.warn("[useTicketCheckout] no se pudo recargar la disponibilidad", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const confirm = useCallback(
    async (tier: TierOption, qty: number) => {
      if (!picker || busyRef.current) return;
      const eventId = picker.event.id;
      const free = isFreeTier(tier);

      busyRef.current = true;
      setSubmitting(true);
      setPendingId(eventId);
      let leavingPage = false;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setPickerOpen(false);
          goToLogin();
          return;
        }

        // Datos del comprador desde su propio perfil
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, phone")
          .eq("id", session.user.id)
          .maybeSingle();
        const email = session.user.email || "";
        if (!email) {
          toast.error(CHECKOUT_ERRORS.buyer_email_required.title, {
            description: CHECKOUT_ERRORS.buyer_email_required.description,
          });
          return;
        }

        const native = Capacitor.isNativePlatform();
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-create-checkout`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              event_id: eventId,
              tier_id: tier.id,
              qty: Math.max(1, Math.min(MAX_TICKETS_PER_ORDER, Math.floor(qty))),
              buyer: {
                email,
                first_name: profile?.first_name ?? undefined,
                last_name: profile?.last_name ?? undefined,
                phone: profile?.phone ?? undefined,
              },
              locale: "es",
              // El servidor añade `?order_id=<uuid>&session_id={CHECKOUT_SESSION_ID}`.
              // En nativo el pago ocurre en Safari/Chrome, sin sesión: vuelve a
              // /ticket/gracias, que confirma el pedido sin sesión y manda de
              // vuelta a la app (también si se cancela: allí llega solo con
              // order_id). En web, /ticket/success enseña ya las entradas, y
              // si se cancela se vuelve a esta página, que anula el pedido.
              success_url: buildExternalReturnUrl(native ? "/ticket/gracias" : "/ticket/success"),
              cancel_url: buildExternalReturnUrl(native ? "/ticket/gracias" : currentRoutePath()),
            }),
          }
        );

        const raw = await resp.text();
        let body: unknown = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }

        if (!resp.ok) {
          console.warn("[useTicketCheckout] stripe-create-checkout rechazó la compra", resp.status, raw);
          const copy = describeCheckoutError(resp.status, body, free);
          toast.error(copy.title, { description: copy.description });
          if (copy.after === "close") setPickerOpen(false);
          else if (copy.after === "refresh") void refreshTiers(eventId);
          if (copy.eventGone) onEventChangedRef.current?.(eventId);
          return;
        }

        const data = (body ?? {}) as CheckoutResponse;

        // Tipo a 0 €: pedido ya pagado y entradas emitidas, sin Stripe.
        if (data.free === true) {
          if (typeof data.order_id !== "string" || !data.order_id) {
            throw new Error("Respuesta inesperada del servidor (reserva sin pedido).");
          }
          setPickerOpen(false);
          navigate(`/ticket/success?order_id=${encodeURIComponent(data.order_id)}&free=1`);
          return;
        }

        if (!data.url) throw new Error("Respuesta inesperada del servidor de pagos.");

        if (native) {
          // Dejamos apuntada la sesión para confirmar la compra (o anularla si
          // vuelve sin pagar) al volver a la app (usePendingCheckoutResume).
          if (data.session_id) await recordPendingCheckout(data.session_id, data.order_id);
          // Capacitor abre la URL externa en el navegador del sistema y la
          // WebView se queda en esta pantalla.
          window.location.href = data.url;
          setPickerOpen(false);
          toast("Completa el pago en el navegador", {
            description: "Cuando termines, vuelve a Pasify: tus entradas aparecerán en Mis entradas.",
          });
          return;
        }

        // Web: la página se va a Stripe. Apuntamos el pedido en esta pestaña
        // (para anularlo si vuelve con "atrás") y dejamos el botón bloqueado
        // para que un segundo toque no cree otro pedido mientras carga.
        if (data.order_id) {
          releasedOrders.delete(data.order_id);
          rememberWebCheckout(data.order_id, data.session_id ?? null, eventId);
        }
        leavingPage = true;
        watchdogRef.current = window.setTimeout(unlock, REDIRECT_WATCHDOG_MS);
        window.location.href = data.url;
      } catch (e) {
        console.error("[useTicketCheckout] checkout failed", e);
        toast.error(free ? "No se pudo completar la reserva" : "No se pudo iniciar el pago", {
          description: "Comprueba tu conexión e inténtalo de nuevo.",
        });
      } finally {
        if (!leavingPage) {
          busyRef.current = false;
          setSubmitting(false);
          setPendingId(null);
        }
      }
    },
    [picker, goToLogin, refreshTiers, unlock, navigate]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && submitting) return;
      setPickerOpen(open);
    },
    [submitting]
  );

  const checkoutSheet = createElement(TierPickerSheet, {
    open: pickerOpen,
    onOpenChange: handleOpenChange,
    eventTitle: picker?.event.title ?? null,
    eventDateStart: picker?.event.dateStart ?? null,
    eventPlace: picker?.event.place ?? null,
    tiers: picker?.tiers ?? NO_TIERS,
    initialQty: picker?.event.qty ?? 1,
    submitting,
    refreshing,
    onConfirm: (tier: TierOption, qty: number) => {
      void confirm(tier, qty);
    },
  });

  return { checkout, pendingId, checkoutSheet };
};

export default useTicketCheckout;
