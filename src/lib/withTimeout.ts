/**
 * Envuelve una promesa con un timeout explícito.
 *
 * Motivo (Apple App Review — Guideline 2.1(a), submission 14204a0e-90da-43d1-b420-2a76956de94d):
 * varias llamadas nativas/red en la app (sobre todo `Preferences.get/set` de
 * Capacitor, usadas como storage de la sesión de Supabase) podían quedarse
 * colgadas sin resolver NI rechazar nunca en ciertos arranques en frío en
 * iOS 26.x, dejando pantallas protegidas (incl. "Editar perfil") congeladas
 * en su loader para siempre, sin ningún feedback ni forma de recuperarse.
 *
 * `withTimeout` convierte ese "cuelgue infinito" en un rechazo acotado y
 * manejable en `ms` milisegundos, para que quien llama pueda hacer fallback
 * (ej. tratar como "sin sesión") en vez de bloquear la UI indefinidamente.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`[timeout] "${label}" no respondió en ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label, ms));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
