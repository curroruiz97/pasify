import { useState, useEffect, useCallback, useRef } from 'react';
import type { AuthChangeEvent, User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/lib/withTimeout';
import { captureError, getErrorMessage, setSentryTag, setSentryUser } from '@/lib/sentry';

/**
 * Pasify auth hook · super-admin/dev mode.
 *
 * Modelo de rol DESPUÉS de Fase 1 (security hardening):
 *
 *  - Usuarios normales tienen UN SOLO rol (client | partner | admin) enforced
 *    por RLS `user_roles_self_insert` (migración 20260513120000). El backend
 *    impide acumular roles vía RPC `claim_initial_role` que sólo permite
 *    reclamar si el usuario aún no tiene rol.
 *
 *  - El "modo super-admin" es exclusivo de Francisco
 *    (francisco@avenuemedia.io + rol admin). La verificación canónica es
 *    `rpc('is_super_admin', { _user_id })` en backend; el frontend lo espeja
 *    en `isSuperAdminDev` para gatear UI.
 *
 *  - `canSwitchPanels` = isSuperAdminDev && env flag `VITE_ENABLE_SUPER_ADMIN_SWITCHER=true`
 *    && userRoles.length >= 2. Sólo true para Francisco con env opt-in. El
 *    PanelSwitcher y ProtectedRoute auto-switch leen este flag.
 *
 *  - `effectiveRole` es el rol más privilegiado del usuario (admin > partner > client).
 *    Para usuarios normales `userRole === effectiveRole` siempre; localStorage
 *    se ignora. Para super-admin, `userRole` puede divergir si está cambiando
 *    entre paneles vía PanelSwitcher.
 *
 *  - `resolveInitialDashboard(roles, lastActiveVenueId?)` es helper exportable
 *    que devuelve la ruta inicial post-login según el rol más privilegiado.
 *
 * Estabilidad de sesión (Fase 0 del panel de local):
 *
 *  - auth-js emite `SIGNED_IN` cada vez que la pestaña/app vuelve a ser visible
 *    (y también lo reenvía desde otras pestañas por BroadcastChannel) y
 *    `TOKEN_REFRESHED` ~cada hora. Antes cada evento ponía `roleLoading=true`
 *    y volvía a pedir los roles; ProtectedRoute pintaba el loader en lugar
 *    del panel y se DESMONTABA todo (asistente de evento a medias, escáner…).
 *
 *  - Ahora los roles se cargan UNA vez por usuario (`user.id`). Los eventos
 *    del mismo usuario solo actualizan la sesión (manteniendo las mismas
 *    referencias si no cambió nada). Un cambio de usuario sí recarga, y
 *    nunca deja ver los roles del usuario anterior.
 *
 *  - `roleLoading` solo es true en la PRIMERA carga de roles de un usuario.
 *    `rolesLoaded` indica que ya se conocen; `roleError` que la primera
 *    carga falló (red/timeout) → ProtectedRoute ofrece "Reintentar" en vez de
 *    redirigir al usuario a un panel que no es el suyo.
 */

const ACTIVE_ROLE_KEY = 'pasify.activeRole';

const SUPER_ADMIN_ENV_ENABLED =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_ENABLE_SUPER_ADMIN_SWITCHER === 'true';

// Orden de privilegio (mayor → menor). Se usa para resolver effectiveRole
// cuando el usuario tiene varios roles (sólo super-admin en producción).
const ROLE_PRIORITY: Record<string, number> = {
  admin: 3,
  partner: 2,
  client: 1,
};

// Límite para leer la sesión y pedir los roles: una promesa colgada (bridge
// nativo de Capacitor, red móvil) no puede dejar la app en el loader para siempre.
const AUTH_TIMEOUT_MS = 10_000;

const dashboardPathFor = (role: string | null | undefined): string => {
  if (role === 'admin') return '/admin';
  if (role === 'partner') return '/partner-dashboard';
  return '/client-dashboard';
};

/**
 * Resuelve la ruta inicial post-login según el conjunto de roles del usuario.
 * Para super-admin (Francisco) respeta el último panel activo si se proporciona.
 * Para usuarios normales devuelve el dashboard correspondiente al rol más
 * privilegiado — nunca redirige a un panel que no tienen.
 */
export const resolveInitialDashboard = (
  roles: string[],
  opts?: { lastActivePath?: string | null; allowLastActive?: boolean },
): string => {
  if (!roles || roles.length === 0) return '/login';
  const sorted = [...roles].sort((a, b) => (ROLE_PRIORITY[b] ?? 0) - (ROLE_PRIORITY[a] ?? 0));
  const top = sorted[0];
  if (opts?.allowLastActive && opts.lastActivePath) {
    // Validamos que la ruta last-active corresponda a un rol que el usuario
    // realmente tiene; si no, fallback al top role.
    if (opts.lastActivePath === '/admin' && roles.includes('admin')) return '/admin';
    if (opts.lastActivePath === '/partner-dashboard' && roles.includes('partner')) return '/partner-dashboard';
    if (opts.lastActivePath === '/client-dashboard' && roles.includes('client')) return '/client-dashboard';
  }
  return dashboardPathFor(top);
};

const sortRolesByPrivilege = (roles: string[]): string[] =>
  [...roles].sort((a, b) => (ROLE_PRIORITY[b] ?? 0) - (ROLE_PRIORITY[a] ?? 0));

const readStoredRole = (): string | null => {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(ACTIVE_ROLE_KEY)
      : null;
  } catch {
    return null;
  }
};

