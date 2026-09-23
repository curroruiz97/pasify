import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { buildExternalReturnUrl } from "@/lib/redirect-url";
import { recordPendingCheckout } from "@/hooks/usePendingCheckoutResume";
import { TierPickerSheet } from "@/components/tickets/TierPickerSheet";
import {
  MAX_TICKETS_PER_ORDER,
  parseEdgeError,
  type TierOption,
} from "@/components/tickets/ticketUtils";

/**
 * useTicketCheckout — hook único de compra de entradas, compartido por
 * `Calendar.tsx`, `PublicPartnerPage.tsx` y cualquier superficie con un botón
 * "Comprar entradas".
 *
 * Flujo:
 *   1. Evento demo (`id` empieza por `demo-`) → toast informativo y salir.
 *   2. Sin sesión → `/register-client?next=<ruta actual>`.
 *   3. Carga los tipos de entrada ACTIVOS del evento y abre el selector
 *      (`TierPickerSheet`) SIEMPRE, aunque solo haya un tipo: el precio de la
 *      tarjeta es un "Desde" y el usuario tiene que confirmar tipo, cantidad
 *      y total antes de pagar. Sin tipos activos → "Venta no disponible".
 *   4. Al confirmar: POST a `stripe-create-checkout` con `tier_id` y `qty`.
 *      Los rechazos del servidor (agotado, fuera de ventana, límite por
 *      persona…) se traducen a toasts en español y, si procede, se recarga la
 *      disponibilidad en el propio selector.
 *   5. Redirige a Stripe Checkout. En nativo Capacitor lo abre en el
 *      navegador del sistema y la app se queda aquí; antes guardamos la
 *      sesión (`recordPendingCheckout`) para confirmarla al volver.
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

const TIER_COLUMNS =
  "id, name, description, price_cents, currency, capacity, sold, per_user_max, sale_starts_at, sale_ends_at, sort_order";

const NO_TIERS: TierOption[] = [];

/** Si el navegador no ha salido hacia Stripe en este tiempo, desbloqueamos. */
const REDIRECT_WATCHDOG_MS = 15_000;

async function fetchActiveTiers(eventId: string): Promise<TierOption[]> {
  const { data, error } = await supabase
    .from("ticket_tiers")
    .select(TIER_COLUMNS)
    .eq("event_id", eventId)
    .eq("status", "active")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    price_cents: t.price_cents ?? 0,
    currency: t.currency || "EUR",
    capacity: t.capacity ?? null,
    sold: t.sold ?? 0,
    per_user_max: t.per_user_max ?? MAX_TICKETS_PER_ORDER,
    sale_starts_at: t.sale_starts_at ?? null,
    sale_ends_at: t.sale_ends_at ?? null,
    sort_order: t.sort_order ?? 0,
  }));
}

/** Ruta actual del HashRouter sin query: la edge function añade
 *  `?order_id=` al `cancel_url` y una query previa lo rompería. */
function currentRoutePath(): string {
  const hash = window.location.hash;
  if (!hash.startsWith("#/")) return "/calendar";
  return hash.slice(1).split("?")[0] || "/calendar";
}

// ---------------------------------------------------------------- errores

type AfterError = "refresh" | "close";
type CheckoutErrorCopy = { title: string; description: string; after?: AfterError };

const CHECKOUT_ERRORS: Record<string, CheckoutErrorCopy> = {
  event_not_available: {
    title: "Evento no disponible",
    description: "Este evento ya no está a la venta.",
    after: "close",
  },
  event_not_published: {
    title: "Evento no disponible",
    description: "Este evento ya no está a la venta.",
    after: "close",
  },
  event_not_found: {
    title: "Evento no disponible",
    description: "No encontramos este evento. Puede que se haya retirado.",
    after: "close",
  },
  event_sold_out: {
    title: "Evento agotado",
    description: "Se han vendido todas las entradas de este evento.",
    after: "close",
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
    title: "No se pudo iniciar el pago",
    description: "Revisa tu selección e inténtalo de nuevo.",
    after: "refresh",
  },
  buyer_email_required: {
    title: "Falta tu email",
    description: "Añade un email a tu cuenta para poder comprar entradas.",
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
    description: "Vuelve a iniciar sesión para comprar tus entradas.",
    after: "close",
  },
  rate_limit_exceeded: {
    title: "Demasiados intentos",
    description: "Espera unos minutos antes de volver a intentarlo.",
  },
};

