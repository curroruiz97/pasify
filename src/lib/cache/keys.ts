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
  public: {
    all: () => ["public"] as const,
    cities: () => ["public", "cities"] as const,
    partners: () => ["public", "partners"] as const,
    calendarEvents: (city: string | null) => ["public", "calendar-events", city] as const,
  },
};
