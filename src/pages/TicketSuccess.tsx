import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Check,
  Home,
  Loader2,
  MapPin,
  Receipt,
  Ticket as TicketIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Wordmark } from "@/components/Wordmark";

/**
 * TicketSuccess — landing post-Stripe Checkout. Stripe redirige aquí con
 * `?order_id=<uuid>&session_id=cs_test_...`. Esta página:
 *
 *   1) Lee los params y dispara dos canales que esperan a que
 *      `ticket_orders.status` pase a 'paid':
 *        - Realtime: subscribe a UPDATE en ticket_orders por buyer_user_id
 *        - Poll: cada 2s comprueba el order (max 30 intentos = 60s)
 *   2) Mientras espera muestra "Procesando tu pago…" con spinner.
 *   3) Cuando confirma: anima un check verde, muestra resumen del evento
 *      (título, venue, fecha, total, nº tickets) y dos CTAs:
 *        - "Ver mis tickets" → /#/client-dashboard (abre wallet via params)
 *        - "Volver al inicio" → /#/
 *   4) Si pasa el timeout sin confirmar, muestra un estado "Procesando"
 *      con explicación de que el email llegará por su lado y botones
 *      "Reintentar" + "Ver mis tickets".
 *   5) Si el order ni siquiera existe (order_id inválido o RLS bloquea),
 *      muestra error claro con botón volver.
 *
 * Mantiene la estética Pasify: dark mode, terracota, mono labels, italic
 * accent en el headline, warm shadows.
 */

type PollState = "loading" | "paid" | "timeout" | "error";

type OrderRow = {
  id: string;
  event_id: string;
  status: string;
  total_cents: number;
  currency: string;
  buyer_email: string;
  buyer_user_id: string | null;
  paid_at: string | null;
};

type EventRow = {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  city: string;
  image_url: string | null;
};

type TicketRow = {
  id: string;
  qr_token: string;
  status: string;
};

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 30; // 60s total

const TicketSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("order_id");
  const sessionId = searchParams.get("session_id");

  const [state, setState] = useState<PollState>("loading");
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  // Carga el order/event/tickets (snapshot). Reusable para poll + post-confirmación.
  const fetchSnapshot = useCallback(async () => {
    if (!orderId && !sessionId) {
      setErrorMsg(
        "No se recibió referencia de tu compra. Si pagaste, revisa tu correo o tus tickets."
      );
      setState("error");
      return null;
    }
    let query = supabase
      .from("ticket_orders")
      .select(
        "id, event_id, status, total_cents, currency, buyer_email, buyer_user_id, paid_at"
      );
    query = orderId
      ? query.eq("id", orderId)
      : query.eq("stripe_session_id", sessionId!);
    const { data: orderData, error: orderErr } = await query.maybeSingle();
    if (orderErr) {
       
      console.error("[TicketSuccess] order fetch failed", orderErr);
      setErrorMsg(orderErr.message);
      setState("error");
      return null;
    }
    if (!orderData) {
      // RLS puede bloquear si la sesión del usuario no es la del comprador.
      // Mostramos mensaje pero no como error crítico — el webhook puede aún
      // no haber asignado buyer_user_id si el usuario pagó como anónimo.
      return null;
    }
    setOrder(orderData as OrderRow);

    // Evento (lectura paralela)
    const { data: evData } = await supabase
      .from("events")
      .select("id, title, date_start, venue_name, city, image_url")
      .eq("id", orderData.event_id)
      .maybeSingle();
    if (evData) setEvent(evData as EventRow);

    // Tickets — pueden ser 0 si pending todavía
    const { data: tixData } = await supabase
      .from("tickets")
      .select("id, qr_token, status")
      .eq("order_id", orderData.id)
      .order("created_at", { ascending: true });
    if (tixData) setTickets(tixData as TicketRow[]);

    return orderData as OrderRow;
  }, [orderId, sessionId]);

  // Effect principal — orquesta carga inicial + poll + realtime
  useEffect(() => {
    if (!orderId && !sessionId) {
      setErrorMsg(
        "URL de éxito sin parámetros (?order_id / ?session_id). ¿Llegaste aquí directamente? Reintenta la compra."
      );
      setState("error");
      return;
    }

    let finished = false;
    let cancelled = false;
    const finish = (next: PollState) => {
      if (finished) return;
      finished = true;
      setState(next);
    };

    // Pide al backend que consulte Stripe directamente. Es la red de
    // seguridad para casos donde el webhook nunca llega (cuentas Stripe
    // desalineadas, signing secret roto, routing fail, etc.). El edge
    // function `confirm-checkout-session` retrieve la session via API y
    // llama a `mark_order_paid` si Stripe confirma que está paid.
    const confirmViaStripeAPI = async () => {
      if (!sessionId) return false;
      try {
        const {
          data: { session: authSession },
        } = await supabase.auth.getSession();
        if (!authSession) return false;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-checkout-session`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authSession.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        return data?.status === "paid";
      } catch {
        return false;
      }
    };

    // Carga inicial — quizás el webhook ya pasó (DB cache) o pedimos a
    // Stripe directamente si no ha pasado.
    (async () => {
      const snap = await fetchSnapshot();
      if (cancelled) return;
      if (snap?.status === "paid") {
        finish("paid");
        return;
      }
      // Si la DB sigue 'pending', preguntamos a Stripe directamente.
      const stripeConfirmed = await confirmViaStripeAPI();
      if (cancelled) return;
      if (stripeConfirmed) {
        await fetchSnapshot();
        finish("paid");
      }
    })();

    // Realtime: cuando el webhook actualiza ticket_orders → 'paid', recargamos.
    // Filtramos por id (si tenemos) o por stripe_session_id para no recibir
    // eventos de otros orders.
    const channel = supabase
      .channel(`ticket-success-${orderId ?? sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_orders",
          ...(orderId
            ? { filter: `id=eq.${orderId}` }
            : { filter: `stripe_session_id=eq.${sessionId}` }),
        },
        async (payload: any) => {
          if (cancelled) return;
          const next = payload.new;
          if (!next) return;
          if (next.status === "paid") {
            await fetchSnapshot();
            finish("paid");
          }
        }
      )
      .subscribe();

    // Poll de respaldo (DB) + confirmación directa a Stripe cada 5 intentos
    // (10s). Si Stripe dice paid pero el webhook no llegó, marcamos manual.
    let attemptCount = 0;
    const interval = setInterval(async () => {
      if (finished || cancelled) return;
      attemptCount++;
      setAttempts(attemptCount);
      const snap = await fetchSnapshot();
      if (snap?.status === "paid") {
        finish("paid");
        return;
      }
      // Cada 5 intentos (10s) preguntamos a Stripe directamente
      if (attemptCount % 5 === 0) {
        const stripeConfirmed = await confirmViaStripeAPI();
        if (!cancelled && stripeConfirmed) {
          await fetchSnapshot();
          finish("paid");
          return;
        }
      }
      if (attemptCount >= POLL_MAX_ATTEMPTS) {
        finish("timeout");
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [orderId, sessionId, fetchSnapshot]);

  const formattedAmount = useMemo(() => {
    if (!order) return null;
    return `${(order.total_cents / 100).toFixed(2)} ${order.currency}`;
  }, [order]);

  const formattedDate = useMemo(() => {
    if (!event) return null;
    return new Date(event.date_start).toLocaleString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [event]);

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Top bar — siempre presente */}
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
        {/* Subtle terracota glow behind icon */}
        <div className="relative mb-8 flex h-28 w-28 items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{
              background:
                state === "paid"
                  ? "radial-gradient(circle, rgba(77,184,122,0.35) 0%, transparent 65%)"
                  : state === "error" || state === "timeout"
                  ? "radial-gradient(circle, rgba(232,84,42,0.30) 0%, transparent 65%)"
                  : "radial-gradient(circle, rgba(232,84,42,0.30) 0%, transparent 65%)",
              filter: "blur(20px)",
            }}
          />

          {state === "paid" ? (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full"
              style={{
                background:
                  "linear-gradient(180deg, #5BCB8A 0%, #4DB87A 55%, #3C9F65 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 18px 40px -10px rgba(77,184,122,0.55)",
                animation: "pasify-pop 320ms cubic-bezier(.2,.9,.4,1.2) both",
              }}
            >
              <Check className="h-12 w-12 text-white" strokeWidth={3} />
            </div>
          ) : state === "loading" ? (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full"
              style={{
                background:
                  "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
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
              <TicketIcon className="h-12 w-12" strokeWidth={2.2} />
            </div>
          )}
        </div>

        {/* Eyebrow */}
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          {state === "paid"
            ? "Compra confirmada"
            : state === "loading"
            ? "Procesando tu pago"
            : state === "timeout"
            ? "Aún confirmando"
            : "Ha habido un problema"}
        </div>

        {/* Headline */}
        <h1 className="mb-4 text-center text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          {state === "paid" ? (
            <>
              ¡Tu entrada está{" "}
              <span style={serif} className="text-orange-500">
                lista
              </span>
              !
            </>
          ) : state === "loading" ? (
            <>
              Confirmando tu{" "}
              <span style={serif} className="text-orange-500">
                pago
              </span>
              …
            </>
          ) : state === "timeout" ? (
            <>
              Estamos{" "}
              <span style={serif} className="text-orange-500">
                procesando
              </span>{" "}
              tu compra
            </>
          ) : (
            <>Algo salió mal</>
          )}
        </h1>

        {/* Subtitle */}
        <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-muted-foreground md:text-base">
          {state === "paid" && (
            <>
              Tu pago se ha confirmado y los tickets están disponibles en tu
              Wallet con su código QR. Te hemos enviado una copia a{" "}
              <span className="text-foreground">{order?.buyer_email}</span>.
            </>
          )}
          {state === "loading" && (
            <>
              Stripe ha cobrado correctamente. Estamos sincronizando tu ticket
              en la plataforma — suele tardar unos segundos.
              {attempts > 5 && (
                <span className="block mt-2 text-xs text-muted-foreground/70">
                  Intento {attempts} de {POLL_MAX_ATTEMPTS}…
                </span>
              )}
            </>
          )}
          {state === "timeout" && (
            <>
              Tu pago se ha procesado pero la confirmación del ticket está
              tardando más de lo habitual. No te preocupes: recibirás un email
              con tu QR en cuanto el sistema termine, y el ticket aparecerá en
              tu Wallet automáticamente. Puedes cerrar esta página.
            </>
          )}
          {state === "error" && errorMsg && (
            <span className="text-destructive">{errorMsg}</span>
          )}
        </p>

        {/* Order summary card — visible cuando ya tenemos datos */}
        {(state === "paid" || state === "timeout") && event && order && (
          <article
            className="mb-8 w-full overflow-hidden rounded-2xl border border-border bg-card"
            style={{
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.02) inset, 0 22px 50px -18px rgba(232,84,42,0.18)",
            }}
          >
            {/* Hero image */}
            {event.image_url && (
              <div className="relative aspect-[16/7] w-full overflow-hidden">
                <img
                  src={event.image_url}
                  alt={event.title}
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
                  {event.title}
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      Cuándo
                    </div>
                    <div className="mt-0.5 text-sm font-medium capitalize text-foreground">
                      {formattedDate}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      Dónde
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-foreground">
                      {event.venue_name ?? event.city}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                    <TicketIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      Tickets
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-foreground">
                      {tickets.length > 0
                        ? `${tickets.length} × Entrada`
                        : "1 × Entrada"}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      Total
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-foreground" style={mono}>
                      {formattedAmount}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="border-t border-border pt-4 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                Order · {order.id.slice(0, 8)}
              </div>
            </div>
          </article>
        )}

        {/* CTAs — botones nativos con estilo Pasify premium (gradient
            terracota primary + outline secondary, tap target >=52px para
            móvil). Jerarquía: primary primero, secondary debajo. */}
        <div className="flex w-full max-w-md flex-col gap-3">
          {/* Primary CTA — varía por estado */}
          {(state === "paid" || state === "timeout") && (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/client-dashboard${
                    orderId || sessionId
                      ? `?${orderId ? `order_id=${orderId}` : ""}${
                          orderId && sessionId ? "&" : ""
                        }${sessionId ? `session_id=${sessionId}` : ""}`
                      : ""
                  }`
                )
              }
              className="group/btn relative inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white transition hover:-translate-y-0.5 md:text-base"
              style={{
                background:
                  "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(80,20,5,0.22), 0 12px 30px -10px rgba(232,84,42,0.55), 0 24px 48px -16px rgba(184,56,26,0.45)",
                letterSpacing: "-0.005em",
              }}
            >
              <TicketIcon className="h-5 w-5" />
              Ver mis tickets
              <span
                aria-hidden="true"
                className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1"
              >
                →
              </span>
            </button>
          )}

          {state === "loading" && (
            <button
              type="button"
              onClick={() => navigate("/client-dashboard")}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card text-sm font-semibold text-foreground transition hover:border-orange-500/60 hover:bg-card/80 md:text-base"
              style={{ letterSpacing: "-0.005em" }}
            >
              <TicketIcon className="h-5 w-5" />
              Ir al Wallet
            </button>
          )}

          {state === "error" && (
            <button
              type="button"
              onClick={() => navigate("/calendar")}
              className="group/btn relative inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white transition hover:-translate-y-0.5 md:text-base"
              style={{
                background:
                  "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
                letterSpacing: "-0.005em",
              }}
            >
              <TicketIcon className="h-5 w-5" />
              Volver al calendario
              <span aria-hidden="true">→</span>
            </button>
          )}

          {/* Secondary CTA — siempre "Volver al inicio" como ghost */}
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-transparent text-sm font-medium text-muted-foreground transition hover:border-border/80 hover:text-foreground"
          >
            <Home className="h-4 w-4" />
            Volver al inicio
          </button>
        </div>

        {/* Helper micro-copy bajo CTAs */}
        {state === "paid" && tickets.length > 0 && (
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

export default TicketSuccess;
