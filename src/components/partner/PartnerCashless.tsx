import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, HandCoins, Loader2, Receipt, Users } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { listEventChoices, pickActiveEvent } from "@/lib/pickActiveEvent";

/**
 * PartnerCashless — wallets cashless reales por evento.
 *
 *   - Lee `cashless_wallets` del evento elegido y suma `cashless_topups` y
 *     `cashless_transactions` (kind = purchase) de esas wallets.
 *   - El evento por defecto es el de pickActiveEvent (en curso o el próximo);
 *     el selector ofrece los de listSelectableEvents. Los eventos llegan del
 *     panel, los mismos que ve el resto de secciones.
 *
 * La vinculación con pulseras físicas (RFID/NFC) no existe todavía: lo dice
 * el BetaBadge y no se promete ningún flujo alternativo.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export interface CashlessEvent {
  id: string;
  title: string;
  date_start: string;
  date_end?: string | null;
  status: string;
}

interface Props {
  events: CashlessEvent[];
}

interface WalletRow {
  id: string;
  user_id: string | null;
  event_id: string;
  wristband_uid: string | null;
  balance_cents: number;
  status: string;
  created_at: string;
  closed_at: string | null;
  // Calculados aparte (no son columnas):
  total_topped_up_cents: number;
  total_spent_cents: number;
}

const WALLET_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  active: { label: "Activa", bg: "rgba(77,184,122,0.15)", color: "#4DB87A" },
  closed: { label: "Cerrada", bg: "rgba(155,147,136,0.15)", color: "#9b9388" },
  refunded: { label: "Reembolsada", bg: "rgba(232,176,76,0.15)", color: "#E8B04C" },
};

const euros = (cents: number, digits = 0) =>
  `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;

export const PartnerCashless = ({ events }: Props) => {
  // Seleccionables: en curso, próximos 7 días y terminados hace < 12 h, más
  // el evento por defecto aunque quede fuera de esa ventana.
  const selectable = useMemo(() => listEventChoices(events), [events]);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    () => pickActiveEvent(events)?.id ?? null
  );
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  // Si cambia la lista y el elegido ya no está, vuelta al evento por defecto.
  useEffect(() => {
    if (selectedEventId && selectable.some((e) => e.id === selectedEventId)) return;
    setSelectedEventId(pickActiveEvent(events)?.id ?? selectable[0]?.id ?? null);
  }, [events, selectable, selectedEventId]);

  const loadWallets = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!selectedEventId) {
      setWallets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("cashless_wallets")
        .select("id, user_id, event_id, wristband_uid, balance_cents, status, created_at, closed_at")
        .eq("event_id", selectedEventId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) throw new Error(err.message);
      const baseWallets = (data ?? []) as Array<
        Omit<WalletRow, "total_topped_up_cents" | "total_spent_cents">
      >;

      // Totales sumados en cliente: con < 200 wallets es trivial y evita
      // agregados anónimos en PostgREST.
      const walletIds = baseWallets.map((w) => w.id);
      if (walletIds.length === 0) {
        if (requestId === requestRef.current) setWallets([]);
        return;
      }
      const [topupsRes, txsRes] = await Promise.all([
        supabase.from("cashless_topups").select("wallet_id, amount_cents").in("wallet_id", walletIds),
        supabase
          .from("cashless_transactions")
          .select("wallet_id, amount_cents, kind")
          .in("wallet_id", walletIds),
      ]);
      if (topupsRes.error) throw new Error(topupsRes.error.message);
      if (txsRes.error) throw new Error(txsRes.error.message);

      const topByWallet = new Map<string, number>();
      for (const t of (topupsRes.data ?? []) as Array<{ wallet_id: string; amount_cents: number }>) {
        topByWallet.set(t.wallet_id, (topByWallet.get(t.wallet_id) ?? 0) + t.amount_cents);
      }
      const spentByWallet = new Map<string, number>();
      for (const t of (txsRes.data ?? []) as Array<{ wallet_id: string; amount_cents: number; kind: string }>) {
        // Solo lo que descuenta saldo (compras en barra).
        if (t.kind === "purchase") {
          spentByWallet.set(t.wallet_id, (spentByWallet.get(t.wallet_id) ?? 0) + t.amount_cents);
        }
      }
      if (requestId !== requestRef.current) return;
      setWallets(
        baseWallets.map((w) => ({
          ...w,
          total_topped_up_cents: topByWallet.get(w.id) ?? 0,
          total_spent_cents: spentByWallet.get(w.id) ?? 0,
        }))
      );
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const msg = err instanceof Error ? err.message : "Error cargando wallets";
      console.error("[PartnerCashless] loadWallets:", err);
      setWallets([]);
      setError(msg);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    void loadWallets();
  }, [loadWallets]);

  const totals = useMemo(() => {
    const accounts = wallets.length;
    const active = wallets.filter((w) => w.status === "active").length;
    const topUp = wallets.reduce((s, w) => s + (w.total_topped_up_cents ?? 0), 0);
    const spent = wallets.reduce((s, w) => s + (w.total_spent_cents ?? 0), 0);
    const balance = wallets.reduce((s, w) => s + (w.balance_cents ?? 0), 0);
    return { accounts, active, topUp, spent, balance };
  }, [wallets]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              Cashless · Pasify
            </span>
            <BetaBadge
              label="Beta · Sin pulseras"
              reason="Las wallets, recargas y consumos se leen de la base de datos. La vinculación con pulseras físicas (RFID/NFC) todavía no está disponible."
            />
          </div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Cashless <span style={serif} className="text-orange-500">wallets</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saldo prepago por evento: recargas, consumo y saldo sin gastar.
          </p>
        </div>
        {selectable.length > 0 && (
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEventId(e.target.value || null)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
            aria-label="Evento"
          >
            {selectable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {format(new Date(e.date_start), "d MMM HH:mm", { locale: es })}
              </option>
            ))}
          </select>
        )}
      </header>

      {selectable.length === 0 && (
        <PasifyEmptyState
          icon={<Coins className="h-7 w-7" />}
          eyebrow="Sin eventos"
          title="Pasify Cashless arranca con un evento"
          subtitle="Aquí aparecen tus eventos publicados: el que está en curso, los de los próximos 7 días y los terminados hace menos de 12 horas."
        />
      )}

      {selectable.length > 0 && error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border p-4 text-sm sm:flex-row sm:items-center"
          style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">No pudimos cargar las wallets</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadWallets()}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-orange-500/40"
          >
            Reintentar
          </button>
        </div>
      )}

      {selectable.length > 0 && loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando wallets del evento…
        </div>
      )}

      {!loading && !error && selectable.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <Tile
              icon={<Users className="h-4 w-4" />}
              color="#FF7A4D"
              eyebrow="Wallets"
              value={totals.accounts.toString()}
              sub={`${totals.active} ${totals.active === 1 ? "activa" : "activas"}`}
            />
            <Tile
              icon={<HandCoins className="h-4 w-4" />}
              color="#E8542A"
              eyebrow="Recargado"
              value={euros(totals.topUp)}
              sub="Total cargado"
            />
            <Tile
              icon={<Receipt className="h-4 w-4" />}
              color="#4DB87A"
              eyebrow="Consumido"
              value={euros(totals.spent)}
              sub={totals.topUp > 0 ? `${Math.round((totals.spent / totals.topUp) * 100)} % de lo cargado` : ""}
            />
            <Tile
              icon={<Coins className="h-4 w-4" />}
              color="#E8B04C"
              eyebrow="Saldo sin gastar"
              value={euros(totals.balance)}
              sub="Lo que queda en las wallets"
            />
          </section>

          {wallets.length === 0 ? (
            <PasifyEmptyState
              icon={<Users className="h-7 w-7" />}
              eyebrow="Sin wallets en este evento"
              title="Aún no hay recargas"
              subtitle="Las wallets aparecen cuando un cliente hace su primera recarga para este evento."
              compact
            />
          ) : (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h3
                className="mb-4 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                Wallets · últimas {Math.min(wallets.length, 50)}
              </h3>
              <ul className="divide-y divide-border">
                {wallets.slice(0, 50).map((w) => {
                  const st = WALLET_STATUS[w.status] ?? {
                    label: w.status,
                    bg: "rgba(155,147,136,0.15)",
                    color: "#9b9388",
                  };
                  return (
                    <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {w.wristband_uid ?? "Sin pulsera vinculada"}
                          </span>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase"
                            style={{ ...mono, letterSpacing: "0.18em", background: st.bg, color: st.color }}
                          >
                            {st.label}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
                          Recargado {euros(w.total_topped_up_cents)} · Gastado {euros(w.total_spent_cents)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold text-foreground" style={mono}>
                          {euros(w.balance_cents, 2)}
                        </div>
                        <div className="text-[10px] text-muted-foreground" style={mono}>
                          {format(new Date(w.created_at), "d MMM HH:mm", { locale: es })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

const Tile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub?: string;
}) => (
  <article
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-12 -top-12 h-24 w-24 rounded-full opacity-50"
      style={{ background: `${color}33`, filter: "blur(30px)" }}
    />
    <div className="relative flex items-start justify-between">
      <div className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: color }}>
        {icon}
      </div>
    </div>
    <div className="relative mt-3">
      <div
        className="text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        {eyebrow}
      </div>
      <div className="mt-0.5 text-2xl font-bold text-foreground" style={mono}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
          {sub}
        </div>
      )}
    </div>
  </article>
);

export default PartnerCashless;
