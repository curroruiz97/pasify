// Pasify · ai-concierge-reply
// Sugiere una respuesta automática a un mensaje de soporte usando OpenAI.
// Loggea en ai_audit_log y ai_decisions.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { chatComplete } from "../_shared/openai.ts";
import { logger } from "../_shared/logger.ts";

const SYSTEM_PROMPT = `Eres un agente de soporte de Pasify, plataforma SaaS de eventos y ticketing en España.

Tu rol: redactar respuestas profesionales, cálidas, breves (máximo 4 frases) y útiles a consultas de clientes. Tono: cercano pero profesional, en español de España, sin emojis. Si no estás seguro, di que un humano lo revisará y escalas.

Áreas en las que SÍ puedes responder con seguridad:
- Cómo comprar/transferir tickets, dónde están en la app, cómo escanear QR
- Cómo funciona el modo evento, cashless NFC, Pasify Points
- Cómo pedir refund (T-7d auto-aprobado), cómo cambiar email/contraseña
- Cómo activar 2FA, cómo descargar datos GDPR
- Información pública sobre eventos publicados, horarios, dress code

NO respondas (escala a humano) sobre:
- Pagos puntuales del cliente, datos de tarjeta, identificación, datos personales
- Reembolsos discrecionales, casos legales, complaints
- Información comercial sensible de partners

Devuelve JSON: { "reply": string, "confidence": 0..1, "escalate": boolean, "category": string }`;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { conversation_id, message } = await req.json();
    if (!conversation_id || !message) return errorResponse("invalid_payload", 400);

    // Kill-switch check
    const { data: killSwitch } = await supabaseAdmin.from("ai_kill_switches").select("killed").eq("capability_code", "concierge").maybeSingle();
    if (killSwitch?.killed) return errorResponse("capability_killed", 503);

    // Verificar permisos: admin o partner de la conversación
    const { data: conv } = await supabaseAdmin
      .from("support_conversations")
      .select("kind, client_id, partner_id, org_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) return errorResponse("conversation_not_found", 404);

    // Solo admins responden a client_admin; partners a client_partner; ambos a partner_admin
    const isAdmin = (await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" })).data;
    const isPartner = conv.partner_id === user.id;
    if (!isAdmin && !isPartner) return errorResponse("forbidden", 403);

    // Cargar últimos 10 mensajes para contexto
    const { data: history } = await supabaseAdmin
      .from("support_messages")
      .select("sender_kind, body, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...(history ?? []).reverse().map((m) => ({
        role: m.sender_kind === "client" ? ("user" as const) : ("assistant" as const),
        content: m.body,
      })),
      { role: "user" as const, content: message },
    ];

    const result = await chatComplete({
      messages,
      jsonMode: true,
      temperature: 0.4,
      maxTokens: 400,
      capability: "concierge",
    });

    // Parse response
    let parsed: { reply: string; confidence: number; escalate: boolean; category?: string } = {
      reply: "",
      confidence: 0,
      escalate: true,
    };
    try {
      parsed = JSON.parse(result.content);
    } catch (e) {
      logger.warn("openai_concierge_invalid_json", { content: result.content });
      parsed = { reply: result.content.slice(0, 500), confidence: 0.3, escalate: true };
    }

    // Audit log
    await supabaseAdmin.from("ai_audit_log").insert({
      capability_code: "concierge",
      org_id: conv.org_id,
      action_summary: `concierge_reply confidence=${parsed.confidence}`,
      result: parsed.escalate ? "escalated" : "ok",
      model_version: result.model,
      latency_ms: result.latency_ms,
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
    });

    return jsonResponse({
      reply: parsed.reply,
      confidence: parsed.confidence,
      escalate: parsed.escalate,
      category: parsed.category,
      model: result.model,
      latency_ms: result.latency_ms,
    });
  } catch (err) {
    logger.error("ai-concierge-reply failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
