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
 */
export const initSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  try {
    const isNative = Capacitor.isNativePlatform();
    const env = import.meta.env.MODE;

    const commonOpts = {
      dsn,
      environment: env,
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
  } catch (err) {
    console.error("[sentry] init failed:", err);
  }
};

// Re-export per usare ErrorBoundary e captureException nelle pagine
export { Sentry };
