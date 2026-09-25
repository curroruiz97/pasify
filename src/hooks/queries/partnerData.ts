import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";
import { qk } from "@/lib/cache/keys";
import { useRealtimeInvalidate } from "@/lib/cache/useRealtimeInvalidate";
import { toFunctionWriteError } from "@/components/partner/writeErrors";

/**
 * Datos del panel de local en la caché (React Query).
 *
 * Cada sección del panel se desmonta al cambiar de sección (SectionBoundary):
 * antes perdía sus datos y al volver pintaba "Cargando…" y los pedía otra
 * vez. Ahora viven aquí, compartidos: volver es instantáneo y solo se
 * refresca en segundo plano lo que tenga más de 30 s.
 */

/** Ninguna carga puede dejar el panel colgado en su loader. */
const LOAD_TIMEOUT_MS = 10_000;

/** Las consultas de Supabase son "thenables": withTimeout necesita una Promise. */
export function timed<T>(query: PromiseLike<T>, label: string): Promise<Awaited<T>> {
  return withTimeout(Promise.resolve(query), LOAD_TIMEOUT_MS, label);
}

export type PartnerEventRow = {
  id: string;
  title: string;
  description: string | null;
  city: string;
  date_start: string;
  date_end: string | null;
  status: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
  /**
   * Local del evento: su zona horaria es la de la fecha que se enseña. Puede
   * faltar en una lista guardada en el dispositivo antes de pedirlo.
   */
  venue_id?: string | null;
};

export type PartnerProfile = {
  id: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  business_city: string | null;
  account_status: string;
};

export type City = { id: string; name: string; slug: string };

const PROFILE_COLUMNS = "id, business_name, business_category, city, business_city, account_status";

/**
 * Eventos del local: los suyos (partner_id, legacy) y los de las
 * organizaciones de las que es miembro o dueño.
 */
async function leerEventosDelLocal(uid: string): Promise<PartnerEventRow[]> {
  let orgIds: string[] = [];
  try {
    const [members, owned] = await Promise.all([
      timed(
        supabase.from("organization_members").select("org_id").eq("user_id", uid).eq("status", "active"),
        "organization_members",
      ),
      // Fallback: organizations donde el user es owner_id directo
      timed(supabase.from("organizations").select("id").eq("owner_id", uid), "organizations"),
    ]);
    orgIds = (members.data ?? [])
      .map((m: { org_id: string | null }) => m.org_id)
      .filter((id): id is string => !!id);
    for (const o of (owned.data ?? []) as Array<{ id: string }>) {
      if (!orgIds.includes(o.id)) orgIds.push(o.id);
    }
  } catch (err) {
    // Sin respuesta: mejor un error visible que una lista incompleta.
    if (err instanceof TimeoutError) throw err;
    /* RLS o tabla no existente — caemos a sólo partner_id */
  }

  const filter =
    orgIds.length > 0 ? `partner_id.eq.${uid},org_id.in.(${orgIds.join(",")})` : `partner_id.eq.${uid}`;

  const { data, error } = await timed(
    supabase
      .from("events")
      .select(
        "id, title, description, city, date_start, date_end, status, price_cents, capacity, tickets_sold, image_url, venue_id"
      )
      .or(filter)
      .order("date_start", { ascending: false }),
    "events",
  );
  if (error) throw error;
  return (data ?? []) as PartnerEventRow[];
}

export function usePartnerEvents(uid: string | null) {
  return useQuery({
    queryKey: qk.partner.events(uid ?? ""),
    queryFn: () => leerEventosDelLocal(uid as string),
    enabled: !!uid,
  });
}

