import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import QRCodeLib from "qrcode";
import {
  CalendarDays,
  Check,
  Clock,
  Home,
  Loader2,
  LogIn,
  MapPin,
  Receipt,
  RotateCcw,
  Ticket as TicketIcon,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import {
  TEST_PAYMENT_MESSAGE,
  forgetWebCheckout,
  useCheckoutConfirmation,
  type CheckoutConfirmationState,
} from "@/hooks/usePendingCheckoutResume";
import { loginPathWithNext } from "@/lib/eventLinks";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { withTimeout } from "@/lib/withTimeout";
import {
  formatEventDateTime,
  formatPriceCents,
  orderReference,
  ticketDoorCode,
  ticketHolderName,
} from "@/components/tickets/ticketUtils";

/**
 * TicketSuccess — confirmación de una compra en WEB y de una reserva gratis.
 *
 * Vuelta de Stripe Checkout (`/#/ticket/success?order_id=<uuid>&session_id=cs_…`):
 *   1) Pregunta a `confirm-checkout-session` con `{session_id, order_id}`,
 *      con o sin sesión: la función consulta a Stripe y, si está pagado,
 *      emite las entradas (misma RPC que el webhook, idempotente). Si Stripe
 *      aún no confirma, reintenta con esperas crecientes.
 *   2) Pagado + sesión → carga el pedido y enseña "Tus entradas" con su QR
 *      aquí mismo, más el botón "Ver en mi cartera".
 *   3) Pagado sin sesión → confirmación y aviso de iniciar sesión.
 *   4) Caducado / sin confirmar / error → mensaje honesto. Solo decimos "te
 *      hemos enviado un email" cuando el servidor lo ha registrado
 *      (`ticket_orders.tickets_email_sent_at`); si no consta, que las
 *      entradas ya están en la cartera y que también irán por email.
 *   5) Pago de modo prueba en producción (409 test_payment_not_accepted): no
 *      hay entradas ni se reintenta; se dice tal cual.
 *
 * Sin sesión de Stripe (`?order_id=<uuid>` a secas): el pedido se lee
 * directamente con la sesión del comprador (RLS de ticket_orders y tickets).
 * Es la vuelta de una reserva gratis (`&free=1`: el servidor la crea ya
 * pagada, sin Stripe, también desde la app nativa) y la de un pago que ya
 * estaba hecho cuando el comprador volvió atrás (cancel-checkout →
 * already_paid). Mismas fases que con Stripe; sin sesión, "inicia sesión".
 *
 * En la app nativa la vuelta de Stripe es /ticket/gracias (TicketReturn).
 * Estética Pasify: dark, terracota, mono labels, itálica serif en el titular.
 */

type OrderRow = {
  id: string;
  event_id: string;
  status: string;
  total_cents: number;
  currency: string;
  buyer_email: string;
  /** Lo pone el servidor cuando el proveedor de email acepta el envío. */
  tickets_email_sent_at: string | null;
};

type EventRow = {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  city: string;
  image_url: string | null;
};

type OrderTicket = {
  id: string;
  qr_token: string;
  status: string;
  tier_id: string | null;
  tier_name: string | null;
  holder: string;
  /** Código de puerta (ticketDoorCode). null en una entrada ya usada, como en la cartera. */
  doorCode: string | null;
  qrDataUrl: string | null;
};

type Details =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "no_session" }
  /** Pagado, pero esta sesión no ve el pedido (compraste con otra cuenta). */
  | { kind: "not_visible" }
  | { kind: "ready"; order: OrderRow; event: EventRow | null; tickets: OrderTicket[] };

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};
const gradient = "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)";
const primaryShadow =
  "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(80,20,5,0.22), 0 12px 30px -10px rgba(232,84,42,0.55), 0 24px 48px -16px rgba(184,56,26,0.45)";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Entradas del pedido que ve esta sesión, con tipo y QR ya generado. */
