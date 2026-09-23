import * as Sentry from "@sentry/react";
import * as SentryCapacitor from "@sentry/capacitor";
import { Capacitor } from "@capacitor/core";

/**
 * Inizializza Sentry. Si attiva solo se è impostato `VITE_SENTRY_DSN`
 * nelle env. Senza DSN è un no-op silenzioso, così la pipeline non
 * fallisce in dev e su deploy senza configurazione.
 *
 * Per attivarlo:
 *   1. Crea progetto su sentry.io (React platform)
 *   2. Aggiungi `VITE_SENTRY_DSN=https://...` in .env / vercel
 *   3. Re-build & deploy
 *
 * Release tag: inyectado en build time por vite.config.ts como
 * `__PASIFY_RELEASE__` (formato `pasify@<sha12>`). Permite agrupar
 * errores por release y subir source maps en CD.
 */
declare const __PASIFY_RELEASE__: string;

// true solo cuando Sentry se ha inicializado de verdad (hay DSN y el init no
// ha fallado). Los helpers de abajo lo consultan para ser no-ops sin DSN.
let sentryActivo = false;

export const initSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  try {
    const isNative = Capacitor.isNativePlatform();
    const env = import.meta.env.MODE;
    // Fallback defensivo: si por algún motivo el define del Vite no se aplicó
    // (test runner, esbuild externo), usamos "pasify@dev" como sentinel.
    const release =
      typeof __PASIFY_RELEASE__ !== "undefined" ? __PASIFY_RELEASE__ : "pasify@dev";

    const commonOpts = {
      dsn,
      environment: env,
      release,
      tracesSampleRate: env === "production" ? 0.2 : 1.0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: env === "production" ? 1.0 : 0,
    };

    if (isNative) {
      SentryCapacitor.init(commonOpts);
    } else {
      Sentry.init({
        ...commonOpts,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration(),
        ],
      });
    }
    sentryActivo = true;
  } catch (err) {
    console.error("[sentry] init failed:", err);
  }
};

/**
 * Mensaje legible de cualquier error. Supabase devuelve sus errores como
 * objetos planos `{ message, code, details, hint }` (no instancias de Error),
 * así que `String(err)` daría "[object Object]".
 */
export const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const { message } = err as { message?: unknown };
    if (typeof message === "string" && message) return message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

// Últimos valores enviados: varias instancias de useAuth/useOrganization
// llaman a estos helpers con el mismo valor en cada evento de auth, y en
// nativo cada `setUser`/`setTag` cruza el bridge de Capacitor.
let ultimoUsuario: string | null | undefined;
const ultimasEtiquetas = new Map<string, string | undefined>();

/**
 * Asocia los errores siguientes al usuario (solo el id: nada de email ni
 * nombre). `null` al cerrar sesión. Sin DSN es un no-op.
 */
export const setSentryUser = (id: string | null): void => {
  if (!sentryActivo || id === ultimoUsuario) return;
  ultimoUsuario = id;
  try {
    Sentry.setUser(id ? { id } : null);
  } catch {
    /* la observabilidad nunca debe romper la app */
  }
};

/**
 * Etiqueta indexable para filtrar en Sentry (p.ej. `role`, `org_id`).
 * `null`/`undefined` la quita. Sin DSN es un no-op.
 */
export const setSentryTag = (
  key: string,
  value: string | number | boolean | null | undefined,
): void => {
  if (!sentryActivo) return;
  const valor = value === null || value === undefined ? undefined : String(value);
  if (ultimasEtiquetas.has(key) && ultimasEtiquetas.get(key) === valor) return;
  ultimasEtiquetas.set(key, valor);
  try {
    Sentry.setTag(key, valor);
  } catch {
    /* noop */
  }
};

/**
 * Reporta un error capturado (los no capturados ya los recoge el SDK).
 * `context` va como datos extra del evento: ids y estado, nunca datos
 * personales. Acepta errores que no son `Error` (los de Supabase) y los
 * convierte para que Sentry los agrupe por mensaje en vez de "Object
 * captured as exception". Sin DSN es un no-op.
 */
export const captureError = (err: unknown, context?: Record<string, unknown>): void => {
  if (!sentryActivo) return;
  try {
    const esError = err instanceof Error;
    const error = esError ? err : new Error(getErrorMessage(err));
    const extra: Record<string, unknown> = { ...(context ?? {}) };
    if (!esError && err && typeof err === "object") extra.errorOriginal = err;
    Sentry.captureException(error, Object.keys(extra).length ? { extra } : undefined);
  } catch {
    /* noop */
  }
};

// Re-export per usare ErrorBoundary e captureException nelle pagine
export { Sentry };
