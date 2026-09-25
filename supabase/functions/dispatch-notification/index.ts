// Pasify · dispatch-notification
//
// Manda por email, push y SMS los avisos de `notifications` según las
// preferencias de cada usuario (user_notification_prefs). Cada aviso nuevo
// deja un envío pendiente por canal en notification_dispatches (trigger de la
// migración 20260928160000): email siempre, push si el usuario tiene
// dispositivos y SMS si es crítico.
//
// Solo servidor → servidor (requireServiceRole: service role o la cabecera
// x-pasify-internal). Dos formas de llamarla:
//   { notification_id }    al momento, desde _shared/notify.ts;
//   {} o { mode: "batch" } en lotes: pg_cron cada minuto
//                          (schedule_dispatch_notifications) recoge todo lo
//                          pendiente, lo encolado desde SQL incluido.
// Los envíos los reparte claim_notification_dispatches: dos ejecuciones nunca
// mandan el mismo. Un fallo se reintenta más tarde (next_retry_at) hasta
// MAX_ATTEMPTS veces; lo que lleva 48 h sin salir caduca.
//
//   email  los tipos de KINDS_WITH_OWN_EMAIL no llevan el genérico (su flujo
//          ya manda uno mejor). Sin RESEND_API_KEY no cuenta como enviado.
//   push   horas de silencio en la zona horaria del usuario (Europe/Madrid
//          por defecto); los críticos se las saltan. Sin dispositivos no se
//          hace nada y sin FCM configurado no cuenta como enviado.
//   sms    solo críticos y con la preferencia activa.
//
// 200: { claimed, sent, skipped, retry, failed, rounds }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { isPushConfigured, sendPushMulticast } from "../_shared/firebase.ts";
import { emailDelivered, esc, sendEmail } from "../_shared/resend.ts";
import { sendSms } from "../_shared/twilio.ts";
import { logger } from "../_shared/logger.ts";
import { knownError, requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";
import { APP_URL, DEFAULT_TIMEZONE, renderBaseEmail } from "../_shared/email-templates.ts";

/**
 * Avisos cuyo email ya lo envía su propio flujo (order-paid, refund.ts,
 * stripe-webhook): aquí solo van a la app, sin un segundo email genérico.
 */
const KINDS_WITH_OWN_EMAIL = new Set([
  "ticket_paid",
  "refund_decided",
  "event_cancelled_refund",
  "payout_arrived",
]);

/** Intentos por envío. */
const MAX_ATTEMPTS = 6;
/** Espera tras el intento n (1, 2…) antes del siguiente: 1 min, 5 min, 15 min, 1 h, 4 h. */
const RETRY_DELAYS_S = [60, 5 * 60, 15 * 60, 60 * 60, 4 * 60 * 60];
/** Envíos por reparto: pocos, para que un lote lento no pase de su plazo. */
const CLAIM_SIZE = 10;
/** Plazo de un envío repartido: si no se apunta el resultado, se vuelve a repartir. */
const LEASE_SECONDS = 300;
/** No se empieza otro reparto pasado este tiempo (pg_net espera 55 s). */
const TIME_BUDGET_MS = 40_000;
const MAX_ROUNDS = 30;
/** Envíos a la vez (Resend admite 2 por segundo en su plan básico). */
const CONCURRENCY = 2;
/** Categorías que, sin preferencia guardada, no van por email (como seed_default_notification_prefs). */
const EMAIL_OFF_BY_DEFAULT = new Set(["loyalty", "newsletter"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Channel = "email" | "push" | "sms";

interface Claimed {
  dispatch_id: string;
  notification_id: string;
  channel: string;
  attempt_count: number;
}

interface NotifRow {
  id: string;
  user_id: string;
  category: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  priority: string;
}

interface PrefRow {
  user_id: string;
  channel: string;
  category: string;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  phone: string | null;
}

interface Ctx {
  prefs: PrefRow[];
  profiles: Map<string, ProfileRow>;
  tokens: Map<string, string[]>;
}

type Outcome =
  | { status: "sent"; provider: string; providerId?: string | null; note?: string }
  | { status: "skipped"; reason: string }
  | { status: "retry"; error: string }
  | { status: "failed"; error: string };

type FinalStatus = Outcome["status"];

interface Counts extends Record<FinalStatus, number> {
  claimed: number;
  rounds: number;
}

type Log = ReturnType<typeof logger.child>;

const skipped = (reason: string): Outcome => ({ status: "skipped", reason });
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const oneLine = (s: string | null | undefined): string => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
/** Resend solo admite letras, números, _ y - en las etiquetas. */
const tagValue = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "none";

/* ===========================================================================
   Preferencias y horas de silencio
   =========================================================================== */

interface ChannelPref {
  enabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string;
}

/**
 * Preferencia de un canal para la categoría del aviso: la fila exacta
 * (canal, categoría) si existe. Sin ella: email sí salvo loyalty y
 * newsletter; push sí; SMS solo en la categoría critical.
 */
function prefFor(prefs: PrefRow[], userId: string, channel: Channel, category: string): ChannelPref {
  const own = prefs.filter((p) => p.user_id === userId);
  const exact = own.find((p) => p.channel === channel && p.category === category);
  const enabled = exact
    ? exact.enabled
    : channel === "sms"
      ? category === "critical"
      : channel === "email"
        ? !EMAIL_OFF_BY_DEFAULT.has(category)
        : true;
  return {
    enabled,
    quietStart: exact?.quiet_hours_start ?? null,
    quietEnd: exact?.quiet_hours_end ?? null,
    timezone: exact?.timezone || own.find((p) => p.timezone)?.timezone || DEFAULT_TIMEZONE,
  };
}

function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** "23:00" o "23:00:00" → minutos desde medianoche. */
function toMinutes(t: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** Minutos desde medianoche ahora en `tz`. */
function minutesIn(tz: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return part("hour") * 60 + part("minute");
}

/**
 * ¿Estamos en las horas de silencio del usuario, en SU zona horaria? Antes se
 * miraba la hora UTC del servidor: el silencio de 23:00 a 09:00 de Madrid
 * empezaba a la 01:00. Admite tramos que cruzan la medianoche.
 */
function isInQuietHours(start: string | null, end: string | null, timezone: string, now = new Date()): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || s === e) return false;
  const m = minutesIn(safeTimeZone(timezone), now);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/* ===========================================================================
   Email genérico de un aviso
   =========================================================================== */

/** Enlace absoluto a la web: rutas propias ("/#/…") o URLs de APP_URL; lo demás, la portada. */
function absoluteLink(link: string | null): string {
  const raw = (link ?? "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) return `${APP_URL}${raw}`;
  if (raw === APP_URL || raw.startsWith(`${APP_URL}/`)) return raw;
  return `${APP_URL}/`;
}

function notificationEmail(n: NotifRow, firstName: string | null): { subject: string; html: string; text: string } {
  const title = oneLine(n.title).slice(0, 180) || "Aviso de Pasify";
  const body = (n.body ?? "").trim();
  const url = absoluteLink(n.link);
  const name = oneLine(firstName).slice(0, 80);
  const greeting = name ? `Hola ${name},` : "Hola,";

  // Título y cuerpo pueden llevar texto de terceros (el título de un evento,
  // el mensaje de soporte): todo escapado.
  const html = renderBaseEmail({
    title: esc(title),
    preheader: oneLine(body).slice(0, 140) || title,
    body: `<p>${esc(greeting)}</p>${body ? `<p>${esc(body).replace(/\r?\n/g, "<br />")}</p>` : ""}`,
    ctaLabel: "Abrir en Pasify",
    ctaUrl: esc(url),
    footer: "Te llega este email por un aviso de tu cuenta de Pasify.",
  });
  const text = [greeting, "", title, ...(body ? ["", body] : []), "", `Ábrelo en Pasify: ${url}`].join("\n");
  return { subject: title, html, text };
}

/* ===========================================================================
   Canales
   =========================================================================== */

async function deliverEmail(n: NotifRow, ctx: Ctx): Promise<Outcome> {
  if (KINDS_WITH_OWN_EMAIL.has(n.kind)) return skipped("own_email");
  if (!prefFor(ctx.prefs, n.user_id, "email", n.category).enabled) return skipped("user_disabled");
  const profile = ctx.profiles.get(n.user_id);
  const to = profile?.email?.trim();
  if (!to) return skipped("no_email");

  try {
    const res = await sendEmail({
      to,
      ...notificationEmail(n, profile?.first_name ?? null),
      // La misma clave en cada reintento: Resend no manda dos veces el mismo aviso.
      idempotencyKey: `notif-${n.id}-email`,
      tags: [
        { name: "category", value: tagValue(n.category) },
        { name: "kind", value: tagValue(n.kind) },
      ],
    });
    // Sin RESEND_API_KEY no sale nada: se reintenta por si se configura.
    if (!emailDelivered(res)) return { status: "retry", error: "email_not_configured" };
    return { status: "sent", provider: "resend", providerId: res.id };
  } catch (e) {
    const msg = errorText(e);
    const code = Number(/Resend send failed: (\d{3})/.exec(msg)?.[1] ?? NaN);
    // 409: esa clave ya se usó (lo mandó un intento anterior o hay otro en curso).
    if (code === 409) return skipped("duplicate_request");
    // Dirección o contenido rechazados: reintentarlo no cambia nada. Una
    // clave inválida (401/403) sí puede arreglarse: se reintenta.
    if (code >= 400 && code < 500 && ![401, 403, 408, 429].includes(code)) return { status: "failed", error: msg };
    return { status: "retry", error: msg };
  }
}

async function deliverPush(n: NotifRow, ctx: Ctx, critical: boolean): Promise<Outcome> {
  const pref = prefFor(ctx.prefs, n.user_id, "push", n.category);
  if (!pref.enabled) return skipped("user_disabled");
  if (!critical && isInQuietHours(pref.quietStart, pref.quietEnd, pref.timezone)) return skipped("quiet_hours");
  const tokens = ctx.tokens.get(n.user_id) ?? [];
  if (tokens.length === 0) return skipped("no_tokens");
  if (!isPushConfigured()) return skipped("push_not_configured");

  const results = await sendPushMulticast(tokens, {
    title: n.title,
    body: n.body ?? "",
    data: { kind: n.kind, notification_id: n.id, ...(n.link ? { link: n.link } : {}) },
    clickAction: n.link ?? undefined,
  });
  const ok = results.filter((r) => r.success);
  if (ok.length > 0) {
    // Enviado; si algún dispositivo falló, queda anotado.
    const note = ok.length < results.length ? `${ok.length}/${results.length} dispositivos` : undefined;
    return { status: "sent", provider: "fcm", providerId: ok[0].id ?? null, note };
  }
  // Un envío simulado no cuenta como enviado.
  if (results.every((r) => r.simulated)) return skipped("push_not_configured");
  const errors = results.map((r) => r.error).filter(Boolean).join(" | ");
  return { status: "retry", error: errors.slice(0, 500) || "push_failed" };
}

async function deliverSms(n: NotifRow, ctx: Ctx, critical: boolean): Promise<Outcome> {
  if (!critical) return skipped("not_critical");
  if (!prefFor(ctx.prefs, n.user_id, "sms", n.category).enabled) return skipped("user_disabled");
  const phone = ctx.profiles.get(n.user_id)?.phone?.trim();
  if (!phone) return skipped("no_phone");
  try {
    const r = await sendSms({ to: phone, body: `${oneLine(n.title)}\n${n.body ?? ""}`.trim().slice(0, 480) });
    if (r.provider !== "twilio") return skipped("sms_not_configured");
    return { status: "sent", provider: "twilio", providerId: r.sid };
  } catch (e) {
    // Sin reintento: Twilio no deduplica y un SMS repetido molesta más que uno perdido.
    return { status: "failed", error: errorText(e) };
  }
}

function deliver(channel: string, n: NotifRow, ctx: Ctx): Promise<Outcome> {
  const critical = n.priority === "critical" || n.category === "critical" || n.category === "security";
  switch (channel) {
    case "email":
      return deliverEmail(n, ctx);
    case "push":
      return deliverPush(n, ctx, critical);
    case "sms":
      return deliverSms(n, ctx, critical);
    default:
      return Promise.resolve(skipped("unknown_channel"));
  }
}

/* ===========================================================================
   Cola
   =========================================================================== */

/**
 * Apunta el resultado de un envío repartido. Un fallo transitorio vuelve a
 * 'pending' con la hora del siguiente intento; agotados los intentos, 'failed'.
 * Solo si nadie lo ha vuelto a repartir entretanto (mismo attempt_count).
 */
async function finish(c: Claimed, outcome: Outcome, log: Log): Promise<FinalStatus> {
  const now = Date.now();
  let final: FinalStatus = outcome.status;
  let patch: Record<string, unknown>;
  switch (outcome.status) {
    case "sent":
      patch = {
        status: "sent",
        provider: outcome.provider,
        provider_message_id: outcome.providerId ?? null,
        error_message: outcome.note ?? null,
        dispatched_at: new Date(now).toISOString(),
        next_retry_at: null,
      };
      break;
    case "skipped":
      patch = { status: "skipped", error_message: outcome.reason, next_retry_at: null };
      break;
    case "failed":
      patch = { status: "failed", error_message: outcome.error, next_retry_at: null };
      break;
    case "retry":
      if (c.attempt_count >= MAX_ATTEMPTS) {
        final = "failed";
        patch = { status: "failed", error_message: outcome.error, next_retry_at: null };
      } else {
        const delay = RETRY_DELAYS_S[Math.min(Math.max(c.attempt_count, 1), RETRY_DELAYS_S.length) - 1];
        patch = {
          status: "pending",
          error_message: outcome.error,
          next_retry_at: new Date(now + delay * 1000).toISOString(),
        };
      }
      break;
  }
  const { error } = await supabaseAdmin
    .from("notification_dispatches")
    .update(patch)
    .eq("id", c.dispatch_id)
    .eq("attempt_count", c.attempt_count);
  if (error) log.error("dispatch_finish_failed", { dispatch_id: c.dispatch_id, error: error.message });
  return final;
}

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Carga avisos, preferencias, perfiles y dispositivos de un reparto y lo manda. */
async function processChunk(rows: Claimed[], counts: Counts, log: Log): Promise<void> {
  const ids = [...new Set(rows.map((r) => r.notification_id))];
  const { data: notifs, error } = await supabaseAdmin
    .from("notifications")
    .select("id, user_id, category, kind, title, body, link, priority")
    .in("id", ids);
  // Si no se puede leer, los envíos se quedan apartados y se reintentan al acabar su plazo.
  if (error) throw new Error(`notifications_load_failed: ${error.message}`);

  const byId = new Map<string, NotifRow>();
  for (const n of (notifs ?? []) as NotifRow[]) byId.set(n.id, n);
  const userIds = [...new Set([...byId.values()].map((n) => n.user_id))];

  const ctx: Ctx = { prefs: [], profiles: new Map(), tokens: new Map() };
  if (userIds.length > 0) {
    const needTokens = rows.some((r) => r.channel === "push");
    const [prefsRes, profilesRes, tokensRes] = await Promise.all([
      supabaseAdmin
        .from("user_notification_prefs")
        .select("user_id, channel, category, enabled, quiet_hours_start, quiet_hours_end, timezone")
        .in("user_id", userIds),
      supabaseAdmin.from("profiles").select("id, email, first_name, phone").in("id", userIds),
      needTokens
        ? supabaseAdmin.from("user_fcm_tokens").select("user_id, fcm_token").in("user_id", userIds)
        : Promise.resolve({ data: [] as Array<{ user_id: string; fcm_token: string }>, error: null }),
    ]);
    for (const res of [prefsRes, profilesRes, tokensRes]) {
      if (res.error) throw new Error(`dispatch_context_failed: ${res.error.message}`);
    }
    ctx.prefs = (prefsRes.data ?? []) as PrefRow[];
    for (const p of (profilesRes.data ?? []) as ProfileRow[]) ctx.profiles.set(p.id, p);
    for (const t of (tokensRes.data ?? []) as Array<{ user_id: string; fcm_token: string }>) {
      const list = ctx.tokens.get(t.user_id) ?? [];
      list.push(t.fcm_token);
      ctx.tokens.set(t.user_id, list);
    }
  }

  await forEachLimit(rows, CONCURRENCY, async (row) => {
    const n = byId.get(row.notification_id);
    let outcome: Outcome;
    if (!n) {
      outcome = skipped("notification_deleted");
    } else {
      try {
        outcome = await deliver(row.channel, n, ctx);
      } catch (e) {
        outcome = { status: "retry", error: errorText(e) };
      }
    }
    const final = await finish(row, outcome, log);
    counts[final] += 1;
    if (final === "failed" || final === "retry") {
      log.warn("dispatch_not_sent", {
        dispatch_id: row.dispatch_id,
        notification_id: row.notification_id,
        channel: row.channel,
        attempt: row.attempt_count,
        status: final,
        error: outcome.status === "retry" || outcome.status === "failed" ? outcome.error : undefined,
      });
    }
  });
}

/** Reparte y manda hasta vaciar la cola o agotar el tiempo. */
async function run(notificationId: string | null, log: Log): Promise<Counts> {
  const started = Date.now();
  const counts: Counts = { claimed: 0, sent: 0, skipped: 0, retry: 0, failed: 0, rounds: 0 };
  const maxRounds = notificationId ? 1 : MAX_ROUNDS;

  while (counts.rounds < maxRounds && Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await supabaseAdmin.rpc("claim_notification_dispatches", {
      _limit: CLAIM_SIZE,
      _notification_id: notificationId,
      _lease_seconds: LEASE_SECONDS,
      _max_attempts: MAX_ATTEMPTS,
    });
    if (error) throw new Error(`claim_notification_dispatches_failed: ${error.message}`);
    const rows = (data ?? []) as Claimed[];
    if (rows.length === 0) break;
    counts.rounds += 1;
    counts.claimed += rows.length;
    await processChunk(rows, counts, log);
    if (rows.length < CLAIM_SIZE) break;
  }
  return counts;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "dispatch-notification" });
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    // Auth: solo servidor → servidor (service role o cabecera interna), antes de leer nada.
    requireServiceRole(req);

    const body = (await req.json().catch(() => ({}))) as { notification_id?: unknown } | null;
    const raw = body?.notification_id;
    if (raw !== undefined && raw !== null && (typeof raw !== "string" || !UUID_RE.test(raw))) {
      return errorResponse("invalid_payload", 400);
    }
    const notificationId = typeof raw === "string" ? raw : null;

    const summary = await run(notificationId, log);
    if (summary.claimed > 0) log.info("dispatch_done", { ...summary, notification_id: notificationId });
    return jsonResponse(summary);
  } catch (err) {
    // Un 401 es lo esperado ante cualquier llamada de fuera (el smoke de CI la prueba en cada despliegue).
    const known = knownError(err);
    if (known) log.warn("dispatch-notification rejected", { code: known.code });
    else log.error("dispatch-notification failed", { error: errorText(err) });
    return safeErrorResponse(err);
  }
});