function describeCheckoutError(httpStatus: number, body: unknown): CheckoutErrorCopy {
  const { codes, message } = parseEdgeError(body);
  const knownCode = codes.find((c) => CHECKOUT_ERRORS[c]);
  const known = knownCode ? CHECKOUT_ERRORS[knownCode] : undefined;
  // Contrato del servidor: `message` de primer nivel es texto para el usuario
  // (el texto técnico del formato antiguo queda fuera, ver parseEdgeError).
  if (known) return message ? { ...known, description: message } : known;
  if (httpStatus === 401) return CHECKOUT_ERRORS.unauthorized;
  if (httpStatus === 429) return CHECKOUT_ERRORS.rate_limit_exceeded;
  if (message) {
    return {
      title: "No se pudo completar la compra",
      description: message,
      after: httpStatus >= 400 && httpStatus < 500 ? "refresh" : undefined,
    };
  }
  if (httpStatus === 404) {
    // 404 sin código ni texto: la función no está desplegada.
    return {
      title: "Pago no disponible",
      description: "El sistema de pago no está disponible ahora mismo. Inténtalo en unos minutos.",
    };
  }
  return {
    title: "No se pudo iniciar el pago",
    description: "Ha fallado el servidor de pagos. No se te ha cobrado nada: inténtalo de nuevo en unos minutos.",
  };
}

// ---------------------------------------------------------------- hook

type PickerState = { event: TicketCheckoutInput; tiers: TierOption[] };

export const useTicketCheckout = () => {
  const navigate = useNavigate();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Guard de reentrada síncrono: el estado de React llega tarde para un doble toque.
  const busyRef = useRef(false);
  const watchdogRef = useRef<number | undefined>(undefined);

  const unlock = useCallback(() => {
    busyRef.current = false;
    setSubmitting(false);
    setPendingId(null);
    if (watchdogRef.current) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = undefined;
    }
  }, []);

  // Volver con "atrás" desde Stripe puede restaurar la página desde la
  // bfcache con el botón aún en "Preparando el pago…". Lo desbloqueamos.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) unlock();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
    };
  }, [unlock]);

  const goToRegister = useCallback(() => {
    // Conserva la ruta para volver tras registro
    const currentPath = window.location.hash.startsWith("#/")
      ? window.location.hash.slice(1)
      : "/calendar";
    navigate(`/register-client?next=${encodeURIComponent(currentPath)}`);
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
          goToRegister();
          return;
        }

        // 2) Tipos de entrada activos del evento
        const tiers = await fetchActiveTiers(input.id);
        if (tiers.length === 0) {
          toast.error("Venta no disponible", {
            description:
              "Este evento aún no tiene entradas a la venta. Vuelve a probar más tarde.",
          });
          return;
        }

        // 3) Selector: el usuario confirma tipo, cantidad y total.
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
    [goToRegister]
  );

  const refreshTiers = useCallback(async (eventId: string) => {
    setRefreshing(true);
    try {
      const tiers = await fetchActiveTiers(eventId);
      setPicker((prev) => (prev && prev.event.id === eventId ? { ...prev, tiers } : prev));
      if (tiers.length === 0) setPickerOpen(false);
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
          goToRegister();
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
              // order_id). En web, /ticket/success enseña ya las entradas.
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
          const copy = describeCheckoutError(resp.status, body);
          toast.error(copy.title, { description: copy.description });
          if (copy.after === "close") setPickerOpen(false);
          else if (copy.after === "refresh") void refreshTiers(eventId);
          return;
        }

        const data = (body ?? {}) as { url?: string; order_id?: string; session_id?: string };
        if (!data.url) throw new Error("Respuesta inesperada del servidor de pagos.");

        if (native) {
          // Dejamos apuntada la sesión para confirmar la compra al volver a la
          // app aunque el webhook de Stripe no llegue (usePendingCheckoutResume).
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

        // Web: la página se va a Stripe. Dejamos el botón bloqueado para que
        // un segundo toque no cree otro pedido mientras carga.
        leavingPage = true;
        watchdogRef.current = window.setTimeout(unlock, REDIRECT_WATCHDOG_MS);
        window.location.href = data.url;
      } catch (e) {
        console.error("[useTicketCheckout] checkout failed", e);
        toast.error("No se pudo iniciar el pago", {
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
    [picker, goToRegister, refreshTiers, unlock]
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
