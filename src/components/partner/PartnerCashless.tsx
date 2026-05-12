import { useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Coins,
  CreditCard,
  GlassWater,
  HandCoins,
  Plus,
  Radio,
  Receipt,
  RefreshCcw,
  TrendingUp,
  Users,
  Wifi,
  Wine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subHours } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface CashlessAccount {
  id: string;
  wristband: string;
  user: string;
  topUpCents: number;
  spentCents: number;
  balanceCents: number;
  lastActivity: Date;
  status: "active" | "topped_up" | "refunded";
}

const ACCOUNTS: CashlessAccount[] = [
  { id: "wb-1", wristband: "WB-291A", user: "Carla Sánchez", topUpCents: 5000, spentCents: 4200, balanceCents: 800, lastActivity: subHours(new Date(), 0.3), status: "active" },
  { id: "wb-2", wristband: "WB-2B12", user: "Diego Reyes", topUpCents: 8000, spentCents: 6850, balanceCents: 1150, lastActivity: subHours(new Date(), 0.1), status: "active" },
  { id: "wb-3", wristband: "WB-3D08", user: "Lucía García", topUpCents: 10000, spentCents: 9700, balanceCents: 300, lastActivity: subHours(new Date(), 0.05), status: "active" },
  { id: "wb-4", wristband: "WB-491F", user: "Pablo López", topUpCents: 3000, spentCents: 2900, balanceCents: 100, lastActivity: subHours(new Date(), 0.5), status: "topped_up" },
  { id: "wb-5", wristband: "WB-5A77", user: "Alba Martínez", topUpCents: 6000, spentCents: 5750, balanceCents: 250, lastActivity: subHours(new Date(), 0.4), status: "active" },
];

export const PartnerCashless = () => {
  const totals = useMemo(() => {
    const topUp = ACCOUNTS.reduce((s, a) => s + a.topUpCents, 0);
    const spent = ACCOUNTS.reduce((s, a) => s + a.spentCents, 0);
    const balance = ACCOUNTS.reduce((s, a) => s + a.balanceCents, 0);
    return { topUp, spent, balance, accounts: ACCOUNTS.length };
  }, []);

  // Hourly bars mock
  const hourly = Array.from({ length: 8 }).map((_, i) => ({
    hour: 22 + i,
    sales: 240 + Math.sin(i * 0.7) * 120 + i * 20,
  }));
  const maxHourly = Math.max(...hourly.map((h) => h.sales));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-1 text-3xl font-bold tracking-tight">
          Cashless <span style={serif} className="text-orange-500">wallets</span>
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Saldo prepago en pulsera RFID — los clientes pagan en barra con un tap, tú ves todo en directo.
        </p>
      </header>

      {/* KPI Tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile icon={<Users className="h-4 w-4" />} color="#FF7A4D" eyebrow="Pulseras activas" value={totals.accounts.toString()} sub="En el evento ahora" pulse />
        <KpiTile icon={<HandCoins className="h-4 w-4" />} color="#E8542A" eyebrow="Recargado" value={`${(totals.topUp / 100).toFixed(0)}€`} sub="Total cargado" />
        <KpiTile icon={<Receipt className="h-4 w-4" />} color="#4DB87A" eyebrow="Consumido" value={`${(totals.spent / 100).toFixed(0)}€`} sub={`${Math.round((totals.spent / totals.topUp) * 100)}% del cargado`} />
        <KpiTile icon={<Coins className="h-4 w-4" />} color="#E8B04C" eyebrow="Saldo pendiente" value={`${(totals.balance / 100).toFixed(0)}€`} sub="A reembolsar al cierre" />
      </section>

      {/* Sales chart per hour */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <TrendingUp className="h-3 w-3" />
              Ventas barra por hora
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              Esta noche
            </h3>
          </div>
          <Button variant="outline" size="sm">
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            Refrescar
          </Button>
        </div>

        <div className="flex h-36 items-end gap-2 md:h-44">
          {hourly.map((h, i) => {
            const isCurrent = h.hour === 22 + hourly.length - 1;
            const heightPct = (h.sales / maxHourly) * 100;
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${Math.max(2, heightPct)}%`,
                    background: isCurrent
                      ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 100%)"
                      : `rgba(232,84,42,${0.35 + (i / hourly.length) * 0.45})`,
                    boxShadow: isCurrent ? "0 0 12px rgba(232,84,42,0.7)" : "none",
                  }}
                />
                <div
                  className="text-[9px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.16em" }}
                >
                  {h.hour}h
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Accounts table */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <Radio className="h-3 w-3" />
              Pulseras
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Estado por usuario
            </h3>
          </div>
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Recargar
          </Button>
        </div>

        <ul className="space-y-2">
          {ACCOUNTS.map((a) => {
            const ratio = a.topUpCents > 0 ? a.spentCents / a.topUpCents : 0;
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-2xl border border-border p-3 md:p-4"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                  style={{
                    background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  }}
                >
                  <Wifi className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{a.user}</span>
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                      style={{
                        ...mono,
                        letterSpacing: "0.16em",
                        background: "rgba(255,255,255,0.04)",
                        color: "#C9BFA8",
                      }}
                    >
                      {a.wristband}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${ratio * 100}%`,
                        background: "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)",
                      }}
                    />
                  </div>
                  <div
                    className="mt-1 text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.14em" }}
                  >
                    Cargó {(a.topUpCents / 100).toFixed(0)}€ · Gastó {(a.spentCents / 100).toFixed(0)}€ · Último{" "}
                    {format(a.lastActivity, "HH:mm", { locale: es })}h
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-[9px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    Saldo
                  </div>
                  <div className="mt-0.5 text-base font-bold text-foreground" style={mono}>
                    {(a.balanceCents / 100).toFixed(2)}€
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
  pulse,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub: string;
  pulse?: boolean;
}) => (
  <div
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 md:p-5"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)" }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full"
      style={{ background: `${color}26`, filter: "blur(28px)" }}
    />
    <div className="relative flex items-center justify-between">
      <div
        className="inline-flex items-center gap-1.5 text-[10px] uppercase"
        style={{ ...mono, letterSpacing: "0.18em", color }}
      >
        {icon}
        {eyebrow}
      </div>
      {pulse && (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
            style={{ background: color }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
          />
        </span>
      )}
    </div>
    <div
      className="relative mt-3 text-2xl font-bold tracking-tight text-foreground md:text-3xl"
      style={mono}
    >
      {value}
    </div>
    <div
      className="relative mt-1 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.14em" }}
    >
      {sub}
    </div>
  </div>
);

export default PartnerCashless;
