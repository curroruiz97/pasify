import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Calendar,
  CheckCircle2,
  History,
  Loader2,
  Sparkles,
  Target,
  Ticket,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * PartnerForecast — previsión de venta de los próximos eventos.
 *
 * Backend: edge function `ai-forecast-event`, que guarda en
 * `forecast_predictions` (predicted_attendance, ci_low, ci_high, confidence,
 * factors, model_version, generated_at).
 *
 * Honestidad de los números:
 *   - La función solo predice de verdad con histórico (≥ 3 eventos pasados con
 *     ventas del mismo local y ciudad en 6 meses): `factors.method =
 *     "historical_mean_same_dow"`. Sin histórico devuelve un relleno
 *     (`default_fallback`: el 60 % del aforo, o 200 si no hay aforo). Ese
 *     relleno NO se enseña como previsión: se dice que aún no hay histórico y
 *     se enseña el ritmo real de venta.
 *   - La función no calcula ingresos (`predicted_revenue_cents` va vacío), así
 *     que no se pinta ningún "0 € proyectados".
 *   - Sin aforo no hay "% de ocupación".
 *   - El error medio (MAPE) se mide solo con previsiones basadas en histórico.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export interface ForecastEvent {
  id: string;
  title: string;
  date_start: string;
  /** Aforo del evento; null si no está definido (nunca se inventa). */
  capacity: number | null;
  tickets_sold: number;
  status?: string;
}

interface PredictionRow {
  id: string;
  event_id: string;
  predicted_attendance: number;
  predicted_revenue_cents: number | null;
  ci_low: number | null;
  ci_high: number | null;
  confidence: number | null;
  factors: Record<string, unknown> | null;
  model_version: string | null;
  generated_at: string;
}

interface Props {
  events: ForecastEvent[];
}

/** Único método de ai-forecast-event que sale de datos reales del local. */
const HISTORY_METHOD = "historical_mean_same_dow";

const isHistoryBased = (p: PredictionRow | null | undefined): boolean =>
  !!p && (p.factors as { method?: unknown } | null)?.method === HISTORY_METHOD;

const fmtInt = (n: number) => Math.round(n).toLocaleString("es-ES");

/** Ritmo real de venta: vendidas y, si hay aforo, sobre cuánto. */
const paceLabel = (event: ForecastEvent): { value: string; sub: string } => {
  const sold = event.tickets_sold ?? 0;
  if (event.capacity && event.capacity > 0) {
    const pct = Math.round((sold / event.capacity) * 100);
    return {
      value: `${fmtInt(sold)} vendidas`,
      sub: `de ${fmtInt(event.capacity)} de aforo · ${pct} %`,
    };
  }
  return { value: `${fmtInt(sold)} vendidas`, sub: "Sin aforo definido" };
};

