import { supabase } from "@/integrations/supabase/client";
import { getSessionSnapshot } from "@/lib/cache/session";
import { withTimeout } from "@/lib/withTimeout";
import { esErrorDeRed } from "@/components/auth/authErrors";

/**
 * Invitaciones de "Trae un amigo" (ReferAFriendCard): el enlace que se
 * comparte es `…/#/register-client?ref=CÓDIGO`.
 *
 * RegisterClient guarda el código al abrirse (sessionStorage: sobrevive a la
 * ida y vuelta de Google en la web y a la recarga tras el alta) y, cuando ya
 * hay una cuenta recién creada con sesión, App lo canjea con la misma RPC que
 * el canje manual (`redeem_referral_code`). Si el canje falla, el alta sigue
 * igual: solo se pierden los puntos, nunca la cuenta.
 *
 * Con «Confirm email» activado no hay sesión al darse de alta y el enlace del
 * email puede abrirse en otra pestaña (sin ese sessionStorage) o horas
 * después. Por eso el alta con email manda también el código en sus
 * metadatos (`user_metadata.ref`): se canjea en cuanto hay sesión y después
 * se borra de ahí. El servidor solo lo acepta en cuentas de menos de 30 días
 * y una sola vez.
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

/** El código guardado en esta pestaña, sin gastarlo (para los metadatos del alta). */
export function leerReferidoPendiente(): string | null {
  try {
    return normalizarCodigoReferido(sessionStorage.getItem(REF_KEY));
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

/** Quita el código de los metadatos del usuario. Nunca lanza. */
async function olvidarReferidoDelAlta(): Promise<void> {
  try {
    await withTimeout(supabase.auth.updateUser({ data: { ref: null } }), CANJE_TIMEOUT_MS, "auth.updateUser(ref)");
  } catch (err) {
    console.warn("[referidos] no se pudo limpiar el código del alta:", err);
  }
}

let canjeando = false;

/**
 * Canjea la invitación guardada si la sesión es de una cuenta recién creada,
 * o la que llegó en los metadatos del alta. Nunca lanza. Con una cuenta
 * antigua la invitación de esta pestaña se descarta.
 */
export async function canjearReferidoPendiente(): Promise<void> {
  if (canjeando) return;
  const user = getSessionSnapshot().session?.user;
  if (!user) return; // sin sesión: se queda para cuando la haya
  const delAlta = normalizarCodigoReferido(user.user_metadata?.ref as string | null | undefined);
  if (!hayReferidoPendiente() && !delAlta) return;

  let code: string | null = null;
  if (hayReferidoPendiente()) {
    const creada = Date.parse(user.created_at ?? "");
    const guardado = tomarReferidoPendiente();
    if (guardado && Number.isFinite(creada) && Date.now() - creada <= ALTA_RECIENTE_MS) code = guardado;
  }
  code = code ?? delAlta;
  if (!code) return;

  canjeando = true;
  try {
    const { error } = await withTimeout(
      Promise.resolve(supabase.rpc("redeem_referral_code", { _code: code })),
      CANJE_TIMEOUT_MS,
      "rpc redeem_referral_code",
    );
    if (error) console.warn("[referidos] canje no aplicado:", error.message);
    // Canjeado o rechazado por el servidor: no se vuelve a intentar. Sin red, sí.
    if (delAlta && !(error && esErrorDeRed(error))) await olvidarReferidoDelAlta();
  } catch (err) {
    console.warn("[referidos] canje fallido:", err);
  } finally {
    canjeando = false;
  }
}
