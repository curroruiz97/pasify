import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Brain,
  Check,
  Clock,
  Loader2,
  Pause,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";

/**
 * PartnerDynamicPricing — propuestas reales desde `pricing_proposals`.
 *
 * Antes era mock puro (`buildPricingEvent()`, seed event.id). Ahora:
 *   1. SELECT a `pricing_proposals WHERE status='pending'` joineando
 *      `events` para autorización por partner_id/org_id (RLS lo hace).
 *   2. Aprobar → llama RPC `apply_pricing_proposal` (mig 0051) que
 *      UPDATE `ticket_tiers.price_cents` atómicamente.
 *   3. Rechazar → UPDATE pricing_proposals SET status='rejected'.
 *   4. "Generar propuestas ahora" → invoca edge function
 *      `ai-pricing-propose` (cron + on-demand) si el usuario es admin.
 *      Para partners sin admin: el cron de Pasify genera propuestas
 *      automáticamente cada 4h.
 *   5. Historial: últimas 30d con status accepted/applied/rejected/superseded.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface ProposalRow {
  id: string;
  event_id: string;
  tier_id: string | null;
  current_price_cents: number;
  suggested_price_cents: number;
  delta_pct: number | null;
  expected_uplift_cents: number | null;
  expected_tickets_uplift: number | null;
  confidence: number | null;
  rationale: string | null;
  status: string;
  decided_at: string | null;
  applied_at: string | null;
  expires_at: string;
  created_at: string;
}

interface TierLite {
  id: string;
  name: string;
  event_id: string;
}

interface EventLite {
  id: string;
  title: string;
  date_start: string;
}

export const PartnerDynamicPricing = () => {
  const { toast } = useToast();
  const [pending, setPending] = useState<ProposalRow[]>([]);
  const [history, setHistory] = useState<ProposalRow[]>([]);
  const [tiers, setTiers] = useState<Map<string, TierLite>>(new Map());
  const [events, setEvents] = useState<Map<string, EventLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // RLS filtra por partner_id o org member en pricing_proposals_member_read.
      // pendiente
      const { data: pen, error: penErr } = await supabase
        .from("pricing_proposals")
        .select(
          "id, event_id, tier_id, current_price_cents, suggested_price_cents, delta_pct, expected_uplift_cents, expected_tickets_uplift, confidence, rationale, status, decided_at, applied_at, expires_at, created_at"
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50);
      if (penErr) throw penErr;
      setPending((pen ?? []) as ProposalRow[]);

      // historial (últimas 30d)
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: hist } = await supabase
        .from("pricing_proposals")
        .select(
          "id, event_id, tier_id, current_price_cents, suggested_price_cents, delta_pct, expected_uplift_cents, expected_tickets_uplift, confidence, rationale, status, decided_at, applied_at, expires_at, created_at"
        )
        .in("status", ["applied", "rejected", "expired", "superseded"])
        .gte("created_at", monthAgo)
        .order("decided_at", { ascending: false })
        .limit(30);
      setHistory((hist ?? []) as ProposalRow[]);

      // Resolve tier names + event titles
      const allRows = [...((pen ?? []) as ProposalRow[]), ...((hist ?? []) as ProposalRow[])];
      const tierIds = Array.from(new Set(allRows.map((p) => p.tier_id).filter((x): x is string => !!x)));
      const eventIds = Array.from(new Set(allRows.map((p) => p.event_id)));

      if (tierIds.length > 0) {
        const { data: tierData } = await supabase
          .from("ticket_tiers")
          .select("id, name, event_id")
          .in("id", tierIds);
        const m = new Map<string, TierLite>();
        for (const t of (tierData ?? []) as TierLite[]) m.set(t.id, t);
        setTiers(m);
      }
      if (eventIds.length > 0) {
        const { data: evData } = await supabase
          .from("events")
          .select("id, title, date_start")
          .in("id", eventIds);
        const m = new Map<string, EventLite>();
        for (const e of (evData ?? []) as EventLite[]) m.set(e.id, e);
        setEvents(m);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error cargando propuestas";
      console.error("[PartnerDynamicPricing] load:", err);
      setError(msg);
      toast({ title: "No se pudieron cargar propuestas", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (proposalId: string) => {
    setDecidingId(proposalId);
    try {
      const { error: rpcErr } = await supabase.rpc("apply_pricing_proposal", {
        _proposal_id: proposalId,
      });
      if (rpcErr) throw rpcErr;
      toast({
        title: "Precio actualizado",
        description: "El nuevo precio ya está aplicado al ticket tier.",
      });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error aplicando propuesta";
      toast({ title: "No se pudo aplicar", description: msg, variant: "destructive" });
    } finally {
      setDecidingId(null);
    }
  };

  const reject = async (proposalId: string) => {
    setDecidingId(proposalId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: updErr } = await supabase
        .from("pricing_proposals")
        .update({
          status: "rejected",
          decided_at: new Date().toISOString(),
          decided_by: user?.id ?? null,
        })
        .eq("id", proposalId);
      if (updErr) throw updErr;
      toast({ title: "Propuesta rechazada" });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error rechazando propuesta";
      toast({ title: "No se pudo rechazar", description: msg, variant: "destructive" });
    } finally {
      setDecidingId(null);
    }
  };

  const generateNow = async () => {
    setGenerating(true);
    try {
      const { error: fnErr } = await supabase.functions.invoke("ai-pricing-propose", {
        body: {},
      });
      if (fnErr) throw fnErr;
      toast({
        title: "Análisis lanzado",
        description: "La IA está evaluando tus tiers. Vuelve en unos segundos.",
      });
      setTimeout(() => void load(), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error invocando IA";
      toast({
        title: "Solo admins pueden forzar análisis",
        description: msg + " · La IA corre automáticamente cada 4h.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const stats = useMemo(() => {
    const totalUplift = pending.reduce((s, p) => s + (p.expected_uplift_cents ?? 0), 0);
    return { count: pending.length, totalUplift };
  }, [pending]);

  return (
    <div className="space-y-6">
      <header
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
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
                Dynamic Pricing IA
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                {stats.count > 0 ? (
                  <>
                    {stats.count} {stats.count === 1 ? "propuesta" : "propuestas"}{" "}
                    <span style={serif} className="text-orange-500">pendientes</span>
                  </>
                ) : (
                  <>Sin propuestas <span style={serif} className="text-orange-500">pendientes</span></>
                )}
              </h2>
              {stats.totalUplift > 0 && (
                <div className="mt-1 text-[12px] text-muted-foreground" style={mono}>
                  Uplift potencial estimado: {(stats.totalUplift / 100).toFixed(0)}€
                </div>
              )}
            </div>
          </div>
          <Button
            onClick={() => void generateNow()}
            disabled={generating}
            className="text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
            }}
          >
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Generar ahora
          </Button>
        </div>
      </header>

      {error && (
        <div
          className="rounded-2xl border p-4 text-sm"
          style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
        >
          <p className="font-semibold text-foreground">Error al cargar propuestas</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando propuestas reales…
        </div>
      )}

      {!loading && pending.length === 0 && history.length === 0 && (
        <PasifyEmptyState
          icon={<Brain className="h-7 w-7" />}
          eyebrow="Aún sin análisis"
          title={<>La IA no ha generado <span style={serif} className="text-orange-500">propuestas</span> aún.</>}
          subtitle="El cron Pasify analiza tus eventos próximos cada 4h y propone subidas/bajadas de precio basadas en velocidad de venta vs baseline. Mientras tanto, puedes forzar un análisis con el botón de arriba."
        />
      )}

      {!loading && pending.length > 0 && (
        <section className="space-y-3">
          <h3
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            Pendientes de tu decisión
          </h3>
          {pending.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              tier={p.tier_id ? tiers.get(p.tier_id) : undefined}
              event={events.get(p.event_id)}
              deciding={decidingId === p.id}
              onApprove={() => void approve(p.id)}
              onReject={() => void reject(p.id)}
            />
          ))}
        </section>
      )}

      {!loading && history.length > 0 && (
        <section className="space-y-3">
          <h3
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            Histórico · últimos 30 días
          </h3>
          <div className="rounded-2xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {history.map((p) => (
                <HistoryRow
                  key={p.id}
                  proposal={p}
                  tier={p.tier_id ? tiers.get(p.tier_id) : undefined}
                  event={events.get(p.event_id)}
                />
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
};

const ProposalCard = ({
  proposal,
  tier,
  event,
  deciding,
  onApprove,
  onReject,
}: {
  proposal: ProposalRow;
  tier?: TierLite;
  event?: EventLite;
  deciding: boolean;
  onApprove: () => void;
  onReject: () => void;
}) => {
  const delta = proposal.delta_pct ?? 0;
  const up = delta >= 0;
  const expiresIn = formatDistanceToNow(new Date(proposal.expires_at), { locale: es, addSuffix: false });
  const expired = new Date(proposal.expires_at).getTime() < Date.now();

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            {tier?.name ?? "Tier"} · {event?.title ?? "Evento"}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground" style={mono}>
              {(proposal.suggested_price_cents / 100).toFixed(2)}€
            </span>
            <span className="text-sm text-muted-foreground line-through" style={mono}>
              {(proposal.current_price_cents / 100).toFixed(2)}€
            </span>
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px]"
              style={{
                ...mono,
                background: up ? "rgba(77,184,122,0.15)" : "rgba(184,56,26,0.15)",
                color: up ? "#4DB87A" : "#FF7A4D",
              }}
            >
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {up ? "+" : ""}{delta.toFixed(1)}%
            </span>
          </div>
          {proposal.rationale && (
            <p className="mt-2 text-sm text-foreground/80">{proposal.rationale}</p>
          )}
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"
            style={mono}
          >
            {proposal.expected_uplift_cents !== null && (
              <span>+{(proposal.expected_uplift_cents / 100).toFixed(0)}€ uplift est.</span>
            )}
            {proposal.expected_tickets_uplift !== null && (
              <span>· +{proposal.expected_tickets_uplift} tickets</span>
            )}
            {proposal.confidence !== null && (
              <span>· Confianza {Math.round((proposal.confidence ?? 0) * 100)}%</span>
            )}
            <span>
              · <Clock className="inline h-3 w-3" /> {expired ? "Caducada" : `Expira en ${expiresIn}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            disabled={deciding || expired}
          >
            {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            <span className="ml-1">Rechazar</span>
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            disabled={deciding || expired}
            className="text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
            }}
          >
            {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span className="ml-1">Aplicar</span>
          </Button>
        </div>
      </header>
    </article>
  );
};

const HistoryRow = ({
  proposal,
  tier,
  event,
}: {
  proposal: ProposalRow;
  tier?: TierLite;
  event?: EventLite;
}) => {
  const STATUS_CFG: Record<string, { color: string; label: string }> = {
    applied: { color: "#4DB87A", label: "Aplicada" },
    rejected: { color: "#9b9388", label: "Rechazada" },
    expired: { color: "#E8B04C", label: "Caducada" },
    superseded: { color: "#9b9388", label: "Reemplazada" },
    accepted: { color: "#4DB87A", label: "Aceptada" },
  };
  const cfg = STATUS_CFG[proposal.status] ?? { color: "#9b9388", label: proposal.status };

  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {tier?.name ?? "Tier"} · {event?.title ?? "Evento"}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[9px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: `${cfg.color}1A`,
              color: cfg.color,
              border: `1px solid ${cfg.color}40`,
            }}
          >
            {cfg.label}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
          {(proposal.current_price_cents / 100).toFixed(2)}€ →{" "}
          {(proposal.suggested_price_cents / 100).toFixed(2)}€
          {proposal.decided_at && (
            <> · {format(new Date(proposal.decided_at), "d MMM HH:mm", { locale: es })}</>
          )}
        </div>
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
    </li>
  );
};

export default PartnerDynamicPricing;
