import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, dashboardPathForRole } from '@/hooks/useAuth';
import LoaderOne from '@/components/ui/loader-one';

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
    roleLoading,
  } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (DEV_PREVIEW) return;
    if (loading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    if (roleLoading) return;

    if (!requireRole) return; // ruta protegida sin rol específico

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
    roleLoading,
    requireRole,
    navigate,
    setActiveRole,
  ]);

  if (DEV_PREVIEW) {
    return <>{children}</>;
  }

  if (loading || (user && requireRole && roleLoading)) {
    return <LoaderOne />;
  }

  if (!user) return null;

  // Render guard final: si el usuario es super-admin y tiene el rol, se renderiza.
  // Si es usuario normal, sólo se renderiza si effectiveRole === requireRole.
  if (requireRole) {
    if (canSwitchPanels) {
      if (!userRoles.includes(requireRole)) return null;
    } else {
      if (effectiveRole !== requireRole) return null;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