export const PartnerForecast = ({ events }: Props) => {
  const { toast } = useToast();

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => e.status !== "cancelled" && new Date(e.date_start).getTime() > now)
      .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
      .slice(0, 6);
  }, [events]);

  const pastEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => new Date(e.date_start).getTime() <= now);
  }, [events]);

  const [predictions, setPredictions] = useState<Record<string, PredictionRow | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [mape, setMape] = useState<number | null>(null);
  const [historyCount, setHistoryCount] = useState(0);

  // Última predicción de cada evento próximo
  const loadPredictions = useCallback(async () => {
    if (upcoming.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const ids = upcoming.map((e) => e.id);
      const { data, error } = await supabase
        .from("forecast_predictions")
        .select(
          "id, event_id, predicted_attendance, predicted_revenue_cents, ci_low, ci_high, confidence, factors, model_version, generated_at"
        )
        .in("event_id", ids)
        .order("generated_at", { ascending: false });
      if (error) throw error;

      const latest: Record<string, PredictionRow | null> = {};
      for (const id of ids) latest[id] = null;
      for (const row of (data ?? []) as unknown as PredictionRow[]) {
        if (latest[row.event_id] === null) latest[row.event_id] = row;
      }
      setPredictions(latest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al cargar las previsiones";
      console.error("[PartnerForecast] loadPredictions:", err);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [upcoming]);

  // Error medio (MAPE) de las previsiones con histórico de eventos ya pasados
  const loadMape = useCallback(async () => {
    if (pastEvents.length === 0) {
      setMape(null);
      setHistoryCount(0);
      return;
    }
    try {
      const pastIds = pastEvents.map((e) => e.id);
      const { data } = await supabase
        .from("forecast_predictions")
        .select("event_id, predicted_attendance, generated_at, factors")
        .in("event_id", pastIds)
        .order("generated_at", { ascending: false });
      const rows = (data ?? []) as unknown as Array<{
        event_id: string;
        predicted_attendance: number;
        factors: Record<string, unknown> | null;
      }>;
      const seen = new Set<string>();
      let total = 0;
      let count = 0;
      for (const r of rows) {
        if (seen.has(r.event_id)) continue;
        seen.add(r.event_id);
        if ((r.factors as { method?: unknown } | null)?.method !== HISTORY_METHOD) continue;
        const real = pastEvents.find((e) => e.id === r.event_id)?.tickets_sold ?? 0;
        if (real === 0) continue;
        total += Math.abs(r.predicted_attendance - real) / real;
        count++;
      }
      setMape(count > 0 ? (total / count) * 100 : null);
      setHistoryCount(count);
    } catch (err) {
      console.warn("[PartnerForecast] mape calc failed", err);
    }
  }, [pastEvents]);

  useEffect(() => {
    void loadPredictions();
  }, [loadPredictions]);
  useEffect(() => {
    void loadMape();
  }, [loadMape]);

  const generate = async (eventId: string) => {
    setGenerating((s) => new Set(s).add(eventId));
    try {
      const { data, error } = await supabase.functions.invoke("ai-forecast-event", {
        body: { event_id: eventId },
      });
      if (error) throw error;
      const prediction = (data as { prediction?: PredictionRow } | null)?.prediction ?? null;
      if (prediction?.id) {
        setPredictions((prev) => ({ ...prev, [eventId]: prediction }));
      }
      if (prediction && !isHistoryBased(prediction)) {
        toast({
          title: "Aún no hay histórico suficiente",
          description:
            "Para prever la venta hacen falta al menos 3 eventos pasados con ventas en la misma ciudad.",
        });
      } else {
        toast({ title: "Previsión calculada" });
      }
      await loadPredictions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error calculando la previsión";
      console.error("[PartnerForecast] generate:", err);
      toast({ title: "No se pudo calcular la previsión", description: msg, variant: "destructive" });
    } finally {
      setGenerating((s) => {
        const next = new Set(s);
        next.delete(eventId);
        return next;
      });
    }
  };

  if (upcoming.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
        Cuando tengas un evento próximo podrás calcular aquí su previsión de venta.
      </div>
    );
  }

  // Cabecera: solo previsiones con histórico
  const predicted = Object.values(predictions).filter((p): p is PredictionRow => isHistoryBased(p));
  const totalPredicted = predicted.reduce((s, p) => s + p.predicted_attendance, 0);
  const highConf = predicted.filter((p) => (p.confidence ?? 0) >= 0.7).length;
  const highConfPct = predicted.length > 0 ? Math.round((highConf / predicted.length) * 100) : 0;
  const onlyFallbacks =
    predicted.length === 0 && Object.values(predictions).some((p) => p !== null);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full"
          style={{ background: "rgba(232,84,42,0.24)", filter: "blur(80px)" }}
        />

        <div className="relative flex items-start gap-3">
          <div
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px -8px rgba(232,84,42,0.6)",
            }}
          >
            <Brain className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Sparkles className="h-3 w-3" />
              Forecast · IA
            </div>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              {predicted.length > 0 ? (
                <>
                  Previsión:{" "}
                  <span style={serif} className="text-orange-500">
                    {fmtInt(totalPredicted)}
                  </span>{" "}
                  entradas
                </>
              ) : onlyFallbacks ? (
                <>
                  Aún no hay{" "}
                  <span style={serif} className="text-orange-500">
                    histórico
                  </span>{" "}
                  suficiente
                </>
              ) : (
                <>
                  Calcula tu primera{" "}
                  <span style={serif} className="text-orange-500">
                    previsión
                  </span>
                </>
              )}
            </h2>
            <div className="mt-1 text-[12px] text-muted-foreground" style={mono}>
              {predicted.length > 0
                ? `${predicted.length} de ${upcoming.length} eventos con previsión · ${highConfPct} % con confianza alta`
                : "La previsión se basa en tus eventos pasados: hacen falta al menos 3 con ventas en la misma ciudad en los últimos 6 meses."}
            </div>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-3">
          <ModelStat
            label="Histórico medido"
            value={`${historyCount} ${historyCount === 1 ? "evento" : "eventos"}`}
          />
          <ModelStat label="Error medio" value={mape === null ? "—" : `${mape.toFixed(1)} %`} />
          <ModelStat label="Modelo" value={predicted[0]?.model_version ?? "—"} />
        </div>
      </section>

      {loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando previsiones…
        </div>
      )}

      {!loading && loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
          style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              No pudimos cargar las previsiones
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Detalle: {loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadPredictions()}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-orange-500/40"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <section className="space-y-4">
          {upcoming.map((event) => (
            <ForecastCard
              key={event.id}
              event={event}
              prediction={predictions[event.id] ?? null}
              generating={generating.has(event.id)}
              onGenerate={() => void generate(event.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
};

const ModelStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-border p-2.5" style={{ background: "rgba(255,255,255,0.04)" }}>
    <div
      className="text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {label}
    </div>
    <div className="mt-0.5 truncate text-sm font-bold text-foreground" style={mono}>
      {value}
    </div>
  </div>
);

/** Factores de la previsión en lenguaje claro; lo desconocido no se enseña. */
const describeFactors = (factors: Record<string, unknown> | null): string[] => {
  if (!factors) return [];
  const { sample_size: sampleSize, mean, stddev, day_of_week: dayOfWeek } = factors;
  const out: string[] = [];
  if (typeof sampleSize === "number") {
    out.push(`${sampleSize} ${sampleSize === 1 ? "evento comparable" : "eventos comparables"}`);
  }
  if (typeof mean === "number") out.push(`media ${fmtInt(mean)} entradas`);
  if (typeof stddev === "number") out.push(`desviación ± ${fmtInt(stddev)}`);
  if (typeof dayOfWeek === "string") out.push(`día del evento: ${dayOfWeek}`);
  return out;
};

const ForecastCard = ({
  event,
  prediction,
  generating,
  onGenerate,
}: {
  event: ForecastEvent;
  prediction: PredictionRow | null;
  generating: boolean;
  onGenerate: () => void;
}) => {
  const date = new Date(event.date_start);
  const capacity = event.capacity && event.capacity > 0 ? event.capacity : null;
  const pace = paceLabel(event);

  // Sin previsión o con el relleno sin histórico: nunca se enseña como previsión.
  if (!prediction || !isHistoryBased(prediction)) {
    const noHistory = !!prediction;
    return (
      <article className="rounded-2xl border border-border bg-card p-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Calendar className="h-3 w-3" />
              {format(date, "EEEE d MMM · HH:mm", { locale: es })}h
            </div>
            <h3 className="text-lg font-semibold text-foreground">{event.title}</h3>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className={
              noHistory
                ? "inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-foreground transition hover:border-orange-500/50 disabled:opacity-60"
                : "inline-flex shrink-0 items-center gap-2 self-start rounded-full px-4 py-2 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            }
            style={
              noHistory
                ? undefined
                : {
                    background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.5)",
                  }
            }
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : noHistory ? (
              <Zap className="h-3.5 w-3.5" />
            ) : (
              <Brain className="h-3.5 w-3.5" />
            )}
            {generating ? "Calculando…" : noHistory ? "Volver a calcular" : "Calcular previsión"}
          </button>
        </header>

        {noHistory && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-background/40 p-3 text-sm text-muted-foreground">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
            <p>
              <span className="font-medium text-foreground">
                Aún no hay histórico suficiente para predecir.
              </span>{" "}
              Hacen falta al menos 3 eventos pasados con ventas en la misma ciudad.
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat icon={<Ticket className="h-4 w-4" />} label="Ritmo actual" value={pace.value} sub={pace.sub} />
        </div>
      </article>
    );
  }

  const conf = prediction.confidence ?? 0;
  const confCfg =
    conf >= 0.7
      ? { color: "#4DB87A", label: "Confianza alta", Icon: CheckCircle2 }
      : conf >= 0.4
      ? { color: "#E8B04C", label: "Confianza media", Icon: TrendingUp }
      : { color: "#B8381A", label: "Confianza baja", Icon: AlertTriangle };

  const factors = describeFactors(prediction.factors);

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full"
        style={{ background: "rgba(232,84,42,0.14)", filter: "blur(70px)" }}
      />

      <header className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Calendar className="h-3 w-3" />
            {format(date, "EEEE d MMM · HH:mm", { locale: es })}h
          </div>
          <h3 className="text-xl font-semibold text-foreground">{event.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: `${confCfg.color}1A`,
              color: confCfg.color,
              border: `1px solid ${confCfg.color}40`,
            }}
          >
            <confCfg.Icon className="h-3 w-3" />
            {confCfg.label}
          </span>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11px] text-foreground transition hover:border-orange-500/50 disabled:opacity-60"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Recalcular
          </button>
        </div>
      </header>

      <div className="relative mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat
          icon={<Users className="h-4 w-4" />}
          label="Previsión"
          value={`${fmtInt(prediction.predicted_attendance)} entradas`}
          sub={
            prediction.ci_low !== null && prediction.ci_high !== null
              ? `Entre ${fmtInt(prediction.ci_low)} y ${fmtInt(prediction.ci_high)}`
              : ""
          }
        />
        {capacity !== null ? (
          <Stat
            icon={<Target className="h-4 w-4" />}
            label="Ocupación prevista"
            value={`${Math.round((prediction.predicted_attendance / capacity) * 100)} %`}
            sub={`Aforo ${fmtInt(capacity)}`}
          />
        ) : (
          <Stat icon={<Target className="h-4 w-4" />} label="Ocupación prevista" value="—" sub="Sin aforo definido" />
        )}
        <Stat
          icon={<Ticket className="h-4 w-4" />}
          label="Ritmo actual"
          value={pace.value}
          sub={`${pace.sub} · calculada ${format(new Date(prediction.generated_at), "d MMM HH:mm", { locale: es })}`}
        />
      </div>

      {factors.length > 0 && (
        <div className="relative mt-5 border-t border-border pt-4">
          <div
            className="mb-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            En qué se basa
          </div>
          <div className="flex flex-wrap gap-2">
            {factors.map((f) => (
              <span
                key={f}
                className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground"
                style={mono}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
};

const Stat = ({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) => (
  <div className="rounded-xl border border-border bg-background/40 p-3">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="text-orange-500">{icon}</span>
      <span className="uppercase" style={{ ...mono, letterSpacing: "0.18em" }}>
        {label}
      </span>
    </div>
    <div className="mt-1 text-xl font-bold text-foreground" style={mono}>
      {value}
    </div>
    {sub && (
      <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
        {sub}
      </div>
    )}
  </div>
);

export default PartnerForecast;
