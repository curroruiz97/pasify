import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  Loader2,
  LogIn,
  MapPin,
  RotateCcw,
  Ticket as TicketIcon,
  TimerOff,
  UserX,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { invokeEdge } from "@/components/tickets/edge";
import { formatEventDate, formatEventTime } from "@/components/tickets/ticketUtils";
import { signOutLocal } from "@/hooks/useAuth";
import { qk } from "@/lib/cache/keys";
import { useCurrentUser, useSessionReady } from "@/lib/cache/session";
import { loginPathWithNext, transferPath } from "@/lib/eventLinks";
import { withNext } from "@/lib/redirect-url";

/**
 * Pasify · aceptar una entrada enviada — `/#/transferencia?token=<token>`.
 *
 * Es el enlace del email de una transferencia (`send-ticket-transfer`). Se
 * abre sin sesión: `accept-ticket-transfer` (GET) cuenta de qué evento es la
 * entrada, de qué tipo, quién la envía y a qué email va (enmascarado), y en
 * qué estado está la transferencia.
 *
 *   - Pendiente y sin sesión → «Inicia sesión para recibirla»
 *     (`/login?next=/transferencia?token=…`, y desde allí crear cuenta).
 *   - Pendiente y con sesión → «Aceptar entrada» (POST con el JWT). La
 *     entrada pasa a esta cuenta con un QR nuevo: se invalida la cartera en
 *     caché y se va a ella (/client-dashboard/wallet).
 *   - Otra cuenta que la del email → cambiar de cuenta.
 *   - Caducada, ya aceptada, cancelada o rechazada, y la entrada que ya no se
 *     puede transferir (usada, devuelta, evento cancelado): dicho tal cual.
 */

type TransferStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

interface TransferInfo {
  event: {
    title: string;
    date_start: string | null;
    venue_name: string | null;
    timezone: string | null;
  };
  tier_name: string | null;
  from_name: string | null;
  to_email_masked: string | null;
  /** El que dice el servidor; uno que no conocemos se trata como "no disponible". */
  status: string;
}

type LoadState =
  | { kind: "loading" }
  /** Sin token, token mal formado o que no existe. */
  | { kind: "invalid" }
  | { kind: "error"; title: string; message: string }
  | { kind: "ready"; info: TransferInfo };

/**
 * Lo que ha pasado al aceptar. `status` corrige el de la carga cuando el
 * servidor dice que ya no está pendiente; `unavailable` es la entrada que
 * ya no se puede transferir.
 */
type AcceptState =
  | { kind: "idle" }
  | { kind: "accepting" }
  | { kind: "wrong_account" }
  | { kind: "closed"; status: TransferStatus | "unavailable" }
  | { kind: "failed"; message: string };

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};
const gradient = "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)";
const primaryShadow = "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)";

