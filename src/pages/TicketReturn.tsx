import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, Smartphone, XCircle } from "lucide-react";
import { useCheckoutConfirmation } from "@/hooks/usePendingCheckoutResume";

/**
 * Pasify · destino de retorno de Stripe Checkout para la APP NATIVA.
 *
 * En la app el checkout se abre en Safari/Chrome, fuera de la WebView, así
 * que quien aterriza aquí es un navegador SIN sesión de Supabase. Stripe
 * vuelve con `?order_id=<uuid>&session_id=<cs_…>` (HashRouter: la query va
 * dentro del hash y la lee `useSearchParams`).
 *
 * Con esos dos datos preguntamos a `confirm-checkout-session`, que acepta la
 * llamada sin sesión si casan, consulta a Stripe y, si está pagado, emite las
 * entradas. Así no dependemos solo del webhook ni de que el usuario vuelva a
 * abrir la app. Mensajes honestos según el estado real:
 *   - pagado     → entradas en la app (Mis entradas) y en el email.
 *   - pendiente  → seguimos comprobando, con reintento.
 *   - caducado   → no se ha cobrado nada.
 *   - cancelado  → Stripe vuelve aquí solo con `order_id` (cancel_url).
 *
 * "Abrir la app": solo en Android, que registra el esquema `es.pasify.app`
 * en AndroidManifest.xml. iOS no declara CFBundleURLSchemes (ni Universal
 * Links), así que allí solo damos instrucciones: un enlace a un esquema no
 * registrado acaba en "Safari no puede abrir la página".
 */

const ANDROID_PACKAGE = "es.pasify.app";
const ANDROID_SCHEME = "es.pasify.app";

/** URL `intent://` de Chrome: abre la app (o su ficha de Play si no está). */
const androidIntentUrl = (path: string) =>
  `intent://app${path}#Intent;scheme=${ANDROID_SCHEME};package=${ANDROID_PACKAGE};end`;

type Platform = "android" | "ios" | "other";

const detectPlatform = (): Platform => {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS se presenta como Mac de escritorio, pero con pantalla táctil.
  if (/macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1) {
    return "ios";
  }
  return "other";
};

const gradient = "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)";

const ReturnToApp = ({ platform, path }: { platform: Platform; path: string }) => {
  if (platform === "android") {
    return (
      <a
        href={androidIntentUrl(path)}
        className="mt-8 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold text-white"
        style={{ background: gradient, boxShadow: "0 12px 30px -10px rgba(232,84,42,0.55)" }}
      >
        <Smartphone className="h-5 w-5" />
        Abrir la app
      </a>
    );
  }
  return (
    <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] leading-relaxed text-white/70">
      {platform === "ios" ? (
        <>
          Para volver, toca <strong className="text-white">◀ Pasify</strong> arriba a la izquierda
          o abre la app Pasify desde tu pantalla de inicio.
        </>
      ) : (
        <>Abre la app Pasify en tu móvil para verlas.</>
      )}
    </p>
  );
};

