/**
 * Vendidas sobre el aforo de un evento, con una barra (Mis eventos).
 *
 * El aforo (events.capacity) lo mantiene la BD con la suma de los cupos de
 * todos los tipos de entrada; sin límite (un tipo sin cupo) no hay barra que
 * llenar y solo se dicen las vendidas.
 */
export const SoldBar = ({ sold, capacity }: { sold: number | null | undefined; capacity: number | null | undefined }) => {
  const vendidas = Math.max(0, sold ?? 0);
  const aforo = capacity != null && capacity > 0 ? capacity : null;
  const pct = aforo ? Math.min(100, Math.round((vendidas / aforo) * 100)) : 0;
  const agotado = aforo !== null && vendidas >= aforo;
  const texto = aforo !== null ? `${vendidas} de ${aforo} entradas vendidas` : `${vendidas} entradas vendidas, sin límite de aforo`;

  return (
    <div className="min-w-0" data-testid="vendidas">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-semibold tabular-nums text-foreground">
          {vendidas}
          {aforo !== null && <span className="font-normal text-muted-foreground"> / {aforo}</span>}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {aforo === null ? "Sin límite" : agotado ? "Agotado" : `${pct} %`}
        </span>
      </div>
      {aforo !== null ? (
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={aforo}
          aria-valuenow={Math.min(vendidas, aforo)}
          aria-label={texto}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${pct}%`,
              background: agotado ? "#4DB87A" : "linear-gradient(90deg, #FF7A4D 0%, #E8542A 100%)",
            }}
          />
        </div>
      ) : (
        <div className="mt-1 h-1.5 w-full rounded-full border border-dashed border-border" aria-label={texto} role="img" />
      )}
    </div>
  );
};

export default SoldBar;
