import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import LoaderOne from '@/components/ui/loader-one';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireRole?: 'admin' | 'partner' | 'client';
}

// DEV-ONLY escape hatch: con VITE_DEV_PREVIEW=true in .env.local (solo dev
// build, mai in produzione), tutte le ProtectedRoute renderizzano i children
// senza richiedere autenticazione. Serve a poter editare visivamente le
// dashboard quando manca la Supabase anon key. I dati saranno vuoti perché
// le query falliranno, ma il layout è visibile.
const DEV_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_DEV_PREVIEW === 'true';

const ProtectedRoute = ({ children, requireRole }: ProtectedRouteProps) => {
  const { user, loading, userRole, roleLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (DEV_PREVIEW) return; // dev preview: nessun redirect
    // Niente redirect finché la sessione o il role stanno ancora caricando
    if (loading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    // Aspetta che il role sia stato determinato
    if (roleLoading) return;

    if (requireRole && userRole !== requireRole) {
      if (userRole === 'admin') {
        navigate('/admin', { replace: true });
      } else if (userRole === 'partner') {
        navigate('/partner-dashboard', { replace: true });
      } else if (userRole === 'client') {
        navigate('/client-dashboard', { replace: true });
      } else {
        // User autenticato ma NESSUN ruolo: probabilmente race con il flow di
        // signup (il ruolo verrà visibile a momenti). Rimandiamo al login così
        // useAuth si reidrata; Login.tsx farà fallback a client se serve.
        navigate('/login', { replace: true });
      }
    }
  }, [user, loading, userRole, roleLoading, requireRole, navigate]);

  if (DEV_PREVIEW) {
    return <>{children}</>;
  }

  // Attendi sia la fine del loading auth che il caricamento del ruolo (se serve)
  if (loading || (user && requireRole && roleLoading)) {
    return <LoaderOne />;
  }

  if (!user || (requireRole && userRole !== requireRole)) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
