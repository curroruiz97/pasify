import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, dashboardPathForRole, signOutLocal } from '@/hooks/useAuth';
import LoaderOne from '@/components/ui/loader-one';
import AuthErrorScreen from '@/components/auth/AuthErrorScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireRole?: 'admin' | 'partner' | 'client';
}

// DEV-ONLY escape hatch: con VITE_DEV_PREVIEW=true en .env.local todas las
// ProtectedRoute renderizan los children sin requerir auth. Los datos saldrán
// vacíos porque las queries fallarán, pero el layout es visible.
const DEV_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_DEV_PREVIEW === 'true';

/**
 * Pasify ProtectedRoute · post Fase 1 hardening.
 *
 *  - Para usuarios normales: tienen UN SOLO rol enforced por RLS. Si intentan
 *    una ruta que no corresponde a su rol, redirigimos a su dashboard.
 *    Nunca cambiamos su rol activo automáticamente.
 *
 *  - Para super-admin/dev (Francisco con env flag): el auto-switch SÍ está
 *    habilitado. Si llega a un dashboard que tiene en su set pero no estaba
 *    como activo, lo activamos para que la UI lo refleje.
 *
 *  - Si el usuario no tiene el rol requerido bajo NINGUNA circunstancia,
 *    redirige al dashboard del rol efectivo (el más privilegiado).
 *
 * Estabilidad (Fase 0 del panel de local):
 *
 *  - El loader solo sale mientras todavía NO se conocen los roles del usuario
 *    (primera carga). Una vez concedido el acceso, los children se mantienen
 *    montados durante cualquier refresco de sesión/roles: antes, cada
 *    SIGNED_IN al volver a la pestaña o TOKEN_REFRESHED horario cambiaba el
 *    panel por el loader y lo desmontaba entero.
 *
 *  - Si la primera carga de roles falla (red/timeout) NO redirigimos a
 *    ciegas (antes mandaba al partner al panel de cliente): se muestra
 *    "Reintentar".
 */
const ProtectedRoute = ({ children, requireRole }: ProtectedRouteProps) => {
  const {
    user,
    loading,
    userRole,
    userRoles,
    effectiveRole,
    canSwitchPanels,
    setActiveRole,
    rolesLoaded,
    roleError,
    reloadRoles,
  } = useAuth();
  const navigate = useNavigate();

  // Usuario al que ya se le concedió esta ruta. Mientras sea el mismo, los
  // children siguen montados aunque los roles se estén recargando.
  const concedidoARef = useRef<string | null>(null);

  // ¿Tiene acceso? Solo significativo cuando `rolesLoaded`.
  // Super-admin: basta con tener el rol en su set. Usuario normal: el rol
  // efectivo (= único rol) debe coincidir con requireRole.
  const tieneAcceso =
    !requireRole ||
    (rolesLoaded && (canSwitchPanels ? userRoles.includes(requireRole) : effectiveRole === requireRole));

  useEffect(() => {
    if (DEV_PREVIEW) return;
    if (loading) return;
    if (!user) {
      concedidoARef.current = null;
      navigate('/login', { replace: true });
      return;
    }
    if (!requireRole) return; // ruta protegida sin rol específico
    // Roles aún desconocidos (primera carga o error): no se decide nada.
    if (!rolesLoaded) return;

    if (tieneAcceso) {
      concedidoARef.current = user.id;
    } else {
      concedidoARef.current = null;
    }

    // 1) Super-admin: comportamiento legacy (auto-switch al rol pedido si está
    //    en su set; redirige si no lo tiene).
    if (canSwitchPanels) {
      if (userRoles.includes(requireRole)) {
        if (userRole !== requireRole) {
          setActiveRole(requireRole);
        }
        return;
      }
      const target = dashboardPathForRole(effectiveRole);
      navigate(target ?? '/login', { replace: true });
      return;
    }

    // 2) Usuario normal: el rol efectivo (= único rol) DEBE coincidir con
    //    requireRole para entrar. Cualquier desajuste → redirect a su
    //    dashboard. No auto-switcheamos, no leemos localStorage.
    if (effectiveRole === requireRole) {
      return;
    }

    const target = dashboardPathForRole(effectiveRole);
    if (target) {
      navigate(target, { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  }, [
    user,
    loading,
    userRole,
    userRoles,
    effectiveRole,
    canSwitchPanels,
    rolesLoaded,
    tieneAcceso,
    requireRole,
    navigate,
    setActiveRole,
  ]);

  if (DEV_PREVIEW) {
    return <>{children}</>;
  }

  if (loading) {
    return <LoaderOne />;
  }

  if (!user) return null;

  if (!requireRole) return <>{children}</>;

  if (!rolesLoaded) {
    // Refresco de un usuario que ya tenía acceso: no se desmonta nada.
    if (concedidoARef.current === user.id) return <>{children}</>;
    if (roleError) {
      return (
        <AuthErrorScreen
          title="No pudimos cargar tu cuenta"
          description="Parece un problema de conexión. Comprueba que tienes internet y vuelve a intentarlo."
          detail={roleError}
          onRetry={reloadRoles}
          onSignOut={async () => {
            await signOutLocal();
            navigate('/login', { replace: true });
          }}
        />
      );
    }
    return <LoaderOne />;
  }

  // Render guard final: si el usuario es super-admin y tiene el rol, se renderiza.
  // Si es usuario normal, sólo se renderiza si effectiveRole === requireRole.
  if (!tieneAcceso) return null;

  return <>{children}</>;
};

export default ProtectedRoute;
