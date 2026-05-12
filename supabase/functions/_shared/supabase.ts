// Pasify · Supabase clients shared (admin + user-scoped)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * Cliente admin (service role). Bypassa RLS. Solo dentro de edge functions trusted.
 * NUNCA exponer service_role al cliente.
 */
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Cliente con el JWT del usuario que invocó la función — respeta RLS.
 * Útil para operaciones que deben verificar permisos.
 */
export function supabaseAsUser(authHeader: string | null): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

/**
 * Extrae el user_id del JWT en Authorization header (verificado vs supabase auth).
 * Lanza si no hay user o token inválido.
 */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null; role?: string }> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("missing_authorization");
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Error("invalid_token");
  return { id: data.user.id, email: data.user.email ?? null, role: data.user.app_metadata?.role };
}

/** Resuelve el rol Pasify del user via tabla user_roles (admin/partner/client). */
export async function getUserRole(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  return data?.role ?? null;
}

export { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY };
