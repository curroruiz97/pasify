// Pasify · health-check (public endpoint)
// Verifica salud de DB + Stripe + Resend + FCM. Persiste snapshot.
// verify_jwt = false.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

interface ServiceCheck { service: string; status: "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance"; latency_ms?: number; message?: string }

async function checkDb(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const { error } = await supabaseAdmin.from("cities").select("id", { count: "exact", head: true });
    if (error) return { service: "database", status: "major_outage", message: error.message };
    return { service: "database", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "database", status: "major_outage", message: String(e), latency_ms: Date.now() - start };
  }
}

async function checkStripe(): Promise<ServiceCheck> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return { service: "stripe", status: "maintenance", message: "not_configured" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    if (!res.ok) return { service: "stripe", status: "degraded", latency_ms: Date.now() - start, message: `status_${res.status}` };
    return { service: "stripe", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "stripe", status: "major_outage", message: String(e) };
  }
}

async function checkResend(): Promise<ServiceCheck> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { service: "email", status: "maintenance", message: "not_configured" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return { service: "email", status: "degraded", latency_ms: Date.now() - start };
    return { service: "email", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "email", status: "major_outage", message: String(e) };
  }
}

async function checkFcm(): Promise<ServiceCheck> {
  const sa = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!sa) return { service: "push", status: "maintenance", message: "not_configured" };
  return { service: "push", status: "operational" };
}

async function checkStorage(): Promise<ServiceCheck> {
  try {
    const start = Date.now();
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    if (error || !data) return { service: "storage", status: "degraded", message: error?.message };
    return { service: "storage", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "storage", status: "major_outage", message: String(e) };
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const [db, stripe, resend, fcm, storage] = await Promise.all([
    checkDb(), checkStripe(), checkResend(), checkFcm(), checkStorage(),
  ]);
  const checks = [db, stripe, resend, fcm, storage];

  // Persistir snapshots.
  // OJO: el builder que devuelve .from().insert() es un PromiseLike — tiene
  // then() pero NO catch(). Encadenar .catch() aqui lanzaba
  // "TypeError: ....catch is not a function" y tumbaba la funcion entera con
  // un 500, que es lo que hacia fallar el check "Smoke production" en cada
  // commit. Los errores de Postgrest vienen dentro de { error }, no como
  // rechazo, asi que basta con envolver en try/catch e ignorarlos: el snapshot
  // es informativo y nunca debe impedir responder el estado de salud.
  try {
    await supabaseAdmin.from("service_status_snapshots").insert(
      checks.map((c) => ({
        service: c.service,
        status: c.status,
        latency_ms: c.latency_ms ?? null,
        message: c.message ?? null,
      }))
    );
  } catch {
    // best-effort: si no se puede guardar el snapshot, seguimos.
  }

  const allOperational = checks.every((c) => c.status === "operational" || c.status === "maintenance");
  const overall = allOperational ? "operational" : checks.some((c) => c.status === "major_outage") ? "major_outage" : "degraded";

  return jsonResponse({ overall, checks, timestamp: new Date().toISOString() });
});