const RetryButton = ({ onClick, label = "Reintentar" }: { onClick: () => void; label?: string }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 text-sm font-semibold text-white/85 transition hover:border-[#E8542A]/60"
  >
    <RotateCcw className="h-4 w-4" />
    {label}
  </button>
);

const TicketReturn = () => {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const orderId = params.get("order_id");
  // cancel_url de Stripe: llega solo con order_id (sin session_id).
  const cancelled = !sessionId && !!orderId;
  const { state, retry } = useCheckoutConfirmation(cancelled ? null : sessionId, orderId);
  const platform = useMemo(detectPlatform, []);

  let icon: React.ReactNode;
  let tone: "ok" | "wait" | "bad" = "wait";
  let title: string;
  let body: React.ReactNode;
  let action: React.ReactNode = null;

  if (cancelled) {
    tone = "bad";
    icon = <XCircle className="h-9 w-9" />;
    title = "Pago cancelado";
    body = "No se ha realizado ningún cargo. Vuelve a la app Pasify cuando quieras para intentarlo de nuevo.";
    action = <ReturnToApp platform={platform} path="/" />;
  } else {
    switch (state.phase) {
      case "idle":
        icon = <Smartphone className="h-9 w-9" />;
        title = "Vuelve a la app Pasify";
        body =
          "No hemos recibido la referencia de tu compra. Si has completado el pago, tus entradas aparecerán en la app, en Mis entradas.";
        action = <ReturnToApp platform={platform} path="/client-dashboard?wallet=1" />;
        break;
      case "checking":
        icon = <Loader2 className="h-9 w-9 animate-spin" />;
        title = "Confirmando tu pago…";
        body = "Estamos comprobando el pago con Stripe. Suele tardar unos segundos.";
        break;
      case "pending":
        icon = state.exhausted ? <Clock className="h-9 w-9" /> : <Loader2 className="h-9 w-9 animate-spin" />;
        title = "Estamos confirmando tu pago…";
        body = state.exhausted
          ? "Stripe todavía no nos ha confirmado el pago. Si se completa, tus entradas aparecerán en la app Pasify, en Mis entradas."
          : "Stripe todavía no nos ha confirmado el pago. Seguimos comprobándolo; no hace falta que hagas nada.";
        action = <RetryButton onClick={retry} label="Comprobar de nuevo" />;
        break;
      case "paid":
        tone = "ok";
        icon = <CheckCircle2 className="h-9 w-9" />;
        title = "Pago confirmado";
        body = "Tus entradas están en la app Pasify (Mis entradas) y en tu email.";
        action = <ReturnToApp platform={platform} path="/client-dashboard?wallet=1" />;
        break;
      case "expired":
        tone = "bad";
        icon = <XCircle className="h-9 w-9" />;
        title = "La compra no se completó";
        body =
          "La sesión de pago caducó y no se ha realizado ningún cargo. Vuelve a la app Pasify para intentarlo de nuevo.";
        action = <ReturnToApp platform={platform} path="/" />;
        break;
      case "unverifiable":
        icon = <Smartphone className="h-9 w-9" />;
        title = "Vuelve a la app para terminar";
        body =
          "Desde el navegador no podemos comprobar el pago. Abre la app Pasify: la compra se confirmará sola y, si se completó, tus entradas aparecerán en Mis entradas.";
        action = <ReturnToApp platform={platform} path="/client-dashboard?wallet=1" />;
        break;
      case "error":
      default: {
        tone = "bad";
        icon = <AlertTriangle className="h-9 w-9" />;
        const status = state.phase === "error" ? state.httpStatus : 0;
        if (status === 404 || status === 403 || status === 400) {
          title = "No encontramos este pedido";
          body =
            "El enlace no corresponde a ninguna compra. Si has pagado, tus entradas aparecerán igualmente en la app Pasify, en Mis entradas; si no, escríbenos a soporte.";
          action = <ReturnToApp platform={platform} path="/client-dashboard?wallet=1" />;
        } else {
          title = "No hemos podido comprobar el pago";
          body =
            "Ha fallado la conexión con Pasify. Si el pago se completó, tus entradas aparecerán en la app, en Mis entradas.";
          action = <RetryButton onClick={retry} />;
        }
        break;
      }
    }
  }

  const iconStyle: React.CSSProperties =
    tone === "ok"
      ? {
          background: "linear-gradient(180deg, #5BCB8A 0%, #4DB87A 55%, #3C9F65 100%)",
          boxShadow: "0 10px 30px -10px rgba(77,184,122,0.6)",
          color: "#fff",
        }
      : tone === "bad"
      ? {
          background: "linear-gradient(180deg, rgba(232,84,42,0.22) 0%, rgba(184,56,26,0.18) 100%)",
          border: "1px solid rgba(232,84,42,0.4)",
          color: "#FFC9B0",
        }
      : { background: gradient, boxShadow: "0 10px 30px -10px rgba(232,84,42,0.6)", color: "#fff" };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F0F0F] px-6 py-12 text-[#F4EEE2]">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl" style={iconStyle}>
          {icon}
        </div>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>

        <p className="mt-3 text-[15px] leading-relaxed text-white/60">{body}</p>

        {action}

        {state.phase === "paid" && !cancelled && (
          <p className="mt-8 text-[13px] leading-relaxed text-white/35">
            Puedes cerrar esta ventana.
          </p>
        )}

        {(state.phase === "error" || cancelled) && (
          <Link
            to="/soporte"
            className="mt-8 inline-block text-[13px] text-white/40 underline underline-offset-4"
          >
            ¿Algún problema? Contacta con soporte
          </Link>
        )}
      </div>
    </div>
  );
};

export default TicketReturn;
