import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
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
import {
  formatEventDate,
  formatEventTime,
  formatPriceCents,
  tierAvailability,
  type TierOption,
} from "@/components/tickets/ticketUtils";

/**
 * Página pública de un evento: `/#/e/:eventId`.
 *
 * Es el enlace que comparte el local (Instagram, WhatsApp, cartel con QR):
 * no depende de la ciudad del calendario ni de tener sesión para verla.
 * Comprar sí pide sesión (lo resuelve useTicketCheckout, que manda a
 * registrarse y vuelve aquí).
 *
 * Datos: todo es lectura pública con RLS (eventos publicados o pasados,
 * tipos de entrada activos, locales activos, public_partners). Un borrador
 * o un evento cancelado sale como "no disponible".
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

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
  | { kind: "not_found" }
  | { kind: "error" }
  | { kind: "ready"; data: PageData };

const TIER_COLUMNS =
  "id, name, description, price_cents, currency, capacity, sold, per_user_max, sale_starts_at, sale_ends_at, sort_order";

const PublicEvent = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const { checkout, pendingId, checkoutSheet } = useTicketCheckout();

  const load = useCallback(async () => {
    if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
      setState({ kind: "not_found" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const { data: event, error } = await supabase
        .from("events")
        .select("id, title, description, image_url, date_start, date_end, city, venue_name, address, status, venue_id, partner_id")
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw error;
      if (!event || (event.status !== "published" && event.status !== "past")) {
        setState({ kind: "not_found" });
        return;
      }

      const [venueRes, partnerRes, tiersRes] = await Promise.all([
        event.venue_id
          ? supabase.from("venues").select("name, address, city, timezone").eq("id", event.venue_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        event.partner_id
          ? supabase.from("public_partners").select("id, business_name").eq("id", event.partner_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("ticket_tiers")
          .select(TIER_COLUMNS)
          .eq("event_id", event.id)
          .eq("status", "active")
          .order("sort_order", { ascending: true }),
      ]);
      if (tiersRes.error) throw tiersRes.error;

      const venue = venueRes.data as { name: string | null; address: string | null; city: string | null; timezone: string | null } | null;
      const tiers: TierOption[] = (tiersRes.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? null,
        price_cents: t.price_cents ?? 0,
        currency: t.currency || "EUR",
        capacity: t.capacity ?? null,
        sold: t.sold ?? 0,
        per_user_max: t.per_user_max ?? 10,
        sale_starts_at: t.sale_starts_at ?? null,
        sale_ends_at: t.sale_ends_at ?? null,
        sort_order: t.sort_order ?? 0,
      }));

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
    } catch {
      setState({ kind: "error" });
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

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
          <div className="flex flex-col items-center py-24 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#FF7A4D]" />
            <p className="mt-4 text-sm text-white/60">Cargando el evento…</p>
          </div>
        )}

        {(state.kind === "not_found" || state.kind === "error") && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#E8542A]/40 bg-[#E8542A]/15 text-[#FFC9B0]">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">
              {state.kind === "not_found" ? "Este evento no está disponible" : "No hemos podido cargar el evento"}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-white/60">
              {state.kind === "not_found"
                ? "Puede que el local lo haya retirado o que el enlace no esté completo."
                : "Revisa tu conexión y vuelve a intentarlo."}
            </p>
            {state.kind === "error" && (
              <button
                type="button"
                onClick={() => void load()}
                className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white"
                style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)" }}
              >
                <RotateCcw className="h-4 w-4" />
                Reintentar
              </button>
            )}
            <Link to="/calendar" className="mt-6 text-sm text-white/50 underline underline-offset-4">
              Ver otros eventos
            </Link>
          </div>
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

const EventView = ({ data, buying, onBuy }: { data: PageData; buying: boolean; onBuy: () => void }) => {
  const { event, timezone: tz, venueName, address, city, partner, tiers } = data;
  const date = formatEventDate(event.date_start, tz);
  const time = formatEventTime(event.date_start, tz);
  const place = [venueName, address, city].filter(Boolean).join(" · ");
  const mapsQuery = [venueName, address, city].filter(Boolean).join(", ");
  const isPast =
    event.status === "past" ||
    new Date(event.date_end ?? event.date_start).getTime() < Date.now() - 2 * 60 * 60 * 1000;

  const tierRows = useMemo(
    () => tiers.map((t) => ({ tier: t, availability: tierAvailability(t) })),
    [tiers],
  );
  const onSale = !isPast && tierRows.some((r) => r.availability.kind === "available");
  const minPrice = tierRows
    .filter((r) => r.availability.kind === "available")
    .reduce<number | null>((min, r) => (min == null ? r.tier.price_cents : Math.min(min, r.tier.price_cents)), null);

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
            {tierRows.map(({ tier, availability }) => (
              <li
                key={tier.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{tier.name}</div>
                  {tier.description && <div className="truncate text-xs text-white/50">{tier.description}</div>}
                  {availability.kind !== "available" && (
                    <div className="mt-0.5 text-xs text-[#FFC9B0]">{availabilityLabel(availability.kind)}</div>
                  )}
                </div>
                <div className="shrink-0 text-sm font-semibold" style={mono}>
                  {tier.price_cents > 0 ? formatPriceCents(tier.price_cents, tier.currency) : "Gratis"}
                </div>
              </li>
            ))}
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
            style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)" }}
          >
            {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <TicketIcon className="h-4 w-4" />}
            {onSale
              ? minPrice != null && minPrice > 0
                ? `Comprar · desde ${formatPriceCents(minPrice)}`
                : "Conseguir entradas"
              : isPast
              ? "Evento terminado"
              : "Entradas no disponibles"}
          </button>
        </div>
      </div>
    </>
  );
};

function availabilityLabel(kind: string): string {
  switch (kind) {
    case "sold_out":
      return "Agotadas";
    case "not_started":
      return "Aún no a la venta";
    case "ended":
      return "Venta cerrada";
    default:
      return "No disponible";
  }
}

export default PublicEvent;
