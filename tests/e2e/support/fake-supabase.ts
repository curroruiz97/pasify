import type { Page, Request, Route } from "@playwright/test";

/**
 * Supabase simulado para los e2e del panel de local (partner-shell.spec.ts).
 *
 * La app se arranca (playwright.partner.config.ts) con VITE_SUPABASE_URL
 * apuntando a FAKE_SUPABASE_URL: un puerto local en el que no escucha nadie,
 * así que ninguna petición puede llegar a un proyecto real. `instalarSupabaseFalso`
 * contesta a todo lo que la app pide a ese origen:
 *
 *   - Auth (/auth/v1): usuario y sesión fijos. La sesión se siembra en
 *     localStorage antes de que cargue la app (clave por defecto de
 *     supabase-js: `sb-<primera etiqueta del host>-auth-token`); en la web
 *     `capacitorStorage` lee de localStorage.
 *   - PostgREST (/rest/v1/<tabla>): filas de `crearDatos` con un filtrado
 *     mínimo (eq, neq, in, is, gt/gte/lt/lte, order, limit, offset).
 *   - RPC (/rest/v1/rpc/<nombre>): respuestas de `RPC`.
 *   - Realtime: websocket simulado que acepta cualquier canal.
 *   - Functions y storage: no se usan al navegar; se contestan vacías.
 *
 * Lo que no tiene respuesta preparada devuelve lo más neutro (lectura: [],
 * escritura: vacío, RPC: null) y queda apuntado en `sinMock`: el test lo
 * imprime para que sea fácil ampliar el mock cuando el panel pida algo nuevo.
 * Cualquier petición a otro host de fuera (fuentes, CDNs, un *.supabase.co
 * real…) se aborta: el test no depende de la red.
 */