const writeStoredRole = (role: string | null) => {
  try {
    if (typeof window === 'undefined') return;
    if (role) window.localStorage.setItem(ACTIVE_ROLE_KEY, role);
    else window.localStorage.removeItem(ACTIVE_ROLE_KEY);
  } catch {
    /* noop */
  }
};

/** Consulta de Supabase (thenable) con límite de tiempo. */
function conTimeout<T>(query: PromiseLike<T>, label: string): Promise<Awaited<T>> {
  return withTimeout(Promise.resolve(query), AUTH_TIMEOUT_MS, label);
}

interface RolesResult {
  /** Ordenados por privilegio (el primero es el efectivo). */
  roles: string[];
  isSuperAdmin: boolean;
}

interface RolesState extends RolesResult {
  /** Usuario al que pertenecen estos roles; null = no hay roles cargados. */
  userId: string | null;
}

const ROLES_VACIOS: RolesState = { userId: null, roles: [], isSuperAdmin: false };
// Referencia estable: `userRoles` va en dependencias de efectos (ProtectedRoute).
const SIN_ROLES: string[] = [];

const mismosRoles = (a: string[], b: string[]) =>
  a.length === b.length && a.every((r, i) => r === b[i]);

const mismoUsuario = (a: User | null, b: User | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.updated_at === b.updated_at);

const mismaSesion = (a: Session | null, b: Session | null) =>
  a === b || (!!a && !!b && a.access_token === b.access_token && mismoUsuario(a.user, b.user));

// Peticiones de roles en vuelo, compartidas entre instancias del hook: App,
// ProtectedRoute, PanelSwitcher, MobileTopBar… montan a la vez y cada una
// lanzaría las mismas dos RPC. Solo se comparte lo que está en vuelo; no hay
// caché de resultados.
const rolesEnVuelo = new Map<string, Promise<RolesResult>>();

const fetchRoles = (userId: string): Promise<RolesResult> => {
  const existente = rolesEnVuelo.get(userId);
  if (existente) return existente;

  const peticion = (async (): Promise<RolesResult> => {
    const [rolesRes, isSuperAdmin] = await Promise.all([
      conTimeout(supabase.rpc('get_user_roles', { _user_id: userId }), 'rpc get_user_roles'),
      // Flag super-admin (RPC de la migración 20260513120000). Si falla o no
      // existe todavía, degradamos a "no super-admin" → nadie ve el
      // PanelSwitcher. Comportamiento seguro.
      conTimeout(supabase.rpc('is_super_admin', { _user_id: userId }), 'rpc is_super_admin')
        .then(({ data, error }) => !error && Boolean(data))
        .catch(() => false),
    ]);
    if (rolesRes.error) throw rolesRes.error;
    return {
      roles: sortRolesByPrivilege((rolesRes.data as string[] | null) ?? []),
      isSuperAdmin,
    };
  })();

  rolesEnVuelo.set(userId, peticion);
  const limpiar = () => {
    if (rolesEnVuelo.get(userId) === peticion) rolesEnVuelo.delete(userId);
  };
  peticion.then(limpiar, limpiar);
  return peticion;
};

