import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Pasify · AuditTrailViewer (Fase 5 observability)
 *
 * Lee `audit_logs WHERE target_kind = 'user_roles'` para mostrar a admin
 * el histórico de cambios en roles (legítimos + intentos bloqueados por RLS).
 *
 * Cada fila representa un evento INSERT/UPDATE/DELETE en `user_roles`:
 * - actor_user_id: quién intentó la operación
 * - actor_role: rol del actor en el momento (snapshot)
 * - target user_id: a quién afecta (extraído de after.user_id || before.user_id)
 * - action: INSERT_user_roles | UPDATE_user_roles | DELETE_user_roles
 * - before/after: shapshot completo del row
 *
 * **Detección de escalada**: marca con badge rojo cualquier fila donde:
 *   - actor_role != 'admin' (alguien NO admin tocando user_roles)
 *   - target user_id != actor_user_id (operando sobre OTRO usuario)
 * Estas filas son las que dispara el alerting rule
 * `unauthorized_role_escalation_attempt` (mig 0035).
 */

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface ProfileLite {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export const AuditTrailViewer = () => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "escalation_only">("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("audit_logs")
        .select(
          "id, actor_user_id, actor_role, action, target_id, before, after, ip_address, created_at",
        )
        .eq("target_kind", "user_roles")
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) throw err;
      const auditRows = (data ?? []) as AuditRow[];
      setRows(auditRows);

      // Resolver perfiles para actor + target IDs visibles.
      const ids = new Set<string>();
      for (const r of auditRows) {
        if (r.actor_user_id) ids.add(r.actor_user_id);
        const targetUserId =
          (r.after as Record<string, unknown> | null)?.user_id ??
          (r.before as Record<string, unknown> | null)?.user_id;
        if (typeof targetUserId === "string") ids.add(targetUserId);
      }
      if (ids.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email, first_name, last_name")
          .in("id", [...ids]);
        const map = new Map<string, ProfileLite>();
        for (const p of profs ?? []) map.set(p.id, p as ProfileLite);
        setProfiles(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isEscalationAttempt = (r: AuditRow): boolean => {
    if (r.actor_role === "admin") return false;
    const targetUserId =
      (r.after as Record<string, unknown> | null)?.user_id ??
      (r.before as Record<string, unknown> | null)?.user_id;
    return typeof targetUserId === "string" && targetUserId !== r.actor_user_id;
  };

  const filtered = useMemo(() => {
    if (filterMode === "escalation_only") return rows.filter(isEscalationAttempt);
    return rows;
  }, [rows, filterMode]);

  const escalationCount = useMemo(() => rows.filter(isEscalationAttempt).length, [rows]);

  const labelFor = (id: string | null): string => {
    if (!id) return "—";
    const p = profiles.get(id);
    if (!p) return id.slice(0, 8);
    return p.email || [p.first_name, p.last_name].filter(Boolean).join(" ") || id.slice(0, 8);
  };

  const targetFor = (r: AuditRow): string => {
    const targetUserId =
      (r.after as Record<string, unknown> | null)?.user_id ??
      (r.before as Record<string, unknown> | null)?.user_id;
    return typeof targetUserId === "string" ? labelFor(targetUserId) : "—";
  };

  const roleFromAfter = (r: AuditRow): string => {
    const role = (r.after as Record<string, unknown> | null)?.role;
    return typeof role === "string" ? role : "—";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Audit · user_roles</h2>
          <p className="text-xs text-muted-foreground">
            Últimas 200 operaciones en `user_roles`. Las filas con badge rojo son intentos de
            escalada (actor no-admin tocando rol ajeno) — disparan el alerting rule
            `unauthorized_role_escalation_attempt`.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filterMode === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterMode("all")}
          >
            Todos ({rows.length})
          </Button>
          <Button
            variant={filterMode === "escalation_only" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterMode("escalation_only")}
            className={escalationCount > 0 ? "border-rose-300 text-rose-700" : ""}
          >
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            Escaladas ({escalationCount})
          </Button>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-10 text-center">
          <ShieldCheck className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
          <p className="text-sm text-muted-foreground">
            {filterMode === "escalation_only"
              ? "Ningún intento de escalada detectado. 👍"
              : "Sin actividad en user_roles todavía."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Cuándo</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Actor</th>
                <th className="px-3 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-left">Rol</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const escalation = isEscalationAttempt(r);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {format(new Date(r.created_at), "d MMM yyyy HH:mm:ss", { locale: es })}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {r.action.replace("_user_roles", "")}
                    </td>
                    <td className="px-3 py-2">{labelFor(r.actor_user_id)}</td>
                    <td className="px-3 py-2">{targetFor(r)}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{roleFromAfter(r)}</td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AuditTrailViewer;
