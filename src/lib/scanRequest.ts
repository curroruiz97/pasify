/**
 * Identificador de cada lectura de la puerta (`_request_id` de `scan_ticket` y
 * de `scan_ticket_by_code`) y tolerancia a un servidor que aún no lo conoce.
 *
 * Por qué: con mala cobertura la RPC puede ejecutarse y marcar la entrada
 * mientras el móvil ya ha mostrado «Sin conexión». Al reintentar, el servidor
 * solo puede saber que es el mismo escaneo (y contestar otra vez con el éxito,
 * en vez de «Entrada ya usada») si el reintento lleva el mismo identificador.
 *
 * Reglas:
 *   - Un UUID nuevo por lectura (de la cámara o tecleada), sacado del azar.
 *     Nunca derivado del QR ni del código, ni compartido por la sesión: si
 *     saliera de ellos, un segundo invitado con la misma entrada pasaría por
 *     un reintento.
 *   - Solo «Reintentar» de esa misma lectura lo vuelve a enviar.
 *   - Un servidor anterior a la migración 20260929130000 no tiene el parámetro
 *     y PostgREST contesta PGRST202. Entonces se repite UNA vez la misma
 *     lectura sin `_request_id` (el comportamiento de siempre) y se recuerda en
 *     memoria (sin guardarlo, y solo unos minutos) para no repetir el viaje en
 *     cada lectura. Así el orden de despliegue entre la BD y el front no es
 *     crítico.
 *
 * Sin dependencias de la app (ni Supabase ni React): se prueba con Node.
 */

/** Lo único que se usa de `crypto` (acotado para probarlo sin navegador). */
export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/**
 * UUID v4 para una lectura. `crypto.randomUUID` solo existe en contextos
 * seguros y desde Safari 15.4 / Chrome 92 (la app admite iOS 15.0 y Android
 * 6); sin él se montan los 16 bytes con `getRandomValues` (que sí está en
 * todos los WebViews) y, en último caso, con Math.random. Siempre en formato
 * canónico: el parámetro de la RPC es UUID y cualquier otra cosa la rechaza el
 * servidor con 22P02, es decir, la puerta caída.
 */
export const newRequestId = (cryptoApi: CryptoLike | undefined = globalThis.crypto): string => {
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch {
      /* existe pero no funciona (contexto no seguro): se siguen los bytes */
    }
  }
  const bytes = new Uint8Array(16);
  let filled = false;
  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      cryptoApi.getRandomValues(bytes);
      filled = true;
    } catch {
      /* sin azar del sistema: Math.random */
    }
  }
  if (!filled) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Lo que se mira de un error de PostgREST / supabase-js. */
export interface RpcErrorLike {
  message?: string | null;
  code?: string | null;
}

/**
 * PostgREST no tiene una función con ese nombre y esos parámetros (PGRST202,
 * HTTP 404): «Could not find the function public.scan_ticket(…) in the schema
 * cache». Es lo que pasa con un argumento que la BD aún no conoce.
 *
 * Es estricto a propósito: no cuentan otros errores que se le parecen y que un
 * reintento sin `_request_id` no arregla ni debe esconder: un 404 de la
 * pasarela (sin código de PostgREST), PGRST203 (sobrecargas ambiguas), 42883
 * (una función que falta DENTRO de scan_ticket), 22P02 (un UUID mal formado),
 * los RAISE de la función («Not authenticated»…) ni los cortes de red.
 * Equivale a `esFuncionQueNoExiste` de components/auth/alta.ts.
 */
export const esFuncionNoEncontrada = (error: RpcErrorLike | null | undefined): boolean =>
  !!error && (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? ""));

/**
 * Cuánto se recuerda que el servidor no admite `_request_id`. Pasado ese rato
 * la siguiente lectura lo vuelve a probar: un móvil de puerta que sigue abierto
 * cuando se despliega la migración empieza a usarlo solo, sin recargar. Cuesta
 * un viaje de más cada 10 minutos, y solo mientras la BD siga sin migrar.
 */
export const REQUEST_ID_RECHECK_MS = 10 * 60_000;

export interface RequestIdGate {
  /**
   * Envía la lectura con `requestId`; `request(undefined)` es la misma lectura
   * sin él. Si el servidor no encuentra la función, repite UNA vez sin
   * `requestId` y recuerda que no lo admite. Cualquier otro error (red,
   * permisos, resultado de la entrada) se devuelve tal cual y sin repetir.
   * `deadline` (ms, como `Date.now()`) es cuando el llamador da la lectura por
   * perdida: pasada, no se lanza la repetición, porque nadie esperaría su
   * respuesta y la entrada se marcaría a espaldas de la pantalla.
   */
  send<R extends { error: RpcErrorLike | null }>(
    request: (requestId?: string) => PromiseLike<R>,
    requestId: string,
    deadline?: number,
  ): Promise<R>;
}

export const createRequestIdGate = ({
  now = Date.now,
  recheckMs = REQUEST_ID_RECHECK_MS,
}: { now?: () => number; recheckMs?: number } = {}): RequestIdGate => {
  let unsupportedSince: number | null = null;
  const admitsRequestId = () => {
    if (unsupportedSince === null) return true;
    const elapsed = now() - unsupportedSince;
    // elapsed < 0: el reloj del móvil ha retrocedido y la marca ya no vale.
    return elapsed < 0 || elapsed >= recheckMs;
  };

  return {
    async send(request, requestId, deadline) {
      if (!admitsRequestId()) return request(undefined);
      const first = await request(requestId);
      if (!esFuncionNoEncontrada(first.error)) return first;
      if (deadline !== undefined && now() >= deadline) return first;
      const second = await request(undefined);
      // Si sin `_request_id` tampoco la encuentra, la culpa no era suya (la BD
      // no tiene scan_ticket, o es otra firma): no se recuerda nada y se
      // enseña ese error como siempre.
      if (!esFuncionNoEncontrada(second.error)) unsupportedSince = now();
      return second;
    },
  };
};
