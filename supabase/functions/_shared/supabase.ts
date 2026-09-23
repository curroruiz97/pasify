// Pasify · Supabase clients shared (admin + user-scoped)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./internal-auth.ts";
import { logger } from "./logger.ts";

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

/** Atajo: cliente con el JWT de esta petición (auth.uid() = quien llama). */
export function userClientFrom(req: Request): SupabaseClient {
  return supabaseAsUser(req.headers.get("Authorization"));
}

/**
 * Extrae el user_id del JWT en Authorization header (verificado vs supabase auth).
 * Lanza HttpError 401 si no hay user o el token no es válido.
 */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null; role?: string }> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new HttpError(401, "missing_authorization");
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "invalid_token");
  return { id: data.user.id, email: data.user.email ?? null, role: data.user.app_metadata?.role };
}

/** Resuelve el rol Pasify del user via tabla user_roles (admin/partner/client). */
export async function getUserRole(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  return data?.role ?? null;
}

/**
 * has_role(uid, rol) con un uid YA verificado (requireUser). Se pasa el uid
 * explícito, así que vale con el cliente admin. Si la RPC falla, false.
 */
export async function hasPlatformRole(userId: string, role: "admin" | "partner" | "client"): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: role });
  if (error) {
    logger.error("has_role_failed", { user_id: userId, role, error: error.message });
    return false;
  }
  return data === true;
}

export function isPlatformAdmin(userId: string): Promise<boolean> {
  return hasPlatformRole(userId, "admin");
}

/** Usuario autenticado con rol admin de plataforma. Si no: HttpError 401/403. */
export async function requireAdmin(req: Request): Promise<{ id: string; email: string | null; role?: string }> {
  const user = await requireUser(req);
  if (!(await isPlatformAdmin(user.id))) throw new HttpError(403, "forbidden");
  return user;
}

/**
 * has_org_role(org, roles) evaluado como el usuario que llama.
 * has_org_role / is_member_of_org usan auth.uid(): con el cliente admin
 * (service role) devuelven SIEMPRE false, por eso van con el JWT del usuario.
 */
export async function callerHasOrgRole(req: Request, orgId: string, roles: string[]): Promise<boolean> {
  const { data, error } = await userClientFrom(req).rpc("has_org_role", { _org_id: orgId, _roles: roles });
  if (error) {
    logger.error("has_org_role_failed", { org_id: orgId, error: error.message });
    return false;
  }
  return data === true;
}

/** is_member_of_org(org) evaluado como el usuario que llama (ver callerHasOrgRole). */
export async function callerIsOrgMember(req: Request, orgId: string): Promise<boolean> {
  const { data, error } = await userClientFrom(req).rpc("is_member_of_org", { _org_id: orgId });
  if (error) {
    logger.error("is_member_of_org_failed", { org_id: orgId, error: error.message });
    return false;
  }
  return data === true;
}

export { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY };
