const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/**
 * Franja de las pantallas demo del cliente (D-7): En vivo, Concierge y las
 * recomendaciones de la home. Solo se ven con el flag client_showcase y en la
 * web; esta franja va siempre encima para que nadie las confunda con datos
 * reales. Mismo aspecto que la del panel de local (PartnerDashboard).
 */
export const ClientDemoBanner = () => (
  <div
    role="note"
    className="mb-6 flex flex-col gap-1 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
    style={{ background: "rgba(232,176,76,0.12)", borderColor: "rgba(232,176,76,0.45)" }}
  >
    <span className="text-[11px] font-semibold uppercase" style={{ ...mono, letterSpacing: "0.22em", color: "#E8B04C" }}>
      DEMO · datos ficticios
    </span>
    <span className="text-[12px] text-muted-foreground">
      Pantalla de demostración: lo que ves es de ejemplo, no son datos reales ni se cobra nada.
    </span>
  </div>
);

export default ClientDemoBanner;
