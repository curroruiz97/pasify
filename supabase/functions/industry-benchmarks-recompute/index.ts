// Pasify · industry-benchmarks-recompute (cron diario + «ejecutar ahora» de un admin)
//
// Agrega, de forma ANÓNIMA, lo que pasa en toda la plataforma y lo guarda en
// industry_benchmarks_snapshots: un fila por segmento (categoría del local, o
// «all») y región (madrid, barcelona, valencia, ibiza, andalucia o
// «españa-nacional») y día. Solo con datos reales: si no hay muestra suficiente
// no se escribe nada (nunca se rellena con cifras inventadas).
//
// Qué se lee: eventos publicados o pasados con fecha de los últimos 365 días,
// de locales en España (venues.country = 'ES'), con sus tipos de entrada. El
// segmento es venues.business_category; la región sale de la ciudad del evento.
//
// Qué se calcula por grupo:
//   price_cents       p25 / mediana / p75 del precio de los tipos de entrada de
//                     pago (price_cents > 0, sin los ocultos)
//   capacity_median   mediana del aforo de los eventos
//   sell_through_pct  entradas vendidas / aforo de los eventos ya celebrados
//                     (media y mediana)
//
// Privacidad (lo que impide reconocer a un local en una cifra):
//   - k-anonimato: un grupo solo se publica si hay al menos 15 organizaciones
//     distintas (k_anonymity_min). sample_size es ese número: la política RLS
//     de la tabla solo deja leer filas con sample_size >= k_anonymity_min.
//   - Cada métrica exige lo mismo por separado: 15 organizaciones que
//     aporten valores de esa métrica (con 15 organizaciones y solo 2 eventos
//     celebrados, el aforo medio sería de esas 2).
//   - Regla de dominancia: si una sola organización pone más de la mitad de los
//     valores de una métrica, esa métrica se omite (la mediana sería la suya).
//   - Se publican medianas y percentiles, redondeados (precios a 0,10 €, aforo a
//     5, porcentajes a 0,1). Sin ruido aleatorio: con una pasada diaria se
//     promediaría y las cifras serían peores sin proteger más.
//
// Idempotente: computed_at es el inicio del día (UTC), así que repetir la
// ejecución el mismo día reescribe las mismas filas.
//
// Autorización: servicio (cron) o admin de plataforma. Kill switch de
// «benchmarks» (fail-closed). POST con cuerpo opcional { "dry_run": true }:
// calcula y devuelve qué grupos se publicarían, sin escribir.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { HttpError, isServiceRoleRequest, safeErrorResponse } from "../_shared/internal-auth.ts";

const CAPABILITY = "benchmarks";
const MODEL_VERSION = "pasify-benchmarks-v1";

export const K_ANONYMITY_MIN = 15;
/** Si una organización aporta más de esta fracción de los valores de una métrica, no se publica. */
export const MAX_TENANT_SHARE = 0.5;
export const WINDOW_DAYS = 365;
const PAGE_SIZE = 500;
/** 100 páginas = 50.000 eventos. Más que eso pide pasar la agregación a SQL: se aborta, no se publica a medias. */
const MAX_PAGES = 100;

export const NATIONAL = "españa-nacional";
export const ALL_SEGMENTS = "all";

/** Ciudades de cada región (sin tildes ni mayúsculas, ver normalizeCity). */
export const REGION_CITIES: Record<string, string[]> = {
  "madrid": ["madrid", "alcala de henares", "mostoles"],
  "barcelona": ["barcelona", "sitges", "castelldefels", "lloret de mar"],
  "valencia": ["valencia", "benidorm", "gandia"],
  "ibiza": ["ibiza", "eivissa", "formentera", "sant antoni de portmany", "santa eularia des riu"],
  "andalucia": ["sevilla", "malaga", "granada", "marbella", "cadiz"],
};

