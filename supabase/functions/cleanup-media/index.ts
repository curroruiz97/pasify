// Pasify · cleanup-media (cron semanal + «ejecutar ahora» de un admin)
//
// Borra de Storage los ficheros HUÉRFANOS de los buckets públicos de imágenes
// (avatars, event-images, partner-branding, partner-galleries): fotos de perfil
// sustituidas, portadas de eventos eliminados, subidas que nunca se guardaron.
// Es la limpieza del código antiguo (que borraba lo que le dijera quien llamara,
// sin autenticar) hecha al revés: aquí no se borra nada que se pida desde fuera.
//
// EMPIEZA EN MODO PRUEBA: sin `"dry_run": false` explícito solo cuenta y
// registra qué borraría (log + una fila en audit_logs). Cuando los candidatos
// de una ejecución semanal sean de verdad huérfanos, se pasa el cron a
// `{"dry_run": false}` (ver supabase/functions/README.md).
//
// Cómo decide qué es huérfano (todo en la RPC cleanup_media_candidates, SQL):
//   - Solo ficheros cuyo nombre sea «<uuid>/…» con tramos de caracteres
//     seguros ([A-Za-z0-9._-], empezando por letra o número), que es como los
//     sube la app. Lo demás (logos de la marca subidos a mano, placeholders de
//     carpeta, rutas con «..»…) no se toca nunca.
//   - Un fichero está referenciado si su ruta «<uuid>/…» aparece en CUALQUIER
//     columna de texto, text[] o JSON de las tablas de `public` (y en los
//     metadatos de auth.users): da igual en qué columna esté la URL y vale
//     también si guardan la ruta sin el bucket. Mejor tomar por usado algo que
//     no lo es que borrar algo en uso. Una columna nueva se cubre sola.
//   - Solo cuenta lo que lleva sin tocarse al menos `min_age_days` días
//     (30 por defecto; mínimo 7): cubre subidas a medias y borradores locales.
//
// Cómo se limita el daño si algo falla:
//   - Fail-closed: si la RPC falla (no existe, RLS, timeout) no se borra nada
//     de ese bucket. Nunca se borra una ruta que no devolviera la RPC.
//   - Tope por ejecución: 200 ficheros por bucket (`max_delete`, hasta 500),
//     los más antiguos primero.
//   - Si más del 90 % de los ficheros elegibles de un bucket salen huérfanos
//     (con al menos 20), se salta ese bucket: casi seguro es un fallo al
//     detectar las referencias, no un bucket lleno de basura.
//   - Se borra solo por la API de Storage (borrar filas de storage.objects por
//     SQL no borra el fichero). Al primer error de Storage se para ese bucket.
//   - Los buckets privados (tickets, support, gdpr-exports…) no están en la lista.
//
// Autorización: servicio (service role / x-pasify-internal, el cron) o admin de
// plataforma. POST con cuerpo opcional:
//   { "dry_run": false,          solo `false` borra; cualquier otra cosa es prueba
//     "min_age_days": 30,        7 a 365
//     "max_delete": 200,         1 a 500 por bucket
//     "buckets": ["avatars"] }   subconjunto de los cuatro

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { HttpError, isServiceRoleRequest, safeErrorResponse } from "../_shared/internal-auth.ts";

/** Los únicos buckets que esta función puede tocar. */
export const CLEANUP_BUCKETS = ["avatars", "event-images", "partner-branding", "partner-galleries"] as const;
type Bucket = (typeof CLEANUP_BUCKETS)[number];

export const DEFAULT_MIN_AGE_DAYS = 30;
export const MIN_AGE_DAYS_FLOOR = 7;
export const DEFAULT_MAX_DELETE = 200;
export const MAX_DELETE_CEILING = 500;
const DELETE_BATCH = 50;
const LOG_CHUNK = 50;
/** Con al menos tantos ficheros elegibles, más de esta fracción de huérfanos es sospechosa. */
export const SUSPICIOUS_MIN_ELIGIBLE = 20;
export const SUSPICIOUS_RATIO = 0.9;

/**
 * «<uuid>/tramo/…/fichero» con tramos que empiezan por letra o número: así no
 * pasan «..», «.» ni los placeholders de carpeta («.emptyFolderPlaceholder»).
 */
const SAFE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/i;

export interface Options {
  dryRun: boolean;
  minAgeDays: number;
  maxDelete: number;
  buckets: Bucket[];
}

