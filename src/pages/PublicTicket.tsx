import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import QRCodeLib from "qrcode";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  RotateCcw,
  Sun,
  Ticket as TicketIcon,
  XCircle,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import {
  formatEventDate,
  formatEventTime,
  formatMomentLong,
  parseEdgeError,
  ticketDoorCode,
} from "@/components/tickets/ticketUtils";

/**
 * Pasify · entrada pública — `/#/entrada/:ticketId?k=<access_url_token>`.
 *
 * Es el enlace que viaja en el email de la compra: abre la entrada en
 * cualquier navegador, sin cuenta ni sesión. El token `k` es la llave; la
 * edge function `ticket-public` comprueba que case con la entrada y solo
 * devuelve el `qr_token` cuando la entrada es válida.
 *
 * Estados: válida (QR grande), ya utilizada (fecha de uso), reembolsada o
 * anulada (sin QR y con aviso claro) y errores honestos (enlace incompleto,
 * no encontrada, sin conexión).
 */

type PublicTicketData = {
  ticket: {
    id: string;
    status: string;
    tier_name: string | null;
    holder_name: string | null;
    qr_token: string | null;
    used_at: string | null;
  };
  event: {
    title: string;
    date_start: string;
    date_end: string | null;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    image_url: string | null;
    timezone: string | null;
  };
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: PublicTicketData }
  | { kind: "error"; title: string; message: string; canRetry: boolean };

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Valida la forma de la respuesta: mejor un error claro que una entrada a medias. */
function parseResponse(body: unknown): PublicTicketData | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const t = b.ticket as Record<string, unknown> | undefined;
  const e = b.event as Record<string, unknown> | undefined;
  if (!t || !e || !str(t.id) || !str(t.status) || !str(e.title) || !str(e.date_start)) return null;
  return {
    ticket: {
      id: t.id as string,
      status: t.status as string,
      tier_name: str(t.tier_name),
      holder_name: str(t.holder_name),
      qr_token: str(t.qr_token),
      used_at: str(t.used_at),
    },
    event: {
      title: e.title as string,
      date_start: e.date_start as string,
      date_end: str(e.date_end),
      venue_name: str(e.venue_name),
      address: str(e.address),
      city: str(e.city),
      image_url: str(e.image_url),
      timezone: str(e.timezone),
    },
  };
}

function describeLoadError(httpStatus: number, body: unknown): LoadState {
  const { code } = parseEdgeError(body);
  if (httpStatus === 404 || code === "ticket_not_found" || code === "not_found") {
    return {
      kind: "error",
      title: "No encontramos esta entrada",
      message: "Comprueba que has abierto el enlace completo del email de tu compra.",
      canRetry: false,
    };
  }
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) {
    return {
      kind: "error",
      title: "Enlace no válido",
      message:
        "Este enlace no es válido o ya no da acceso a la entrada. Abre el enlace completo del email o entra en la app Pasify (Mis entradas).",
      canRetry: false,
    };
  }
  if (httpStatus === 429) {
    return {
      kind: "error",
      title: "Demasiadas consultas",
      message: "Espera un momento y vuelve a intentarlo.",
      canRetry: true,
    };
  }
  return {
    kind: "error",
    title: "No hemos podido cargar la entrada",
    message: "Ha fallado la conexión con Pasify. Inténtalo de nuevo en unos segundos.",
    canRetry: true,
  };
}