/** Minúsculas, sin tildes ni signos: «Alcalá de Henares » → «alcala de henares». */
export function normalizeCity(city: string | null | undefined): string {
  return (city ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Región a la que pertenece una ciudad (igual a una de la lista, o «ciudad barrio»), o null. */
export function regionOf(city: string | null | undefined): string | null {
  const c = normalizeCity(city);
  if (!c) return null;
  for (const [region, cities] of Object.entries(REGION_CITIES)) {
    if (cities.some((name) => c === name || c.startsWith(`${name} `))) return region;
  }
  return null;
}

/** Cuantil q (0-1) de una lista ordenada con interpolación lineal (como percentile_cont). */
export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Un evento ya normalizado, listo para agregar. */
export interface BenchEvent {
  /** Organización (org_id, o el local que lo creó). */
  tenant: string;
  /** Categoría del local, en minúsculas («discoteca», «club»…). */
  segment: string;
  /** madrid, barcelona… o null si la ciudad no cae en ninguna región. */
  region: string | null;
  capacity: number | null;
  ticketsSold: number;
  startsAtMs: number;
  /** Precios en céntimos de sus tipos de entrada de pago. */
  prices: number[];
}

type Series = Array<[tenant: string, value: number]>;

interface Acc {
  tenants: Set<string>;
  events: number;
  /** [organización, precio] por tipo de entrada. */
  prices: Series;
  capacities: Series;
  sellThrough: Series;
}

export interface SnapshotGroup {
  segment: string;
  region: string;
  sampleSize: number;
  payload: Record<string, unknown>;
}

export interface ComputeResult {
  groups: SnapshotGroup[];
  skippedBelowK: number;
  skippedNoMetric: number;
  /** Métricas omitidas dentro de grupos publicados (por k o por dominancia). */
  metricsOmitted: number;
}

/** ¿Se puede publicar una métrica? Al menos k organizaciones y ninguna con más de la mitad de los valores. */
export function publishable(series: Series): boolean {
  if (series.length === 0) return false;
  const perTenant = new Map<string, number>();
  for (const [tenant] of series) perTenant.set(tenant, (perTenant.get(tenant) ?? 0) + 1);
  if (perTenant.size < K_ANONYMITY_MIN) return false;
  const top = Math.max(...perTenant.values());
  return top / series.length <= MAX_TENANT_SHARE;
}

const sortedValues = (series: Series) => series.map(([, v]) => v).sort((a, b) => a - b);

/** Agrupa por (segmento, región) y deja solo lo que se puede publicar. Pura: no toca la BD. */
export function computeGroups(events: BenchEvent[], nowMs: number): ComputeResult {
  const accs = new Map<string, Acc>();
  const acc = (segment: string, region: string): Acc => {
    const key = `${segment}\u0000${region}`;
    let a = accs.get(key);
    if (!a) {
      a = { tenants: new Set(), events: 0, prices: [], capacities: [], sellThrough: [] };
      accs.set(key, a);
    }
    return a;
  };

  for (const e of events) {
    const segments = [e.segment === ALL_SEGMENTS ? "otro" : e.segment, ALL_SEGMENTS];
    const regions = e.region ? [e.region, NATIONAL] : [NATIONAL];
    const sellThrough = e.capacity != null && e.capacity > 0 && e.startsAtMs < nowMs
      ? Math.min(100, Math.max(0, (e.ticketsSold / e.capacity) * 100))
      : null;
    for (const segment of segments) {
      for (const region of regions) {
        const a = acc(segment, region);
        a.tenants.add(e.tenant);
        a.events++;
        for (const p of e.prices) a.prices.push([e.tenant, p]);
        if (e.capacity != null && e.capacity > 0) a.capacities.push([e.tenant, e.capacity]);
        if (sellThrough != null) a.sellThrough.push([e.tenant, sellThrough]);
      }
    }
  }

  const result: ComputeResult = { groups: [], skippedBelowK: 0, skippedNoMetric: 0, metricsOmitted: 0 };
  for (const [key, a] of accs) {
    if (a.tenants.size < K_ANONYMITY_MIN) {
      result.skippedBelowK++;
      continue;
    }
    const [segment, region] = key.split("\u0000");

    let priceCents: { p25: number; median: number; p75: number } | null = null;
    if (publishable(a.prices)) {
      const v = sortedValues(a.prices);
      priceCents = {
        p25: roundTo(quantile(v, 0.25), 10),
        median: roundTo(quantile(v, 0.5), 10),
        p75: roundTo(quantile(v, 0.75), 10),
      };
    } else if (a.prices.length > 0) {
      result.metricsOmitted++;
    }

    let capacityMedian: number | null = null;
    if (publishable(a.capacities)) capacityMedian = roundTo(quantile(sortedValues(a.capacities), 0.5), 5);
    else if (a.capacities.length > 0) result.metricsOmitted++;

    let sellThroughPct: { avg: number; median: number; events: number } | null = null;
    if (publishable(a.sellThrough)) {
      const v = sortedValues(a.sellThrough);
      sellThroughPct = {
        avg: round1(v.reduce((s, x) => s + x, 0) / v.length),
        median: round1(quantile(v, 0.5)),
        events: v.length,
      };
    } else if (a.sellThrough.length > 0) {
      result.metricsOmitted++;
    }

    if (!priceCents && capacityMedian == null && !sellThroughPct) {
      result.skippedNoMetric++;
      continue;
    }
    result.groups.push({
      segment,
      region,
      sampleSize: a.tenants.size,
      payload: {
        version: 1,
        window_days: WINDOW_DAYS,
        tenants: a.tenants.size,
        events_total: a.events,
        price_cents: priceCents,
        capacity_median: capacityMedian,
        sell_through_pct: sellThroughPct,
      },
    });
  }
  result.groups.sort((x, y) => (x.segment + x.region < y.segment + y.region ? -1 : 1));
  return result;
}

// ---------------------------------------------------------------- lectura de la BD

interface EventRow {
  org_id: string | null;
  partner_id: string | null;
  city: string | null;
  capacity: number | null;
  tickets_sold: number | null;
  date_start: string;
  venues: { business_category: string | null; country: string | null; org_id: string | null } | null;
  ticket_tiers: Array<{ price_cents: number | null; status: string | null }> | null;
}

/** Todos los eventos de la ventana, de 500 en 500. Lanza si no cabe en MAX_PAGES. */
async function loadEvents(sinceIso: string): Promise<{ rows: EventRow[]; pages: number }> {
  const rows: EventRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseAdmin
      .from("events")
      .select(
        "org_id, partner_id, city, capacity, tickets_sold, date_start, venues!venue_id(business_category, country, org_id), ticket_tiers!event_id(price_cents, status)",
      )
      .in("status", ["published", "past"])
      .gte("date_start", sinceIso)
      .order("date_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`events: ${error.message}`);
    const batch = (data ?? []) as unknown as EventRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, pages: page + 1 };
  }
  throw new HttpError(500, "dataset_too_large");
}

/** Eventos normalizados; los que no se pueden atribuir a una organización o a un local de España se descartan. */
export function toBenchEvents(rows: EventRow[]): { events: BenchEvent[]; dropped: number } {
  const events: BenchEvent[] = [];
  let dropped = 0;
  for (const r of rows) {
    const venue = r.venues;
    const tenant = r.org_id ?? r.partner_id ?? venue?.org_id ?? null;
    const startsAtMs = Date.parse(r.date_start);
    if (!tenant || !venue || (venue.country ?? "").toUpperCase() !== "ES" || !Number.isFinite(startsAtMs)) {
      dropped++;
      continue;
    }
    events.push({
      tenant,
      segment: (venue.business_category ?? "").trim().toLowerCase() || "otro",
      region: regionOf(r.city),
      capacity: typeof r.capacity === "number" ? r.capacity : null,
      ticketsSold: Number(r.tickets_sold ?? 0),
      startsAtMs,
      prices: (r.ticket_tiers ?? [])
        .filter((t) => t.status !== "hidden" && typeof t.price_cents === "number" && t.price_cents > 0)
        .map((t) => t.price_cents as number),
    });
  }
  return { events, dropped };
}

// ---------------------------------------------------------------- handler

async function readDryRun(req: Request): Promise<boolean> {
  const raw = await req.text();
  if (!raw.trim()) return false;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_json");
  const dry = (body as Record<string, unknown>).dry_run;
  if (dry !== undefined && typeof dry !== "boolean") throw new HttpError(400, "invalid_dry_run");
  return dry === true;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const started = Date.now();
  let running = false;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405, "method_not_allowed");
    // Cron (service role / x-pasify-internal) o admin de plataforma.
    if (!isServiceRoleRequest(req)) await requireAdmin(req);
    const dryRun = await readDryRun(req);

    // Si no se puede leer el interruptor no se sigue: mejor parar que saltárselo.
    const { data: killSwitch, error: killSwitchErr } = await supabaseAdmin
      .from("ai_kill_switches")
      .select("killed")
      .eq("capability_code", CAPABILITY)
      .maybeSingle();
    if (killSwitchErr) throw new Error(`ai_kill_switches: ${killSwitchErr.message}`);
    if (killSwitch?.killed) throw new HttpError(503, "capability_killed");

    running = true;
    const now = new Date();
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
    const { rows, pages } = await loadEvents(since);
    const { events, dropped } = toBenchEvents(rows);
    const computed = computeGroups(events, now.getTime());

    // Inicio del día en UTC: repetir la ejecución el mismo día reescribe las mismas filas.
    const computedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    if (!dryRun && computed.groups.length > 0) {
      const { error: upsertErr } = await supabaseAdmin.from("industry_benchmarks_snapshots").upsert(
        computed.groups.map((g) => ({
          segment: g.segment,
          region: g.region,
          computed_at: computedAt,
          sample_size: g.sampleSize,
          k_anonymity_min: K_ANONYMITY_MIN,
          payload: g.payload,
        })),
        { onConflict: "segment,region,computed_at" },
      );
      if (upsertErr) throw new Error(`industry_benchmarks_snapshots: ${upsertErr.message}`);
    }

    const summary = `benchmarks_recompute events=${events.length} dropped=${dropped} groups=${computed.groups.length}` +
      ` below_k=${computed.skippedBelowK} no_metric=${computed.skippedNoMetric} metrics_omitted=${computed.metricsOmitted}` +
      (dryRun ? " dry_run" : "");
    const { error: auditErr } = await supabaseAdmin.from("ai_audit_log").insert({
      capability_code: CAPABILITY,
      action_summary: summary,
      result: dryRun ? "dry_run" : "ok",
      model_version: MODEL_VERSION,
      latency_ms: Date.now() - started,
    });
    // Las filas ya están escritas: un fallo del registro no tumba la respuesta.
    if (auditErr) logger.error("benchmarks_audit_log_failed", { error: auditErr.message, code: auditErr.code });

    logger.info("benchmarks_recomputed", {
      dry_run: dryRun,
      pages,
      events_read: rows.length,
      events_used: events.length,
      dropped,
      groups: computed.groups.length,
      skipped_below_k: computed.skippedBelowK,
      skipped_no_metric: computed.skippedNoMetric,
      metrics_omitted: computed.metricsOmitted,
    });
    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      window_days: WINDOW_DAYS,
      k_anonymity_min: K_ANONYMITY_MIN,
      events_read: rows.length,
      events_used: events.length,
      events_dropped: dropped,
      groups_published: computed.groups.length,
      groups_skipped_below_k: computed.skippedBelowK,
      groups_skipped_no_metric: computed.skippedNoMetric,
      metrics_omitted: computed.metricsOmitted,
      groups: computed.groups.map((g) => ({ segment: g.segment, region: g.region, sample_size: g.sampleSize })),
    });
  } catch (err) {
    if (running) {
      const { error: auditErr } = await supabaseAdmin.from("ai_audit_log").insert({
        capability_code: CAPABILITY,
        action_summary: "benchmarks_recompute failed",
        result: "failed",
        model_version: MODEL_VERSION,
        latency_ms: Date.now() - started,
        error_message: err instanceof HttpError ? err.code : "internal_error",
      });
      if (auditErr) logger.error("benchmarks_audit_log_failed", { error: auditErr.message, code: auditErr.code });
    }
    logger.error("industry-benchmarks-recompute failed", { error: err instanceof HttpError ? err.code : String(err) });
    return safeErrorResponse(err);
  }
});