/** Lee el cuerpo opcional. Solo `dry_run: false` (booleano) activa el borrado. */
export function parseOptions(raw: unknown): Options {
  const body = raw === undefined || raw === null ? {} : raw;
  if (typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_json");
  const o = body as Record<string, unknown>;

  let minAgeDays = DEFAULT_MIN_AGE_DAYS;
  if (o.min_age_days !== undefined) {
    const v = o.min_age_days;
    if (typeof v !== "number" || !Number.isInteger(v) || v < MIN_AGE_DAYS_FLOOR || v > 365) {
      throw new HttpError(400, "invalid_min_age_days");
    }
    minAgeDays = v;
  }
  let maxDelete = DEFAULT_MAX_DELETE;
  if (o.max_delete !== undefined) {
    const v = o.max_delete;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_DELETE_CEILING) {
      throw new HttpError(400, "invalid_max_delete");
    }
    maxDelete = v;
  }
  let buckets: Bucket[] = [...CLEANUP_BUCKETS];
  if (o.buckets !== undefined) {
    const v = o.buckets;
    if (!Array.isArray(v) || v.length === 0 || !v.every((b) => (CLEANUP_BUCKETS as readonly string[]).includes(b as string))) {
      throw new HttpError(400, "invalid_buckets");
    }
    buckets = [...new Set(v as Bucket[])];
  }
  return { dryRun: o.dry_run !== false, minAgeDays, maxDelete, buckets };
}

