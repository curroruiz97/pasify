// Pasify · send-push: validación del cuerpo de la petición.
// Código puro (sin Deno ni red) para poder probarlo aparte.

/**
 * Tokens por llamada. dispatch-notification manda a los dispositivos de un
 * solo usuario, que son un puñado; 500 era el tope de un multicast de FCM.
 * Pasado el tope no se recorta en silencio (se perderían envíos sin avisar): 400.
 */
export const MAX_TOKENS = 500;

export interface PushPayload {
  /** `tokens` (multicast, hasta MAX_TOKENS) o el único `token`. */
  tokens: string[];
  multicast: boolean;
  title: string;
  body: string;
  /** FCM solo admite cadenas como valores. */
  data?: Record<string, string>;
  image?: string;
  link?: string;
  badge?: number;
  channel: string;
}

export type ParsedPush = { ok: true; value: PushPayload } | { ok: false; code: string };

const fail = (code: string): ParsedPush => ({ ok: false, code });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
/** Opcional: ausente (o null) o una cadena. */
const isOptionalString = (v: unknown): v is string | null | undefined => v == null || typeof v === "string";

/**
 * Cuerpo de send-push: { token | tokens, title, body, data?, link?, image?,
 * badge?, channel? }. Devuelve el mensaje tipado o el código del primer campo
 * que no vale (siempre un 400 para quien llama).
 */
export function parsePushBody(raw: unknown): ParsedPush {
  if (!isRecord(raw)) return fail("invalid_payload");
  const { token, tokens: tokenList, title, body, data, image, link, channel, badge } = raw;

  let tokens: string[];
  let multicast = false;
  if (tokenList != null && !Array.isArray(tokenList)) return fail("invalid_tokens");
  if (Array.isArray(tokenList) && tokenList.length > 0) {
    if (tokenList.length > MAX_TOKENS) return fail("too_many_tokens");
    if (!tokenList.every(isText)) return fail("invalid_tokens");
    tokens = tokenList as string[];
    multicast = true;
  } else {
    if (!token) return fail("token_or_tokens_required");
    if (!isText(token)) return fail("invalid_token");
    tokens = [token];
  }

  if (!isText(title)) return fail("invalid_title");
  if (typeof body !== "string") return fail("invalid_body");
  if (data != null && (!isRecord(data) || !Object.values(data).every((v) => typeof v === "string"))) {
    return fail("invalid_data");
  }
  if (!isOptionalString(image)) return fail("invalid_image");
  if (!isOptionalString(link)) return fail("invalid_link");
  if (!isOptionalString(channel)) return fail("invalid_channel");
  if (badge != null && !(typeof badge === "number" && Number.isInteger(badge) && badge >= 0)) {
    return fail("invalid_badge");
  }

  return {
    ok: true,
    value: {
      tokens,
      multicast,
      title,
      body,
      data: (data ?? undefined) as Record<string, string> | undefined,
      image: image ?? undefined,
      link: link ?? undefined,
      badge: (badge ?? undefined) as number | undefined,
      channel: channel || "default",
    },
  };
}
