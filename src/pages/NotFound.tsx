import { Link } from "react-router-dom";

/**
 * Página que no existe. En español y con el fondo oscuro de la app (antes,
 * un "Oops! Page not found" en inglés sobre gris claro).
 */
const NotFound = () => (
  <div
    className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    style={{
      fontFamily: "'Inter', system-ui, sans-serif",
      background: "radial-gradient(circle at 50% 40%, #1a0e05 0%, #0a0a0a 70%)",
      color: "#F4EEE2",
    }}
  >
    <div
      className="mb-3 text-[10px] uppercase"
      style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: "0.22em", color: "#FF7A4D" }}
    >
      — Pasify · 404 —
    </div>
    <h1 className="mb-3 text-2xl font-bold tracking-tight">Esta página no existe</h1>
    <p className="max-w-sm text-sm leading-relaxed" style={{ color: "rgba(244,238,226,0.7)" }}>
      Puede que el enlace esté mal escrito o que la página ya no esté disponible.
    </p>
    <Link
      to="/"
      className="mt-6 rounded-full px-7 py-3 text-sm font-semibold text-white"
      style={{
        background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
      }}
    >
      Volver al inicio
    </Link>
  </div>
);

export default NotFound;
