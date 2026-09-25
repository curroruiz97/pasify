import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CalendarX2,
  Gift,
  Loader2,
  MapPin,
  RotateCcw,
  Share2,
  Ticket as TicketIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import { useTicketCheckout } from "@/hooks/useTicketCheckout";
import { shareEventLink } from "@/lib/eventLinks";
import { withTimeout } from "@/lib/withTimeout";
import { TierConditions } from "@/components/tickets/TierPickerSheet";
import { fetchEventTiers } from "@/components/tickets/tierData";
import {
  formatEventDate,
  formatEventTime,
  formatPriceCents,
  isEventOver,
  isFreeTier,
  tierAvailability,
  type TierAvailability,
  type TierOption,
} from "@/components/tickets/ticketUtils";

/**
 * Página pública de un evento: `/#/e/:eventId` (el enlace compartido es
 * `/e/:eventId`, que pasa por api/e/[id].ts para la vista previa).
 *
 * Es el enlace que comparte el local (Instagram, WhatsApp, cartel con QR):
 * no depende de la ciudad del calendario ni de tener sesión para verla.
 * Comprar sí pide sesión (lo resuelve useTicketCheckout, que manda al login
 * con `next` y vuelve aquí).
 *
 * Datos: todo es lectura pública con RLS (eventos publicados o pasados,
 * tipos de entrada activos, locales activos, public_partners) más la
 * disponibilidad real de `event_availability` (tierData.ts). Nunca se
 * enseñan cifras de lo que queda: «Últimas entradas» o «Agotado». Cada tipo
 * lleva sus condiciones (devolución y transferencia) antes de comprar.
 *
 * Evento que ya no se ve (su local está suspendido, lo han despublicado o no
 * existe): la RLS no lo devuelve y la página dice «Este evento ya no está
 * disponible», con el calendario a mano. Un evento cancelado (solo lo ve
 * quien tenía entrada) lo dice tal cual. Ninguna carga se queda girando: con
 * la red caída o colgada sale el error con «Reintentar».
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const gradient = "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)";

/** Ninguna carga puede dejar la página en «Cargando el evento…» para siempre. */
const LOAD_TIMEOUT_MS = 15_000;

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  date_start: string;
  date_end: string | null;
  city: string | null;
  venue_name: string | null;
  address: string | null;
  status: string;
  venue_id: string | null;
  partner_id: string | null;
}

interface PageData {
  event: EventRow;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  partner: { id: string; business_name: string | null } | null;
  tiers: TierOption[];
}

