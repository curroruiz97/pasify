import { useState, useEffect, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Pasify multi-role auth hook.
 *
 * Un usuario puede tener varios roles (ej. el admin de demo tiene admin+partner+client
 * para poder probar los tres dashboards). Para soportarlo expone:
 *  - `userRoles`    → text[] con todos los roles ordenados por privilegio
 *                     (admin > partner > client) desde el RPC `get_user_roles`.
 *  - `userRole`     → el role ACTIVO (uno solo). Se persiste en localStorage como
 *                     `pasify.activeRole`. Si el valor guardado no está entre
 *                     los roles válidos del usuario, fallback al primero
 *                     (= mayor privilegio).
 *  - `setActiveRole(role)` → cambia el role activo + persiste + emite evento
 *                            `pasify:role-changed`. La UI (PanelSwitcher) lo usa
 *                            para navegar al dashboard adecuado.
 *
 * Compatibilidad con código existente: `userRole` sigue siendo un string,
 * ProtectedRoute no necesita cambios.
 */

const ACTIVE_ROLE_KEY = 'pasify.activeRole';

const dashboardPathFor = (role: string | null | undefined): string => {
  if (role === 'admin') return '/admin';
  if (role === 'partner') return '/partner-dashboard';
  return '/client-dashboard';
};

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  // `roleLoading` es true hasta que fetchUserRoles haya completado para el usuario actual.
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
      const { data, error } = await supabase.rpc('get_user_roles', { _user_id: userId });
      if (error) {
        console.error('Error fetching user roles:', error);
        setUserRoles([]);
        setUserRole(null);
        return;
      }
      const roles = (data as string[] | null) ?? [];
      setUserRoles(roles);

      // Determinar role activo: localStorage > primary (más privilegio) > null
      const stored = readStoredRole();
      const active = stored && roles.includes(stored) ? stored : roles[0] ?? null;
      setUserRole(active);
      if (active && active !== stored) writeStoredRole(active);
    } catch (error) {
      console.error('Error fetching user roles:', error);
      setUserRoles([]);
      setUserRole(null);
    } finally {
      setRoleLoading(false);
    }
  }, []);

  /** Cambia el role activo. Devuelve la ruta del dashboard correspondiente. */
  const setActiveRole = useCallback((role: string): string => {
    if (!userRoles.includes(role)) {
      console.warn(`[useAuth] setActiveRole('${role}') — role no disponible. Roles válidos:`, userRoles);
      return dashboardPathFor(userRole);
    }
    setUserRole(role);
    writeStoredRole(role);
    try {
      window.dispatchEvent(new CustomEvent('pasify:role-changed', { detail: { role } }));
    } catch { /* noop */ }
    return dashboardPathFor(role);
  }, [userRoles, userRole]);

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
          setRoleLoading(false);
          // Logout limpia el role activo persistido
          if (event === 'SIGNED_OUT') writeStoredRole(null);
        }

        setLoading(false);
      }
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
          setTimeout(() => { fetchUserRoles(session.user.id); }, 0);
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
    setActiveRole,
    roleLoading,
    signOut,
    isAuthenticated: !!user,
  };
};

export const dashboardPathForRole = dashboardPathFor;