/** Los tokens de transferencia son UUID (ticket_transfers.invitation_token). */
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_STATUSES = new Set<string>(["pending", "accepted", "declined", "expired", "cancelled"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Valida la respuesta del GET: mejor un error claro que una tarjeta a medias. */
function parseTransfer(body: unknown): TransferInfo | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const ev = (b.event && typeof b.event === "object" ? b.event : {}) as Record<string, unknown>;
  const status = str(b.status);
  const title = str(ev.title);
  if (!status || !title) return null;
  return {
    event: {
      title,
      date_start: str(ev.date_start),
      venue_name: str(ev.venue_name),
      timezone: str(ev.timezone),
    },
    tier_name: str(b.tier_name),
    from_name: str(b.from_name),
    to_email_masked: str(b.to_email_masked),
    status: status.toLowerCase(),
  };
}

/** Códigos del POST que dicen que la transferencia ya no está pendiente. */
function closedStatusFor(code: string | null, httpStatus: number): TransferStatus | "unavailable" | null {
  switch (code) {
    case "already_used":
    case "already_accepted":
    case "transfer_accepted":
      return "accepted";
    case "expired":
    case "transfer_expired":
    case "invalid_or_expired":
      return "expired";
    case "cancelled":
    case "transfer_cancelled":
      return "cancelled";
    case "declined":
    case "transfer_declined":
      return "declined";
    case "ticket_not_transferable":
      return "unavailable";
    default:
      return httpStatus === 410 ? "expired" : null;
  }
}

const AcceptTransfer = () => {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionReady = useSessionReady();
  const user = useCurrentUser();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });
  const requestRef = useRef(0);
  const acceptingRef = useRef(false);

  const next = token ? transferPath(token) : "/calendar";

  const fetchTransfer = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!TOKEN_RE.test(token)) {
      setLoad({ kind: "invalid" });
      return;
    }
    setLoad({ kind: "loading" });
    const res = await invokeEdge<unknown>("accept-ticket-transfer", {
      method: "GET",
      query: { token },
    });
    if (requestId !== requestRef.current) return;

    if (!res.ok) {
      if (res.httpStatus === 400 || res.httpStatus === 404) {
        setLoad({ kind: "invalid" });
      } else if (res.httpStatus === 429) {
        setLoad({
          kind: "error",
          title: "Demasiadas consultas",
          message: "Espera un momento y vuelve a intentarlo.",
        });
      } else {
        setLoad({
          kind: "error",
          title: "No hemos podido cargar la entrada",
          message:
            res.httpStatus === 0
              ? "Comprueba tu conexión y vuelve a intentarlo."
              : "Ha fallado la conexión con Pasify. Inténtalo de nuevo en unos segundos.",
        });
      }
      return;
    }
    const info = parseTransfer(res.data);
    if (!info) {
      setLoad({
        kind: "error",
        title: "No hemos podido leer la transferencia",
        message: "La respuesta del servidor no es válida. Inténtalo de nuevo en unos segundos.",
      });
      return;
    }
    setAccept({ kind: "idle" });
    setLoad({ kind: "ready", info });
  }, [token]);

  useEffect(() => {
    void fetchTransfer();
  }, [fetchTransfer]);

  const goToLogin = useCallback(() => navigate(loginPathWithNext(next)), [navigate, next]);

  const switchAccount = useCallback(async () => {
    await signOutLocal();
    navigate(loginPathWithNext(next));
  }, [navigate, next]);

  const onAccept = useCallback(async () => {
    if (acceptingRef.current || !TOKEN_RE.test(token)) return;
    acceptingRef.current = true;
    setAccept({ kind: "accepting" });
    try {
      const res = await invokeEdge<{ ticket_id?: unknown }>("accept-ticket-transfer", {
        method: "POST",
        body: { token },
      });
      if (res.ok) {
        const uid = user?.id;
        if (uid) void queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) });
        toast.success("Entrada recibida", {
          description: "Ya la tienes en Mis entradas, con su código QR.",
        });
        navigate("/client-dashboard/wallet", { replace: true });
        return;
      }

      // La sesión ha caducado entre abrir la página y aceptar.
      if (res.httpStatus === 401) {
        toast("Vuelve a iniciar sesión", {
          description: "Tu sesión ha caducado. Entra de nuevo para recibir la entrada.",
        });
        goToLogin();
        return;
      }
      if (res.code === "email_mismatch" || res.httpStatus === 403) {
        setAccept({ kind: "wrong_account" });
        return;
      }
      const closed = closedStatusFor(res.code, res.httpStatus);
      if (closed) {
        setAccept({ kind: "closed", status: closed });
        return;
      }
      if (res.httpStatus === 400 || res.httpStatus === 404) {
        setLoad({ kind: "invalid" });
        return;
      }
      setAccept({
        kind: "failed",
        message:
          res.httpStatus === 0
            ? "No hay conexión. Comprueba tu red y vuelve a intentarlo."
            : res.httpStatus === 429
            ? "Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo."
            : "No hemos podido aceptar la entrada. Inténtalo de nuevo en unos segundos.",
      });
    } finally {
      acceptingRef.current = false;
    }
  }, [token, user, queryClient, navigate, goToLogin]);

  return (
    <div
      className="min-h-screen bg-[#0F0F0F] text-[#F4EEE2]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <header
        className="flex items-center gap-3 border-b border-white/10 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link to="/calendar" aria-label="Ver eventos">
          <Wordmark height={26} />
        </Link>
        <span className="text-[10px] uppercase text-[#E8542A]" style={{ ...mono, letterSpacing: "0.22em" }}>
          · Entrada enviada
        </span>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        {load.kind === "loading" && (
          <div className="flex flex-col items-center py-24 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-[#FF7A4D]" />
            <p className="mt-4 text-sm text-white/60">Cargando la entrada…</p>
          </div>
        )}

        {load.kind === "invalid" && (
          <Notice
            icon={<AlertTriangle className="h-8 w-8" />}
            title="Enlace no válido"
            text="Este enlace de transferencia no es válido o está incompleto. Ábrelo desde el email que te llegó, sin recortarlo."
          >
            <Link to="/soporte" className="mt-6 text-sm text-white/50 underline underline-offset-4">
              ¿Necesitas ayuda? Contacta con soporte
            </Link>
          </Notice>
        )}

        {load.kind === "error" && (
          <Notice icon={<AlertTriangle className="h-8 w-8" />} title={load.title} text={load.message}>
            <PrimaryButton onClick={() => void fetchTransfer()}>
              <RotateCcw className="h-4 w-4" />
              Reintentar
            </PrimaryButton>
          </Notice>
        )}

        {load.kind === "ready" && (
          <TransferView
            info={load.info}
            accept={accept}
            sessionReady={sessionReady}
            userEmail={user?.email ?? null}
            signedIn={!!user}
            registerPath={withNext("/register-client", next)}
            onLogin={goToLogin}
            onAccept={() => void onAccept()}
            onSwitchAccount={() => void switchAccount()}
            onWallet={() => navigate("/client-dashboard/wallet")}
          />
        )}
      </main>
    </div>
  );
};