export function usePartnerProfile(uid: string | null) {
  return useQuery({
    queryKey: qk.partner.profile(uid ?? ""),
    queryFn: async (): Promise<PartnerProfile | null> => {
      const { data, error } = await timed(
        supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", uid as string).maybeSingle(),
        "profiles",
      );
      if (error) throw error;
      return (data as PartnerProfile | null) ?? null;
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

export function useCities() {
  return useQuery({
    queryKey: qk.public.cities(),
    queryFn: async (): Promise<City[]> => {
      const { data, error } = await timed(
        supabase.from("cities").select("id, name, slug").eq("active", true),
        "cities",
      );
      if (error) throw error;
      return (data ?? []) as City[];
    },
    staleTime: 60 * 60_000,
  });
}

/**
 * Secciones maqueta: solo la organización de demo (flag partner_showcase).
 * Sin organización todavía no hay nada que preguntar (el flag es por org).
 */
export function usePartnerShowcase(uid: string | null, orgId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.partner.showcase(uid ?? "", orgId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await timed(
        supabase.rpc("get_feature_flag", { _code: "partner_showcase", _org_id: orgId }),
        "get_feature_flag",
      );
      if (error) throw error;
      return data === true;
    },
    enabled: enabled && !!uid && !!orgId,
    staleTime: 10 * 60_000,
  });
}

export type BalanceRow = {
  paid_orders: number;
  gross_cents: number;
  refunded_cents: number;
  fee_cents: number;
  net_cents: number;
};

// partner_balance_v (security_invoker) aún no está en los types generados.
const leerSaldo = (orgId: string) =>
  (
    supabase as unknown as {
      from: (t: "partner_balance_v") => {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => { maybeSingle: () => Promise<{ data: BalanceRow | null; error: { message: string } | null }> };
        };
      };
    }
  )
    .from("partner_balance_v")
    .select("paid_orders, gross_cents, refunded_cents, fee_cents, net_cents")
    .eq("org_id", orgId)
    .maybeSingle();

export interface PartnerBalance {
  /** Cuenta de Stripe conectada y cobrando (lo que de verdad usa el checkout). */
  connected: boolean;
  balance: BalanceRow | null;
}

/** Cobros: si el local cobra con su Stripe y lo vendido hasta hoy. */
export function usePartnerBalance(uid: string | null, orgId: string | null) {
  return useQuery({
    queryKey: qk.partner.balance(uid ?? "", orgId ?? ""),
    queryFn: async (): Promise<PartnerBalance> => {
      const id = orgId as string;
      const [orgRes, balRes] = await Promise.all([
        timed(
          supabase
            .from("organizations")
            .select("stripe_connect_account_id, stripe_connect_charges_enabled")
            .eq("id", id)
            .maybeSingle(),
          "organizations.stripe",
        ),
        timed(leerSaldo(id), "partner_balance_v"),
      ]);
      if (balRes.error) throw balRes.error;
      const org = orgRes.data;
      return {
        connected:
          !orgRes.error && !!org?.stripe_connect_account_id && org?.stripe_connect_charges_enabled === true,
        balance: balRes.data,
      };
    },
    enabled: !!uid && !!orgId,
  });
}

// ---------------------------------------------------------------------------
// Reembolsos: bandeja del local (B1-07, B4-05)
// ---------------------------------------------------------------------------

export type PartnerRefundStatus = "pending" | "approved" | "processing" | "refunded" | "failed" | "rejected";

const ESTADOS_REEMBOLSO: ReadonlySet<string> = new Set<PartnerRefundStatus>([
  "pending",
  "approved",
  "processing",
  "refunded",
  "failed",
  "rejected",
]);

export interface PartnerRefundRequest {
  id: string;
  eventId: string;
  eventTitle: string | null;
  eventDate: string | null;
  /** Local del evento: la fecha se enseña en su zona horaria. */
  venueId: string | null;
  /** Tipo de entrada (null si no se puede leer). */
  tierName: string | null;
  amountCents: number;
  currency: string;
  /** Lo que escribió el comprador al pedirla. */
  reason: string;
  status: PartnerRefundStatus;
  /** Motivo del rechazo (o nota de quien la decidió). */
  decisionNote: string | null;
  decidedAt: string | null;
  /** La aprobó el plazo del tipo de entrada, sin pasar por el local. */
  autoApproved: boolean;
  createdAt: string;
}

export interface PartnerRefunds {
  /** Por decidir: la que más lleva esperando, primero. */
  pending: PartnerRefundRequest[];
  /** Ya decididas (en curso, reembolsadas, fallidas y rechazadas): la más reciente, primero. */
  decided: PartnerRefundRequest[];
}

/** Todas las pendientes cuentan (menú y lista); de las decididas, las últimas. */
const MAX_PENDIENTES = 500;
const MAX_DECIDIDAS = 100;

// Sin el email ni el nombre del comprador: la bandeja no los necesita.
const COLUMNAS_REEMBOLSO =
  "id, event_id, amount_cents, currency, reason, status, decision_note, decided_at, auto_approved, created_at, events(title, date_start, venue_id), tickets(ticket_tiers(name))";

type Embebido<T> = T | T[] | null | undefined;

interface FilaReembolso {
  id: string;
  event_id: string;
  amount_cents: number | null;
  currency: string | null;
  reason: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  auto_approved: boolean | null;
  created_at: string;
  events: Embebido<{ title: string | null; date_start: string | null; venue_id: string | null }>;
  tickets: Embebido<{ ticket_tiers: Embebido<{ name: string | null }> }>;
}

/** PostgREST da un objeto por cada relación "a uno"; por si acaso, también una lista. */
const uno = <T>(v: Embebido<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const aSolicitud = (r: FilaReembolso): PartnerRefundRequest => {
  const evento = uno(r.events);
  const tipo = uno(uno(r.tickets)?.ticket_tiers);
  return {
    id: r.id,
    eventId: r.event_id,
    eventTitle: evento?.title ?? null,
    eventDate: evento?.date_start ?? null,
    venueId: evento?.venue_id ?? null,
    tierName: tipo?.name ?? null,
    amountCents: r.amount_cents ?? 0,
    currency: (r.currency || "EUR").toUpperCase(),
    reason: r.reason ?? "",
    // Un estado que la app aún no conoce se trata como "en curso", nunca como pendiente.
    status: ESTADOS_REEMBOLSO.has(r.status) ? (r.status as PartnerRefundStatus) : "processing",
    decisionNote: r.decision_note,
    decidedAt: r.decided_at,
    autoApproved: r.auto_approved === true,
    createdAt: r.created_at,
  };
};

/**
 * Solicitudes de la organización (la RLS deja leerlas a owner, admin y
 * manager). Las de "evento cancelado" no salen: no son peticiones que decidir
 * (nacen aprobadas al cancelar) y se siguen desde el menú del evento.
 */
async function leerReembolsos(orgId: string): Promise<PartnerRefunds> {
  const [pendientes, decididas] = await Promise.all([
    timed(
      supabase
        .from("refund_requests")
        .select(COLUMNAS_REEMBOLSO)
        .eq("org_id", orgId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(MAX_PENDIENTES),
      "refund_requests.pending",
    ),
    timed(
      supabase
        .from("refund_requests")
        .select(COLUMNAS_REEMBOLSO)
        .eq("org_id", orgId)
        .neq("status", "pending")
        .or("reason_code.is.null,reason_code.neq.event_cancelled")
        .order("created_at", { ascending: false })
        .limit(MAX_DECIDIDAS),
      "refund_requests.decided",
    ),
  ]);
  if (pendientes.error) throw pendientes.error;
  if (decididas.error) throw decididas.error;
  const filas = (data: unknown) => ((data ?? []) as FilaReembolso[]).map(aSolicitud);
  return {
    pending: filas(pendientes.data).filter((r) => r.status === "pending"),
    decided: filas(decididas.data).filter((r) => r.status !== "pending"),
  };
}

/**
 * Bandeja de reembolsos del local. La usa también el menú (número de
 * pendientes): es la misma consulta. Datos de compradores → solo en memoria
 * (policy.ts no guarda "refunds") y poco rato cuando nadie la mira.
 */
export function usePartnerRefunds(uid: string | null, orgId: string | null) {
  return useQuery({
    queryKey: qk.partner.refunds(uid ?? "", orgId ?? ""),
    queryFn: () => leerReembolsos(orgId as string),
    enabled: !!uid && !!orgId,
    gcTime: 5 * 60_000,
  });
}

/**
 * Tiempo real: una solicitud nueva, una decisión o el reembolso hecho en
 * Stripe refrescan la bandeja (y el número del menú) sin recargar.
 */
export function usePartnerRefundsLive(uid: string | null, orgId: string | null) {
  useRealtimeInvalidate({
    canal: uid && orgId ? "partner-refunds" : null,
    tabla: "refund_requests",
    filtro: orgId ? `org_id=eq.${orgId}` : undefined,
    eventos: ["*"],
    queryKey: uid && orgId ? qk.partner.refunds(uid, orgId) : null,
  });
}

export type RefundDecision = "approve" | "reject";

/** decide-refund exige una nota de al menos 5 caracteres para rechazar. */
export const REJECT_NOTE_MIN_LENGTH = 5;

/** Aprobar llama a Stripe: se le da más margen que a una lectura. */
const DECIDE_TIMEOUT_MS = 30_000;

/**
 * Aprueba o rechaza una solicitud con la edge function decide-refund (JWT de
 * owner/admin/manager de la organización del evento). Aprobar ejecuta el
 * reembolso en Stripe; rechazar se lo explica al comprador por email con la
 * nota. Devuelve el estado en que queda la solicitud (null si la respuesta no
 * lo trae). Si falla lanza un WriteError (writeErrors.ts) o un TimeoutError.
 */
export async function decideRefundRequest(
  requestId: string,
  decision: RefundDecision,
  note?: string,
): Promise<PartnerRefundStatus | null> {
  const nota = note?.trim() ?? "";
  const body = { request_id: requestId, decision, ...(nota ? { note: nota } : {}) };
  const res = await withTimeout(
    supabase.functions.invoke("decide-refund", { body }),
    DECIDE_TIMEOUT_MS,
    "decide-refund",
  ).catch(async (err: unknown) => {
    if (err instanceof TimeoutError) throw err;
    throw await toFunctionWriteError(err);
  });
  if (res.error) throw await toFunctionWriteError(res.error);
  const status = (res.data as { status?: unknown } | null)?.status;
  return typeof status === "string" && ESTADOS_REEMBOLSO.has(status) ? (status as PartnerRefundStatus) : null;
}

/**
 * Tras decidir una solicitud: la bandeja (y el menú) al momento; cobros,
 * informes, asistentes, En vivo y eventos cambian con el reembolso.
 */
export async function invalidarTrasDecidirReembolso(queryClient: QueryClient, uid: string): Promise<void> {
  const derivados = new Set(["balance", "reports", "attendees", "live", "events"]);
  void queryClient.invalidateQueries({
    queryKey: qk.partner.all(uid),
    predicate: (q) => derivados.has(String(q.queryKey[2])),
  });
  await queryClient.invalidateQueries({
    queryKey: qk.partner.all(uid),
    predicate: (q) => q.queryKey[2] === "refunds",
  });
}

/**
 * Tras crear, editar, publicar, cancelar o borrar un evento: fuera de fecha
 * todo lo que sale de los eventos (lista, primeros pasos, En vivo,
 * asistentes, informes, cobros, previsión y reembolsos: cancelar convierte
 * las solicitudes pendientes en reembolsos). Se refresca ya lo que se está
 * viendo y el resto al volver a él. Devuelve cuando la lista está al día.
 */
export async function invalidarTrasCambioDeEventos(queryClient: QueryClient, uid: string): Promise<void> {
  const derivados = new Set(["context", "live", "attendees", "reports", "balance", "forecast", "refunds"]);
  void queryClient.invalidateQueries({
    queryKey: qk.partner.all(uid),
    predicate: (q) => derivados.has(String(q.queryKey[2])),
  });
  await queryClient.invalidateQueries({ queryKey: qk.partner.events(uid) });
}
