// Pasify · Cliente mínimo de OpenAI (REST, sin SDK)
//
// Lo usan ai-concierge-reply (chat completions) y moderate-content
// (moderations). Un fetch con tiempo máximo, un reintento ante fallos
// transitorios y errores con código estable que la función devuelve tal cual:
//
//   503 ai_unavailable     falta OPENAI_API_KEY, la clave no vale o no hay cuota
//   502 ai_upstream_error  OpenAI no contesta bien (timeout, 5xx, respuesta rara)
//
// Secrets (Edge Functions → Secrets):
//   OPENAI_API_KEY          obligatoria; sin ella todo responde 503
//   OPENAI_MODEL_DEFAULT    opcional, modelo de chat (por defecto gpt-4o-mini)
//   OPENAI_MODERATION_MODEL opcional (por defecto omni-moderation-latest)
//
// Lo que se envía a OpenAI NO se escribe en los logs: solo estado y código de
// error. Los secrets se leen en cada llamada, no al arrancar.

import { HttpError } from "./internal-auth.ts";
import { logger } from "./logger.ts";

const OPENAI_BASE = "https://api.openai.com/v1";
const RETRY_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function apiKey(): string {
  return (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
}

/** true si hay clave configurada (no comprueba que sea válida). */
export function openaiConfigured(): boolean {
  return apiKey().length > 0;
}

export function chatModel(): string {
  return (Deno.env.get("OPENAI_MODEL_DEFAULT") ?? "").trim() || "gpt-4o-mini";
}

export function moderationModel(): string {
  return (Deno.env.get("OPENAI_MODERATION_MODEL") ?? "").trim() || "omni-moderation-latest";
}

interface PostOptions {
  timeoutMs: number;
  /** Intentos totales (1 = sin reintento). */
  attempts: number;
}

/** Estado y código del error de OpenAI, sin el mensaje (puede llevar trozos de la clave o del texto). */
async function describeError(res: Response): Promise<{ status: number; type?: string; code?: string; message?: string }> {
  const info: { status: number; type?: string; code?: string; message?: string } = { status: res.status };
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { type?: unknown; code?: unknown; message?: unknown } };
    if (typeof parsed.error?.type === "string") info.type = parsed.error.type;
    if (typeof parsed.error?.code === "string") info.code = parsed.error.code;
    // En un 400 el mensaje dice qué parámetro no vale para el modelo: es lo único que ayuda a depurar.
    if (res.status === 400 && typeof parsed.error?.message === "string") info.message = parsed.error.message.slice(0, 160);
  } catch {
    // cuerpo que no es JSON: solo el estado
  }
  return info;
}

async function openaiPost(path: string, body: unknown, opts: PostOptions): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new HttpError(503, "ai_unavailable");

  let lastStatus = 0;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS);

    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE}${path}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      // Red caída o timeout: transitorio.
      lastStatus = 0;
      logger.warn("openai_request_failed", { path, attempt, error: err instanceof Error ? err.name : "unknown" });
      continue;
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        logger.error("openai_bad_json", { path });
        throw new HttpError(502, "ai_upstream_error");
      }
    }

    const info = await describeError(res);
    lastStatus = res.status;
    // Clave incorrecta, sin permisos o sin saldo: no se arregla reintentando.
    if (res.status === 401 || res.status === 403 || (res.status === 429 && info.code === "insufficient_quota")) {
      logger.error("openai_unavailable", { path, ...info });
      throw new HttpError(503, "ai_unavailable");
    }
    if (res.status === 429 || res.status >= 500) {
      logger.warn("openai_transient_error", { path, attempt, ...info });
      continue;
    }
    // Resto de 4xx: la petición no vale para este modelo. Reintentar daría lo mismo.
    logger.error("openai_rejected", { path, ...info });
    throw new HttpError(502, "ai_upstream_error");
  }

  // Sin cuota en este momento (límite de ritmo) se parece más a «no disponible» que a «roto».
  if (lastStatus === 429) throw new HttpError(503, "ai_unavailable");
  throw new HttpError(502, "ai_upstream_error");
}

// ---------------------------------------------------------------- chat

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatJsonOptions {
  messages: ChatMessage[];
  /** Tope de tokens de la respuesta. */
  maxTokens: number;
  temperature?: number;
  /** Por intento. Por defecto 20 s. */
  timeoutMs?: number;
}

export interface ChatJsonResult {
  content: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  /** "stop" si terminó; "length" si se cortó por maxTokens (el JSON puede estar incompleto). */
  finishReason: string | null;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Chat completion que responde un objeto JSON (response_format json_object).
 * OpenAI exige que los mensajes mencionen la palabra «JSON»: el prompt de quien
 * llama debe pedir el formato. Devuelve el texto tal cual: validarlo es cosa
 * de quien llama.
 */
export async function chatJson(opts: ChatJsonOptions): Promise<ChatJsonResult> {
  const model = chatModel();
  const started = Date.now();
  const json = await openaiPost("/chat/completions", {
    model,
    messages: opts.messages,
    response_format: { type: "json_object" },
    max_completion_tokens: opts.maxTokens,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  }, { timeoutMs: opts.timeoutMs ?? 20_000, attempts: 2 }) as ChatCompletionResponse;

  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string") {
    logger.error("openai_chat_no_content", { finish_reason: choice?.finish_reason ?? null });
    throw new HttpError(502, "ai_upstream_error");
  }
  return {
    content,
    model: json.model ?? model,
    latencyMs: Date.now() - started,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    finishReason: choice?.finish_reason ?? null,
  };
}

// ---------------------------------------------------------------- moderación

export interface ModerationVerdict {
  /** El veredicto de OpenAI: true si el texto incumple alguna categoría. */
  flagged: boolean;
  /** Categorías marcadas (hate, harassment, sexual, violence, self-harm, illicit…). */
  categories: string[];
  /** Puntuación (0-1) de las categorías marcadas. */
  scores: Record<string, number>;
  model: string;
  latencyMs: number;
}

interface ModerationResponse {
  model?: string;
  results?: Array<{
    flagged?: unknown;
    categories?: Record<string, unknown>;
    category_scores?: Record<string, unknown>;
  }>;
}

/** Clasifica un texto con el endpoint de moderación de OpenAI. */
export async function moderateText(input: string, opts: { timeoutMs?: number } = {}): Promise<ModerationVerdict> {
  const model = moderationModel();
  const started = Date.now();
  const json = await openaiPost("/moderations", { model, input }, {
    timeoutMs: opts.timeoutMs ?? 5_000,
    attempts: 2,
  }) as ModerationResponse;

  const result = json.results?.[0];
  if (!result || typeof result.flagged !== "boolean" || typeof result.categories !== "object" || result.categories === null) {
    logger.error("openai_moderation_bad_shape", {});
    throw new HttpError(502, "ai_upstream_error");
  }
  const categories = Object.entries(result.categories).filter(([, v]) => v === true).map(([k]) => k);
  const scores: Record<string, number> = {};
  for (const c of categories) {
    const s = result.category_scores?.[c];
    if (typeof s === "number" && Number.isFinite(s)) scores[c] = Number(s.toFixed(4));
  }
  return { flagged: result.flagged, categories, scores, model: json.model ?? model, latencyMs: Date.now() - started };
}