// ---------------------------------------------------------------- vista

const TransferView = ({
  info,
  accept,
  sessionReady,
  userEmail,
  signedIn,
  registerPath,
  onLogin,
  onAccept,
  onSwitchAccount,
  onWallet,
}: {
  info: TransferInfo;
  accept: AcceptState;
  sessionReady: boolean;
  userEmail: string | null;
  signedIn: boolean;
  registerPath: string;
  onLogin: () => void;
  onAccept: () => void;
  onSwitchAccount: () => void;
  onWallet: () => void;
}) => {
  const { event } = info;
  const date = formatEventDate(event.date_start, event.timezone);
  const time = formatEventTime(event.date_start, event.timezone);
  const from = info.from_name;
  const status: TransferStatus | "unavailable" | "unknown" =
    accept.kind === "closed"
      ? accept.status
      : KNOWN_STATUSES.has(info.status)
      ? (info.status as TransferStatus)
      : "unknown";

  const headline = from ? (
    <>
      {from} te envía una{" "}
      <span style={serif} className="text-[#FF7A4D]">
        entrada
      </span>
    </>
  ) : (
    <>
      Te han enviado una{" "}
      <span style={serif} className="text-[#FF7A4D]">
        entrada
      </span>
    </>
  );

  return (
    <>
      <div
        className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-[#E8542A]"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        <span className="inline-block h-px w-5 bg-[#E8542A]/70" />
        Transferencia de entrada
      </div>
      <h1 className="text-2xl font-bold leading-tight tracking-tight">{headline}</h1>

      {/* Evento y tipo de entrada */}
      <article
        className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-[#161616]"
        style={{ boxShadow: "0 22px 50px -18px rgba(232,84,42,0.25)" }}
      >
        <div
          aria-hidden="true"
          className="h-2 w-full"
          style={{ background: "linear-gradient(90deg, #E8542A 0%, #B8381A 100%)" }}
        />
        <div className="space-y-3 px-5 pb-5 pt-4">
          <h2 className="text-xl font-semibold leading-tight tracking-tight">{event.title}</h2>
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
          {event.venue_name && (
            <div className="flex items-start gap-3 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF7A4D]" />
              <span className="min-w-0">{event.venue_name}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 border-t border-dashed border-white/15 pt-4">
            <div className="min-w-0">
              <div className="text-[10px] uppercase text-white/45" style={{ ...mono, letterSpacing: "0.18em" }}>
                Tipo
              </div>
              <div className="mt-1 truncate text-sm font-semibold">{info.tier_name || "Entrada"}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase text-white/45" style={{ ...mono, letterSpacing: "0.18em" }}>
                Para
              </div>
              <div className="mt-1 truncate text-sm font-semibold" style={mono}>
                {info.to_email_masked || "—"}
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* Qué se puede hacer */}
      <section className="mt-6" aria-live="polite">
        {status === "pending" && (
          <PendingActions
            accept={accept}
            sessionReady={sessionReady}
            signedIn={signedIn}
            userEmail={userEmail}
            maskedEmail={info.to_email_masked}
            registerPath={registerPath}
            onLogin={onLogin}
            onAccept={onAccept}
            onSwitchAccount={onSwitchAccount}
          />
        )}

        {status === "accepted" && (
          <StatusBox
            icon={<CheckCircle2 className="h-7 w-7" />}
            title="Esta entrada ya se ha aceptado"
            text="Ya está en Mis entradas de la cuenta que la recibió, con su propio código QR."
          >
            {signedIn && (
              <PrimaryButton onClick={onWallet}>
                <TicketIcon className="h-4 w-4" />
                Ver mis entradas
              </PrimaryButton>
            )}
          </StatusBox>
        )}

        {status === "expired" && (
          <StatusBox
            icon={<TimerOff className="h-7 w-7" />}
            title="Esta transferencia ha caducado"
            text={`Pide a ${from ?? "quien te la envió"} que te la vuelva a enviar desde Mis entradas.`}
          />
        )}

        {status === "cancelled" && (
          <StatusBox
            icon={<Ban className="h-7 w-7" />}
            title="Se ha cancelado el envío"
            text={`${from ?? "Quien te la envió"} ha cancelado el envío de esta entrada. Si crees que es un error, pídele que te la vuelva a enviar.`}
          />
        )}

        {status === "declined" && (
          <StatusBox
            icon={<Ban className="h-7 w-7" />}
            title="Esta transferencia se rechazó"
            text="La entrada sigue siendo de quien la envió."
          />
        )}

        {status === "unavailable" && (
          <StatusBox
            icon={<Ban className="h-7 w-7" />}
            title="Esta entrada ya no se puede transferir"
            text={`Puede que se haya usado o devuelto, o que el evento se haya cancelado. Habla con ${from ?? "quien te la envió"}.`}
          />
        )}

        {status === "unknown" && (
          <StatusBox
            icon={<AlertTriangle className="h-7 w-7" />}
            title="Esta transferencia no está disponible"
            text="No se puede aceptar ahora mismo. Si crees que es un error, contacta con soporte."
          />
        )}
      </section>
    </>
  );
};

const PendingActions = ({
  accept,
  sessionReady,
  signedIn,
  userEmail,
  maskedEmail,
  registerPath,
  onLogin,
  onAccept,
  onSwitchAccount,
}: {
  accept: AcceptState;
  sessionReady: boolean;
  signedIn: boolean;
  userEmail: string | null;
  maskedEmail: string | null;
  registerPath: string;
  onLogin: () => void;
  onAccept: () => void;
  onSwitchAccount: () => void;
}) => {
  const forEmail = maskedEmail ? (
    <span className="text-white/85" style={mono}>
      {maskedEmail}
    </span>
  ) : (
    "el email al que te la enviaron"
  );

  if (!sessionReady) {
    return (
      <div className="flex justify-center py-4" role="status" aria-label="Comprobando tu sesión">
        <Loader2 className="h-5 w-5 animate-spin text-white/50" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-5">
        <p className="text-[14px] leading-relaxed text-white/70">
          Para recibirla, inicia sesión con la cuenta de {forEmail}. Si aún no tienes cuenta, créala con ese
          email.
        </p>
        <PrimaryButton onClick={onLogin}>
          <LogIn className="h-4 w-4" />
          Inicia sesión para recibirla
        </PrimaryButton>
        <Link
          to={registerPath}
          className="mt-4 block text-center text-sm text-white/60 underline underline-offset-4"
        >
          Crear una cuenta
        </Link>
      </div>
    );
  }

  if (accept.kind === "wrong_account") {
    return (
      <div className="rounded-2xl border border-[#E8542A]/40 bg-[#E8542A]/10 px-5 py-5">
        <div className="flex items-start gap-3">
          <UserX className="mt-0.5 h-5 w-5 shrink-0 text-[#FFC9B0]" />
          <p className="text-[14px] leading-relaxed text-white/80">
            Esta entrada es para {forEmail}
            {userEmail ? (
              <>
                {" "}y has entrado como <span className="text-white">{userEmail}</span>
              </>
            ) : null}
            . Inicia sesión con la cuenta de ese email para recibirla.
          </p>
        </div>
        <PrimaryButton onClick={onSwitchAccount}>
          <LogIn className="h-4 w-4" />
          Cambiar de cuenta
        </PrimaryButton>
      </div>
    );
  }

  const accepting = accept.kind === "accepting";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-5">
      <p className="text-[14px] leading-relaxed text-white/70">
        La entrada pasará a tu cuenta
        {userEmail ? (
          <>
            {" "}(<span className="text-white/90">{userEmail}</span>)
          </>
        ) : null}{" "}
        y la verás en Mis entradas con su propio código QR.
      </p>
      {accept.kind === "failed" && (
        <p role="alert" className="mt-3 text-[13px] leading-relaxed text-[#FFC9B0]">
          {accept.message}
        </p>
      )}
      <PrimaryButton onClick={onAccept} disabled={accepting}>
        {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TicketIcon className="h-4 w-4" />}
        {accepting ? "Aceptando…" : "Aceptar entrada"}
      </PrimaryButton>
      <button
        type="button"
        onClick={onSwitchAccount}
        disabled={accepting}
        className="mt-4 block w-full text-center text-sm text-white/50 underline underline-offset-4 disabled:opacity-50"
      >
        ¿No es tu cuenta? Cambiar de cuenta
      </button>
    </div>
  );
};

// ---------------------------------------------------------------- piezas

const Notice = ({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center py-16 text-center">
    <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#E8542A]/40 bg-[#E8542A]/15 text-[#FFC9B0]">
      {icon}
    </div>
    <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
    <p className="mt-3 text-[15px] leading-relaxed text-white/60">{text}</p>
    {children}
  </div>
);

const StatusBox = ({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-7 text-center">
    <div className="text-[#FFC9B0]">{icon}</div>
    <h2 className="mt-3 text-lg font-semibold">{title}</h2>
    <p className="mt-2 text-sm leading-relaxed text-white/60">{text}</p>
    {children}
    <Link to="/calendar" className="mt-5 text-sm text-white/50 underline underline-offset-4">
      Ver el calendario
    </Link>
  </div>
);

const PrimaryButton = ({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white transition disabled:opacity-60"
    style={{ background: gradient, boxShadow: primaryShadow }}
  >
    {children}
  </button>
);

export default AcceptTransfer;