async function loadOrderTickets(orderId: string): Promise<OrderTicket[]> {
  const fetchRows = () =>
    supabase
      .from("tickets")
      .select(
        "id, qr_token, status, tier_id, holder_first_name, holder_last_name, holder_email, buyer_first_name, buyer_last_name, buyer_email, transferred_to_user_id"
      )
      .eq("order_id", orderId)
      .in("status", ["paid", "used"])
      .order("created_at", { ascending: true });

  let { data: rows } = await fetchRows();
  if (!rows || rows.length === 0) {
    // Recién confirmado: damos un respiro por si la réplica va por detrás.
    await wait(2000);
    ({ data: rows } = await fetchRows());
  }
  if (!rows || rows.length === 0) return [];

  const tierIds = Array.from(
    new Set(rows.map((r) => r.tier_id).filter((id): id is string => !!id))
  );
  const tierNames = new Map<string, string>();
  if (tierIds.length > 0) {
    const { data: tiers } = await supabase.from("ticket_tiers").select("id, name").in("id", tierIds);
    (tiers ?? []).forEach((t) => tierNames.set(t.id, t.name));
  }

  return Promise.all(
    rows.map(async (r) => {
      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await QRCodeLib.toDataURL(r.qr_token, {
          width: 360,
          margin: 2,
          color: { dark: "#0F0F0F", light: "#F4EEE2" },
          errorCorrectionLevel: "M",
        });
      } catch (err) {
        console.error("[TicketSuccess] QR", err);
      }
      return {
        id: r.id,
        qr_token: r.qr_token,
        status: r.status,
        tier_id: r.tier_id,
        tier_name: r.tier_id ? tierNames.get(r.tier_id) ?? null : null,
        holder: ticketHolderName(r),
        doorCode: r.status === "used" ? null : ticketDoorCode(r.qr_token),
        qrDataUrl,
      };
    })
  );
}

/** Estados de pedido que ya implican cobro (o reserva gratis emitida). */
const PAID_ORDER_STATUSES = new Set(["paid", "partial_refund", "refunded"]);
/** Pedido aún pendiente (el webhook va por detrás): esperas entre lecturas. */
const ORDER_RETRY_DELAYS_MS = [2000, 3000, 5000, 8000, 12000];
const ORDER_TIMEOUT_MS = 15_000;

/**
 * Estado de un pedido leído con la sesión del comprador, sin Stripe: reserva
 * gratis o pago confirmado al volver atrás. Mismas fases que
 * `useCheckoutConfirmation` para que la página no distinga de dónde viene.
 * `orderId` null → "idle" (no hace nada).
 */
function useOrderStatus(orderId: string | null) {
  const [state, setState] = useState<CheckoutConfirmationState>(
    orderId ? { phase: "checking" } : { phase: "idle" }
  );
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setState({ phase: "idle" });
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;

    const later = () => {
      const delay = ORDER_RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) return false;
      timer = window.setTimeout(() => void check(), delay);
      return true;
    };

    const check = async () => {
      attempt += 1;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        // Sin sesión la RLS no deja leer el pedido: que inicie sesión.
        if (!session) {
          setState({ phase: "unverifiable" });
          return;
        }
        const { data, error } = await withTimeout(
          supabase.from("ticket_orders").select("id, status").eq("id", orderId).maybeSingle(),
          ORDER_TIMEOUT_MS,
          "ticket_orders"
        );
        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          // No existe o es de otra cuenta.
          setState({ phase: "error", httpStatus: 404, code: "order_not_found" });
          return;
        }
        if (PAID_ORDER_STATUSES.has(data.status)) {
          setState({ phase: "paid", orderId: data.id });
          return;
        }
        if (data.status !== "pending") {
          setState({ phase: "expired", orderId: data.id });
          return;
        }
        const willRetry = later();
        setState({ phase: "pending", exhausted: !willRetry });
      } catch (err) {
        if (cancelled) return;
        console.warn("[TicketSuccess] no se pudo leer el pedido", err);
        // Sin red o timeout: un par de reintentos antes de rendirse.
        if (attempt < 3 && later()) return;
        setState({ phase: "error", httpStatus: 0, code: "network_error" });
      }
    };

    setState({ phase: "checking" });
    void check();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [orderId, run]);

  const retry = useCallback(() => setRun((n) => n + 1), []);
  return { state, retry };
}