const PublicTicket = () => {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [searchParams] = useSearchParams();
  const accessKey = searchParams.get("k");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!ticketId || !accessKey) {
      setState({
        kind: "error",
        title: "Enlace incompleto",
        message:
          "A este enlace le falta una parte. Ábrelo desde el email de tu compra, sin recortarlo.",
        canRetry: false,
      });
      return;
    }
    setState({ kind: "loading" });

    const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ticket-public`);
    url.searchParams.set("id", ticketId);
    url.searchParams.set("k", accessKey);

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: "GET",
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
    } catch {
      if (requestId !== requestRef.current) return;
      setState({
        kind: "error",
        title: "Sin conexión",
        message: "No hemos podido cargar la entrada. Comprueba tu conexión y vuelve a intentarlo.",
        canRetry: true,
      });
      return;
    }

    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    if (requestId !== requestRef.current) return;

    if (!resp.ok) {
      setState(describeLoadError(resp.status, body));
      return;
    }
    const data = parseResponse(body);
    if (!data) {
      setState({
        kind: "error",
        title: "No hemos podido leer la entrada",
        message: "La respuesta del servidor no es válida. Inténtalo de nuevo en unos segundos.",
        canRetry: true,
      });
      return;
    }
    setState({ kind: "ready", data });
  }, [ticketId, accessKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const showQr =
    state.kind === "ready" && state.data.ticket.status === "paid" && !!state.data.ticket.qr_token;
  const qrToken = state.kind === "ready" ? state.data.ticket.qr_token : null;

  useEffect(() => {
    if (!showQr || !qrToken) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCodeLib.toDataURL(qrToken, {
      width: 560,
      margin: 2,
      color: { dark: "#0F0F0F", light: "#F4EEE2" },
      errorCorrectionLevel: "M",
    })
      .then((dataUrl: string) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch((err: unknown) => console.error("[PublicTicket] QR", err));
    return () => {
      cancelled = true;
    };
  }, [showQr, qrToken]);

  return (
    <div
      className="min-h-screen bg-[#0F0F0F] text-[#F4EEE2]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <header
        className="flex items-center gap-3 border-b border-white/10 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Wordmark height={26} />
        <span
          className="text-[10px] uppercase text-[#E8542A]"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          · Entrada
        </span>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        {state.kind === "loading" && (
          <div className="flex flex-col items-center py-24 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#FF7A4D]" />
            <p className="mt-4 text-sm text-white/60">Cargando tu entrada…</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#E8542A]/40 bg-[#E8542A]/15 text-[#FFC9B0]">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">{state.title}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-white/60">{state.message}</p>
            {state.canRetry && (
              <button
                type="button"
                onClick={() => void load()}
                className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white"
                style={{
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
                }}
              >
                <RotateCcw className="h-4 w-4" />
                Reintentar
              </button>
            )}
            <Link to="/soporte" className="mt-6 text-sm text-white/50 underline underline-offset-4">
              ¿Necesitas ayuda? Contacta con soporte
            </Link>
          </div>
        )}

        {state.kind === "ready" && (
          <TicketView data={state.data} qrDataUrl={qrDataUrl} showQr={showQr} />
        )}
      </main>
    </div>
  );
};

const TicketView = ({
  data,
  qrDataUrl,
  showQr,
}: {
  data: PublicTicketData;
  qrDataUrl: string | null;
  showQr: boolean;
}) => {
  const { ticket, event } = data;
  const doorCode = showQr ? ticketDoorCode(ticket.qr_token) : null;
  const tz = event.timezone;
  const date = formatEventDate(event.date_start, tz);
  const time = formatEventTime(event.date_start, tz);
  const place = [event.venue_name, event.address, event.city].filter(Boolean).join(" · ");
  const mapsQuery = [event.venue_name, event.address, event.city].filter(Boolean).join(", ");

  const status = ticket.status;
  const statusPill =
    status === "paid"
      ? { label: "Válida", bg: "rgba(77,184,122,0.18)", color: "#7FE0A6" }
      : status === "used"
      ? { label: "Utilizada", bg: "rgba(244,238,226,0.12)", color: "#F4EEE2" }
      : status === "pending"
      ? { label: "Pendiente de pago", bg: "rgba(232,176,76,0.18)", color: "#E8B04C" }
      : { label: "No válida", bg: "rgba(232,84,42,0.2)", color: "#FFC9B0" };

  // Mensaje cuando NO enseñamos el QR.
  const notice = (() => {
    if (status === "used") {
      const when = ticket.used_at ? formatMomentLong(ticket.used_at, tz) : "";
      return {
        icon: <CheckCircle2 className="h-7 w-7" />,
        title: when ? `Entrada ya utilizada el ${when}` : "Entrada ya utilizada",
        text: "Esta entrada ya se ha validado en la puerta y no puede volver a usarse.",
      };
    }
    if (status === "refunded") {
      return {
        icon: <XCircle className="h-7 w-7" />,
        title: "Entrada reembolsada",
        text: "El importe de esta entrada se ha devuelto y ya no es válida para entrar.",
      };
    }
    if (status === "cancelled") {
      return {
        icon: <XCircle className="h-7 w-7" />,
        title: "Entrada anulada",
        text: "Esta entrada se ha anulado y ya no es válida para entrar.",
      };
    }
    if (status === "pending") {
      return {
        icon: <Clock className="h-7 w-7" />,
        title: "Pago pendiente de confirmar",
        text: "Todavía no hemos confirmado el pago de esta entrada. Vuelve a abrir este enlace en unos minutos.",
      };
    }
    if (status === "paid") {
      return {
        icon: <TicketIcon className="h-7 w-7" />,
        title: "Código no disponible en este enlace",
        text: "Si la entrada es tuya, ábrela en la app Pasify, en Mis entradas.",
      };
    }
    return {
      icon: <XCircle className="h-7 w-7" />,
      title: "Entrada no válida",
      text: "Esta entrada no permite el acceso al evento.",
    };
  })();

  return (
    <article
      className="overflow-hidden rounded-3xl border border-white/10 bg-[#161616]"
      style={{ boxShadow: "0 22px 50px -18px rgba(232,84,42,0.25)" }}
    >
      {/* Evento */}
      <div className="relative">
        {event.image_url ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <img src={event.image_url} alt="" className="h-full w-full object-cover" />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background: "linear-gradient(180deg, rgba(10,10,10,0) 30%, rgba(22,22,22,1) 100%)",
              }}
            />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="h-24 w-full"
            style={{ background: "linear-gradient(160deg, #E8542A 0%, #B8381A 70%, #161616 100%)" }}
          />
        )}

        <div className={event.image_url ? "-mt-10 relative px-5" : "relative px-5 pt-4"}>
          <span
            className="inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase"
            style={{
              ...mono,
              letterSpacing: "0.16em",
              background: statusPill.bg,
              color: statusPill.color,
            }}
          >
            {statusPill.label}
          </span>
          <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight">{event.title}</h1>
        </div>
      </div>

      <div className="space-y-3 px-5 pb-5 pt-4">
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
              {place}
              {mapsQuery && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 whitespace-nowrap text-[#FF7A4D] underline underline-offset-4"
                >
                  Cómo llegar
                </a>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Separador troquelado */}
      <div className="relative h-6" aria-hidden="true">
        <div className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-[#0F0F0F]" />
        <div className="absolute -right-3 top-0 h-6 w-6 rounded-full bg-[#0F0F0F]" />
        <div className="absolute inset-x-5 top-3 border-t border-dashed border-white/15" />
      </div>

      {/* Titular + QR */}
      <div className="px-5 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <div
              className="text-[10px] uppercase text-white/45"
              style={{ ...mono, letterSpacing: "0.18em" }}
            >
              Titular
            </div>
            <div className="mt-1 truncate text-sm font-semibold">{ticket.holder_name || "—"}</div>
          </div>
          <div className="min-w-0">
            <div
              className="text-[10px] uppercase text-white/45"
              style={{ ...mono, letterSpacing: "0.18em" }}
            >
              Tipo
            </div>
            <div className="mt-1 truncate text-sm font-semibold">{ticket.tier_name || "Entrada"}</div>
          </div>
        </div>

        {showQr ? (
          <div className="mt-6 flex flex-col items-center">
            <div className="w-full rounded-3xl p-4" style={{ background: "#F4EEE2" }}>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Código QR de la entrada"
                  className="mx-auto aspect-square w-full max-w-[320px]"
                  draggable={false}
                />
              ) : (
                <div className="mx-auto aspect-square w-full max-w-[320px] animate-pulse rounded-2xl bg-black/10" />
              )}
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[13px] text-white/60">
              <Sun className="h-4 w-4 shrink-0" />
              Sube el brillo y muestra este código en la puerta.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center">
            <div className="text-[#FFC9B0]">{notice.icon}</div>
            <h2 className="mt-3 text-lg font-semibold">{notice.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{notice.text}</p>
          </div>
        )}

        {doorCode ? (
          <p className="mt-6 text-center text-[11px] uppercase text-white/50" style={{ ...mono, letterSpacing: "0.18em" }}>
            Código <span className="text-sm text-white/85">{doorCode}</span>
          </p>
        ) : (
          <p
            className="mt-6 text-center text-[10px] uppercase text-white/35"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            Ref. {ticket.id.slice(0, 8)}
          </p>
        )}
      </div>

      <div className="border-t border-white/10 px-5 py-4 text-center text-[13px] leading-relaxed text-white/50">
        Si compraste con tu cuenta de Pasify, también la tienes en la app, en{" "}
        <span className="text-white/80" style={serif}>
          Mis entradas
        </span>
        .
      </div>
    </article>
  );
};

export default PublicTicket;
