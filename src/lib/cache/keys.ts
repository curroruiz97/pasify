/**
 * Claves de la caché de datos (React Query).
 *
 * Tres ámbitos, siempre el primero de la clave:
 *   - "me":      datos del usuario con sesión        → ["me", uid, …]
 *   - "partner": panel de local del usuario          → ["partner", uid, …]
 *   - "public":  datos públicos, iguales para todos  → ["public", …]
 *
 * El uid va SIEMPRE en segunda posición en "me" y "partner": una respuesta
 * que llega después de cambiar de cuenta no puede acabar en la caché del
 * usuario nuevo, y la persistencia (policy.ts) solo guarda claves del
 * usuario activo.
 *
 * Invalidar `qk.partner.all(uid)` refresca todo el panel; `qk.me.all(uid)`
 * todo lo del usuario.
 */
export const qk = {
  me: {
    all: (uid: string) => ["me", uid] as const,
    roles: (uid: string) => ["me", uid, "roles"] as const,
    profile: (uid: string) => ["me", uid, "profile"] as const,
    tickets: (uid: string) => ["me", uid, "tickets"] as const,
    refunds: (uid: string) => ["me", uid, "refunds"] as const,
    favorites: (uid: string) => ["me", uid, "favorites"] as const,
    loyalty: (uid: string) => ["me", uid, "loyalty"] as const,
    support: (uid: string, mode: string, scope: string | null) => ["me", uid, "support", mode, scope] as const,
  },
  partner: {
    all: (uid: string) => ["partner", uid] as const,
    tenant: (uid: string) => ["partner", uid, "tenant"] as const,
    subscription: (uid: string, orgId: string | null) => ["partner", uid, "subscription", orgId] as const,
    context: (uid: string) => ["partner", uid, "context"] as const,
    profile: (uid: string) => ["partner", uid, "profile"] as const,
    events: (uid: string) => ["partner", uid, "events"] as const,
    showcase: (uid: string, orgId: string | null) => ["partner", uid, "showcase", orgId] as const,
    balance: (uid: string, orgId: string) => ["partner", uid, "balance", orgId] as const,
    reports: (uid: string, range: string) => ["partner", uid, "reports", range] as const,
    attendees: (uid: string, eventId: string) => ["partner", uid, "attendees", eventId] as const,
    live: (uid: string, eventId: string) => ["partner", uid, "live", eventId] as const,
    forecast: (uid: string) => ["partner", uid, "forecast"] as const,
  },
  /**
   * Cuarto ámbito, "admin" → ["admin", uid, …]: panel de admin, datos de toda
   * la plataforma (de otras personas). Solo en memoria: policy.ts no guarda
   * nunca este ámbito en el dispositivo y se vacía al cerrar sesión o cambiar
   * de cuenta.
   */
  admin: {
    all: (uid: string) => ["admin", uid] as const,
    /** Flag admin_showcase (módulos maqueta con la franja DEMO). */
    showcase: (uid: string) => ["admin", uid, "showcase"] as const,
    kpis: (uid: string) => ["admin", uid, "kpis"] as const,
    /** Prefijo de los listados de usuarios (Locales, Clientes). */
    users: (uid: string) => ["admin", uid, "users"] as const,
    usersPage: (uid: string, params: Record<string, string | number | null>) =>
      ["admin", uid, "users", params] as const,
    userFacets: (uid: string, role: string) => ["admin", uid, "user-facets", role] as const,
    events: (uid: string, page: number) => ["admin", uid, "events", page] as const,
    /** Prefijo de la bandeja de soporte: Realtime lo invalida entero. */
    supportInbox: (uid: string) => ["admin", uid, "support-inbox"] as const,
    supportInboxList: (uid: string, filter: string, limit: number) =>
      ["admin", uid, "support-inbox", "list", filter, limit] as const,
    supportUnread: (uid: string) => ["admin", uid, "support-inbox", "unread"] as const,
    /** Una conversación abierta por el admin (SupportChat). */
    supportChat: (uid: string, conversation: string) => ["admin", uid, "support", conversation] as const,
    /** Prefijo de la cola de reembolsos del admin (no es la de useRefundRequests). */
    refundQueue: (uid: string) => ["admin", uid, "refund-queue"] as const,
    refundQueuePage: (uid: string, queue: string, page: number) =>
      ["admin", uid, "refund-queue", "page", queue, page] as const,
    refundCounts: (uid: string) => ["admin", uid, "refund-queue", "counts"] as const,
    /** Prefijo de la auditoría (todas las tablas). */
    auditAll: (uid: string) => ["admin", uid, "audit"] as const,
    audit: (uid: string, kind: string, limit: number) => ["admin", uid, "audit", kind, limit] as const,
    adminIds: (uid: string) => ["admin", uid, "admin-ids"] as const,
    killSwitches: (uid: string) => ["admin", uid, "ai-kill-switches"] as const,
  },
  public: {
    all: () => ["public"] as const,
    cities: () => ["public", "cities"] as const,
    partners: () => ["public", "partners"] as const,
    calendarEvents: (city: string | null) => ["public", "calendar-events", city] as const,
    /** Ficha de un local (vista `public_partners`), página /p/:id. */
    partner: (id: string) => ["public", "partner", id] as const,
    /** Eventos publicados de un local, página /p/:id. */
    partnerEvents: (id: string) => ["public", "partner-events", id] as const,
  },
};
