// Pasify · CORS helpers compartidos por todas las edge functions
// Permite preflight desde cualquier origen autorizado del front (web + capacitor).

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pasify-request-id, x-pasify-app-version, stripe-signature",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(message: string, status = 400, code?: string): Response {
  return jsonResponse({ error: { message, code: code ?? "generic_error" } }, { status });
}
