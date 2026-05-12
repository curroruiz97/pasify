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

const ProtectedRoute = ({ children, requireRole }: ProtectedRouteProps) => {
  const { user, loading, userRole, userRoles, setActiveRole, roleLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (DEV_PREVIEW) return;
    if (loading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    if (roleLoading) return;

    if (requireRole) {
      // Multi-role: si el usuario TIENE el role requerido (aunque no sea el activo),
      // permitimos el acceso y lo ponemos como activo. Solo redirigimos si NO lo
      // tiene en su set de roles.
      if (userRoles.includes(requireRole)) {
        if (userRole !== requireRole) {
          // Auto-switch: el usuario llegó a un dashboard que sí puede usar pero
          // que no estaba como activo. Lo activamos para que la UI lo refleje
          // (badge en PanelSwitcher, etc.).
          setActiveRole(requireRole);
        }
        return;
      }

      // No tiene el role → redirige al dashboard de su role activo (o primario)
      const target = dashboardPathForRole(userRole);
      if (target) {
        navigate(target, { replace: true });
      } else {
        // Sin roles → al login para re-hidratar (useAuth se encarga del fallback)
        navigate('/login', { replace: true });
      }
    }
  }, [user, loading, userRole, userRoles, roleLoading, requireRole, navigate, setActiveRole]);

  if (DEV_PREVIEW) {
    return <>{children}</>;
  }

  if (loading || (user && requireRole && roleLoading)) {
    return <LoaderOne />;
  }

  if (!user) return null;
  if (requireRole && !userRoles.includes(requireRole)) return null;

  return <>{children}</>;
};

export default ProtectedRoute;
