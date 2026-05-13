import { useState } from "react";
import { Heart, Loader2, Minus, Plus, Ticket } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useFavorites } from "@/hooks/useFavorites";

export type EventCardData = {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  city: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
};

interface Props {
  event: EventCardData;
  partnerId: string;
  partnerName?: string;
  /** Mostra il sottotitolo "@ partnerName" sotto il titolo (utile in favorites). */
  showPartner?: boolean;
  /**
   * Handler de "Comprar entrada". Recibe (eventId, qty). Soporta multi-ticket
   * vía el stepper integrado.
   */
  onBuyTicket?: (eventId: string, qty: number) => void;
  /** Si true, muestra spinner en el botón y lo deshabilita (compra en curso). */
  pending?: boolean;
  /** Tope superior del stepper de cantidad. Default 10 (cap del edge function). */
  maxQty?: number;
}

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

export const EventListCard = ({
  event,
  partnerId,
  partnerName,
  showPartner,
  onBuyTicket,
  pending = false,
  maxQty = 10,
}: Props) => {
  const [qty, setQty] = useState(1);
  const incQty = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQty((q) => Math.min(maxQty, q + 1));
  };
  const decQty = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQty((q) => Math.max(1, q - 1));
  };
  const date = new Date(event.date_start);
  const initial = (event.title?.[0] ?? "?").toUpperCase();
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(event.id);

  const handleToggleFav = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggle({
      id: event.id,
      partnerId,
      partnerName,
      title: event.title,
      description: event.description,
      date_start: event.date_start,
      city: event.city,
      price_cents: event.price_cents,
      capacity: event.capacity,
      tickets_sold: event.tickets_sold,
      image_url: event.image_url,
    });
  };

  const capacity = event.capacity ?? 0;
  const sold = event.tickets_sold ?? 0;
  const soldPct = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0;
  const remainingPct = 100 - soldPct;
  const almostSoldOut = capacity > 0 && remainingPct <= 20;
  const soldOut = capacity > 0 && sold >= capacity;

  // Status pill copy + color
  let statusLabel: string;
  let statusColor: string;
  if (soldOut) {
    statusLabel = "Sold out";
    statusColor = "#8A8275";
  } else if (almostSoldOut) {
    statusLabel = `Últimas · ${remainingPct}%`;
    statusColor = "#E8B04C";
  } else {
    statusLabel = `${remainingPct}% disponible`;
    statusColor = "#4DB87A";
  }

  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-border bg-card transition duration-300 hover:-translate-y-0.5"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
      }}
    >
      {/* Warm shadow on hover (added via style + class trick) */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition duration-300 group-hover:opacity-100"
        style={{
          boxShadow: "0 22px 50px -18px rgba(232,84,42,0.25), 0 0 0 1px rgba(232,84,42,0.35)",
        }}
      />

      <div className="relative flex flex-col gap-0 sm:flex-row">
        {/* MEDIA — image with date pill + heart overlay */}
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden sm:aspect-auto sm:w-44 md:w-52">
          {event.image_url ? (
            <img
              src={event.image_url}
              alt={event.title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
                color: "#F4EEE2",
                fontSize: 48,
                fontWeight: 800,
                letterSpacing: "-0.04em",
              }}
            >
              {initial}
            </div>
          )}

          {/* Gradient overlay bottom for legibility */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(10,10,10,0.05) 0%, rgba(10,10,10,0.55) 100%)",
            }}
          />

          {/* Date pill — top left */}
          <div
            className="absolute left-3 top-3 flex flex-col items-center rounded-lg px-2.5 py-1.5 text-center backdrop-blur-md"
            style={{
              background: "rgba(232,84,42,0.94)",
              color: "#fff",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.3), 0 6px 18px -6px rgba(232,84,42,0.5)",
            }}
          >
            <span
              className="text-[9px] font-semibold uppercase leading-none"
              style={{ ...mono, letterSpacing: "0.18em" }}
            >
              {format(date, "MMM", { locale: es })}
            </span>
            <span
              className="mt-1 text-xl font-bold leading-none"
              style={{ ...mono, letterSpacing: "-0.02em" }}
            >
              {format(date, "d", { locale: es })}
            </span>
          </div>

          {/* Heart — top right */}
          <span
            role="button"
            tabIndex={0}
            aria-label={fav ? "Quitar de favoritos" : "Añadir a favoritos"}
            aria-pressed={fav}
            onClick={handleToggleFav}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleToggleFav(e);
            }}
            className="absolute right-3 top-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full backdrop-blur-md transition hover:scale-110 active:scale-95"
            style={{
              background: fav ? "rgba(232,84,42,0.95)" : "rgba(10,10,10,0.55)",
              border: `1px solid ${fav ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.18)"}`,
              boxShadow: fav
                ? "0 6px 18px -6px rgba(232,84,42,0.65), inset 0 1px 0 rgba(255,255,255,0.25)"
                : "0 4px 12px -4px rgba(0,0,0,0.4)",
            }}
          >
            <Heart
              className="h-[18px] w-[18px]"
              color="#fff"
              fill={fav ? "#fff" : "transparent"}
              strokeWidth={fav ? 2 : 2.2}
            />
          </span>

          {/* Time — bottom left */}
          <div
            className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-md"
            style={{
              ...mono,
              letterSpacing: "0.12em",
              background: "rgba(10,10,10,0.55)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <span className="inline-block h-1 w-1 rounded-full bg-white/90" />
            {format(date, "HH:mm")}H
          </div>
        </div>

        {/* CONTENT */}
        <div className="flex min-w-0 flex-1 flex-col justify-between p-4 md:p-5">
          {/* Top: eyebrow + title + description */}
          <div className="min-w-0">
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] font-medium uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <span className="inline-block h-px w-5 bg-orange-500/70" />
              <span>{format(date, "EEEE", { locale: es })}</span>
              <span className="text-muted-foreground/70">·</span>
              <span className="text-muted-foreground">
                {format(date, "d MMM", { locale: es })}
              </span>
            </div>

            <h3
              className="text-base font-semibold leading-tight tracking-tight text-foreground sm:text-lg md:text-xl"
              style={{ letterSpacing: "-0.018em" }}
            >
              {event.title}
            </h3>

            {showPartner && partnerName && (
              <div className="mt-1 truncate text-[12px] font-medium text-orange-500">
                @ {partnerName}
              </div>
            )}

            {event.description && (
              <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                {event.description}
              </p>
            )}
          </div>

          {/* Bottom: stats + CTA */}
          <div className="mt-4 space-y-3">
            {/* Tickets progress */}
            {capacity > 0 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    Tickets ·{" "}
                    <span className="text-foreground">
                      {sold}/{capacity}
                    </span>
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase"
                    style={{ ...mono, letterSpacing: "0.14em", color: statusColor }}
                  >
                    {almostSoldOut && !soldOut && (
                      <span
                        className="relative inline-flex h-1.5 w-1.5"
                        aria-hidden="true"
                      >
                        <span
                          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                          style={{ background: statusColor }}
                        />
                        <span
                          className="relative inline-flex h-1.5 w-1.5 rounded-full"
                          style={{ background: statusColor }}
                        />
                      </span>
                    )}
                    {statusLabel}
                  </span>
                </div>
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${soldPct}%`,
                      background:
                        "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)",
                      boxShadow: "0 0 12px rgba(232,84,42,0.5)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Price + CTA row.
                Layout en mobile:
                  fila 1: Desde · precio
                  fila 2: stepper qty + CTA "Comprar X · YY€"
                En sm+ todo en una sola fila. */}
            <div className="flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-end justify-between gap-3 sm:block">
                <div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.18em" }}
                  >
                    Desde
                  </div>
                  <div
                    className="mt-0.5 text-xl font-bold leading-none tracking-tight text-foreground md:text-2xl"
                    style={mono}
                  >
                    {(event.price_cents / 100).toFixed(2)}
                    <span className="ml-1 text-sm font-medium text-muted-foreground">€</span>
                  </div>
                </div>

                {/* Qty stepper — visible junto al precio en mobile, junto al botón en desktop */}
                {!soldOut && (
                  <div
                    className="inline-flex items-center gap-0 rounded-full border border-border bg-card/60 sm:hidden"
                    aria-label="Cantidad de entradas"
                  >
                    <button
                      type="button"
                      onClick={decQty}
                      disabled={qty <= 1 || pending}
                      className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                      aria-label="Quitar entrada"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      className="min-w-[24px] text-center text-sm font-semibold text-foreground"
                      style={mono}
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={incQty}
                      disabled={qty >= maxQty || pending}
                      className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                      aria-label="Añadir entrada"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Qty stepper desktop — entre price y CTA */}
                {!soldOut && (
                  <div
                    className="hidden items-center gap-0 rounded-full border border-border bg-card/60 sm:inline-flex"
                    aria-label="Cantidad de entradas"
                  >
                    <button
                      type="button"
                      onClick={decQty}
                      disabled={qty <= 1 || pending}
                      className="inline-flex h-10 w-10 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                      aria-label="Quitar entrada"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      className="min-w-[28px] text-center text-sm font-semibold text-foreground"
                      style={mono}
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={incQty}
                      disabled={qty >= maxQty || pending}
                      className="inline-flex h-10 w-10 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                      aria-label="Añadir entrada"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}

              <button
                type="button"
                disabled={soldOut || pending}
                onClick={(e) => {
                  // Detén la propagación: la card está dentro de un <article>
                  // que en el futuro puede ser clicable para abrir detalle.
                  e.preventDefault();
                  e.stopPropagation();
                  if (soldOut || pending) return;
                  if (onBuyTicket) {
                    onBuyTicket(event.id, qty);
                  } else if (import.meta.env.DEV) {
                     
                    console.warn(
                      "[EventListCard] onBuyTicket prop not provided. Button click is a no-op.",
                      { eventId: event.id, qty }
                    );
                  }
                }}
                className="group/btn inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 sm:flex-initial md:text-sm"
                style={{
                  background: soldOut
                    ? "#3a3a3a"
                    : "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow: soldOut
                    ? "none"
                    : "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(80,20,5,0.22), 0 6px 16px -4px rgba(232,84,42,0.5), 0 14px 32px -10px rgba(184,56,26,0.5)",
                  letterSpacing: "-0.005em",
                }}
                aria-label={
                  soldOut
                    ? "Entradas agotadas"
                    : pending
                    ? "Procesando compra"
                    : `Comprar ${qty} ${qty === 1 ? "entrada" : "entradas"}`
                }
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ticket className="h-4 w-4" />
                )}
                {soldOut
                  ? "Agotado"
                  : pending
                  ? "Procesando…"
                  : qty === 1
                  ? "Comprar entrada"
                  : `Comprar ${qty} · ${((event.price_cents * qty) / 100).toFixed(2)}€`}
                {!soldOut && !pending && (
                  <span
                    aria-hidden="true"
                    className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1"
                  >
                    →
                  </span>
                )}
              </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

export default EventListCard;