type State =
  | { kind: "loading" }
  /** No existe, no se ve (despublicado, local suspendido) o es un borrador. */
  | { kind: "not_found" }
  /** Cancelado por el local: solo lo ve quien tenía entrada. */
  | { kind: "cancelled"; title: string }
  | { kind: "error" }
  | { kind: "ready"; data: PageData };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PublicEvent = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  // Solo cuenta la última carga (Reintentar, recargas tras una compra…).
  const requestRef = useRef(0);

  /** `silent`: recarga sin pasar por "Cargando…" (se mantiene lo que se ve). */
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const requestId = ++requestRef.current;
      if (!eventId || !UUID_RE.test(eventId)) {
        setState({ kind: "not_found" });
        return;
      }
      if (!silent) setState({ kind: "loading" });
      try {
        const { data: event, error } = await withTimeout(
          supabase
            .from("events")
            .select("id, title, description, image_url, date_start, date_end, city, venue_name, address, status, venue_id, partner_id")
            .eq("id", eventId)
            .maybeSingle(),
          LOAD_TIMEOUT_MS,
          "events"
        );
        if (requestId !== requestRef.current) return;
        if (error) throw error;
        if (!event) {
          setState({ kind: "not_found" });
          return;
        }
        if (event.status === "cancelled") {
          setState({ kind: "cancelled", title: event.title });
          return;
        }
        if (event.status !== "published" && event.status !== "past") {
          setState({ kind: "not_found" });
          return;
        }

        const [venueRes, partnerRes, tiers] = await withTimeout(
          Promise.all([
            event.venue_id
              ? supabase.from("venues").select("name, address, city, timezone").eq("id", event.venue_id).maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            event.partner_id
              ? supabase.from("public_partners").select("id, business_name").eq("id", event.partner_id).maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            fetchEventTiers(event.id),
          ]),
          LOAD_TIMEOUT_MS,
          "event details"
        );
        if (requestId !== requestRef.current) return;

        const venue = venueRes.data as { name: string | null; address: string | null; city: string | null; timezone: string | null } | null;
        setState({
          kind: "ready",
          data: {
            event: event as EventRow,
            timezone: venue?.timezone ?? null,
            venueName: event.venue_name || venue?.name || null,
            address: event.address || venue?.address || null,
            city: event.city || venue?.city || null,
            partner: (partnerRes.data as PageData["partner"]) ?? null,
            tiers,
          },
        });
      } catch (err) {
        if (requestId !== requestRef.current) return;
        console.warn("[PublicEvent] no se pudo cargar el evento", err);
        // Una recarga silenciosa que falla no tapa lo que ya se ve; si aún no
        // se veía nada (sustituyó a la carga inicial), sale el error.
        setState((prev) => (silent && prev.kind === "ready" ? prev : { kind: "error" }));
      }
    },
    [eventId]
  );

  // La venta ha cambiado (reserva liberada al volver sin pagar, evento
  // retirado mientras se compraba…): se recarga sin pasar por "Cargando…".
  const { checkout, pendingId, checkoutSheet } = useTicketCheckout({
    onEventChanged: () => void load({ silent: true }),
  });

  useEffect(() => {
    void load();
  }, [load]);

  // Título de la pestaña: el del evento mientras se ve (y el de antes al salir).
  useEffect(() => {
    const previo = document.title;
    return () => {
      document.title = previo;
    };
  }, []);
  useEffect(() => {
    if (state.kind === "ready") document.title = `${state.data.event.title} · Pasify`;
  }, [state]);

  return (
    <div
      className="min-h-screen bg-[#0F0F0F] text-[#F4EEE2]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <header
        className="flex items-center gap-3 border-b border-white/10 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link to="/calendar" aria-label="Ver más eventos">
          <Wordmark height={26} />
        </Link>
        <span className="text-[10px] uppercase text-[#E8542A]" style={{ ...mono, letterSpacing: "0.22em" }}>
          · Evento
        </span>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-28 pt-6">
        {state.kind === "loading" && (
          <div className="flex flex-col items-center py-24 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-[#FF7A4D]" />
            <p className="mt-4 text-sm text-white/60">Cargando el evento…</p>
          </div>
        )}

        {state.kind === "not_found" && (
          <Unavailable
            icon={<CalendarX2 className="h-8 w-8" />}
            title="Este evento ya no está disponible"
            text="Puede que el local lo haya retirado o que el enlace no esté completo. En el calendario tienes más planes."
          />
        )}

        {state.kind === "cancelled" && (
          <Unavailable
            icon={<CalendarX2 className="h-8 w-8" />}
            title="Este evento se ha cancelado"
            text={`El local ha cancelado «${state.title}». Si tenías entrada, en Mis entradas verás en qué punto está la devolución.`}
          />
        )}

        {state.kind === "error" && (
          <Unavailable
            icon={<AlertTriangle className="h-8 w-8" />}
            title="No hemos podido cargar el evento"
            text="Revisa tu conexión y vuelve a intentarlo."
            onRetry={() => void load()}
          />
        )}

        {state.kind === "ready" && (
          <EventView
            data={state.data}
            buying={pendingId === state.data.event.id}
            onBuy={() => {
              const { event, venueName, city } = state.data;
              void checkout({
                id: event.id,
                title: event.title,
                dateStart: event.date_start,
                place: venueName || city,
              });
            }}
          />
        )}
      </main>
      {checkoutSheet}
    </div>
  );
};

/** Evento que no se puede ver o cargar: qué pasa y, siempre, el calendario. */
const Unavailable = ({
  icon,
  title,
  text,
  onRetry,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onRetry?: () => void;
}) => (
  <div className="flex flex-col items-center py-16 text-center">
    <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#E8542A]/40 bg-[#E8542A]/15 text-[#FFC9B0]">
      {icon}
    </div>
    <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
    <p className="mt-3 text-[15px] leading-relaxed text-white/60">{text}</p>
    {onRetry ? (
      <>
        <button
          type="button"
          onClick={onRetry}
          className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white"
          style={{ background: gradient }}
        >
          <RotateCcw className="h-4 w-4" />
          Reintentar
        </button>
        <Link to="/calendar" className="mt-6 text-sm text-white/50 underline underline-offset-4">
          Ver el calendario
        </Link>
      </>
    ) : (
      <Link
        to="/calendar"
        className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white"
        style={{ background: gradient }}
      >
        <CalendarDays className="h-4 w-4" />
        Ver el calendario
      </Link>
    )}
  </div>
);

