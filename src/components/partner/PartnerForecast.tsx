import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Calendar,
  CheckCircle2,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * PartnerForecast — predicción real de venta para próximos eventos.
 *
 * Backend: edge function `ai-forecast-event` que persiste en la tabla
 * `forecast_predictions(event_id, predicted_attendance, ci_low, ci_high,
 * confidence, factors, model_version, generated_at)` (mig 0021).
 *
 * Antes este componente era mock puro (`forecastFor()` local, "142
 * eventos MAPE 11.4%" hardcoded). Ahora:
 *   1. Para cada evento próximo, hace SELECT a `forecast_predictions`
 *      pidiendo la última fila (DESC LIMIT 1).
 *   2. Si no hay predicción, botón "Generar" que invoca la edge function.
 *   3. MAPE se calcula sobre eventos pasados comparando
 *      `predicted_attendance` con `tickets_sold` real del evento.
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
  capacity: number | null;
  tickets_sold: number;
  price_cents: number;
}

interface PredictionRow {
  id: string;
  event_id: string;
  predicted_attendance: number;
  predicted_revenue_cents: number | null;
  ci_low: number | null;
  ci_high: number | null;
  confidence: number | null;
  factors: Record<string, unknown>;
  model_version: string | null;
  generated_at: string;
}

interface Props {
  events: ForecastEvent[];
}

