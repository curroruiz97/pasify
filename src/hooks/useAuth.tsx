import { useState, useEffect, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isSuperAdminDev, setIsSuperAdminDev] = useState(false);
  // `roleLoading` es true hasta que fetchUserRoles + is_super_admin hayan
  // completado para el usuario actual.
  const [roleLoading, setRoleLoading] = useState(false);

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

  const fetchUserRoles = useCallback(async (userId: string) => {
    setRoleLoading(true);
    try {
      // 1) Cargar roles
      const { data, error } = await supabase.rpc('get_user_roles', { _user_id: userId });
      if (error) {
        console.error('Error fetching user roles:', error);
        setUserRoles([]);
        setUserRole(null);
        setIsSuperAdminDev(false);
        return;
      }
      const rolesRaw = (data as string[] | null) ?? [];
      const roles = sortRolesByPrivilege(rolesRaw);
      setUserRoles(roles);

      // 2) Cargar flag super-admin (RPC añadida en migración 20260513120000).
      //    Si la RPC todavía no existe (rama feature sin DB migration aplicada),
      //    capturamos el error y degradamos a "no super-admin" → ningún usuario
      //    ve el PanelSwitcher, comportamiento seguro.
      let isSuperAdmin = false;
      try {
        const { data: sa, error: saErr } = await supabase.rpc('is_super_admin', {
          _user_id: userId,
        });
        if (!saErr) isSuperAdmin = Boolean(sa);
      } catch {
        // RPC no existe todavía: tratamos como no-super-admin. Safe default.
      }
      setIsSuperAdminDev(isSuperAdmin);

      // 3) Determinar role activo:
      //    - Super-admin (Francisco) con env flag: respeta localStorage si es
      //      válido, fallback al rol más privilegiado.
      //    - Usuario normal: ignora localStorage; siempre usa el rol más
      //      privilegiado de su set. Esto blinda el escenario en que un usuario
      //      tuviera basura en localStorage de sesiones anteriores.
      const canPersist = isSuperAdmin && SUPER_ADMIN_ENV_ENABLED && roles.length >= 2;
      const stored = readStoredRole();
      const candidate = canPersist && stored && roles.includes(stored) ? stored : roles[0] ?? null;
      setUserRole(candidate);

      // Limpia el localStorage del usuario normal: si tenía un rol guardado
      // que no corresponde a su rol real, lo borramos.
      if (!canPersist) {
        if (stored && stored !== candidate) writeStoredRole(null);
      } else if (candidate && candidate !== stored) {
        writeStoredRole(candidate);
      }
    } catch (error) {
      console.error('Error fetching user roles:', error);
      setUserRoles([]);
      setUserRole(null);
      setIsSuperAdminDev(false);
    } finally {
      setRoleLoading(false);
    }
  }, []);

  // Derivado: ¿puede este usuario cambiar de panel? Sólo super-admin con env on.
  const canSwitchPanels = isSuperAdminDev && SUPER_ADMIN_ENV_ENABLED && userRoles.length >= 2;

  // Rol más privilegiado (effectiveRole). Para usuarios normales es igual a
  // userRole. Para super-admin es el "tope" de su set, independiente del
  // userRole activo del switcher.
  const effectiveRole = userRoles.length > 0 ? sortRolesByPrivilege(userRoles)[0] : null;

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
      setUserRole(role);
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

  const logAccess = async (_userId: string) => {
    // Pasify: access_logs no existe en el schema actual. Re-introducir si se añade audit.
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.id);

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setRoleLoading(true);
          // Defer per evitare deadlock iOS
          setTimeout(() => {
            fetchUserRoles(session.user!.id);
            if (event === 'SIGNED_IN') {
              logAccess(session.user!.id);
            }
          }, 0);
        } else {
          setUserRoles([]);
          setUserRole(null);
          setIsSuperAdminDev(false);
          setRoleLoading(false);
          // Logout limpia el role activo persistido
          if (event === 'SIGNED_OUT') writeStoredRole(null);
        }

        setLoading(false);
      },
    );

    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('Error getting session:', error);
          setLoading(false);
          return;
        }

        console.log('Initial session:', session?.user?.id);

        if (session) {
          setSession(session);
          setUser(session.user);
          setRoleLoading(true);
          setTimeout(() => {
            fetchUserRoles(session.user.id);
          }, 0);
        }

        setLoading(false);
      } catch (error) {
        console.error('Error checking session:', error);
        setLoading(false);
      }
    };

    checkSession();

    return () => subscription.unsubscribe();
  }, [fetchUserRoles]);

  const signOut = async () => {
    writeStoredRole(null);
    await supabase.auth.signOut();
  };

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
    signOut,
    isAuthenticated: !!user,
  };
};

export const dashboardPathForRole = dashboardPathFor;