const EventView = ({ data, buying, onBuy }: { data: PageData; buying: boolean; onBuy: () => void }) => {
  const { event, timezone: tz, venueName, address, city, partner, tiers } = data;
  const date = formatEventDate(event.date_start, tz);
  const time = formatEventTime(event.date_start, tz);
  const place = [venueName, address, city].filter(Boolean).join(" · ");
  const mapsQuery = [venueName, address, city].filter(Boolean).join(", ");
  // Misma regla que el servidor al vender (`create_ticket_order`): hasta
  // `date_end` o, sin hora de fin, 12 h después de empezar. Antes se cerraba
  // 2 h después del inicio: un evento de las 23:00 salía "terminado" a la 1:01.
  const isPast = event.status === "past" || isEventOver(event);

  const tierRows = useMemo(
    () => tiers.map((t) => ({ tier: t, availability: tierAvailability(t) })),
    [tiers],
  );
  const onSaleRows = tierRows.filter((r) => r.availability.kind === "available");
  const onSale = !isPast && onSaleRows.length > 0;
  const minPrice = onSaleRows.reduce<number | null>(
    (min, r) => (min == null ? r.tier.price_cents : Math.min(min, r.tier.price_cents)),
    null
  );
  // Todo lo que queda a la venta es gratis: «Conseguir gratis».
  const allFree = onSaleRows.length > 0 && onSaleRows.every((r) => isFreeTier(r.tier));

  return (
    <>
      <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#161616]">
        {event.image_url ? (
          <img src={event.image_url} alt="" className="aspect-[4/5] w-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="h-28 w-full"
            style={{ background: "linear-gradient(160deg, #E8542A 0%, #B8381A 70%, #161616 100%)" }}
          />
        )}

        <div className="space-y-4 px-5 pb-6 pt-5">
          <h1 className="text-2xl font-bold leading-tight tracking-tight">{event.title}</h1>
          {partner?.business_name && (
            <Link to={`/p/${partner.id}`} className="block text-sm text-[#FFC9B0] underline-offset-4 hover:underline">
              {partner.business_name}
            </Link>
          )}

          {(date || time) && (
            <div className="flex items-start gap-3 text-sm">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#FF7A4D]" />
              <span>
                {date}
                {date && time ? " · " : ""}
                {time && <span style={mono}>{time}</span>}
              </span>
            </div>
          )}
          {place && (
            <div className="flex items-start gap-3 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF7A4D]" />
              <span className="min-w-0">
                {place}{" "}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#FF7A4D] underline underline-offset-4"
                >
                  Cómo llegar
                </a>
              </span>
            </div>
          )}

          {event.description && (
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-white/75">{event.description}</p>
          )}
        </div>
      </article>

      <section className="mt-6">
        <h2 className="mb-3 text-[11px] uppercase text-white/50" style={{ ...mono, letterSpacing: "0.18em" }}>
          Entradas
        </h2>
        {isPast ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/60">
            Este evento ya ha terminado.
          </p>
        ) : tierRows.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/60">
            La venta de entradas aún no está abierta.
          </p>
        ) : (
          <ul className="space-y-2">
            {tierRows.map(({ tier, availability }) => {
              const label = availabilityLabel(availability);
              const lowStock = availability.kind === "available" && availability.lowStock;
              return (
                <li
                  key={tier.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{tier.name}</div>
                    {tier.description && <div className="truncate text-xs text-white/50">{tier.description}</div>}
                    {label && (
                      <div className={lowStock ? "mt-0.5 text-xs font-semibold text-[#FF7A4D]" : "mt-0.5 text-xs text-[#FFC9B0]"}>
                        {label}
                      </div>
                    )}
                    <TierConditions tier={tier} className="mt-1.5 text-white/50" />
                  </div>
                  <div className="shrink-0 text-sm font-semibold" style={mono}>
                    {isFreeTier(tier) ? "Gratis" : formatPriceCents(tier.price_cents, tier.currency)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div
        className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0F0F0F]/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <div className="mx-auto flex w-full max-w-md items-center gap-2">
          <button
            type="button"
            onClick={() => void shareEventLink(event.id, event.title)}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 text-white/80"
            aria-label="Compartir evento"
          >
            <Share2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            disabled={!onSale || buying}
            onClick={onBuy}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: gradient }}
          >
            {buying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : onSale && allFree ? (
              <Gift className="h-4 w-4" />
            ) : (
              <TicketIcon className="h-4 w-4" />
            )}
            {onSale
              ? allFree
                ? "Conseguir gratis"
                : minPrice != null && minPrice > 0
                ? `Comprar · desde ${formatPriceCents(minPrice)}`
                : "Conseguir entradas"
              : isPast
              ? "Evento terminado"
              : tierRows.length > 0 && tierRows.every((r) => r.availability.kind === "sold_out")
              ? "Agotado"
              : "Entradas no disponibles"}
          </button>
        </div>
      </div>
    </>
  );
};

/** Estado de venta de un tipo, sin cifras. null = a la venta, sin nada que decir. */
function availabilityLabel(a: TierAvailability): string | null {
  switch (a.kind) {
    case "sold_out":
      return "Agotado";
    case "not_started":
      return "Aún no a la venta";
    case "ended":
      return "Venta cerrada";
    case "available":
      return a.lowStock ? "Últimas entradas" : null;
    default:
      return "No disponible";
  }
}

export default PublicEvent;