export interface Candidate {
  name: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface CandidatesResult {
  bucket: string;
  total_objects: number;
  eligible_objects: number;
  candidates_total: number;
  candidates_bytes: number;
  candidates: Candidate[];
}

/** ¿Es la respuesta de la RPC la que esperamos? Cualquier otra forma se trata como fallo. */
export function validateCandidates(bucket: string, data: unknown): CandidatesResult {
  const d = data as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  if (
    !d || typeof d !== "object" || d.bucket !== bucket || !Array.isArray(d.candidates) ||
    num(d.total_objects) === null || num(d.eligible_objects) === null ||
    num(d.candidates_total) === null || num(d.candidates_bytes) === null
  ) {
    throw new Error("cleanup_media_candidates devolvió un formato inesperado");
  }
  const candidates: Candidate[] = [];
  for (const c of d.candidates as Array<Record<string, unknown>>) {
    // Defensa en profundidad: aunque la RPC ya filtra, una ruta rara no se borra.
    if (typeof c?.name !== "string" || !SAFE_NAME_RE.test(c.name)) {
      throw new Error("cleanup_media_candidates devolvió una ruta no válida");
    }
    candidates.push({
      name: c.name,
      size: num(c.size) ?? 0,
      created_at: String(c.created_at ?? ""),
      updated_at: String(c.updated_at ?? ""),
    });
  }
  return {
    bucket,
    total_objects: d.total_objects as number,
    eligible_objects: d.eligible_objects as number,
    candidates_total: d.candidates_total as number,
    candidates_bytes: d.candidates_bytes as number,
    candidates,
  };
}

/** ¿Demasiados huérfanos para ser creíble? */
export function isSuspicious(r: Pick<CandidatesResult, "eligible_objects" | "candidates_total">): boolean {
  return r.eligible_objects >= SUSPICIOUS_MIN_ELIGIBLE && r.candidates_total / r.eligible_objects > SUSPICIOUS_RATIO;
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

interface BucketReport {
  bucket: string;
  total_objects?: number;
  eligible_objects?: number;
  candidates_total?: number;
  candidates_bytes?: number;
  /** Cuántos nombres se listan/borran en esta pasada (tope max_delete). */
  selected?: number;
  deleted?: number;
  deleted_bytes?: number;
  failed?: number;
  skipped?: "suspicious_ratio";
  error?: string;
  /** Solo en modo prueba: los nombres que se borrarían. */
  would_delete?: string[];
}

async function cleanBucket(
  bucket: Bucket,
  opts: Options,
  actor: { id: string | null; role: string },
): Promise<BucketReport> {
  const report: BucketReport = { bucket };
  const removedNames: string[] = [];
  try {
    const { data, error } = await supabaseAdmin.rpc("cleanup_media_candidates", {
      _bucket: bucket,
      _min_age_days: opts.minAgeDays,
      _max_candidates: opts.maxDelete,
    });
    if (error) throw new Error(`cleanup_media_candidates: ${error.message}`);
    const found = validateCandidates(bucket, data);
    Object.assign(report, {
      total_objects: found.total_objects,
      eligible_objects: found.eligible_objects,
      candidates_total: found.candidates_total,
      candidates_bytes: found.candidates_bytes,
      selected: found.candidates.length,
    });

    if (isSuspicious(found)) {
      report.skipped = "suspicious_ratio";
      logger.error("cleanup_media_suspicious_ratio", {
        bucket,
        eligible_objects: found.eligible_objects,
        candidates_total: found.candidates_total,
      });
    } else if (opts.dryRun) {
      report.would_delete = found.candidates.map((c) => c.name);
      chunk(found.candidates, LOG_CHUNK).forEach((part, i) =>
        logger.info("cleanup_media_dry_run_candidates", {
          bucket,
          part: i + 1,
          files: part.map((c) => ({ name: c.name, bytes: c.size, updated_at: c.updated_at })),
        })
      );
    } else {
      let deleted = 0;
      let deletedBytes = 0;
      let failed = 0;
      const sizeByName = new Map(found.candidates.map((c) => [c.name, c.size]));
      for (const part of chunk(found.candidates.map((c) => c.name), DELETE_BATCH)) {
        const { data: removed, error: removeErr } = await supabaseAdmin.storage.from(bucket).remove(part);
        if (removeErr) {
          // Al primer error de Storage se para este bucket: lo que falta se verá en la siguiente pasada.
          failed += part.length;
          report.error = "storage_remove_failed";
          logger.error("cleanup_media_remove_failed", { bucket, error: removeErr.message, batch: part.length });
          break;
        }
        for (const r of removed ?? []) {
          deleted++;
          removedNames.push(r.name);
          deletedBytes += sizeByName.get(r.name) ?? 0;
        }
      }
      report.deleted = deleted;
      report.deleted_bytes = deletedBytes;
      report.failed = failed;
      logger.info("cleanup_media_deleted", { bucket, deleted, deleted_bytes: deletedBytes, failed });
    }
  } catch (err) {
    report.error = "failed";
    logger.error("cleanup_media_bucket_failed", { bucket, error: String(err) });
  }

  // Registro permanente (los logs de la función caducan en pocos días).
  const { error: auditErr } = await supabaseAdmin.from("audit_logs").insert({
    actor_user_id: actor.id,
    actor_role: actor.role,
    action: opts.dryRun ? "storage_cleanup_dry_run" : "storage_cleanup",
    target_kind: "storage_bucket",
    after: {
      bucket,
      dry_run: opts.dryRun,
      min_age_days: opts.minAgeDays,
      max_delete: opts.maxDelete,
      total_objects: report.total_objects ?? null,
      eligible_objects: report.eligible_objects ?? null,
      candidates_total: report.candidates_total ?? null,
      candidates_bytes: report.candidates_bytes ?? null,
      deleted: report.deleted ?? null,
      deleted_bytes: report.deleted_bytes ?? null,
      failed: report.failed ?? null,
      skipped: report.skipped ?? null,
      error: report.error ?? null,
      files: opts.dryRun ? (report.would_delete ?? []) : removedNames,
    },
  });
  if (auditErr) logger.error("cleanup_media_audit_log_failed", { bucket, error: auditErr.message, code: auditErr.code });
  return report;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405, "method_not_allowed");

    // Cron (service role / x-pasify-internal) o admin de plataforma.
    let actor: { id: string | null; role: string } = { id: null, role: "service" };
    if (!isServiceRoleRequest(req)) {
      const admin = await requireAdmin(req);
      actor = { id: admin.id, role: "admin" };
    }

    const raw = await req.text();
    let parsed: unknown = undefined;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "invalid_json");
      }
    }
    const opts = parseOptions(parsed);

    const reports: BucketReport[] = [];
    for (const bucket of opts.buckets) reports.push(await cleanBucket(bucket, opts, actor));

    const failedBuckets = reports.filter((r) => r.error || r.skipped).length;
    const allErrored = reports.length > 0 && reports.every((r) => r.error);
    const totalDeleted = reports.reduce((n, r) => n + (r.deleted ?? 0), 0);
    logger.info("cleanup_media_run", {
      dry_run: opts.dryRun,
      min_age_days: opts.minAgeDays,
      max_delete: opts.maxDelete,
      buckets: reports.length,
      candidates: reports.reduce((n, r) => n + (r.candidates_total ?? 0), 0),
      deleted: totalDeleted,
      problems: failedBuckets,
    });
    return jsonResponse({
      ok: failedBuckets === 0,
      dry_run: opts.dryRun,
      min_age_days: opts.minAgeDays,
      max_delete: opts.maxDelete,
      buckets: reports,
    }, { status: allErrored ? 500 : 200 });
  } catch (err) {
    logger.error("cleanup-media failed", { error: err instanceof HttpError ? err.code : String(err) });
    return safeErrorResponse(err);
  }
});
