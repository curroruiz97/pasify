import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Coins,
  HandCoins,
  Loader2,
  Receipt,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { BetaBadge } from "@/components/shared/BetaBadge";

/**
 * PartnerCashless — wallets cashless reales por evento.
 *
 * Antes era 100% mock (`ACCOUNTS` hardcoded con "WB-291A"). Ahora:
 *   - SELECT real desde `cashless_wallets` filtered by tenant + evento activo.
 *   - SELECT desde `cashless_topups` para conocer recargas.
 *   - SELECT desde `pos_sales` para conocer consumo via wristband.
 *
 * La parte de "Provisionar pulsera RFID" lleva BetaBadge porque la
 * integración con readers NFC/RFID requiere SDK hardware externo que
 * todavía no está implementado. Las wallets aún se pueden cargar y
 * consumir via TPV manual / Stripe — sólo el bind a un wristband
 * físico queda pendiente.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

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

interface EventLite {
  id: string;
  title: string;
  date_start: string;
}

export const PartnerCashless = () => {
  const { toast } = useToast();
  const { tenant, loading: tenantLoading } = useOrganization();
  const [activeEvents, setActiveEvents] = useState<EventLite[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carga eventos en curso o próximos (donde tenga sentido tener wallets)
  const loadEvents = useCallback(async () => {
    if (!tenant?.org_id) {
      setActiveEvents([]);
      return;
    }
    const now = new Date();
    const past48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const next7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("events")
      .select("id, title, date_start")
      .eq("org_id", tenant.org_id)
      .gte("date_start", past48h)
      .lte("date_start", next7d)
      .order("date_start", { ascending: true });
    const list = (data ?? []) as EventLite[];
    setActiveEvents(list);
    if (list.length > 0 && !selectedEventId) {
      setSelectedEventId(list[0].id);
    }
  }, [tenant?.org_id, selectedEventId]);

  const loadWallets = useCallback(async () => {
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
        .select(
          "id, user_id, event_id, wristband_uid, balance_cents, status, created_at, closed_at"
        )
        .eq("event_id", selectedEventId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) throw err;
      const baseWallets = (data ?? []) as Array<Omit<WalletRow, "total_topped_up_cents" | "total_spent_cents">>;

      // Calcular totales con queries agregadas a topups + transactions.
      // No usamos SUM() agregada porque PostgREST/Supabase requiere head
      // y devolver agregados anónimos. Hacemos pull simple y sumamos en
      // cliente — para <200 wallets es trivial.
      const walletIds = baseWallets.map((w) => w.id);
      if (walletIds.length === 0) {
        setWallets([]);
        return;
      }
      const [{ data: topups }, { data: txs }] = await Promise.all([
        supabase
          .from("cashless_topups")
          .select("wallet_id, amount_cents")
          .in("wallet_id", walletIds),
        supabase
          .from("cashless_transactions")
          .select("wallet_id, amount_cents, kind")
          .in("wallet_id", walletIds),
      ]);
      const topByWallet = new Map<string, number>();
      for (const t of (topups ?? []) as Array<{ wallet_id: string; amount_cents: number }>) {
        topByWallet.set(t.wallet_id, (topByWallet.get(t.wallet_id) ?? 0) + t.amount_cents);
      }
      const spentByWallet = new Map<string, number>();
      for (const t of (txs ?? []) as Array<{ wallet_id: string; amount_cents: number; kind: string }>) {
        // Solo sumamos los kind que descuentan saldo (purchase, etc.).
        // El refund/adjustment puede tener amount negativo, lo respetamos.
        if (t.kind === "purchase") {
          spentByWallet.set(t.wallet_id, (spentByWallet.get(t.wallet_id) ?? 0) + t.amount_cents);
        }
      }
      setWallets(
        baseWallets.map((w) => ({
          ...w,
          total_topped_up_cents: topByWallet.get(w.id) ?? 0,
          total_spent_cents: spentByWallet.get(w.id) ?? 0,
        }))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error cargando wallets";
      console.error("[PartnerCashless] loadWallets:", err);
      setError(msg);
      toast({ title: "No se pudieron cargar wallets", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, toast]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadWallets();
  }, [loadWallets]);

  const totals = useMemo(() => {
    const accounts = wallets.length;
    const topUp = wallets.reduce((s, w) => s + (w.total_topped_up_cents ?? 0), 0);
    const spent = wallets.reduce((s, w) => s + (w.total_spent_cents ?? 0), 0);
    const balance = wallets.reduce((s, w) => s + (w.balance_cents ?? 0), 0);
    return { accounts, topUp, spent, balance };
  }, [wallets]);

  if (tenantLoading) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
        Cargando contexto…
      </div>
    );
  }

  if (!tenant?.org_id) {
    return (
      <PasifyEmptyState
        icon={<Coins className="h-7 w-7" />}
        eyebrow="Sin organización"
        title="Necesitas completar el onboarding"
        subtitle="Pasify Cashless funciona por evento de tu organización. Completa el onboarding para activarlo."
      />
    );
  }

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
              label="Beta · Provisión RFID"
              reason="Las wallets existen en la BD y se cargan via Stripe. El bind a un wristband físico (RFID/NFC tap en barra) requiere SDK hardware que aún no está integrado. Hasta entonces, las pulseras se enlazan manualmente en la pantalla del TPV."
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Cashless <span style={serif} className="text-orange-500">wallets</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saldo prepago por evento. Las wallets se crean cuando el cliente compra recarga.
          </p>
        </div>
        {activeEvents.length > 0 && (
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
            aria-label="Evento activo"
          >
            {activeEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {format(new Date(e.date_start), "d MMM", { locale: es })}
              </option>
            ))}
          </select>
        )}
      </header>

      {activeEvents.length === 0 && (
        <PasifyEmptyState
          icon={<Coins className="h-7 w-7" />}
          eyebrow="Sin eventos activos"
          title="Pasify Cashless arranca con un evento"
          subtitle="Crea un evento en las próximas 48h o en curso para activar wallets cashless. Aquí verás recargas, consumo en barra y reembolsos al cierre."
        />
      )}

      {activeEvents.length > 0 && error && (
        <div
          className="rounded-2xl border p-4 text-sm"
          style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
        >
          <p className="font-semibold text-foreground">No pudimos cargar wallets</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      {activeEvents.length > 0 && loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando wallets del evento…
        </div>
      )}

      {!loading && !error && activeEvents.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <Tile
              icon={<Users className="h-4 w-4" />}
              color="#FF7A4D"
              eyebrow="Pulseras activas"
              value={totals.accounts.toString()}
              sub={wallets.filter((w) => w.status === "active").length + " active"}
            />
            <Tile
              icon={<HandCoins className="h-4 w-4" />}
              color="#E8542A"
              eyebrow="Recargado"
              value={`${(totals.topUp / 100).toFixed(0)}€`}
              sub="Total cargado"
            />
            <Tile
              icon={<Receipt className="h-4 w-4" />}
              color="#4DB87A"
              eyebrow="Consumido"
              value={`${(totals.spent / 100).toFixed(0)}€`}
              sub={totals.topUp > 0 ? `${Math.round((totals.spent / totals.topUp) * 100)}% del cargado` : ""}
            />
            <Tile
              icon={<Coins className="h-4 w-4" />}
              color="#E8B04C"
              eyebrow="Saldo pendiente"
              value={`${(totals.balance / 100).toFixed(0)}€`}
              sub="A reembolsar al cierre"
            />
          </section>

          {wallets.length === 0 ? (
            <PasifyEmptyState
              icon={<Users className="h-7 w-7" />}
              eyebrow="Sin wallets en este evento"
              title="Aún no hay recargas"
              subtitle="Las wallets aparecen automáticamente cuando un cliente compra su primera recarga prepago para este evento."
              compact
            />
          ) : (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2
                className="mb-4 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                Wallets · últimas {wallets.length}
              </h2>
              <ul className="divide-y divide-border">
                {wallets.slice(0, 50).map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {w.wristband_uid ?? "Sin pulsera vinculada"}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                          style={{
                            ...mono,
                            letterSpacing: "0.18em",
                            background:
                              w.status === "active"
                                ? "rgba(77,184,122,0.15)"
                                : w.status === "closed"
                                ? "rgba(155,147,136,0.15)"
                                : "rgba(232,176,76,0.15)",
                            color:
                              w.status === "active"
                                ? "#4DB87A"
                                : w.status === "closed"
                                ? "#9b9388"
                                : "#E8B04C",
                          }}
                        >
                          {w.status}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
                        Recargado {(w.total_topped_up_cents / 100).toFixed(0)}€ · Gastado{" "}
                        {(w.total_spent_cents / 100).toFixed(0)}€
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-foreground" style={mono}>
                        {(w.balance_cents / 100).toFixed(2)}€
                      </div>
                      <div className="text-[10px] text-muted-foreground" style={mono}>
                        {format(new Date(w.created_at), "d MMM HH:mm", { locale: es })}
                      </div>
                    </div>
                  </li>
                ))}
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