const TicketSuccess = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const uid = useCurrentUserId();
  const [searchParams] = useSearchParams();
  const orderIdParam = searchParams.get("order_id");
  const sessionId = searchParams.get("session_id");
  // Reserva de entradas gratis: sin Stripe y sin pago.
  const free = searchParams.get("free") === "1";

  const stripeConfirmation = useCheckoutConfirmation(sessionId, orderIdParam);
  const directConfirmation = useOrderStatus(sessionId ? null : orderIdParam);
  const { state, retry } = sessionId ? stripeConfirmation : directConfirmation;
  const [details, setDetails] = useState<Details>({ kind: "idle" });

  // Ha llegado a la confirmación: la compra no está abandonada (la página de
  // la que salió no debe anularla si el comprador vuelve atrás).
  useEffect(() => {
    if (orderIdParam) forgetWebCheckout(orderIdParam);
  }, [orderIdParam]);

  const isPaid = state.phase === "paid";
  const paidOrderId = state.phase === "paid" ? state.orderId ?? orderIdParam : null;

  // Pagado → cargamos pedido, evento y entradas (solo con sesión: RLS).
  useEffect(() => {
    if (!isPaid) return;
    let cancelled = false;
    (async () => {
      setDetails({ kind: "loading" });
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) {
          setDetails({ kind: "no_session" });
          return;
        }
        if (!paidOrderId) {
          setDetails({ kind: "not_visible" });
          return;
        }

        const { data: order } = await supabase
          .from("ticket_orders")
          .select("id, event_id, status, total_cents, currency, buyer_email, tickets_email_sent_at")
          .eq("id", paidOrderId)
          .maybeSingle();
        if (cancelled) return;
        if (!order) {
          setDetails({ kind: "not_visible" });
          return;
        }

        const [{ data: ev }, tickets] = await Promise.all([
          supabase
            .from("events")
            .select("id, title, date_start, venue_name, city, image_url")
            .eq("id", order.event_id)
            .maybeSingle(),
          loadOrderTickets(order.id),
        ]);
        if (cancelled) return;
        setDetails({
          kind: "ready",
          order: order as OrderRow,
          event: (ev as EventRow | null) ?? null,
          tickets,
        });
      } catch (err) {
        console.error("[TicketSuccess] no se pudo cargar el pedido", err);
        if (!cancelled) setDetails({ kind: "not_visible" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPaid, paidOrderId]);

  const ready = details.kind === "ready" ? details : null;
  const ticketCount = ready?.tickets.length ?? 0;
  const walletPath = `/client-dashboard?wallet=${encodeURIComponent(ready?.order.event_id ?? "1")}`;

  // Entradas nuevas: la cartera (en caché, y guardada 30 días) tiene que
  // pedirlas otra vez al abrirse aunque se haya visitado hace un momento.
  const readyOrderId = ready?.order.id ?? null;
  useEffect(() => {
    if (readyOrderId && uid) void queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) });
  }, [readyOrderId, uid, queryClient]);

  // ---------------------------------------------------------------- copy
  // Leído del pedido, sin Stripe (reserva gratis o pago ya hecho al volver).
  const direct = !sessionId && !!orderIdParam;
  const noun = free ? "reserva" : "pago";
  const busy = state.phase === "checking" || (state.phase === "pending" && !state.exhausted);
  const tone: "ok" | "wait" | "bad" = isPaid ? "ok" : busy ? "wait" : "bad";

  const eyebrow = isPaid
    ? free
      ? "Reserva confirmada"
      : "Compra confirmada"
    : state.phase === "checking"
    ? free
      ? "Confirmando tu reserva"
      : "Procesando tu pago"
    : state.phase === "pending"
    ? "Aún confirmando"
    : state.phase === "expired"
    ? free
      ? "Reserva no completada"
      : "Pago no completado"
    : state.phase === "unverifiable"
    ? "Pendiente de confirmar"
    : state.phase === "test_payment"
    ? "Pago no válido"
    : "Ha habido un problema";

  const accent = (word: string) => (
    <span style={serif} className="text-orange-500">
      {word}
    </span>
  );

  const headline = isPaid ? (
    ticketCount === 1 ? (
      <>¡Tu entrada está {accent("lista")}!</>
    ) : (
      <>¡Tus entradas están {accent("listas")}!</>
    )
  ) : state.phase === "checking" ? (
    <>Confirmando tu {accent(noun)}…</>
  ) : state.phase === "pending" ? (
    <>Estamos {accent("confirmando")} tu {noun}</>
  ) : state.phase === "expired" ? (
    free ? (
      <>La reserva no se {accent("completó")}</>
    ) : (
      <>La compra no se {accent("completó")}</>
    )
  ) : state.phase === "unverifiable" ? (
    direct ? (
      <>Inicia sesión para {accent("verlas")}</>
    ) : (
      <>Inicia sesión para {accent("confirmar")}</>
    )
  ) : state.phase === "test_payment" ? (
    <>Este pago no es {accent("válido")}</>
  ) : (
    <>Algo salió mal</>
  );

  const errorStatus = state.phase === "error" ? state.httpStatus : 0;
  const subtitle: React.ReactNode = (() => {
    if (isPaid) {
      const confirmed = free ? "Reserva confirmada." : "Pago confirmado.";
      // "Te hemos enviado un email" solo si el servidor lo ha registrado: el
      // envío puede fallar, o salir más tarde, con el pago ya confirmado.
      if (ready?.order.tickets_email_sent_at) {
        const email = ready.order.buyer_email;
        return (
          <>
            {confirmed} Te hemos enviado un email
            {email ? (
              <>
                {" "}a <span className="text-foreground">{email}</span>
              </>
            ) : null}{" "}
            con tus entradas.
          </>
        );
      }
      switch (details.kind) {
        case "ready":
          return `${confirmed} Tus entradas ya están en tu cartera. Te las enviaremos también por email.`;
        case "no_session":
          return `${confirmed} Inicia sesión con la cuenta con la que ${free ? "reservaste" : "compraste"} para ver tus entradas en Mis entradas. Te las enviaremos también por email.`;
        case "not_visible":
          return `${confirmed} Las encontrarás en Mis entradas de la cuenta con la que hiciste la ${free ? "reserva" : "compra"}. Te las enviaremos también por email.`;
        default:
          return confirmed;
      }
    }
    switch (state.phase) {
      case "checking":
        return direct
          ? free
            ? "Estamos preparando tus entradas. Suele tardar unos segundos."
            : "Estamos comprobando tu pedido. Suele tardar unos segundos."
          : "Estamos comprobando el pago con Stripe. Suele tardar unos segundos.";
      case "pending":
        if (direct) {
          return state.exhausted
            ? `Todavía no hemos podido confirmar tu ${noun}. Si se completa, tus entradas aparecerán en Mis entradas. Puedes volver a comprobarlo.`
            : `Estamos terminando de confirmar tu ${noun}. Seguimos comprobándolo automáticamente; no cierres esta página.`;
        }
        return state.exhausted
          ? "Stripe todavía no ha confirmado el pago. Si se completa, tus entradas aparecerán en Mis entradas. Puedes volver a comprobarlo."
          : "Stripe todavía no nos ha confirmado el pago. Seguimos comprobándolo automáticamente; no cierres esta página.";
      case "expired":
        if (free) {
          return "No hemos podido completar la reserva y no se ha emitido ninguna entrada. Puedes volver a intentarlo cuando quieras.";
        }
        return direct
          ? "Este pedido no se completó y no se ha realizado ningún cargo. Puedes volver a intentarlo cuando quieras."
          : "La sesión de pago caducó y no se ha realizado ningún cargo. Puedes volver a intentarlo cuando quieras.";
      case "unverifiable":
        return direct
          ? `Inicia sesión con la cuenta con la que hiciste la ${free ? "reserva" : "compra"} para ver tus entradas.`
          : "Sin sesión no podemos comprobar el pago desde aquí. Inicia sesión con la cuenta de la compra: si el pago se completó, tus entradas estarán en Mis entradas.";
      case "test_payment":
        return TEST_PAYMENT_MESSAGE;
      case "idle":
        return "No hemos recibido la referencia de tu compra. Si has pagado, tus entradas aparecerán en Mis entradas.";
      default:
        if (direct) {
          return errorStatus === 404
            ? "No encontramos este pedido en tu cuenta. Si lo hiciste con otra, tus entradas estarán en Mis entradas de esa cuenta; si no, escríbenos a soporte."
            : `No hemos podido comprobar tu ${noun} ahora mismo. Si se completó, tus entradas aparecerán en Mis entradas.`;
        }
        return errorStatus === 404 || errorStatus === 403 || errorStatus === 400
          ? "No encontramos este pedido. Si has pagado, tus entradas aparecerán en Mis entradas; si no, escríbenos a soporte."
          : "No hemos podido comprobar el pago ahora mismo. Si se completó, tus entradas aparecerán en Mis entradas.";
    }
  })();

  const ticketsSummary = (() => {
    if (!ready || ticketCount === 0) return null;
    const names = Array.from(new Set(ready.tickets.map((t) => t.tier_name || "Entrada")));
    return names.length === 1 ? `${ticketCount} × ${names[0]}` : `${ticketCount} entradas`;
  })();

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Top bar */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3 md:px-6"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Wordmark height={28} />
        <span
          className="text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          · Confirmación
        </span>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-10 md:py-16">
        {/* Icono de estado con halo */}
        <div className="relative mb-8 flex h-28 w-28 items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{
              background:
                tone === "ok"
                  ? "radial-gradient(circle, rgba(77,184,122,0.35) 0%, transparent 65%)"
                  : "radial-gradient(circle, rgba(232,84,42,0.30) 0%, transparent 65%)",
              filter: "blur(20px)",
            }}
          />
          {tone === "ok" ? (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full"
              style={{
                background: "linear-gradient(180deg, #5BCB8A 0%, #4DB87A 55%, #3C9F65 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 18px 40px -10px rgba(77,184,122,0.55)",
                animation: "pasify-pop 320ms cubic-bezier(.2,.9,.4,1.2) both",
              }}
            >
              <Check className="h-12 w-12 text-white" strokeWidth={3} />
            </div>
          ) : tone === "wait" ? (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full"
              style={{
                background: gradient,
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 18px 40px -10px rgba(232,84,42,0.55)",
              }}
            >
              <Loader2 className="h-12 w-12 animate-spin text-white" strokeWidth={2.5} />
            </div>
          ) : (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full"
              style={{
                background:
                  "linear-gradient(180deg, rgba(232,84,42,0.22) 0%, rgba(184,56,26,0.18) 100%)",
                color: "#FFC9B0",
                border: "1px solid rgba(232,84,42,0.4)",
              }}
            >
              {state.phase === "expired" || state.phase === "test_payment" ? (
                <XCircle className="h-12 w-12" strokeWidth={2.2} />
              ) : state.phase === "pending" ? (
                <Clock className="h-12 w-12" strokeWidth={2.2} />
              ) : (
                <TicketIcon className="h-12 w-12" strokeWidth={2.2} />
              )}
            </div>
          )}
        </div>

        {/* Eyebrow */}
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          {eyebrow}
        </div>

        <h1 className="mb-4 text-center text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          {headline}
        </h1>

        <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-muted-foreground md:text-base">
          {subtitle}
        </p>

        {/* Tus entradas — QR de cada entrada del pedido */}
        {isPaid && details.kind === "loading" && (
          <div className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando tus entradas…
          </div>
        )}

        {ready && ticketCount > 0 && (
          <section className="mb-8 w-full" aria-label="Tus entradas">
            <div
              className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.18em" }}
            >
              Tus entradas · {ticketCount.toString().padStart(2, "0")}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ready.tickets.map((t, i) => (
                <article
                  key={t.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                  style={{ boxShadow: "0 22px 50px -18px rgba(232,84,42,0.18)" }}
                >
                  <div
                    className="flex items-center justify-between gap-2 px-4 py-3 text-white"
                    style={{ background: "linear-gradient(160deg, #E8542A 0%, #B8381A 100%)" }}
                  >
                    <span className="truncate text-sm font-semibold">{t.tier_name || "Entrada"}</span>
                    <span
                      className="shrink-0 text-[10px] uppercase text-white/80"
                      style={{ ...mono, letterSpacing: "0.16em" }}
                    >
                      {i + 1} de {ticketCount}
                    </span>
                  </div>
                  <div
                    className="flex flex-col items-center px-4 py-5"
                    style={{ background: "#F4EEE2", color: "#0F0F0F" }}
                  >
                    {t.qrDataUrl ? (
                      <img
                        src={t.qrDataUrl}
                        alt={`Código QR de la entrada ${i + 1}`}
                        className="aspect-square w-full max-w-[220px] rounded-xl"
                        draggable={false}
                      />
                    ) : (
                      <div className="aspect-square w-full max-w-[220px] animate-pulse rounded-xl bg-black/10" />
                    )}
                    {t.holder && <p className="mt-3 text-sm font-semibold">{t.holder}</p>}
                    {/* Código de puerta: el mismo del email y de la cartera, por
                        si el QR no se lee. */}
                    {t.doorCode ? (
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-wider opacity-60">
                        Código <span className="text-sm font-semibold opacity-100">{t.doorCode}</span>
                      </p>
                    ) : (
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider opacity-50">
                        Ref. {t.id.slice(0, 8)}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <p className="mt-3 text-center text-[12px] text-muted-foreground">
              Muéstralas en la puerta desde aquí o desde Mis entradas en la app.
            </p>
          </section>
        )}

        {ready && ticketCount === 0 && (
          <p className="mb-8 max-w-md text-center text-sm text-muted-foreground">
            Tus entradas estarán en Mis entradas en unos segundos.
          </p>
        )}

        {/* Resumen del pedido */}
        {ready && ready.event && (
          <article
            className="mb-8 w-full overflow-hidden rounded-2xl border border-border bg-card"
            style={{
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.02) inset, 0 22px 50px -18px rgba(232,84,42,0.18)",
            }}
          >
            {ready.event.image_url && (
              <div className="relative aspect-[16/7] w-full overflow-hidden">
                <img
                  src={ready.event.image_url}
                  alt={ready.event.title}
                  className="h-full w-full object-cover"
                  loading="eager"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(10,10,10,0.0) 0%, rgba(10,10,10,0.65) 100%)",
                  }}
                />
              </div>
            )}

            <div className="space-y-5 p-5 md:p-6">
              <div>
                <div
                  className="mb-1 text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.18em" }}
                >
                  Evento
                </div>
                <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground md:text-2xl">
                  {ready.event.title}
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SummaryItem icon={<CalendarDays className="h-4 w-4" />} label="Cuándo">
                  {formatEventDateTime(ready.event.date_start)}
                </SummaryItem>
                <SummaryItem icon={<MapPin className="h-4 w-4" />} label="Dónde">
                  {ready.event.venue_name ?? ready.event.city}
                </SummaryItem>
                {ticketsSummary && (
                  <SummaryItem icon={<TicketIcon className="h-4 w-4" />} label="Entradas">
                    {ticketsSummary}
                  </SummaryItem>
                )}
                <SummaryItem icon={<Receipt className="h-4 w-4" />} label="Total">
                  <span style={mono}>
                    {ready.order.total_cents > 0
                      ? formatPriceCents(ready.order.total_cents, ready.order.currency)
                      : "Gratis"}
                  </span>
                </SummaryItem>
              </div>

              <div
                className="border-t border-border pt-4 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                Pedido · {orderReference(ready.order.id)}
              </div>
            </div>
          </article>
        )}

        {/* CTAs */}
        <div className="flex w-full max-w-md flex-col gap-3">
          {isPaid && details.kind !== "no_session" && (
            <PrimaryButton onClick={() => navigate(walletPath)}>
              <TicketIcon className="h-5 w-5" />
              Ver en mi cartera
              <span
                aria-hidden="true"
                className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1"
              >
                →
              </span>
            </PrimaryButton>
          )}

          {((isPaid && details.kind === "no_session") || state.phase === "unverifiable") && (
            // Vuelve aquí tras iniciar sesión, con el pedido en la URL.
            <PrimaryButton onClick={() => navigate(loginPathWithNext())}>
              <LogIn className="h-5 w-5" />
              Iniciar sesión
            </PrimaryButton>
          )}

          {state.phase === "pending" && (
            <SecondaryButton onClick={retry}>
              <RotateCcw className="h-5 w-5" />
              Comprobar de nuevo
            </SecondaryButton>
          )}

          {state.phase === "error" && (
            <PrimaryButton onClick={retry}>
              <RotateCcw className="h-5 w-5" />
              Reintentar
            </PrimaryButton>
          )}

          {(state.phase === "expired" ||
            state.phase === "error" ||
            state.phase === "idle" ||
            state.phase === "test_payment") && (
            <SecondaryButton onClick={() => navigate("/calendar")}>
              <CalendarDays className="h-5 w-5" />
              Volver al calendario
            </SecondaryButton>
          )}

          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-transparent text-sm font-medium text-muted-foreground transition hover:border-border/80 hover:text-foreground"
          >
            <Home className="h-4 w-4" />
            Volver al inicio
          </button>
        </div>

        {isPaid && ticketCount > 0 && (
          <p
            className="mt-8 text-center text-[10px] uppercase text-muted-foreground/70"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            · QR generado · Listo para escanear en la puerta ·
          </p>
        )}
      </main>

      {/* Pop animation keyframe inline (no global css update needed) */}
      <style>{`
        @keyframes pasify-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

const SummaryItem = ({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-start gap-3">
    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
      {icon}
    </div>
    <div className="min-w-0">
      <div
        className="text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{children}</div>
    </div>
  </div>
);

const PrimaryButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group/btn relative inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white transition hover:-translate-y-0.5 md:text-base"
    style={{ background: gradient, boxShadow: primaryShadow, letterSpacing: "-0.005em" }}
  >
    {children}
  </button>
);

const SecondaryButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card text-sm font-semibold text-foreground transition hover:border-orange-500/60 hover:bg-card/80 md:text-base"
    style={{ letterSpacing: "-0.005em" }}
  >
    {children}
  </button>
);

export default TicketSuccess;
