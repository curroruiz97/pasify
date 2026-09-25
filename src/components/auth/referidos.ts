import { supabase } from "@/integrations/supabase/client";
import { getSessionSnapshot } from "@/lib/cache/session";
import { withTimeout } from "@/lib/withTimeout";

/**
 * Invitaciones de "Trae un amigo" (ReferAFriendCard): el enlace que se
 * comparte es `…/#/register-client?ref=CÓDIGO`.
 *
 * RegisterClient guarda el código al abrirse (sessionStorage: sobrevive a la
 * ida y vuelta de Google en la web y a la recarga tras el alta) y, cuando ya
 * hay una cuenta recién creada con sesión, App lo canjea con la misma RPC que
 * el canje manual (`redeem_referral_code`). Si el canje falla, el alta sigue
 * igual: solo se pierden los puntos, nunca la cuenta.
 */
const REF_KEY = "pasify.ref";
/** Solo se canjea en cuentas recién creadas: entrar con una antigua no es un alta. */
const ALTA_RECIENTE_MS = 30 * 60 * 1000;
const CANJE_TIMEOUT_MS = 8_000;

/** Código de invitación con buena forma (8 letras o cifras) o null. */
export const normalizarCodigoReferido = (raw: string | null | undefined): string | null => {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
};

export function guardarReferidoPendiente(raw: string | null | undefined): void {
  const code = normalizarCodigoReferido(raw);
  if (!code) return;
  try {
    sessionStorage.setItem(REF_KEY, code);
  } catch {
    /* sin storage: sin puntos de invitación */
  }
}

function tomarReferidoPendiente(): string | null {
  try {
    const code = sessionStorage.getItem(REF_KEY);
    if (code !== null) sessionStorage.removeItem(REF_KEY);
    return normalizarCodigoReferido(code);
  } catch {
    return null;
  }
}

function hayReferidoPendiente(): boolean {
  try {
    return sessionStorage.getItem(REF_KEY) !== null;
  } catch {
    return false;
  }
}

let canjeando = false;

/**
 * Canjea la invitación guardada si la sesión es de una cuenta recién creada.
 * Nunca lanza. Con una cuenta antigua la invitación se descarta.
 */
export async function canjearReferidoPendiente(): Promise<void> {
  if (canjeando || !hayReferidoPendiente()) return;
  const user = getSessionSnapshot().session?.user;
  if (!user) return; // sin sesión: se queda para cuando la haya
  const creada = Date.parse(user.created_at ?? "");
  const code = tomarReferidoPendiente();
  if (!code || !Number.isFinite(creada) || Date.now() - creada > ALTA_RECIENTE_MS) return;
  canjeando = true;
  try {
    const { error } = await withTimeout(
      Promise.resolve(supabase.rpc("redeem_referral_code", { _code: code })),
      CANJE_TIMEOUT_MS,
      "rpc redeem_referral_code",
    );
    if (error) console.warn("[referidos] canje no aplicado:", error.message);
  } catch (err) {
    console.warn("[referidos] canje fallido:", err);
  } finally {
    canjeando = false;
  }
}
