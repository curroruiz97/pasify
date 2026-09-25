import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { getErrorMessage } from "@/lib/sentry";
import { useAdminIds, useAuditLogs, type AuditKind, type AuditRow, type ProfileLite } from "./adminQueries";

/**
 * Pasify · AuditTrailViewer
 *
 * Lee `audit_logs` de las tablas auditadas: roles (user_roles, con su propio
 * trigger), perfiles, solicitudes de reembolso y organizaciones (trigger
 * audit_changes, solo UPDATE y DELETE; el reembolso creado por un admin desde
 * Pedidos también deja su alta) y liquidaciones (partner_settlements, también
 * las altas).
 *
 * **Escalada** (solo en roles): alguien que no es admin toca el rol de OTRA
 * persona. No cuentan:
 *   - los actores NULL: el sistema (alta de cuenta con el trigger de auth,
 *     servidor, SQL). Antes salían como 'anon' y cada alta era una
 *     "escalada".
 *   - los admins: actor_role 'admin' (el trigger lo calcula con has_role
 *     desde la migración 20260926160000) o, en filas antiguas con un rol
 *     cualquiera (LIMIT 1 sin orden), quien hoy es admin.
 */

const TABS: { id: AuditKind; label: string; descripcion: string }[] = [
  {
    id: "user_roles",
    label: "Roles",
    descripcion: "Altas, cambios y bajas de roles. En rojo, un no-admin tocando el rol de otra persona.",
  },
  { id: "profiles", label: "Perfiles", descripcion: "Cambios en perfiles: aprobación de locales, datos de contacto…" },
  {
    id: "refund_requests",
    label: "Reembolsos",
    descripcion: "Cambios de estado de las solicitudes de reembolso (decisiones, reintentos, Stripe).",
  },
  { id: "organizations", label: "Organizaciones", descripcion: "Cambios en las organizaciones de los locales." },
  {
    id: "partner_settlements",
    label: "Liquidaciones",
    descripcion: "Transferencias a los locales apuntadas en Liquidaciones: altas, cambios y bajas, con quién las hizo.",
  },
];

const PAGE = 100;
/** Campos que cambian en cada UPDATE y no dicen nada. */
const RUIDO = new Set(["updated_at"]);

const campo = (fila: Record<string, unknown> | null, k: string): unknown => (fila ? fila[k] : undefined);

