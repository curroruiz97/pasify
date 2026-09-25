import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { useRealtimeInvalidate } from "@/lib/cache/useRealtimeInvalidate";
import { withTimeout } from "@/lib/withTimeout";

/**
 * Datos del panel de admin en la caché (React Query), siempre con clave
 * ["admin", uid, …]: solo en memoria (policy.ts no guarda el ámbito "admin")
 * y fuera al cerrar sesión o cambiar de cuenta.
 *
 * Los errores se lanzan (nada de tragárselos y enseñar "Aún no hay…"): cada
 * sección pinta el error con su "Reintentar".
 */

/** Ninguna carga del panel puede quedarse colgada en su loader. */
const TIMEOUT_MS = 15_000;
const conTimeout = <T>(consulta: PromiseLike<T>, etiqueta: string) => withTimeout(consulta, TIMEOUT_MS, etiqueta);

type RpcError = { message: string; code?: string; details?: string | null; hint?: string | null };
type RpcResult<T> = { data: T | null; error: RpcError | null };

/** RPCs nuevas (o con otra firma) que aún no están en los types generados. */
export function rpcAdmin<T>(nombre: string, args?: Record<string, unknown>): PromiseLike<RpcResult<T>> {
  const cliente = supabase as unknown as {
    rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<RpcResult<T>>;
  };
  return cliente.rpc(nombre, args);
}

/** bigint de PostgREST: llega como número (o como texto si no cabe). */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ============================================================================
// Modo demo (flag admin_showcase, override por uid del admin)
// ============================================================================

export function useAdminShowcase(uid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.admin.showcase(uid ?? ""),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await conTimeout(
        supabase.rpc("get_feature_flag", { _code: "admin_showcase", _org_id: uid as string }),
        "admin_showcase",
      );
      if (error) throw error;
      return data === true;
    },
    enabled: enabled && !!uid,
    staleTime: 10 * 60_000,
  });
}

// ============================================================================
// Portada: KPIs reales (vista v_admin_platform_kpis, security_invoker)
// ============================================================================

export interface AdminKpis {
  partners: number;
  clients: number;
  publishedEvents: number;
  /** Entradas vendidas: pagadas + ya usadas en puerta (un escaneo no "desvende"). */
  ticketsSold: number;
  pendingRefunds: number;
}

export function useAdminKpis(uid: string | null) {
  return useQuery({
    queryKey: qk.admin.kpis(uid ?? ""),
    queryFn: async (): Promise<AdminKpis> => {
      const { data, error } = await conTimeout(
        supabase
          .from("v_admin_platform_kpis")
          .select("partners, clients, published_events, tickets_paid_lifetime, tickets_used_lifetime, pending_refunds")
          .maybeSingle(),
        "v_admin_platform_kpis",
      );
      if (error) throw error;
      return {
        partners: num(data?.partners),
        clients: num(data?.clients),
        publishedEvents: num(data?.published_events),
        ticketsSold: num(data?.tickets_paid_lifetime) + num(data?.tickets_used_lifetime),
        pendingRefunds: num(data?.pending_refunds),
      };
    },
    enabled: !!uid,
    staleTime: 60_000,
  });
}

// ============================================================================
// Locales y Clientes: admin_list_users (filtra y pagina en el servidor)
// ============================================================================

export interface AdminUserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  business_category: string | null;
  account_status: string;
  role: string | null;
  city: string | null;
  phone: string | null;
  created_at: string;
}

export interface AdminUsersParams {
  role: "partner" | "client";
  search: string;
  status: string | null;
  city: string | null;
  category: string | null;
  page: number;
  pageSize: number;
}

type AdminUserDbRow = AdminUserRow & { total_count: number | string };

