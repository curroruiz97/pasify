import { useMemo, useState } from "react";
import {
  Banknote,
  CreditCard,
  Download,
  HandCoins,
  Lock,
  Receipt,
  UserCheck,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface Shift {
  id: string;
  user: string;
  terminal: string;
  startedAt: Date;
  closedAt: Date | null;
  cashCents: number;
  cardCents: number;
  tipCents: number;
  refundCents: number;
  expectedCashCents: number;
}

const mockShifts: Shift[] = [
  {
    id: "s-01",
    user: "Carla Sánchez",
    terminal: "TPV · Barra 1",
    startedAt: new Date(new Date().setHours(20, 0, 0, 0)),
    closedAt: null,
    cashCents: 287_50_0,
    cardCents: 1_842_30_0,
    tipCents: 38_50_0,
    refundCents: 12_00_0,
    expectedCashCents: 287_50_0,
  },
  {
    id: "s-02",
    user: "Diego Reyes",
    terminal: "TPV · Barra 2",
    startedAt: new Date(new Date().setHours(19, 30, 0, 0)),
    closedAt: null,
    cashCents: 132_80_0,
    cardCents: 968_40_0,
    tipCents: 21_00_0,
    refundCents: 0,
    expectedCashCents: 132_80_0,
  },
  {
    id: "s-03",
    user: "Lucía García",
    terminal: "Taquilla · Puerta principal",
    startedAt: new Date(new Date().setHours(18, 0, 0, 0)),
    closedAt: new Date(new Date().setHours(22, 30, 0, 0)),
    cashCents: 84_00_0,
    cardCents: 1_412_60_0,
    tipCents: 0,
    refundCents: 0,
    expectedCashCents: 84_00_0,
  },
];

/**
 * Cierre Z del TPV — pantalla diaria de cuadre de caja.
 * Modo demo (mockShifts) hasta conectar con Supabase / Stripe Terminal.
 */
export const TpvCierreZ = () => {
  const today = new Date();
  const [shifts, setShifts] = useState<Shift[]>(mockShifts);
  const [countingId, setCountingId] = useState<string | null>(null);
  const [countedCash, setCountedCash] = useState<string>("");

  const totals = useMemo(() => {
    const t = { cash: 0, card: 0, tip: 0, refund: 0 };
    shifts.forEach((s) => {
      t.cash += s.cashCents;
      t.card += s.cardCents;
      t.tip += s.tipCents;
      t.refund += s.refundCents;
    });
    return t;
  }, [shifts]);

  const gross = totals.cash + totals.card - totals.refund;

  const closeShift = (id: string) => {
    setShifts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, closedAt: new Date() } : s))
    );
    setCountingId(null);
    setCountedCash("");
  };

  return (
    <div>
      {/* Hero */}
      <header
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-7"
        style={{
          boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 20px -10px rgba(0,0,0,0.5)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(90px)" }}
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="inline-block h-px w-5 bg-orange-500/70" />
              TPV · Cierre Z
            </div>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              Caja de <span style={serif} className="text-orange-500">hoy</span>
            </h2>
            <div
              className="mt-2 text-sm text-muted-foreground"
              style={mono}
            >
              {format(today, "EEEE d 'de' MMMM yyyy", { locale: es })}
            </div>
          </div>

          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </header>

      {/* Resumen del día */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <SummaryTile
          icon={<HandCoins className="h-4 w-4" />}
          color="#FF7A4D"
          eyebrow="Efectivo"
          value={`${(totals.cash / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
        />
        <SummaryTile
          icon={<CreditCard className="h-4 w-4" />}
          color="#E8542A"
          eyebrow="Tarjeta"
          value={`${(totals.card / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
        />
        <SummaryTile
          icon={<Banknote className="h-4 w-4" />}
          color="#E8B04C"
          eyebrow="Propinas"
          value={`${(totals.tip / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
        />
        <SummaryTile
          icon={<Receipt className="h-4 w-4" />}
          color="#4DB87A"
          eyebrow="Bruto"
          value={`${(gross / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
          highlight
        />
      </div>

      {/* Lista de turnos */}
      <section
        className="mt-8 rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <span className="inline-block h-px w-5 bg-orange-500/70" />
              Turnos del día
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {shifts.filter((s) => !s.closedAt).length} abiertos · {shifts.filter((s) => s.closedAt).length} cerrados
            </h3>
          </div>
        </div>

        <div className="space-y-3">
          {shifts.map((s) => {
            const isClosed = !!s.closedAt;
            const isCounting = countingId === s.id;
            const counted = parseFloat(countedCash.replace(",", ".")) || 0;
            const expected = s.expectedCashCents / 100;
            const diff = isCounting ? counted - expected : 0;
            return (
              <article
                key={s.id}
                className="rounded-2xl border border-border p-4 md:p-5"
                style={{
                  background: isClosed ? "rgba(255,255,255,0.02)" : "rgba(232,84,42,0.04)",
                  borderColor: isClosed ? undefined : "rgba(232,84,42,0.3)",
                }}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] uppercase"
                        style={{ ...mono, letterSpacing: "0.18em", color: isClosed ? "#8A8275" : "#4DB87A" }}
                      >
                        {!isClosed && (
                          <span className="relative inline-flex h-1.5 w-1.5">
                            <span
                              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                              style={{ background: "#4DB87A" }}
                            />
                            <span
                              className="relative inline-flex h-1.5 w-1.5 rounded-full"
                              style={{ background: "#4DB87A" }}
                            />
                          </span>
                        )}
                        {isClosed ? "Cerrado" : "Abierto"}
                      </span>
                      <span className="text-[10px] text-muted-foreground" style={mono}>
                        {format(s.startedAt, "HH:mm", { locale: es })}h
                        {s.closedAt && ` → ${format(s.closedAt, "HH:mm", { locale: es })}h`}
                      </span>
                    </div>
                    <div className="mt-1 text-base font-semibold text-foreground">
                      {s.terminal}
                    </div>
                    <div
                      className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
                      style={mono}
                    >
                      <UserCheck className="h-3 w-3" />
                      {s.user}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-right md:gap-x-6">
                    <MoneyCell label="Efectivo" value={s.cashCents / 100} />
                    <MoneyCell label="Tarjeta" value={s.cardCents / 100} />
                    <MoneyCell label="Propinas" value={s.tipCents / 100} />
                  </div>
                </div>

                {!isClosed && (
                  <div className="mt-4 border-t border-border pt-4">
                    {!isCounting ? (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setCountingId(s.id);
                          setCountedCash("");
                        }}
                      >
                        <Lock className="mr-1.5 h-3.5 w-3.5" />
                        Cuadrar y cerrar caja
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <Label className="text-xs">Efectivo contado (€)</Label>
                          <Input
                            className="mt-1.5 h-10 rounded-xl"
                            type="number"
                            step="0.01"
                            placeholder={expected.toFixed(2)}
                            value={countedCash}
                            onChange={(e) => setCountedCash(e.target.value)}
                          />
                          <div
                            className="mt-1 text-[10px] uppercase text-muted-foreground"
                            style={{ ...mono, letterSpacing: "0.16em" }}
                          >
                            Esperado · {expected.toFixed(2)}€
                            {countedCash && (
                              <>
                                {" · "}
                                <span style={{ color: Math.abs(diff) < 0.5 ? "#4DB87A" : "#E8B04C" }}>
                                  {diff >= 0 ? "+" : ""}
                                  {diff.toFixed(2)}€ diferencia
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCountingId(null);
                              setCountedCash("");
                            }}
                          >
                            Cancelar
                          </Button>
                          <Button size="sm" onClick={() => closeShift(s.id)}>
                            <Lock className="mr-1.5 h-3.5 w-3.5" />
                            Cerrar caja
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

const MoneyCell = ({ label, value }: { label: string; value: number }) => (
  <div>
    <div
      className="text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.14em" }}
    >
      {label}
    </div>
    <div className="mt-0.5 text-sm font-bold text-foreground md:text-base" style={mono}>
      {value.toLocaleString("es-ES", { maximumFractionDigits: 2 })}€
    </div>
  </div>
);

const SummaryTile = ({
  icon,
  color,
  eyebrow,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  highlight?: boolean;
}) => (
  <div
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 md:p-5"
    style={{
      boxShadow: highlight
        ? "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 20px -8px rgba(232,84,42,0.4)"
        : "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)",
      borderColor: highlight ? "rgba(232,84,42,0.4)" : undefined,
    }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full"
      style={{ background: `${color}26`, filter: "blur(28px)" }}
    />
    <div
      className="relative inline-flex items-center gap-1.5 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color }}
    >
      {icon}
      {eyebrow}
    </div>
    <div
      className="relative mt-3 text-2xl font-bold tracking-tight text-foreground md:text-3xl"
      style={mono}
    >
      {value}
    </div>
  </div>
);

export default TpvCierreZ;
