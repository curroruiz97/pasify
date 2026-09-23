import { useState } from "react";

/**
 * Pantalla completa de "no hemos podido comprobar tu acceso" con Reintentar.
 *
 * La usan ProtectedRoute (no cargan los roles) y PartnerGate (no carga la
 * cuenta del local o no se pudo activar el plan gratuito). Sustituye a las
 * redirecciones a ciegas: un fallo de red NO es "no tienes acceso", así que
 * se ofrece reintentar en vez de mandar al usuario a otra pantalla.
 *
 * Mismo fondo que LoaderOne para que el paso loader → error → loader no
 * parpadee.
 */
interface AuthErrorScreenProps {
  title: string;
  description: string;
  /** Mensaje técnico para soporte (se pinta pequeño y en mono). */
  detail?: string | null;
  onRetry: () => unknown;
  onSignOut?: () => unknown;
}

const AuthErrorScreen = ({ title, description, detail, onRetry, onSignOut }: AuthErrorScreenProps) => {
  const [accion, setAccion] = useState<"reintentar" | "salir" | null>(null);

  const ejecutar = async (tipo: "reintentar" | "salir", fn: () => unknown) => {
    if (accion) return;
    setAccion(tipo);
    try {
      await fn();
    } catch (err) {
      console.error(`[AuthErrorScreen] ${tipo} falló:`, err);
    } finally {
      // Si la acción desmonta esta pantalla (reintento con éxito, logout) este
      // setState no hace nada; si no, se vuelve a habilitar el botón.
      setAccion(null);
    }
  };

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        textAlign: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
        background: "radial-gradient(circle at 50% 40%, #1a0e05 0%, #0a0a0a 70%)",
        color: "#F4EEE2",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          fontFamily: "'Geist Mono', ui-monospace, monospace",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#FF7A4D",
          marginBottom: "0.75rem",
        }}
      >
        — Pasify —
      </div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.6rem", letterSpacing: "-0.01em" }}>
        {title}
      </h1>
      <p style={{ color: "rgba(244,238,226,0.7)", fontSize: "0.9rem", maxWidth: "26rem", lineHeight: 1.5 }}>
        {description}
      </p>
      {detail ? (
        <p
          style={{
            marginTop: "0.75rem",
            maxWidth: "26rem",
            fontSize: "11px",
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            color: "rgba(244,238,226,0.45)",
            wordBreak: "break-word",
          }}
        >
          {detail}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void ejecutar("reintentar", onRetry)}
        disabled={accion !== null}
        style={{
          marginTop: "1.5rem",
          padding: "0.875rem 1.75rem",
          minWidth: "11rem",
          background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          color: "white",
          border: "none",
          borderRadius: "999px",
          fontWeight: 600,
          fontSize: "0.95rem",
          cursor: accion ? "default" : "pointer",
          opacity: accion ? 0.7 : 1,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
        }}
      >
        {accion === "reintentar" ? "Reintentando…" : "Reintentar"}
      </button>
      {onSignOut ? (
        <button
          type="button"
          onClick={() => void ejecutar("salir", onSignOut)}
          disabled={accion !== null}
          style={{
            marginTop: "0.9rem",
            background: "none",
            border: "none",
            padding: "0.5rem",
            fontSize: "0.8rem",
            color: "rgba(244,238,226,0.6)",
            textDecoration: "underline",
            textUnderlineOffset: "4px",
            cursor: accion ? "default" : "pointer",
          }}
        >
          {accion === "salir" ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      ) : null}
    </div>
  );
};

export default AuthErrorScreen;