export function useAdminUsers(uid: string | null, p: AdminUsersParams) {
  return useQuery({
    queryKey: qk.admin.usersPage(uid ?? "", {
      role: p.role,
      search: p.search,
      status: p.status,
      city: p.city,
      category: p.category,
      page: p.page,
      pageSize: p.pageSize,
    }),
    queryFn: async (): Promise<{ rows: AdminUserRow[]; total: number }> => {
      const { data, error } = await conTimeout(
        rpcAdmin<AdminUserDbRow[]>("admin_list_users", {
          _search: p.search.trim() || null,
          _role_filter: p.role,
          _status_filter: p.status,
          _limit: p.pageSize,
          _offset: p.page * p.pageSize,
          _city: p.city,
          _category: p.category,
        }),
        "admin_list_users",
      );
      if (error) throw error;
      const rows = data ?? [];
      return { rows, total: rows.length ? num(rows[0].total_count) : 0 };
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useAdminUserFacets(uid: string | null, role: "partner" | "client", enabled = true) {
  return useQuery({
    queryKey: qk.admin.userFacets(uid ?? "", role),
    queryFn: async (): Promise<{ cities: string[]; categories: string[] }> => {
      const { data, error } = await conTimeout(
        rpcAdmin<{ cities: string[] | null; categories: string[] | null }[]>("admin_user_facets", {
          _role_filter: role,
        }),
        "admin_user_facets",
      );
      if (error) throw error;
      const fila = data?.[0];
      return { cities: fila?.cities ?? [], categories: fila?.categories ?? [] };
    },
    enabled: enabled && !!uid,
    staleTime: 5 * 60_000,
  });
}

// ============================================================================
// Eventos (paginados, con el local)
// ============================================================================

export interface AdminEventRow {
  id: string;
  title: string;
  city: string;
  date_start: string;
  date_end: string | null;
  status: string;
  price_cents: number;
  tickets_sold: number;
  capacity: number | null;
  org_id: string | null;
  localName: string | null;
  /** Su local está suspendido: el evento no se ve ni se vende (D-8). */
  orgSuspended: boolean;
}

type EventDbRow = Omit<AdminEventRow, "localName" | "orgSuspended"> & {
  partner: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
  // Toda la fila: suspended_at llega con la migración del checkout y, si aún
  // no existe, pedirla por nombre rompería la consulta.
  organizations: { name: string | null; status: string | null; suspended_at?: string | null } | null;
};

export function useAdminEvents(uid: string | null, page: number, pageSize: number) {
  return useQuery({
    queryKey: qk.admin.events(uid ?? "", page),
    queryFn: async (): Promise<{ rows: AdminEventRow[]; total: number }> => {
      const desde = page * pageSize;
      const { data, error, count } = await conTimeout(
        supabase
          .from("events")
          .select(
            "id, title, city, date_start, date_end, status, price_cents, tickets_sold, capacity, org_id, partner:profiles!events_partner_id_fkey(business_name, first_name, last_name), organizations(*)",
            { count: "exact" },
          )
          .order("date_start", { ascending: false })
          .range(desde, desde + pageSize - 1),
        "admin_events",
      );
      if (error) throw error;
      const rows = ((data ?? []) as unknown as EventDbRow[]).map(({ partner, organizations, ...e }) => {
        const persona = [partner?.first_name, partner?.last_name].filter(Boolean).join(" ");
        return {
          ...e,
          localName: partner?.business_name || organizations?.name || persona || null,
          orgSuspended: !!organizations && orgSuspendida({
            status: organizations.status,
            suspended_at: organizations.suspended_at ?? null,
          }),
        };
      });
      return { rows, total: count ?? rows.length };
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// ============================================================================
// Soporte: bandeja con contadores del servidor y tiempo real
// ============================================================================

export type InboxFilter = "open" | "unread" | "mine" | "closed";

export interface InboxConversation {
  id: string;
  client_id: string;
  kind: "client_admin" | "partner_admin" | "client_partner";
  status: string;
  assigned_admin_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_for_admin: number;
  created_at: string;
  client: { first_name: string | null; last_name: string | null; email: string | null; business_name: string | null } | null;
  assigned: { first_name: string | null; last_name: string | null; email: string | null } | null;
  org: { name: string | null } | null;
}

const INBOX_COLUMNS =
  "id, client_id, kind, status, assigned_admin_id, last_message_at, last_message_preview, unread_for_admin, created_at, " +
  "client:profiles!support_conversations_client_id_fkey(first_name, last_name, email, business_name), " +
  "assigned:profiles!support_conversations_assigned_admin_id_fkey(first_name, last_name, email), " +
  "org:organizations(name)";

export function useAdminSupportInbox(uid: string | null, filter: InboxFilter, limit: number) {
  return useQuery({
    queryKey: qk.admin.supportInboxList(uid ?? "", filter, limit),
    queryFn: async (): Promise<{ rows: InboxConversation[]; total: number }> => {
      // Las conversaciones sin ningún mensaje (visitas a Soporte sin escribir,
      // de antes de crearlas con el primer mensaje) no son trabajo para nadie.
      let consulta = supabase
        .from("support_conversations")
        .select(INBOX_COLUMNS, { count: "exact" })
        .not("last_message_at", "is", null);
      if (filter === "open") consulta = consulta.neq("status", "closed");
      else if (filter === "closed") consulta = consulta.eq("status", "closed");
      else if (filter === "unread") consulta = consulta.gt("unread_for_admin", 0);
      else if (filter === "mine") consulta = consulta.eq("assigned_admin_id", uid as string).neq("status", "closed");
      const { data, error, count } = await conTimeout(
        consulta.order("last_message_at", { ascending: false }).range(0, limit - 1),
        "admin_support_inbox",
      );
      if (error) throw error;
      const rows = (data ?? []) as unknown as InboxConversation[];
      return { rows, total: count ?? rows.length };
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/**
 * Tiempo real del panel, una sola vez (en AdminDashboard): un mensaje o un
 * cambio en cualquier conversación refresca bandeja y contador; un cambio en
 * cualquier solicitud de reembolso, la cola, sus contadores y la búsqueda de
 * Pedidos (el estado del reembolso de cada entrada).
 */
export function useAdminRealtime(uid: string | null) {
  const soporte = uid ? qk.admin.supportInbox(uid) : null;
  useRealtimeInvalidate({
    canal: uid ? "admin-support-conversations" : null,
    tabla: "support_conversations",
    eventos: ["INSERT", "UPDATE"],
    queryKey: soporte,
  });
  useRealtimeInvalidate({
    canal: uid ? "admin-support-messages" : null,
    tabla: "support_messages",
    eventos: ["INSERT", "UPDATE"],
    queryKey: soporte,
  });
  useRealtimeInvalidate({
    canal: uid ? "admin-refund-queue" : null,
    tabla: "refund_requests",
    eventos: ["*"],
    queryKey: uid ? qk.admin.refundQueue(uid) : null,
  });
  // El estado del reembolso de cada entrada en Pedidos (Stripe confirma por webhook).
  useRealtimeInvalidate({
    canal: uid ? "admin-refund-orders" : null,
    tabla: "refund_requests",
    eventos: ["*"],
    queryKey: uid ? qk.admin.orders(uid) : null,
  });
}

/** Mensajes sin leer de toda la bandeja (contador del servidor, no de la página cargada). */
export function useAdminSupportUnread(uid: string | null) {
  return useQuery({
    queryKey: qk.admin.supportUnread(uid ?? ""),
    // Si el Realtime se corta, el aviso del menú no se queda congelado.
    refetchInterval: 2 * 60_000,
    queryFn: async (): Promise<{ messages: number; conversations: number }> => {
      const { data, error } = await conTimeout(
        supabase.from("support_conversations").select("id, unread_for_admin").gt("unread_for_admin", 0).limit(1000),
        "admin_support_unread",
      );
      if (error) throw error;
      const filas = data ?? [];
      return {
        messages: filas.reduce((s, c) => s + (c.unread_for_admin ?? 0), 0),
        conversations: filas.length,
      };
    },
    enabled: !!uid,
    staleTime: 15_000,
  });
}

// ============================================================================
// Reembolsos: cola del admin (admin_refund_queue) con los seis estados
// ============================================================================

export type RefundQueue = "pending" | "attention" | "in_progress" | "done";
export type RefundStatus6 = "pending" | "approved" | "rejected" | "processing" | "refunded" | "failed";

export interface AdminRefundRow {
  id: string;
  ticket_id: string;
  event_id: string;
  requester_email: string | null;
  amount_cents: number;
  currency: string;
  reason: string;
  reason_code: string | null;
  status: RefundStatus6;
  auto_approved: boolean;
  decided_at: string | null;
  decision_note: string | null;
  stripe_refund_id: string | null;
  stripe_refund_status: string | null;
  stripe_failure_reason: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
  event_title: string | null;
  event_date: string | null;
  venue_name: string | null;
  queue: RefundQueue;
}

type AdminRefundDbRow = AdminRefundRow & { total_count: number | string };

const SIN_CONTADORES: Record<RefundQueue, number> = { pending: 0, attention: 0, in_progress: 0, done: 0 };

/**
 * Cuántas hay en cada cola. Cada minuto se vuelve a pedir: un aprobado pasa
 * a "con incidencia" solo por el paso del tiempo, sin ningún cambio en la
 * fila que avise por Realtime.
 */
export function useAdminRefundCounts(uid: string | null) {
  return useQuery({
    queryKey: qk.admin.refundCounts(uid ?? ""),
    queryFn: async (): Promise<Record<RefundQueue, number>> => {
      const { data, error } = await conTimeout(
        rpcAdmin<{ queue: string; total: number | string }[]>("admin_refund_queue_counts"),
        "admin_refund_queue_counts",
      );
      if (error) throw error;
      const out = { ...SIN_CONTADORES };
      for (const fila of data ?? []) {
        if (fila.queue in out) out[fila.queue as RefundQueue] = num(fila.total);
      }
      return out;
    },
    enabled: !!uid,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAdminRefundQueue(uid: string | null, queue: RefundQueue, page: number, pageSize: number) {
  return useQuery({
    queryKey: qk.admin.refundQueuePage(uid ?? "", queue, page),
    queryFn: async (): Promise<{ rows: AdminRefundRow[]; total: number }> => {
      const { data, error } = await conTimeout(
        rpcAdmin<AdminRefundDbRow[]>("admin_refund_queue", {
          _queue: queue,
          _limit: pageSize,
          _offset: page * pageSize,
        }),
        "admin_refund_queue",
      );
      if (error) throw error;
      const filas = data ?? [];
      return {
        rows: filas.map((r) => ({ ...r, amount_cents: num(r.amount_cents), retry_count: num(r.retry_count) })),
        total: filas.length ? num(filas[0].total_count) : 0,
      };
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

// ============================================================================
// Auditoría
// ============================================================================

export type AuditKind = "user_roles" | "profiles" | "refund_requests" | "organizations" | "partner_settlements";

export interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface ProfileLite {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
}

/** Usuarios que hoy son admin (para filas antiguas con un actor_role poco fiable). */
export function useAdminIds(uid: string | null) {
  return useQuery({
    queryKey: qk.admin.adminIds(uid ?? ""),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await conTimeout(
        supabase.from("user_roles").select("user_id").eq("role", "admin"),
        "admin_ids",
      );
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id);
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

/** ids de usuario de una fila de auditoría: actor y, si la fila es de una persona, a quién afecta. */
export function auditUserIds(r: AuditRow): string[] {
  const ids: string[] = [];
  if (r.actor_user_id) ids.push(r.actor_user_id);
  const fila = r.after ?? r.before;
  const objetivo =
    r.target_kind === "user_roles"
      ? fila?.user_id
      : r.target_kind === "profiles"
        ? r.target_id
        : r.target_kind === "refund_requests"
          ? fila?.requester_user_id
          : r.target_kind === "partner_settlements"
            ? null
            : fila?.owner_id;
  if (typeof objetivo === "string") ids.push(objetivo);
  return ids;
}

export function useAuditLogs(uid: string | null, kind: AuditKind, limit: number) {
  return useQuery({
    queryKey: qk.admin.audit(uid ?? "", kind, limit),
    queryFn: async (): Promise<{ rows: AuditRow[]; profiles: Record<string, ProfileLite> }> => {
      const { data, error } = await conTimeout(
        supabase
          .from("audit_logs")
          .select("id, actor_user_id, actor_role, action, target_kind, target_id, before, after, created_at")
          .eq("target_kind", kind)
          .order("created_at", { ascending: false })
          .limit(limit),
        "audit_logs",
      );
      if (error) throw error;
      const rows = (data ?? []) as unknown as AuditRow[];

      // Perfiles de actores y afectados, en tandas cortas: una lista de
      // cientos de ids en la URL de .in() se pasa del límite.
      const ids = [...new Set(rows.flatMap(auditUserIds))];
      const profiles: Record<string, ProfileLite> = {};
      for (let i = 0; i < ids.length; i += 50) {
        const tanda = ids.slice(i, i + 50);
        const { data: perfiles, error: perr } = await conTimeout(
          supabase.from("profiles").select("id, email, first_name, last_name, business_name").in("id", tanda),
          "audit_profiles",
        );
        if (perr) throw perr;
        for (const p of perfiles ?? []) profiles[p.id] = p as ProfileLite;
      }
      return { rows, profiles };
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// ============================================================================
// Locales: sus organizaciones y la suspensión (admin_partner_orgs)
// ============================================================================

export interface AdminPartnerOrg {
  org_id: string;
  owner_id: string;
  name: string;
  /** active | suspended | closed */
  status: string;
  /** Columnas de la migración del checkout (Ola 2); null si aún no existen. */
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
}

/** Suspendida: suspended_at (admin_set_org_suspension) o el estado 'suspended'. */
export const orgSuspendida = (o: { status: string | null; suspended_at: string | null }): boolean =>
  !!o.suspended_at || o.status === "suspended";

/** Organizaciones de los locales de la página de Locales que se está viendo. */
export function useAdminPartnerOrgs(uid: string | null, ownerIds: string[]) {
  const ids = [...new Set(ownerIds)].sort();
  return useQuery({
    queryKey: qk.admin.partnerOrgsFor(uid ?? "", ids.join(",")),
    queryFn: async (): Promise<AdminPartnerOrg[]> => {
      const { data, error } = await conTimeout(
        rpcAdmin<AdminPartnerOrg[]>("admin_partner_orgs", { _owner_ids: ids }),
        "admin_partner_orgs",
      );
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!uid && ids.length > 0,
    staleTime: 30_000,
  });
}

// ============================================================================
// Liquidaciones (admin_settlement_overview, admin_org_settlements)
// ============================================================================

export interface SettlementOverviewRow {
  org_id: string;
  org_name: string;
  org_status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  owner_id: string | null;
  owner_email: string | null;
  owner_name: string | null;
  paid_orders: number;
  gross_cents: number;
  refunded_cents: number;
  fee_cents: number;
  net_cents: number;
  settled_cents: number;
  /** neto − liquidado; negativo si Pasify ha transferido de más. */
  pending_cents: number;
  settlements_count: number;
  last_paid_at: string | null;
  /**
   * Pedidos cobrados con el Stripe del propio local (cargo con destino): ese
   * dinero ya le llegó, pero el neto de partner_balance_v lo incluye.
   */
  connect_orders: number;
}

export interface SettlementOverview {
  rows: SettlementOverviewRow[];
  total: number;
  /**
   * De todo el filtro, no solo de la página. `pending` es lo que se debe: la
   * suma de los pendientes positivos (lo transferido de más no resta).
   */
  totals: { net: number; settled: number; pending: number };
}

export interface SettlementOverviewParams {
  search: string;
  onlyPending: boolean;
  page: number;
  pageSize: number;
}

type SettlementOverviewDbRow = SettlementOverviewRow & {
  total_count: number | string;
  total_net_cents: number | string;
  total_settled_cents: number | string;
  total_pending_cents: number | string;
};

export function useAdminSettlementOverview(uid: string | null, p: SettlementOverviewParams) {
  return useQuery({
    queryKey: qk.admin.settlementOverview(uid ?? "", {
      search: p.search,
      onlyPending: p.onlyPending,
      page: p.page,
      pageSize: p.pageSize,
    }),
    queryFn: async (): Promise<SettlementOverview> => {
      const { data, error } = await conTimeout(
        rpcAdmin<SettlementOverviewDbRow[]>("admin_settlement_overview", {
          _search: p.search.trim() || null,
          _only_pending: p.onlyPending,
          _limit: p.pageSize,
          _offset: p.page * p.pageSize,
        }),
        "admin_settlement_overview",
      );
      if (error) throw error;
      const filas = data ?? [];
      const primera = filas[0];
      return {
        rows: filas.map((r) => ({
          ...r,
          paid_orders: num(r.paid_orders),
          gross_cents: num(r.gross_cents),
          refunded_cents: num(r.refunded_cents),
          fee_cents: num(r.fee_cents),
          net_cents: num(r.net_cents),
          settled_cents: num(r.settled_cents),
          pending_cents: num(r.pending_cents),
          settlements_count: num(r.settlements_count),
          connect_orders: num(r.connect_orders),
        })),
        total: primera ? num(primera.total_count) : 0,
        totals: {
          net: primera ? num(primera.total_net_cents) : 0,
          settled: primera ? num(primera.total_settled_cents) : 0,
          pending: primera ? num(primera.total_pending_cents) : 0,
        },
      };
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export interface SettlementRow {
  id: string;
  org_id: string;
  amount_cents: number;
  currency: string;
  paid_at: string;
  bank_reference: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Historial de una organización (se pide al desplegar su fila). */
export function useAdminOrgSettlements(uid: string | null, orgId: string | null) {
  return useQuery({
    queryKey: qk.admin.orgSettlements(uid ?? "", orgId ?? ""),
    queryFn: async (): Promise<SettlementRow[]> => {
      const { data, error } = await conTimeout(
        rpcAdmin<SettlementRow[]>("admin_org_settlements", { _org_id: orgId }),
        "admin_org_settlements",
      );
      if (error) throw error;
      return (data ?? []).map((s) => ({ ...s, amount_cents: num(s.amount_cents) }));
    },
    enabled: !!uid && !!orgId,
    staleTime: 30_000,
  });
}

// ============================================================================
// Pedidos (admin_search_orders) y asistentes de un evento
// ============================================================================

export interface AdminOrderTicket {
  id: string;
  status: string;
  /** 8 primeros caracteres del QR: lo que teclea el portero. */
  door_code: string;
  tier_name: string | null;
  amount_paid_cents: number;
  currency: string;
  holder_name: string | null;
  holder_email: string | null;
  transferred: boolean;
  paid_at: string | null;
  used_at: string | null;
  refund_id: string | null;
  refund_status: RefundStatus6 | null;
  refund_amount_cents: number | null;
  refund_reason_code: string | null;
  refund_note: string | null;
  refund_failure: string | null;
  refund_updated_at: string | null;
}

export interface AdminOrderRow {
  order_id: string;
  /** Como orderReference: 8 primeros caracteres del id, en mayúsculas. */
  reference: string;
  /** Por qué ha salido: id, reference, door_code, stripe, email o name (separados por comas). */
  matched_by: string;
  status: string;
  /** false = pago de prueba de Stripe; null = desconocido. */
  livemode: boolean | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  subtotal_cents: number;
  fees_cents: number;
  total_cents: number;
  refunded_cents: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  tickets_email_sent_at: string | null;
  buyer_user_id: string | null;
  buyer_email: string;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_phone: string | null;
  event_id: string | null;
  event_title: string | null;
  event_date_start: string | null;
  event_date_end: string | null;
  event_status: string | null;
  venue_name: string | null;
  event_city: string | null;
  org_id: string | null;
  org_name: string | null;
  tickets: AdminOrderTicket[];
}

/** Lo mínimo que hay que teclear para buscar (el servidor no busca con menos). */
export const MIN_BUSQUEDA_PEDIDOS = 3;

export function useAdminOrderSearch(uid: string | null, q: string, limit = 25) {
  const texto = q.trim();
  return useQuery({
    queryKey: qk.admin.orderSearch(uid ?? "", `${limit}:${texto}`),
    queryFn: async (): Promise<AdminOrderRow[]> => {
      const { data, error } = await conTimeout(
        rpcAdmin<AdminOrderRow[]>("admin_search_orders", { _q: texto, _limit: limit }),
        "admin_search_orders",
      );
      if (error) throw error;
      return (data ?? []).map((o) => ({
        ...o,
        subtotal_cents: num(o.subtotal_cents),
        fees_cents: num(o.fees_cents),
        total_cents: num(o.total_cents),
        refunded_cents: num(o.refunded_cents),
        tickets: Array.isArray(o.tickets)
          ? o.tickets.map((t) => ({
              ...t,
              amount_paid_cents: num(t.amount_paid_cents),
              refund_amount_cents: t.refund_amount_cents == null ? null : num(t.refund_amount_cents),
            }))
          : [],
      }));
    },
    enabled: !!uid && texto.length >= MIN_BUSQUEDA_PEDIDOS,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export interface AdminAttendee {
  ticket_id: string;
  order_id: string | null;
  status: string;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  amount_paid_cents: number;
  currency: string;
  paid_at: string | null;
  used_at: string | null;
  scanned_by_name: string | null;
  tier_name: string | null;
}

/** partner_event_attendees acepta al admin (con emails y teléfonos). */
export function useAdminEventAttendees(uid: string | null, eventId: string | null) {
  return useQuery({
    queryKey: qk.admin.eventAttendees(uid ?? "", eventId ?? ""),
    queryFn: async (): Promise<AdminAttendee[]> => {
      const { data, error } = await conTimeout(
        rpcAdmin<AdminAttendee[]>("partner_event_attendees", { _event_id: eventId }),
        "partner_event_attendees",
      );
      if (error) throw error;
      return (data ?? []).map((a) => ({ ...a, amount_paid_cents: num(a.amount_paid_cents) }));
    },
    enabled: !!uid && !!eventId,
    staleTime: 30_000,
  });
}

// ============================================================================
// Kill-switches de IA (tabla ai_kill_switches, RPC toggle_ai_kill_switch)
// ============================================================================

export interface KillSwitchRow {
  capability_code: string;
  killed: boolean;
  killed_at: string | null;
  reason: string | null;
}

export function useAiKillSwitches(uid: string | null, enabled: boolean) {
  useRealtimeInvalidate({
    canal: uid && enabled ? "admin-ai-kill-switches" : null,
    tabla: "ai_kill_switches",
    eventos: ["INSERT", "UPDATE"],
    queryKey: uid && enabled ? qk.admin.killSwitches(uid) : null,
  });
  return useQuery({
    queryKey: qk.admin.killSwitches(uid ?? ""),
    queryFn: async (): Promise<KillSwitchRow[]> => {
      const { data, error } = await conTimeout(
        supabase.from("ai_kill_switches").select("capability_code, killed, killed_at, reason"),
        "ai_kill_switches",
      );
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && !!uid,
    staleTime: 30_000,
  });
}