export const AuditTrailViewer = () => {
  const uid = useCurrentUserId();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AuditKind>("user_roles");
  const [limit, setLimit] = useState(PAGE);
  const [soloEscaladas, setSoloEscaladas] = useState(false);

  const logs = useAuditLogs(uid, kind, limit);
  const admins = useAdminIds(uid);
  const adminSet = useMemo(() => new Set(admins.data ?? []), [admins.data]);
  const rows = useMemo(() => logs.data?.rows ?? [], [logs.data]);
  const profiles = logs.data?.profiles ?? {};

  const isEscalationAttempt = (r: AuditRow): boolean => {
    if (r.target_kind !== "user_roles") return false;
    if (!r.actor_user_id) return false; // sistema: alta de cuenta, servidor
    if (r.actor_role === "admin" || adminSet.has(r.actor_user_id)) return false;
    const targetUserId = campo(r.after, "user_id") ?? campo(r.before, "user_id");
    return typeof targetUserId === "string" && targetUserId !== r.actor_user_id;
  };

  const escalationCount = rows.filter(isEscalationAttempt).length;
  const visibles = kind === "user_roles" && soloEscaladas ? rows.filter(isEscalationAttempt) : rows;
  const tab = TABS.find((t) => t.id === kind) ?? TABS[0];

  const labelFor = (id: string | null | undefined): string => {
    if (!id) return "—";
    const p: ProfileLite | undefined = profiles[id];
    if (!p) return id.slice(0, 8);
    return p.email || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.business_name || id.slice(0, 8);
  };

  const actorLabel = (r: AuditRow): string => {
    if (!r.actor_user_id) return "Sistema";
    const esAdmin = r.actor_role === "admin" || adminSet.has(r.actor_user_id);
    return `${labelFor(r.actor_user_id)}${esAdmin ? " · admin" : ""}`;
  };

  const objetivo = (r: AuditRow): string => {
    const fila = r.after ?? r.before;
    switch (r.target_kind) {
      case "user_roles": {
        const u = campo(fila, "user_id");
        return typeof u === "string" ? labelFor(u) : "—";
      }
      case "profiles":
        return labelFor(r.target_id);
      case "refund_requests": {
        const quien = campo(fila, "requester_email");
        return `Solicitud ${String(r.target_id ?? "").slice(0, 8)}${typeof quien === "string" ? ` · ${quien}` : ""}`;
      }
      case "organizations": {
        const nombre = campo(fila, "name");
        return typeof nombre === "string" ? nombre : String(r.target_id ?? "—").slice(0, 8);
      }
      case "partner_settlements": {
        const org = campo(fila, "org_id");
        return `Organización ${typeof org === "string" ? org.slice(0, 8) : "—"}`;
      }
      default:
        return "—";
    }
  };

  /** Qué ha cambiado: campo antes → después (sin updated_at). */
  const cambios = (r: AuditRow): string => {
    if (r.target_kind === "user_roles") {
      const rol = campo(r.after, "role") ?? campo(r.before, "role");
      return typeof rol === "string" ? `rol ${rol}` : "—";
    }
    // Liquidación nueva o borrada: importe y referencia de la transferencia.
    if (r.target_kind === "partner_settlements" && (!r.before || !r.after)) {
      const fila = r.after ?? r.before;
      const importe = Number(campo(fila, "amount_cents"));
      const ref = campo(fila, "bank_reference");
      const texto = `${Number.isFinite(importe) ? (importe / 100).toFixed(2).replace(".", ",") : "?"} ${String(campo(fila, "currency") ?? "EUR")}${typeof ref === "string" ? ` · ref. ${ref}` : ""}`;
      return r.action.startsWith("DELETE") ? `borrada: ${texto}` : texto;
    }
    if (!r.before || !r.after) return r.action.startsWith("DELETE") ? "borrado" : "—";
    const partes: string[] = [];
    for (const k of Object.keys(r.after)) {
      if (RUIDO.has(k)) continue;
      const antes = JSON.stringify(r.before[k] ?? null);
      const despues = JSON.stringify(r.after[k] ?? null);
      if (antes !== despues) partes.push(`${k}: ${recorta(antes)} → ${recorta(despues)}`);
    }
    return partes.length ? partes.join(" · ") : "sin cambios visibles";
  };

  const refrescar = () => {
    if (!uid) return;
    void queryClient.invalidateQueries({ queryKey: qk.admin.auditAll(uid) });
    void queryClient.invalidateQueries({ queryKey: qk.admin.adminIds(uid) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-3xl font-bold tracking-tight">Auditoría</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{tab.descripcion}</p>
        </div>
        <Button variant="outline" size="icon" onClick={refrescar} disabled={logs.isFetching} aria-label="Refrescar">
          <RefreshCw className={`h-4 w-4 ${logs.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Tabla auditada">
        {TABS.map((t) => (
          <Button
            key={t.id}
            role="tab"
            aria-selected={t.id === kind}
            variant={t.id === kind ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setKind(t.id);
              setLimit(PAGE);
              setSoloEscaladas(false);
            }}
          >
            {t.label}
          </Button>
        ))}
        {kind === "user_roles" && (
          <Button
            variant={soloEscaladas ? "default" : "outline"}
            size="sm"
            onClick={() => setSoloEscaladas((v) => !v)}
            className={`ml-auto ${escalationCount > 0 ? "border-rose-300 text-rose-700" : ""}`}
          >
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            Escaladas ({escalationCount})
          </Button>
        )}
      </div>

      {(logs.isError || admins.isError) && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{getErrorMessage(logs.error ?? admins.error)}</span>
        </div>
      )}

      {logs.isPending ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-10 text-center">
          <ShieldCheck className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
          <p className="text-sm text-muted-foreground">
            {soloEscaladas ? "Ningún intento de escalada en lo cargado." : "Sin actividad registrada todavía."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Cuándo</th>
                <th className="px-3 py-2 text-left">Acción</th>
                <th className="px-3 py-2 text-left">Quién</th>
                <th className="px-3 py-2 text-left">Sobre</th>
                <th className="px-3 py-2 text-left">Cambio</th>
                {kind === "user_roles" && <th className="px-3 py-2 text-left">Estado</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const escalation = isEscalationAttempt(r);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {format(new Date(r.created_at), "d MMM yyyy HH:mm:ss", { locale: es })}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{accion(r.action)}</td>
                    <td className="px-3 py-2">{actorLabel(r)}</td>
                    <td className="px-3 py-2">{objetivo(r)}</td>
                    <td className="max-w-[28rem] break-words px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {cambios(r)}
                    </td>
                    {kind === "user_roles" && (
                      <td className="px-3 py-2">
                        {escalation ? (
                          <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700">
                            ⚠ Escalada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            OK
                          </Badge>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length >= limit && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={logs.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
            {logs.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ver más
          </Button>
        </div>
      )}
    </div>
  );
};

const accion = (a: string) => {
  const op = a.split("_")[0];
  return op === "INSERT" ? "alta" : op === "UPDATE" ? "cambio" : op === "DELETE" ? "baja" : a;
};

const recorta = (s: string) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

export default AuditTrailViewer;