export const FAKE_SUPABASE_URL = "http://127.0.0.1:54399";
export const FAKE_SUPABASE_KEY = "e2e-clave-publica-falsa";

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;
const HOST_SUPABASE = new URL(FAKE_SUPABASE_URL).host;
/** Igual que supabase-js: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`. */
export const CLAVE_SESION = `sb-${new URL(FAKE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

/** Ids fijos (uuid v4 válidos) para poder buscarlos desde los tests. */
export const IDS = {
  usuario: "5e2e0000-0000-4000-8000-000000000001",
  org: "5e2e0000-0000-4000-8000-000000000002",
  marca: "5e2e0000-0000-4000-8000-000000000003",
  local: "5e2e0000-0000-4000-8000-000000000004",
  suscripcion: "5e2e0000-0000-4000-8000-000000000005",
  eventoHoy: "5e2e0000-0000-4000-8000-000000000010",
  eventoProximo: "5e2e0000-0000-4000-8000-000000000011",
  eventoBorrador: "5e2e0000-0000-4000-8000-000000000012",
  eventoPasado: "5e2e0000-0000-4000-8000-000000000013",
  tipoHoyGeneral: "5e2e0000-0000-4000-8000-000000000020",
  tipoHoyVip: "5e2e0000-0000-4000-8000-000000000021",
  tipoProximo: "5e2e0000-0000-4000-8000-000000000022",
  tipoBorrador: "5e2e0000-0000-4000-8000-000000000023",
  tipoPasado: "5e2e0000-0000-4000-8000-000000000024",
  conversacion: "5e2e0000-0000-4000-8000-000000000030",
} as const;

export const NOMBRE_LOCAL = "Sala E2E";

export interface OpcionesSupabaseFalso {
  /**
   * Flag `partner_showcase` de get_feature_flag: la organización de demo, la
   * única que ve las secciones maqueta en la web. Por defecto, un local real.
   */
  showcase?: boolean;
}

export interface SupabaseFalso {
  /** Peticiones sin respuesta preparada ("GET /rest/v1/tabla?…"), sin repetir. */
  sinMock: Set<string>;
  /** Peticiones a un Supabase real (*.supabase.co/in). Se abortan; no debe haber ninguna. */
  supabaseReal: string[];
  /** Peticiones al Supabase falso aún sin contestar. */
  enVuelo(): number;
  /** Datos pedidos (REST y RPC, sin auth) en orden: "GET /rest/v1/events". */
  peticiones: string[];
  /** Retraso de cada respuesta de datos (REST y RPC), para simular una red lenta. */
  retrasoMs: number;
}

type Fila = Record<string, unknown>;

interface Respuesta {
  status?: number;
  /** Se serializa como JSON. `undefined` = cuerpo vacío. */
  json?: unknown;
  headers?: Record<string, string>;
}

const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

const base64url = (texto: string) => Buffer.from(texto).toString("base64url");

/** JWT con forma válida (auth-js y realtime-js lo decodifican); la firma da igual. */
const jwtFalso = (payload: Fila) =>
  [base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), base64url(JSON.stringify(payload)), base64url("firma-e2e")].join(
    ".",
  );

/** Datos del local de prueba, con fechas relativas a `ahora`. */
export function crearDatos(ahora: number) {
  const usuario = {
    id: IDS.usuario,
    aud: "authenticated",
    role: "authenticated",
    email: "local@e2e.pasify.test",
    email_confirmed_at: iso(ahora - 90 * D),
    phone: "",
    confirmed_at: iso(ahora - 90 * D),
    last_sign_in_at: iso(ahora - H),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { business_name: NOMBRE_LOCAL },
    identities: [],
    created_at: iso(ahora - 90 * D),
    updated_at: iso(ahora - H),
    is_anonymous: false,
  };

  const exp = Math.floor(ahora / 1000) + 24 * 3600;
  const sesion = {
    access_token: jwtFalso({
      aud: "authenticated",
      exp,
      iat: Math.floor(ahora / 1000),
      iss: `${FAKE_SUPABASE_URL}/auth/v1`,
      sub: IDS.usuario,
      email: usuario.email,
      phone: "",
      app_metadata: usuario.app_metadata,
      user_metadata: usuario.user_metadata,
      role: "authenticated",
      aal: "aal1",
      amr: [{ method: "password", timestamp: Math.floor(ahora / 1000) }],
      session_id: "5e2e0000-0000-4000-8000-0000000000ff",
      is_anonymous: false,
    }),
    refresh_token: "e2e-refresh-token",
    token_type: "bearer",
    expires_in: 24 * 3600,
    expires_at: exp,
    user: usuario,
  };

  const org = {
    id: IDS.org,
    slug: "sala-e2e",
    name: NOMBRE_LOCAL,
    legal_name: "Sala E2E S.L.",
    country: "ES",
    city: "Madrid",
    address: "Calle de Prueba 1",
    postal_code: "28001",
    billing_email: usuario.email,
    contact_email: usuario.email,
    contact_phone: "+34600000000",
    vat_id: "B00000000",
    metadata: {},
    owner_id: IDS.usuario,
    status: "active",
    stripe_connect_account_id: null,
    stripe_connect_charges_enabled: false,
    created_at: iso(ahora - 90 * D),
  };

  const marca = {
    id: IDS.marca,
    org_id: IDS.org,
    slug: "sala-e2e",
    name: NOMBRE_LOCAL,
    tagline: null,
    description: null,
    logo_url: null,
    cover_image_url: null,
    primary_color: null,
    accent_color: null,
    website_url: null,
    instagram_handle: null,
    sort_order: 0,
  };

  const local = {
    id: IDS.local,
    brand_id: IDS.marca,
    org_id: IDS.org,
    slug: "sala-e2e-principal",
    name: `${NOMBRE_LOCAL} · Principal`,
    business_category: "club",
    address: "Calle de Prueba 1",
    city: "Madrid",
    postal_code: "28001",
    country: "ES",
    timezone: "Europe/Madrid",
    capacity: 300,
    cover_image_url: null,
    description: null,
    phone: null,
    email: null,
    opening_hours: {},
    status: "active",
    created_at: iso(ahora - 90 * D),
  };

  const evento = <T extends Fila>(e: T) => ({
    description: null,
    city: "Madrid",
    image_url: null,
    partner_id: IDS.usuario,
    org_id: IDS.org,
    venue_id: IDS.local,
    date_end: null,
    ...e,
  });
  const eventos = [
    evento({
      id: IDS.eventoHoy,
      title: "Noche E2E",
      date_start: iso(ahora - H),
      date_end: iso(ahora + 5 * H),
      status: "published",
      price_cents: 1500,
      capacity: 300,
      tickets_sold: 120,
    }),
    evento({
      id: IDS.eventoProximo,
      title: "Concierto E2E",
      date_start: iso(ahora + 7 * D),
      date_end: iso(ahora + 7 * D + 4 * H),
      status: "published",
      price_cents: 2000,
      capacity: 200,
      tickets_sold: 40,
    }),
    evento({
      id: IDS.eventoBorrador,
      title: "Borrador E2E",
      date_start: iso(ahora + 14 * D),
      status: "draft",
      price_cents: 1000,
      capacity: null,
      tickets_sold: 0,
    }),
    evento({
      id: IDS.eventoPasado,
      title: "Fiesta pasada E2E",
      date_start: iso(ahora - 10 * D),
      date_end: iso(ahora - 10 * D + 6 * H),
      status: "published",
      price_cents: 1200,
      capacity: 250,
      tickets_sold: 180,
    }),
  ];

  const tipo = <T extends Fila>(t: T) => ({
    currency: "eur",
    description: null,
    metadata: {},
    per_user_max: 10,
    refundable_until_hours_before: 24,
    sale_starts_at: null,
    sale_ends_at: null,
    status: "active",
    stripe_price_id: null,
    transfer_allowed: true,
    created_at: iso(ahora - 30 * D),
    updated_at: iso(ahora - D),
    ...t,
  });
  const tiposEntrada = [
    tipo({ id: IDS.tipoHoyGeneral, event_id: IDS.eventoHoy, name: "General", price_cents: 1500, capacity: 250, sold: 100, sort_order: 0 }),
    tipo({ id: IDS.tipoHoyVip, event_id: IDS.eventoHoy, name: "VIP", price_cents: 3000, capacity: 50, sold: 20, sort_order: 1 }),
    tipo({ id: IDS.tipoProximo, event_id: IDS.eventoProximo, name: "Anticipada", price_cents: 2000, capacity: 200, sold: 40, sort_order: 0 }),
    tipo({ id: IDS.tipoBorrador, event_id: IDS.eventoBorrador, name: "General", price_cents: 1000, capacity: null, sold: 0, sort_order: 0 }),
    tipo({ id: IDS.tipoPasado, event_id: IDS.eventoPasado, name: "General", price_cents: 1200, capacity: 250, sold: 180, sort_order: 0 }),
  ];

  // Entradas vendidas en los últimos 30 días (Métricas / PartnerReports).
  const nombres = ["Ana García", "Luis Pérez", "Marta López", "Jorge Ruiz", "Lucía Díaz", "Pablo Sanz"];
  const entradas = Array.from({ length: 12 }, (_, i) => {
    const deHoy = i % 2 === 0;
    const eventoId = deHoy ? IDS.eventoHoy : IDS.eventoPasado;
    const [nombre, apellido] = nombres[i % nombres.length].split(" ");
    return {
      id: `5e2e0000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
      event_id: eventoId,
      tier_id: deHoy ? IDS.tipoHoyGeneral : IDS.tipoPasado,
      order_id: `5e2e0000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
      status: i % 3 === 0 ? "used" : "paid",
      amount_paid_cents: deHoy ? 1500 : 1200,
      currency: "eur",
      paid_at: iso(ahora - (deHoy ? (i % 5) + 1 : 12 + (i % 4)) * D),
      used_at: i % 3 === 0 ? iso(ahora - H / 2) : null,
      buyer_user_id: null,
      buyer_email: `${nombre.toLowerCase()}@e2e.pasify.test`,
      buyer_first_name: nombre,
      buyer_last_name: apellido,
      buyer_phone: null,
      tier_name: "General",
      // Recurso embebido de `events!inner(partner_id)`.
      events: { partner_id: IDS.usuario },
    };
  });

  const estadoOnboarding = {
    user_id: IDS.usuario,
    has_org: true,
    has_venue: true,
    has_event: true,
    onboarding_status: "completed",
    completed_at: iso(ahora - 60 * D),
    primary_org_id: IDS.org,
    primary_venue_id: IDS.local,
    should_show_wizard: false,
  };

  const tenant = {
    org_id: IDS.org,
    org_name: NOMBRE_LOCAL,
    brand_id: IDS.marca,
    brand_name: NOMBRE_LOCAL,
    venue_id: IDS.local,
    venue_name: local.name,
    role: "owner",
  };

  const tablas: Record<string, Fila[]> = {
    profiles: [
      {
        id: IDS.usuario,
        email: usuario.email,
        first_name: "Local",
        last_name: "E2E",
        phone: null,
        business_name: NOMBRE_LOCAL,
        business_category: "club",
        city: "Madrid",
        business_city: "Madrid",
        account_status: "approved",
      },
    ],
    cities: [
      { id: "5e2e0000-0000-4000-8000-000000000040", name: "Madrid", slug: "madrid", active: true },
      { id: "5e2e0000-0000-4000-8000-000000000041", name: "Barcelona", slug: "barcelona", active: true },
    ],
    organizations: [org],
    organization_members: [
      { id: "5e2e0000-0000-4000-8000-000000000050", org_id: IDS.org, user_id: IDS.usuario, role: "owner", status: "active" },
    ],
    brands: [marca],
    venues: [local],
    partner_subscriptions: [
      {
        id: IDS.suscripcion,
        org_id: IDS.org,
        plan_code: "free",
        status: "active",
        trial_ends_at: null,
        current_period_end: null,
        cancel_at_period_end: false,
        admin_granted_until: null,
      },
    ],
    partner_balance_v: [
      { org_id: IDS.org, paid_orders: 12, gross_cents: 16200, refunded_cents: 0, fee_cents: 1620, net_cents: 14580 },
    ],
    events: eventos,
    ticket_tiers: tiposEntrada,
    tickets: entradas,
    forecast_predictions: [
      {
        id: "5e2e0000-0000-4000-8000-000000000060",
        event_id: IDS.eventoProximo,
        predicted_attendance: 150,
        predicted_revenue_cents: 300000,
        ci_low: 120,
        ci_high: 180,
        confidence: 0.7,
        factors: { method: "historical_mean_same_dow", sample_size: 3 },
        model_version: "e2e",
        generated_at: iso(ahora - D),
      },
    ],
    support_conversations: [
      {
        id: IDS.conversacion,
        client_id: IDS.usuario,
        org_id: IDS.org,
        kind: "partner_admin",
        status: "open",
        created_at: iso(ahora - 3 * D),
        last_message_at: iso(ahora - 2 * D),
      },
    ],
    support_messages: [
      {
        id: "5e2e0000-0000-4000-8000-000000000031",
        conversation_id: IDS.conversacion,
        sender_id: IDS.usuario,
        sender_kind: "client",
        body: "Hola, ¿cuándo se liquida lo vendido?",
        created_at: iso(ahora - 3 * D),
        read_at: iso(ahora - 3 * D + H),
      },
      {
        id: "5e2e0000-0000-4000-8000-000000000032",
        conversation_id: IDS.conversacion,
        sender_id: "5e2e0000-0000-4000-8000-0000000000aa",
        sender_kind: "admin",
        body: "Hola: cada lunes por transferencia.",
        created_at: iso(ahora - 2 * D),
        read_at: null,
      },
    ],
    // Vacías a propósito (el panel las lee, pero un local nuevo no tiene filas).
    user_notification_prefs: [],
    pricing_proposals: [],
    cashless_wallets: [],
    cashless_topups: [],
    cashless_transactions: [],
    notifications: [],
    refund_requests: [],
  };

  const asistentes = (eventoId: unknown) =>
    entradas
      .filter((e) => e.event_id === eventoId)
      .map((e) => ({
        ticket_id: e.id,
        order_id: e.order_id,
        status: e.status,
        buyer_first_name: e.buyer_first_name,
        buyer_last_name: e.buyer_last_name,
        buyer_email: e.buyer_email,
        buyer_phone: e.buyer_phone,
        amount_paid_cents: e.amount_paid_cents,
        currency: e.currency,
        paid_at: e.paid_at,
        used_at: e.used_at,
        used_by_partner_id: e.used_at ? IDS.usuario : null,
        scanned_by_name: e.used_at ? "Puerta" : null,
        tier_name: e.tier_name,
      }));

  const estadisticasPorTipo = (eventoId: unknown) =>
    tiposEntrada
      .filter((t) => t.event_id === eventoId)
      .map((t) => {
        const vendidas = Number(t.sold ?? 0);
        const dentro = Math.floor(vendidas / 3);
        return {
          tier_id: t.id,
          tier_name: t.name,
          tier_status: t.status,
          capacity: t.capacity,
          sold_count: vendidas,
          used_count: dentro,
          pending_count: vendidas - dentro,
          refunded_count: 0,
          revenue_cents: vendidas * Number(t.price_cents),
          checkin_pct: vendidas ? Math.round((dentro / vendidas) * 1000) / 10 : 0,
          has_sales: vendidas > 0,
          sort_order: t.sort_order,
        };
      });

  const estadisticasCheckin = (eventoId: unknown) => {
    const ev = eventos.find((e) => e.id === eventoId);
    const lista = asistentes(eventoId);
    const dentro = lista.filter((a) => a.status === "used").length;
    return {
      capacity: ev?.capacity ?? null,
      tickets_sold: lista.length,
      tickets_used: dentro,
      tickets_pending: lista.length - dentro,
      tickets_refunded: 0,
      revenue_cents: lista.reduce((s, a) => s + a.amount_paid_cents, 0),
      checkin_pct: lista.length ? Math.round((dentro / lista.length) * 1000) / 10 : 0,
    };
  };

  return { usuario, sesion, tenant, estadoOnboarding, tablas, asistentes, estadisticasPorTipo, estadisticasCheckin };
}

type Datos = ReturnType<typeof crearDatos>;
type Args = Record<string, unknown>;

/** RPC que usa el panel. Las que faltan devuelven null y se apuntan en `sinMock`. */
const crearRpcs = (datos: Datos, opciones: OpcionesSupabaseFalso): Record<string, (args: Args) => unknown> => ({
  get_user_roles: () => ["partner"],
  is_super_admin: () => false,
  tenant_for_user: () => [datos.tenant],
  partner_onboarding_status: () => [datos.estadoOnboarding],
  get_feature_flag: (a) => (a._code === "partner_showcase" ? Boolean(opciones.showcase) : false),
  partner_event_tier_live_stats: (a) => datos.estadisticasPorTipo(a._event_id),
  partner_event_attendees: (a) => datos.asistentes(a._event_id),
  partner_event_checkin_stats: (a) => [datos.estadisticasCheckin(a._event_id)],
  open_conversation: () => IDS.conversacion,
  mark_conversation_read: () => null,
  switch_active_venue: () => null,
});

// ---------------------------------------------------------------------------
// Filtrado mínimo al estilo PostgREST
// ---------------------------------------------------------------------------

/** Parámetros que no son filtros de columna. `or`/`and` no se interpretan: se ignoran. */
const PARAMS_NO_FILTRO = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"]);

const esNumero = (s: string) => s.trim() !== "" && Number.isFinite(Number(s));

/** Orden de PostgreSQL para lo que usa el panel: números como números y el resto (fechas ISO) por código. */
const comparar = (a: string, b: string) =>
  esNumero(a) && esNumero(b) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0;

const valoresIn = (arg: string) =>
  arg
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((v) => v.trim().replace(/^"|"$/g, ""));

/** true/false si la fila cumple `op.valor`; undefined si el operador no está soportado (no filtra). */
function cumple(valor: unknown, expresion: string): boolean | undefined {
  const negado = expresion.startsWith("not.");
  const expr = negado ? expresion.slice(4) : expresion;
  const punto = expr.indexOf(".");
  if (punto < 0) return undefined;
  const op = expr.slice(0, punto);
  const arg = expr.slice(punto + 1);
  const texto = valor === null || valor === undefined ? null : String(valor);

  let resultado: boolean;
  switch (op) {
    case "eq":
      resultado = texto === arg;
      break;
    case "neq":
      resultado = texto !== arg;
      break;
    case "is":
      resultado = arg === "null" ? texto === null : texto === arg;
      break;
    case "in":
      resultado = texto !== null && valoresIn(arg).includes(texto);
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (texto === null) {
        resultado = false;
        break;
      }
      const cmp = comparar(texto, arg);
      resultado = op === "gt" ? cmp > 0 : op === "gte" ? cmp >= 0 : op === "lt" ? cmp < 0 : cmp <= 0;
      break;
    }
    default:
      return undefined;
  }
  return negado ? !resultado : resultado;
}

function ordenar(filas: Fila[], order: string): Fila[] {
  const criterios = order.split(",").map((c) => {
    const [col, ...mods] = c.split(".");
    return { col, desc: mods.includes("desc"), nullsFirst: mods.includes("nullsfirst") };
  });
  return [...filas].sort((a, b) => {
    for (const { col, desc, nullsFirst } of criterios) {
      const va = a[col];
      const vb = b[col];
      if (va === vb) continue;
      if (va === null || va === undefined) return nullsFirst ? -1 : 1;
      if (vb === null || vb === undefined) return nullsFirst ? 1 : -1;
      const cmp = comparar(String(va), String(vb));
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function consultar(filas: Fila[], params: URLSearchParams): Fila[] {
  let resultado = filas.filter((fila) => {
    for (const [col, expr] of params) {
      // Filtros sobre tablas embebidas (`events.partner_id`): el mock ya las trae resueltas.
      if (PARAMS_NO_FILTRO.has(col) || col.includes(".")) continue;
      if (cumple(fila[col], expr) === false) return false;
    }
    return true;
  });
  const order = params.get("order");
  if (order) resultado = ordenar(resultado, order);
  const offset = Number(params.get("offset") ?? 0);
  const limit = params.get("limit");
  return resultado.slice(offset, limit === null ? undefined : offset + Number(limit));
}

// ---------------------------------------------------------------------------
// Respuestas por servicio
// ---------------------------------------------------------------------------

const clave = (req: Request, url: URL) => `${req.method()} ${url.pathname}${url.search}`.slice(0, 200);

function leerArgs(req: Request, url: URL): Args {
  if (req.method() === "GET" || req.method() === "HEAD") return Object.fromEntries(url.searchParams);
  try {
    return (req.postDataJSON() as Args | null) ?? {};
  } catch {
    return {};
  }
}

function responderRest(tabla: string, req: Request, url: URL, datos: Datos, sinMock: Set<string>): Respuesta {
  const metodo = req.method();
  const cabeceras = req.headers();
  const quiereObjeto = (cabeceras["accept"] ?? "").includes("vnd.pgrst.object+json");
  const filas = datos.tablas[tabla];

  if (metodo === "GET" || metodo === "HEAD") {
    if (!filas) sinMock.add(clave(req, url));
    const resultado = consultar(filas ?? [], url.searchParams);
    const rango = resultado.length ? `0-${resultado.length - 1}/${resultado.length}` : "*/0";
    if (metodo === "HEAD") return { headers: { "content-range": rango } };
    if (quiereObjeto) {
      if (resultado.length !== 1) {
        return {
          status: 406,
          json: {
            code: "PGRST116",
            details: `The result contains ${resultado.length} rows`,
            hint: null,
            message: "JSON object requested, multiple (or no) rows returned",
          },
        };
      }
      return { json: resultado[0], headers: { "content-range": "0-0/1" } };
    }
    return { json: resultado, headers: { "content-range": rango } };
  }

  // Escrituras: recorrer el panel no debería escribir nada; se apunta y se
  // contesta como PostgREST sin filas.
  sinMock.add(clave(req, url));
  if (quiereObjeto) return { status: 201, json: {} };
  if ((cabeceras["prefer"] ?? "").includes("return=representation")) return { status: 201, json: [] };
  return { status: metodo === "POST" ? 201 : 204 };
}

function responderAuth(ruta: string, req: Request, url: URL, datos: Datos, sinMock: Set<string>): Respuesta {
  switch (ruta) {
    case "/auth/v1/user":
      return { json: datos.usuario };
    case "/auth/v1/token":
      return { json: datos.sesion };
    case "/auth/v1/logout":
      return { status: 204 };
    default:
      sinMock.add(clave(req, url));
      return { json: {} };
  }
}

/**
 * Instala el Supabase falso en `page`. Llamar antes de `page.goto`.
 * Devuelve lo que el test necesita para comprobar que el mock está completo.
 */
export async function instalarSupabaseFalso(
  page: Page,
  opciones: OpcionesSupabaseFalso = {},
): Promise<SupabaseFalso> {
  const datos = crearDatos(Date.now());
  const rpcs = crearRpcs(datos, opciones);
  const sinMock = new Set<string>();
  const supabaseReal: string[] = [];
  let pendientes = 0;
  const falso: SupabaseFalso = {
    sinMock,
    supabaseReal,
    enVuelo: () => pendientes,
    peticiones: [],
    retrasoMs: 0,
  };

  await page.addInitScript(
    ({ clave: claveSesion, sesion }) => {
      if (window.top !== window) return;
      window.localStorage.setItem(claveSesion, JSON.stringify(sesion));
    },
    { clave: CLAVE_SESION, sesion: datos.sesion },
  );

  // Todo lo que no sea la propia app ni el Supabase falso se corta aquí.
  await page.route(
    (url) =>
      url.protocol.startsWith("http") &&
      url.origin !== ORIGEN_SUPABASE &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    (route) => {
      const url = route.request().url();
      if (/\.supabase\.(co|in)$/i.test(new URL(url).hostname)) supabaseReal.push(url);
      return route.abort("blockedbyclient");
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE,
    async (route: Route) => {
      pendientes++;
      try {
        const req = route.request();
        const url = new URL(req.url());
        const ruta = url.pathname;
        let respuesta: Respuesta;

        if (ruta.startsWith("/rest/v1/") && req.method() !== "OPTIONS") {
          falso.peticiones.push(`${req.method()} ${ruta}`);
          if (falso.retrasoMs > 0) await new Promise((r) => setTimeout(r, falso.retrasoMs));
        }

        if (ruta.startsWith("/auth/v1/")) {
          respuesta = responderAuth(ruta, req, url, datos, sinMock);
        } else if (ruta.startsWith("/rest/v1/rpc/")) {
          const nombre = ruta.slice("/rest/v1/rpc/".length);
          const rpc = rpcs[nombre];
          if (!rpc) sinMock.add(clave(req, url));
          respuesta = { json: rpc ? rpc(leerArgs(req, url)) : null };
        } else if (ruta.startsWith("/rest/v1/")) {
          respuesta = responderRest(ruta.slice("/rest/v1/".length), req, url, datos, sinMock);
        } else {
          // functions/v1, storage/v1…: nada de esto se usa solo con navegar.
          sinMock.add(clave(req, url));
          respuesta = { json: {} };
        }

        const cuerpo = respuesta.json === undefined ? "" : JSON.stringify(respuesta.json);
        await route.fulfill({
          status: respuesta.status ?? 200,
          headers: {
            // Otro origen que la app: sin CORS el navegador no deja leer la respuesta.
            "access-control-allow-origin": req.headers()["origin"] ?? "*",
            "access-control-allow-credentials": "true",
            "access-control-expose-headers": "content-range, x-supabase-api-version",
            ...(cuerpo ? { "content-type": "application/json; charset=utf-8" } : {}),
            ...respuesta.headers,
          },
          body: cuerpo,
        });
      } finally {
        pendientes--;
      }
    },
  );

  // Realtime (Phoenix, serializador 2.0.0: [join_ref, ref, topic, event, payload]).
  // Cada mensaje con `ref` recibe un "ok": los canales quedan SUBSCRIBED y el
  // latido nunca caduca. No se emite ningún cambio.
  await page.routeWebSocket(
    (url) => url.host === HOST_SUPABASE,
    (ws) => {
      ws.onMessage((mensaje) => {
        if (typeof mensaje !== "string") return;
        let frame: unknown;
        try {
          frame = JSON.parse(mensaje);
        } catch {
          return;
        }
        if (!Array.isArray(frame)) return;
        const [joinRef, ref, topic] = frame as [string | null, string | null, string];
        if (ref === null || ref === undefined) return;
        ws.send(JSON.stringify([joinRef ?? null, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      });
    },
  );

  return falso;
}

/**
 * Hace creer a la SPA que corre dentro de la app de iOS/Android con el
 * override de src/lib/platform.ts. No se simula Capacitor: con él,
 * capacitorStorage iría a Preferences y se perdería la sesión sembrada.
 */
export async function simularAppNativa(page: Page, plataforma: "ios" | "android" = "ios"): Promise<void> {
  await page.addInitScript((p) => {
    Object.assign(window, { __PASIFY_FORCE_NATIVE_UI__: true, __PASIFY_FORCE_PLATFORM__: p });
  }, plataforma);
}
