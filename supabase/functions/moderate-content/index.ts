// Pasify · moderate-content (a demanda, desde la app o desde otro backend)
//
// Clasifica un texto con la API de moderación de OpenAI (omni-moderation) y
// dice si incumple alguna categoría (odio, acoso, sexual, violencia,
// autolesión, ilícito…). No bloquea nada por sí misma: devuelve el veredicto y
// la app decide qué hacer con él.
//
// Entrada:  POST { "text": "…" }          hasta 10.000 caracteres
//           + opcional { "record": { "target_kind": "event", "target_id": "<uuid>" } }
//             Solo servicio o admin: si el texto está marcado, deja una fila abierta
//             en moderation_flags (reporter_id nulo, sin el texto) para revisión.
//
// Salida 200: { approved, flagged, categories, scores, checked, model, latency_ms }
//   approved = !flagged. categories: las marcadas; scores: su puntuación 0-1.
//   checked = false solo con un texto vacío (no se llama a OpenAI).
//
// Contrato de errores — lo importante para el cliente:
//   · 502 / 503  «no se pudo comprobar». DECISIÓN DE PRODUCTO: el contenido pasa y
//                no se enseña ningún error a la persona. Es lo que se devuelve si
//                falta OPENAI_API_KEY o no hay cuota (503 ai_unavailable), si el
//                interruptor «moderation» está parado (503 capability_killed),
//                si OpenAI falla o tarda (502 ai_upstream_error) y ante cualquier
//                fallo inesperado de la propia función (502 moderation_failed).
//   · 400 / 401 / 403 / 413 / 429  error de quien llama (texto no válido, sin sesión,
//                sin permiso para `record`, demasiado largo, demasiadas
//                comprobaciones). No son «no se pudo comprobar».
//
// Autorización: sesión de cualquier usuario (JWT) con 30 comprobaciones por minuto,
// o servicio (service role / x-pasify-internal) sin límite. Moderar es gratis en
// OpenAI, pero no es un servicio público: sin sesión, 401.
//
// Privacidad: el texto va a OpenAI tal cual (es lo que la persona va a publicar)
// y NO se escribe en los logs ni en la base de datos.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { HttpError, isServiceRoleRequest, knownError, safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { moderateText, openaiConfigured, type ModerationVerdict } from "../_shared/openai.ts";

const CAPABILITY = "moderation";
export const MAX_TEXT_CHARS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_KIND_RE = /^[a-z][a-z0-9_]{0,39}$/;

export interface ModerationRequest {
  text: string;
  record: { targetKind: string; targetId: string } | null;
}

/** Valida el cuerpo. Lanza HttpError 400 / 413. */
export function parseRequest(raw: unknown): ModerationRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "invalid_json");
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string") throw new HttpError(400, "invalid_text");
  if (o.text.length > MAX_TEXT_CHARS) throw new HttpError(413, "text_too_long");

  let record: ModerationRequest["record"] = null;
  if (o.record !== undefined && o.record !== null) {
    const r = o.record as Record<string, unknown>;
    if (
      typeof r !== "object" || Array.isArray(r) ||
      typeof r.target_kind !== "string" || !TARGET_KIND_RE.test(r.target_kind) ||
      typeof r.target_id !== "string" || !UUID_RE.test(r.target_id)
    ) {
      throw new HttpError(400, "invalid_record");
    }
    record = { targetKind: r.target_kind, targetId: r.target_id.toLowerCase() };
  }
  return { text: o.text, record };
}

/** Deja una fila abierta en moderation_flags, salvo que ya haya una automática abierta para ese destino. */
async function recordFlag(record: NonNullable<ModerationRequest["record"]>, verdict: ModerationVerdict): Promise<void> {
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("moderation_flags")
    .select("id")
    .eq("target_kind", record.targetKind)
    .eq("target_id", record.targetId)
    .is("reporter_id", null)
    .in("status", ["open", "investigating"])
    .limit(1);
  if (lookupErr) throw new Error(`moderation_flags lookup: ${lookupErr.message}`);
  if (existing && existing.length > 0) return;

  const scores = verdict.categories.map((c) => `${c}=${verdict.scores[c] ?? "?"}`).join(" ");
  const { error } = await supabaseAdmin.from("moderation_flags").insert({
    reporter_id: null,
    target_kind: record.targetKind,
    target_id: record.targetId,
    reason: `auto: ${verdict.categories.join(", ")}`.slice(0, 5000),
    details: `${verdict.model} · ${scores}`.slice(0, 5000),
  });
  if (error) throw new Error(`moderation_flags insert: ${error.message}`);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405, "method_not_allowed");

    const trusted = isServiceRoleRequest(req);
    const user = trusted ? null : await requireUser(req);
    if (user) await enforceRateLimit({ key: `moderate:user:${user.id}`, max: 30, windowSec: 60 });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new HttpError(400, "invalid_json");
    }
    const { text, record } = parseRequest(raw);

    // Dejar marcas para revisión no es cosa de cualquier usuario: con un destino a
    // elección podría llenar la cola de moderación.
    if (record && !trusted && !(await isPlatformAdmin(user!.id))) throw new HttpError(403, "record_not_allowed");

    // Nada que comprobar: no se gasta una llamada.
    if (text.trim() === "") {
      return jsonResponse({ approved: true, flagged: false, categories: [], scores: {}, checked: false });
    }

    if (!openaiConfigured()) throw new HttpError(503, "ai_unavailable");

    // Si no se puede leer el interruptor no se sigue («no se pudo comprobar»).
    const { data: killSwitch, error: killSwitchErr } = await supabaseAdmin
      .from("ai_kill_switches")
      .select("killed")
      .eq("capability_code", CAPABILITY)
      .maybeSingle();
    if (killSwitchErr) throw new Error(`ai_kill_switches: ${killSwitchErr.message}`);
    if (killSwitch?.killed) throw new HttpError(503, "capability_killed");

    const verdict = await moderateText(text);

    if (verdict.flagged && record) {
      // El veredicto ya está: si la marca no se guarda, se registra y se responde igual.
      try {
        await recordFlag(record, verdict);
      } catch (err) {
        logger.error("moderation_flag_record_failed", { error: String(err) });
      }
    }

    logger.info("moderation_checked", {
      user_id: user?.id,
      flagged: verdict.flagged,
      categories: verdict.categories,
      latency_ms: verdict.latencyMs,
      recorded: Boolean(verdict.flagged && record),
    });
    return jsonResponse({
      approved: !verdict.flagged,
      flagged: verdict.flagged,
      categories: verdict.categories,
      scores: verdict.scores,
      checked: true,
      model: verdict.model,
      latency_ms: verdict.latencyMs,
    });
  } catch (err) {
    logger.error("moderate-content failed", { error: err instanceof HttpError ? err.code : String(err) });
    // Lo conocido (sesión, formato, 502/503 de OpenAI, límite) sale con su código. Lo inesperado
    // también es «no se pudo comprobar»: 502 para que el cliente deje pasar el contenido.
    if (knownError(err)) return safeErrorResponse(err);
    return errorResponse("moderation_failed", 502, "moderation_failed");
  }
});
