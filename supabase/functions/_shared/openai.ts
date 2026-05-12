// Pasify · OpenAI client compartido para AI features (concierge, marketing copy, etc.)
import { logger } from "./logger.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL_DEFAULT = Deno.env.get("OPENAI_MODEL_DEFAULT") ?? "gpt-4o-mini";

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatOptions {
  model?: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Para audit_log: identificador de la capability invocando. */
  capability?: string;
}

export interface OpenAIChatResponse {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
  latency_ms: number;
}

/**
 * Chat completion vía OpenAI Chat Completions API.
 * Si OPENAI_API_KEY no está configurada, devuelve un stub útil para dev.
 */
export async function chatComplete(opts: OpenAIChatOptions): Promise<OpenAIChatResponse> {
  if (!OPENAI_API_KEY) {
    logger.warn("openai_not_configured", { capability: opts.capability });
    return {
      content: opts.jsonMode ? '{"stub":true,"message":"OpenAI not configured"}' : "(OpenAI no configurado — respuesta simulada)",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: "stub",
      latency_ms: 0,
    };
  }

  const start = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? OPENAI_MODEL_DEFAULT,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 800,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const latency_ms = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    logger.error("openai_request_failed", { status: res.status, body: errText.slice(0, 300), capability: opts.capability });
    throw new Error(`OpenAI request failed: ${res.status}`);
  }

  const json = await res.json();
  return {
    content: json.choices?.[0]?.message?.content ?? "",
    usage: json.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    model: json.model ?? opts.model ?? OPENAI_MODEL_DEFAULT,
    latency_ms,
  };
}