/**
 * Cierra la sesión SOLO en este dispositivo (`scope: 'local'`). El scope
 * global por defecto revoca los refresh tokens de todas las sesiones del
 * usuario: echaría al resto de dispositivos del local (p.ej. la tablet de
 * puerta) y rompe el multi-cuenta.
 *
 * Ojo: si no hay red, auth-js devuelve el error SIN borrar la sesión local.
 */
export const signOutLocal = async (): Promise<{ error: Error | null }> => {
  writeStoredRole(null);
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      console.error('[useAuth] signOut falló:', error);
      captureError(error, { where: 'signOutLocal' });
      return { error };
    }
    setSentryUser(null);
    return { error: null };
  } catch (err) {
    console.error('[useAuth] signOut falló:', err);
    captureError(err, { where: 'signOutLocal' });
    return { error: err instanceof Error ? err : new Error(getErrorMessage(err)) };
  }
};

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesState, setRolesState] = useState<RolesState>(ROLES_VACIOS);
  const [activeRole, setActiveRoleState] = useState<string | null>(null);
  const [roleErrorState, setRoleErrorState] = useState<{ userId: string; message: string } | null>(null);

  // Estado de control en refs (no provoca renders y el callback de auth lo
  // lee siempre actualizado).
  const mountedRef = useRef(true);
  // Usuario de la última sesión aplicada.
  const userIdRef = useRef<string | null>(null);
  // Espejo de `rolesState`: qué usuario tiene los roles ya cargados.
  const rolesRef = useRef<RolesState>(ROLES_VACIOS);
  // Carga de roles en curso en esta instancia (evita la doble llamada
  // INITIAL_SESSION + getSession, o SIGNED_IN + INITIAL_SESSION al arrancar).
  const cargaRolesRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const guardarRoles = useCallback((next: RolesState) => {
    const prev = rolesRef.current;
    if (
      prev.userId === next.userId &&
      prev.isSuperAdmin === next.isSuperAdmin &&
      mismosRoles(prev.roles, next.roles)
    ) {
      return; // mismos roles: conservamos referencias (sin renders ni efectos)
    }
    rolesRef.current = next;
    setRolesState(next);
  }, []);

  const aplicarRoles = useCallback(
    (userId: string, { roles, isSuperAdmin }: RolesResult) => {
      // Rol activo:
      //  - Super-admin (Francisco) con env flag: respeta localStorage si es
      //    válido, fallback al rol más privilegiado.
      //  - Usuario normal: ignora localStorage; siempre usa el rol más
      //    privilegiado de su set. Esto blinda el escenario en que un usuario
      //    tuviera basura en localStorage de sesiones anteriores.
      const canPersist = isSuperAdmin && SUPER_ADMIN_ENV_ENABLED && roles.length >= 2;
      const stored = readStoredRole();
      const candidate = canPersist && stored && roles.includes(stored) ? stored : roles[0] ?? null;

      // Limpia el localStorage del usuario normal: si tenía un rol guardado
      // que no corresponde a su rol real, lo borramos.
      if (!canPersist) {
        if (stored && stored !== candidate) writeStoredRole(null);
      } else if (candidate && candidate !== stored) {
        writeStoredRole(candidate);
      }

      guardarRoles({ userId, roles, isSuperAdmin });
      setActiveRoleState(candidate);
      setRoleErrorState(null);
      setSentryTag('role', roles[0] ?? null);
    },
    [guardarRoles],
  );

  const cargarRoles = useCallback(
    (userId: string): Promise<void> => {
      const enCurso = cargaRolesRef.current;
      if (enCurso && enCurso.userId === userId) return enCurso.promise;

      const carga = { userId, promise: Promise.resolve() };
      carga.promise = (async () => {
        try {
          const resultado = await fetchRoles(userId);
          // Respuesta obsoleta: el usuario cambió (o se desmontó) mientras tanto.
          if (!mountedRef.current || userIdRef.current !== userId) return;
          aplicarRoles(userId, resultado);
        } catch (err) {
          if (!mountedRef.current || userIdRef.current !== userId) return;
          if (rolesRef.current.userId === userId) {
            // Refresco en segundo plano: un fallo de red no borra los roles
            // que ya teníamos (antes dejaba userRoles=[] y ProtectedRoute
            // mandaba al partner al panel de cliente).
            console.warn('[useAuth] refresco de roles fallido; se mantienen los actuales:', getErrorMessage(err));
          } else {
            console.error('Error fetching user roles:', err);
            setRoleErrorState({ userId, message: getErrorMessage(err) });
            captureError(err, { where: 'useAuth.cargarRoles' });
          }
        } finally {
          if (cargaRolesRef.current === carga) cargaRolesRef.current = null;
        }
      })();
      cargaRolesRef.current = carga;
      return carga.promise;
    },
    [aplicarRoles],
  );

  /**
   * Aplica una sesión recibida de auth-js. Idempotente por `user.id`: se
   * puede llamar con cada evento sin efectos secundarios si nada cambió.
   */
  const aplicarSesion = useCallback(
    (event: AuthChangeEvent, nextSession: Session | null) => {
      const nextUser = nextSession?.user ?? null;
      const uid = nextUser?.id ?? null;
      const uidAnterior = userIdRef.current;
      userIdRef.current = uid;

      // Mismas referencias si no cambió nada relevante: el SIGNED_IN de volver
      // a la pestaña trae la misma sesión y no debe re-renderizar la app.
      setSession((prev) => (mismaSesion(prev, nextSession) ? prev : nextSession));
      setUser((prev) => (mismoUsuario(prev, nextUser) ? prev : nextUser));

      if (!uid) {
        cargaRolesRef.current = null;
        guardarRoles(ROLES_VACIOS);
        setActiveRoleState(null);
        setRoleErrorState(null);
        // Logout limpia el role activo persistido
        if (event === 'SIGNED_OUT') writeStoredRole(null);
        setSentryUser(null);
        setSentryTag('role', null);
        setLoading(false);
        return;
      }

      if (uid !== uidAnterior) setSentryUser(uid);

      // Diferido: llamar a Supabase dentro del callback de onAuthStateChange
      // puede bloquear el lock de auth-js (deadlock visto en iOS).
      const programarCarga = () =>
        setTimeout(() => {
          if (mountedRef.current) void cargarRoles(uid);
        }, 0);

      if (rolesRef.current.userId === uid) {
        // Roles ya cargados para este usuario: TOKEN_REFRESHED (~cada hora),
        // SIGNED_IN (cada vez que la pestaña vuelve a ser visible) o
        // USER_UPDATED no los recargan — refrescar el token no cambia los roles.
        // Única excepción: si no tenía ningún rol (p.ej. aún no lo había
        // reclamado), un SIGNED_IN reintenta en segundo plano, sin loader.
        if (event === 'SIGNED_IN' && rolesRef.current.roles.length === 0) programarCarga();
      } else {
        // Primera carga para este usuario (arranque, login o cambio de cuenta)
        // o reintento tras un fallo. Nunca dejamos los roles de otro usuario.
        if (rolesRef.current.userId !== null) {
          guardarRoles(ROLES_VACIOS);
          setActiveRoleState(null);
        }
        setRoleErrorState(null);
        programarCarga();
      }

      setLoading(false);
    },
    [cargarRoles, guardarRoles],
  );

  useEffect(() => {
    mountedRef.current = true;
    let vivo = true;
    let eventoRecibido = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      eventoRecibido = true;
      if (!vivo) return;
      console.log('Auth state changed:', event, nextSession?.user?.id);
      aplicarSesion(event, nextSession);
    });

    // Red de seguridad por si INITIAL_SESSION no llegara (lock de auth-js o
    // storage nativo colgados): leemos la sesión con límite de tiempo para no
    // dejar la app en el splash para siempre. Si ya llegó algún evento, este
    // resultado se ignora (podría ser más antiguo). Los roles no se piden dos
    // veces: aplicarSesion es idempotente por user.id.
    void (async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          'auth.getSession',
        );
        if (!vivo || eventoRecibido) return;
        if (error) {
          console.error('Error getting session:', error);
          setLoading(false);
          return;
        }
        aplicarSesion('INITIAL_SESSION', data.session);
      } catch (err) {
        if (!vivo) return;
        console.error('Error checking session:', err);
        captureError(err, { where: 'useAuth.getSession' });
        if (!eventoRecibido) setLoading(false);
      }
    })();

    return () => {
      vivo = false;
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [aplicarSesion]);

  // Super-admin: ProtectedRoute/PanelSwitcher cambian el rol activo en SU
  // instancia y lo anuncian con este evento; el resto de instancias se
  // sincronizan aquí (antes lo hacían de rebote al recargar roles en cada
  // SIGNED_IN).
  useEffect(() => {
    const onRoleChanged = (e: Event) => {
      const role = (e as CustomEvent<{ role?: string }>).detail?.role;
      const actuales = rolesRef.current;
      if (!role || actuales.userId === null || actuales.userId !== userIdRef.current) return;
      const canPersist = actuales.isSuperAdmin && SUPER_ADMIN_ENV_ENABLED && actuales.roles.length >= 2;
      if (!canPersist || !actuales.roles.includes(role)) return;
      setActiveRoleState((prev) => (prev === role ? prev : role));
    };
    window.addEventListener('pasify:role-changed', onRoleChanged);
    return () => window.removeEventListener('pasify:role-changed', onRoleChanged);
  }, []);

  // Derivados. Solo se exponen roles si pertenecen al usuario actual: durante
  // un cambio de cuenta nunca se ven (ni un render) los del anterior.
  const rolesLoaded = !!user && rolesState.userId === user.id;
  const userRoles = rolesLoaded ? rolesState.roles : SIN_ROLES;
  const isSuperAdminDev = rolesLoaded && rolesState.isSuperAdmin;
  const userRole = rolesLoaded ? activeRole : null;
  const roleError = user && roleErrorState?.userId === user.id ? roleErrorState.message : null;
  // true solo en la PRIMERA carga de roles del usuario (sin roles aún y sin
  // error). Los refrescos en segundo plano nunca la activan.
  const roleLoading = !!user && !rolesLoaded && !roleError;

  // Derivado: ¿puede este usuario cambiar de panel? Sólo super-admin con env on.
  const canSwitchPanels = isSuperAdminDev && SUPER_ADMIN_ENV_ENABLED && userRoles.length >= 2;

  // Rol más privilegiado (effectiveRole). `userRoles` ya viene ordenado por
  // privilegio. Para usuarios normales es igual a userRole. Para super-admin
  // es el "tope" de su set, independiente del userRole activo del switcher.
  const effectiveRole = userRoles.length > 0 ? userRoles[0] : null;

  /**
   * Cambia el role activo. Sólo permitido para super-admin con env flag.
   * Para cualquier otro usuario es un no-op (devuelve la ruta del rol efectivo).
   */
  const setActiveRole = useCallback(
    (role: string): string => {
      if (!canSwitchPanels) {
        if (import.meta.env.DEV) {
          console.warn(
            '[useAuth] setActiveRole bloqueado: usuario no es super-admin o env flag off.',
            { isSuperAdminDev, env: SUPER_ADMIN_ENV_ENABLED, userRoles },
          );
        }
        return dashboardPathFor(effectiveRole);
      }
      if (!userRoles.includes(role)) {
        console.warn(`[useAuth] setActiveRole('${role}') — role no disponible. Roles válidos:`, userRoles);
        return dashboardPathFor(userRole);
      }
      setActiveRoleState(role);
      writeStoredRole(role);
      try {
        window.dispatchEvent(new CustomEvent('pasify:role-changed', { detail: { role } }));
      } catch {
        /* noop */
      }
      return dashboardPathFor(role);
    },
    [canSwitchPanels, userRoles, userRole, effectiveRole, isSuperAdminDev],
  );

  /**
   * Reintenta cargar los roles (botón "Reintentar"). Si ya estaban cargados
   * es un refresco en segundo plano: no activa `roleLoading`.
   */
  const reloadRoles = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setRoleErrorState(null);
    await cargarRoles(uid);
  }, [cargarRoles]);

  const signOut = useCallback(() => signOutLocal(), []);

  return {
    user,
    session,
    loading,
    userRole,
    userRoles,
    effectiveRole,
    isSuperAdminDev,
    canSwitchPanels,
    setActiveRole,
    roleLoading,
    rolesLoaded,
    roleError,
    reloadRoles,
    signOut,
    isAuthenticated: !!user,
  };
};

export const dashboardPathForRole = dashboardPathFor;
