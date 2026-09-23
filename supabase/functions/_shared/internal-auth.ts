// Pasify · Autorización de llamadas internas (servidor→servidor) + errores HTTP
//
// Por qué existe: `verify_jwt` (supabase/config.toml) NO basta para proteger las
// funciones que solo se invocan desde otro backend (dispatch-notification,
// send-sms, send-push, crons…). La anon key es pública y es un JWT válido, y
// cualquier usuario registrado tiene su propio JWT: los dos pasan el gateway.
// Estas funciones tienen que comprobar en código que quien llama es de confianza:
//
//   - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, comparado entero y en
//     tiempo constante. Antes se hacía `auth.includes(SERVICE_KEY)`, que con la
//     variable vacía dejaba pasar cualquier petición.
//   - `x-pasify-internal: <PASIFY_INTERNAL_SECRET>`, solo si ese secret existe
//     (≥ 32 caracteres). Pensado para pg_cron/pg_net u otros backends que no
//     deban manejar la service role. Ojo: con verify_jwt activo el gateway sigue
//     exigiendo un JWT válido en Authorization (vale la anon key).
//
// Este módulo no importa supabase.ts (supabase.ts importa HttpError de aquí).

import { errorResponse } from "./cors.ts";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RAW_INTERNAL_SECRET = Deno.env.get("PASIFY_INTERNAL_SECRET") ?? "";
// Un secret corto se podría adivinar: por debajo de 32 caracteres se ignora.
const INTERNAL_SECRET = RAW_INTERNAL_SECRET.length >= 32 ? RAW_INTERNAL_SECRET : "";
if (RAW_INTERNAL_SECRET && !INTERNAL_SECRET) {
  console.warn("[internal-auth] PASIFY_INTERNAL_SECRET ignorado: necesita al menos 32 caracteres");
}

/** Error con status HTTP y código estable, seguro de devolver al cliente. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Compara dos strings sin cortar en el primer byte distinto (tiempo constante). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

function bearerToken(req: Request): string | null {
  const auth = (req.headers.get("Authorization") ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : null;
}

/** true si la petición viene de un backend de confianza (service role o secret interno). */
export function isServiceRoleRequest(req: Request): boolean {
  const token = bearerToken(req);
  if (SERVICE_ROLE_KEY && token && timingSafeEqual(token, SERVICE_ROLE_KEY)) return true;
  const internal = req.headers.get("x-pasify-internal");
  if (INTERNAL_SECRET && internal && timingSafeEqual(internal.trim(), INTERNAL_SECRET)) return true;
  return false;
}

/** Lanza HttpError 401 si la petición no es servidor→servidor. */
export function requireServiceRole(req: Request): void {
  if (!isServiceRoleRequest(req)) throw new HttpError(401, "unauthorized");
}

/**
 * Status y código de un error "conocido" (HttpError, RateLimitError), o null si
 * es un error inesperado: esos mensajes (Stripe, Postgres, Auth) no salen al cliente.
 */
export function knownError(err: unknown): { status: number; code: string } | null {
  if (err instanceof HttpError) return { status: err.status, code: err.code };
  // RateLimitError (_shared/rate-limit.ts): su mensaje incluye la clave del
  // bucket (teléfono, user id), así que solo devolvemos el código.
  const e = err as { status?: unknown; code?: unknown } | null;
  if (e && e.status === 429 && e.code === "rate_limit_exceeded") {
    return { status: 429, code: "rate_limit_exceeded" };
  }
  return null;
}

/** Respuesta de error sin filtrar detalles internos: códigos conocidos tal cual, el resto 500. */
export function safeErrorResponse(err: unknown, fallbackCode = "internal_error"): Response {
  const known = knownError(err);
  if (known) return errorResponse(known.code, known.status, known.code);
  return errorResponse(fallbackCode, 500, fallbackCode);
}
