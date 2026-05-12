import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  // `roleLoading` è true finché fetchUserRole non ha terminato per l'utente corrente.
  // Indipendente da `loading` così la UI può renderizzare senza aspettare la RPC.
  const [roleLoading, setRoleLoading] = useState(false);

  const fetchUserRole = async (userId: string) => {
    setRoleLoading(true);
    try {
      const { data: rpcRole, error: rpcError } = await supabase
        .rpc('get_user_role', { _user_id: userId });
      if (rpcError) {
        console.error('Error fetching user role:', rpcError);
        setUserRole(null);
        return;
      }
      setUserRole((rpcRole as string) || null);
    } catch (error) {
      console.error('Error fetching user role:', error);
      setUserRole(null);
    } finally {
      setRoleLoading(false);
    }
  };

  const logAccess = async (_userId: string) => {
    // Pasify: access_logs table non esiste, no-op. Reintrodurre quando serve audit.
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.id);

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Defer async per evitare deadlock iOS, ma aggiorna roleLoading.
          setRoleLoading(true);
          setTimeout(() => {
            fetchUserRole(session.user!.id);
            if (event === 'SIGNED_IN') {
              logAccess(session.user!.id);
            }
          }, 0);
        } else {
          setUserRole(null);
          setRoleLoading(false);
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
          setTimeout(() => { fetchUserRole(session.user.id); }, 0);
        }

        setLoading(false);
      } catch (error) {
        console.error('Error checking session:', error);
        setLoading(false);
      }
    };

    checkSession();

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    user,
    session,
    loading,
    userRole,
    roleLoading,
    signOut,
    isAuthenticated: !!user,
  };
};