export const PartnerForecast = ({ events }: Props) => {
  const { toast } = useToast();

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => new Date(e.date_start).getTime() > now)
      .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
      .slice(0, 6);
  }, [events]);

  const pastEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => new Date(e.date_start).getTime() <= now);
  }, [events]);

  const [predictions, setPredictions] = useState<Record<string, PredictionRow | null>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [mape, setMape] = useState<number | null>(null);
  const [historyCount, setHistoryCount] = useState(0);

  // Carga: para cada evento próximo, última predicción
  const loadPredictions = useCallback(async () => {
    if (upcoming.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
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

      // Quedarnos con la última por event_id
      const latest: Record<string, PredictionRow | null> = {};
      for (const id of ids) latest[id] = null;
      for (const row of (data ?? []) as PredictionRow[]) {
        if (latest[row.event_id] === null) latest[row.event_id] = row;
      }
      setPredictions(latest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al cargar predicciones";
      console.error("[PartnerForecast] loadPredictions:", err);
      toast({ title: "No se pudieron cargar predicciones", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [upcoming, toast]);

  // MAPE real sobre eventos pasados con predicción
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
        .select("event_id, predicted_attendance, generated_at")
        .in("event_id", pastIds)
        .order("generated_at", { ascending: false });
      const rows = (data ?? []) as Array<{ event_id: string; predicted_attendance: number }>;
      // Última predicción por evento pasado
      const seen = new Set<string>();
      const lastPred: Array<{ event_id: string; predicted: number }> = [];
      for (const r of rows) {
        if (seen.has(r.event_id)) continue;
        seen.add(r.event_id);
        lastPred.push({ event_id: r.event_id, predicted: r.predicted_attendance });
      }
      if (lastPred.length === 0) {
        setMape(null);
        setHistoryCount(0);
        return;
      }
      // Cálculo MAPE
      let total = 0;
      let count = 0;
      for (const p of lastPred) {
        const real = pastEvents.find((e) => e.id === p.event_id)?.tickets_sold ?? 0;
        if (real === 0) continue;
        total += Math.abs(p.predicted - real) / real;
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
      toast({
        title: "Predicción generada",
        description: "El forecast IA ha persistido en tu organización.",
      });
      // Re-cargar para que muestre la nueva
      await loadPredictions();
      // Si la edge function devuelve la predicción directamente, mergemos
      if (data && (data as PredictionRow).id) {
        setPredictions((prev) => ({ ...prev, [eventId]: data as PredictionRow }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error generando predicción";
      console.error("[PartnerForecast] generate:", err);
      toast({ title: "Error al generar predicción", description: msg, variant: "destructive" });
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
        Publica un evento futuro para activar el forecast con IA.
      </div>
    );
  }

  // Stats del hero: solo sobre eventos con predicción
  const predicted = Object.values(predictions).filter((p): p is PredictionRow => p !== null);
  const totalPredicted = predicted.reduce((s, p) => s + p.predicted_attendance, 0);
  const totalRevenue = predicted.reduce(
    (s, p) => s + (p.predicted_revenue_cents ?? 0),
    0
  );
  const highConf = predicted.filter((p) => (p.confidence ?? 0) >= 0.7).length;
  const avgConfPct = predicted.length > 0 ? Math.round((highConf / predicted.length) * 100) : 0;

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

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
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
            <div>
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
                    Predicción: <span style={serif} className="text-orange-500">{totalPredicted.toLocaleString("es-ES")}</span> entradas
                  </>
                ) : (
                  <>Genera tu primera <span style={serif} className="text-orange-500">predicción</span></>
                )}
              </h2>
              <div className="mt-1 text-[12px] text-muted-foreground" style={mono}>
                {predicted.length} / {upcoming.length} eventos predichos · {(totalRevenue / 100).toFixed(0)}€ proyectados · {avgConfPct}% alta confianza
              </div>
            </div>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-3">
          <ModelStat label="Histórico medido" value={`${historyCount} ${historyCount === 1 ? "evento" : "eventos"}`} />
          <ModelStat label="MAPE" value={mape === null ? "—" : `${mape.toFixed(1)}%`} />
          <ModelStat label="Modelo" value={predicted[0]?.model_version ?? "v1"} />
        </div>
      </section>

      {loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando predicciones…
        </div>
      )}

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
    <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
      {value}
    </div>
  </div>
);

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
  const capacity = event.capacity ?? 0;

  if (!prediction) {
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
            <div className="mt-1 text-xs text-muted-foreground">
              Aforo {capacity > 0 ? capacity.toLocaleString("es-ES") : "—"} · Vendidos {event.tickets_sold}
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.5)",
            }}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            {generating ? "Generando…" : "Generar predicción"}
          </button>
        </header>
      </article>
    );
  }

  const conf = prediction.confidence ?? 0;
  const confCfg =
    conf >= 0.7
      ? { color: "#4DB87A", label: "Alta", Icon: CheckCircle2 }
      : conf >= 0.4
      ? { color: "#E8B04C", label: "Media", Icon: TrendingUp }
      : { color: "#B8381A", label: "Baja", Icon: AlertTriangle };

  const occupancyPct = capacity > 0 ? (prediction.predicted_attendance / capacity) * 100 : 0;

  // Factors: forecasted como JSON ({ method, sample_size, dow_match, etc. })
  const factors = Object.entries(prediction.factors ?? {})
    .filter(([k]) => k !== "method") // method ya se muestra como version
    .map(([k, v]) => ({ key: k, value: String(v) }))
    .slice(0, 6);

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
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11px] text-foreground transition hover:border-orange-500/50"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Recalcular
          </button>
        </div>
      </header>

      <div className="relative mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat
          icon={<Users className="h-4 w-4" />}
          label="Predicción"
          value={prediction.predicted_attendance.toLocaleString("es-ES")}
          sub={
            prediction.ci_low !== null && prediction.ci_high !== null
              ? `IC ${prediction.ci_low}–${prediction.ci_high}`
              : ""
          }
        />
        <Stat
          icon={<Target className="h-4 w-4" />}
          label="Ocupación"
          value={`${occupancyPct.toFixed(0)}%`}
          sub={capacity > 0 ? `Aforo ${capacity.toLocaleString("es-ES")}` : ""}
        />
        <Stat
          icon={<TrendingUp className="h-4 w-4" />}
          label="Ingresos proyectados"
          value={`${((prediction.predicted_revenue_cents ?? 0) / 100).toFixed(0)}€`}
          sub={`Generado ${format(new Date(prediction.generated_at), "d MMM HH:mm", { locale: es })}`}
        />
      </div>

      {factors.length > 0 && (
        <div className="relative mt-5 border-t border-border pt-4">
          <div
            className="mb-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            Factores explicables
          </div>
          <div className="flex flex-wrap gap-2">
            {factors.map((f) => (
              <span
                key={f.key}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px]"
                style={mono}
              >
                <span className="text-muted-foreground">{f.key}</span>
                <span className="text-foreground">· {f.value}</span>
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
