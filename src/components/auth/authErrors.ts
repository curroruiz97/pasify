/**
 * Errores de Supabase Auth en español para las pantallas de acceso (login,
 * alta, recuperar y cambiar contraseña).
 *
 * GoTrue responde en inglés ("Invalid login credentials", "Email not
 * confirmed"…) y el login los enseñaba tal cual. Se traduce por el código de
 * auth-js (`error.code`) y, para versiones del servidor sin código, por el
 * texto. Lo que no se reconoce sale como un mensaje genérico, nunca en inglés.
 */

/** Soporte: el mismo correo que publica /soporte. */
export const SUPPORT_EMAIL = "comunicacion@avenuemedia.io";

/** Mínimo de caracteres de una contraseña nueva (alta, recuperar y Ajustes). */
export const MIN_PASSWORD_LENGTH = 8;

export const MENSAJE_PASSWORD_CORTA = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;

interface ErrorConCodigo {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
}

const campos = (err: unknown): { code: string; status: number | null; message: string; name: string } => {
  const e = (err && typeof err === "object" ? err : {}) as ErrorConCodigo;
  return {
    code: typeof e.code === "string" ? e.code : "",
    status: typeof e.status === "number" ? e.status : null,
    message: typeof e.message === "string" ? e.message : typeof err === "string" ? err : "",
    name: typeof e.name === "string" ? e.name : "",
  };
};

/** ¿Fallo de red (sin conexión, el servidor no contesta)? */
export const esErrorDeRed = (err: unknown): boolean => {
  const { name, message, status } = campos(err);
  return (
    name === "AuthRetryableFetchError" ||
    name === "TimeoutError" ||
    (name === "TypeError" && /fetch|network|load failed/i.test(message)) ||
    /failed to fetch|network ?error|load failed|networkerror/i.test(message) ||
    status === 0
  );
};

/** ¿Demasiadas peticiones (login, emails de recuperación…)? */
export const esLimiteDePeticiones = (err: unknown): boolean => {
  const { code, status, message } = campos(err);
  return (
    status === 429 ||
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    /rate limit|too many requests|only request this after/i.test(message)
  );
};

/** ¿La cuenta está desactivada (local revocado, cuenta rechazada, baneada)? */
export const esCuentaDesactivada = (err: unknown): boolean => {
  const { code, message } = campos(err);
  return code === "user_banned" || /desactivada|user is banned/i.test(message);
};

/** Mensaje en español para un error de acceso, alta o contraseña. */
export function mensajeErrorAuth(err: unknown): string {
  if (esErrorDeRed(err)) return "No hay conexión con Pasify. Revisa tu red y vuelve a intentarlo.";
  if (esLimiteDePeticiones(err)) return "Demasiados intentos seguidos. Espera un par de minutos y vuelve a intentarlo.";
  if (esCuentaDesactivada(err)) return `Esta cuenta está desactivada. Escríbenos a ${SUPPORT_EMAIL} y lo revisamos.`;

  const { code, message } = campos(err);
  switch (code) {
    case "invalid_credentials":
      return "El email o la contraseña no son correctos.";
    case "email_not_confirmed":
      return "Todavía no has confirmado tu email. Abre el enlace que te enviamos al registrarte.";
    case "user_already_exists":
    case "email_exists":
      return "Ya hay una cuenta con ese email. Inicia sesión o recupera tu contraseña.";
    case "weak_password":
      return `Esa contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD_LENGTH} caracteres y mezcla letras y números.`;
    case "same_password":
      return "La nueva contraseña tiene que ser distinta de la actual.";
    case "email_address_invalid":
    case "validation_failed":
      return "Revisa el email: no parece válido.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "Ahora mismo no se pueden crear cuentas nuevas. Inténtalo más tarde.";
    case "otp_expired":
    case "flow_state_expired":
      return "El enlace ha caducado o ya se ha usado. Pide uno nuevo.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
    case "user_not_found":
      return "No encontramos esa cuenta.";
    default:
      break;
  }

  // Servidores sin `code`: por el texto.
  if (/invalid login credentials/i.test(message)) return "El email o la contraseña no son correctos.";
  if (/email not confirmed/i.test(message)) {
    return "Todavía no has confirmado tu email. Abre el enlace que te enviamos al registrarte.";
  }
  if (/already registered|already exists/i.test(message)) {
    return "Ya hay una cuenta con ese email. Inicia sesión o recupera tu contraseña.";
  }
  if (/password should be|password is too weak|weak password/i.test(message)) {
    return `Esa contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD_LENGTH} caracteres y mezcla letras y números.`;
  }
  if (/invalid email|unable to validate email/i.test(message)) return "Revisa el email: no parece válido.";
  if (/expired|invalid.*(link|token)/i.test(message)) return "El enlace ha caducado o ya se ha usado. Pide uno nuevo.";

  return "No hemos podido completarlo. Vuelve a intentarlo en unos segundos.";
}
