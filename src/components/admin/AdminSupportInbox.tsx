import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es as esDate } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, RefreshCw, RotateCcw, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import SupportChat from "@/components/support/SupportChat";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/cache/keys";
import { getErrorMessage } from "@/lib/sentry";
import { useAdminSupportInbox, useAdminSupportUnread, type InboxConversation, type InboxFilter } from "./adminQueries";

/* ============================================================================
   Bandeja de soporte del admin (B5-1)

   React Query + Realtime (useAdminRealtime en AdminDashboard): un mensaje o
   un cambio en cualquier conversación la refresca sola. Los no leídos son los
   del servidor (unread_for_admin), y al leer una conversación SupportChat
   invalida la bandeja: el aviso desaparece de la lista y del menú.
   ============================================================================ */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const PAGE = 30;

const FILTROS: { id: InboxFilter; label: string }[] = [
  { id: "open", label: "Abiertas" },
  { id: "unread", label: "Sin leer" },
  { id: "mine", label: "Mías" },
  { id: "closed", label: "Cerradas" },
];

const nombrePersona = (c: InboxConversation): string => {
  const p = c.client;
  const nombre = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || null;
  if (c.kind === "partner_admin") return `Local · ${p?.business_name || c.org?.name || nombre || "sin nombre"}`;
  return nombre || "Usuario sin nombre";
};

const nombreAdmin = (c: InboxConversation, uid: string | null): string | null => {
  if (!c.assigned_admin_id) return null;
  if (c.assigned_admin_id === uid) return "ti";
  const a = c.assigned;
  return [a?.first_name, a?.last_name].filter(Boolean).join(" ") || a?.email || "otro admin";
};

export const AdminSupportInbox = ({ uid }: { uid: string | null }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<InboxFilter>("open");
  const [limite, setLimite] = useState(PAGE);
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  // Copia de la conversación abierta para cuando sale del filtro activo (se
  // cierra estando en "Abiertas", se lee estando en "Sin leer"…).
  const [copia, setCopia] = useState<InboxConversation | null>(null);
  const [accion, setAccion] = useState<"assign" | "status" | null>(null);

  const bandeja = useAdminSupportInbox(uid, filtro, limite);
  const noLeidos = useAdminSupportUnread(uid);
  const filas = useMemo(() => bandeja.data?.rows ?? [], [bandeja.data]);
  const total = bandeja.data?.total ?? 0;
  const seleccion =
    (seleccionId ? filas.find((c) => c.id === seleccionId) : undefined) ??
    (copia && copia.id === seleccionId ? copia : null);

  // La copia se queda con lo último que trajo la bandeja.
  useEffect(() => {
    const fresca = seleccionId ? filas.find((c) => c.id === seleccionId) : undefined;
    if (fresca) setCopia(fresca);
  }, [filas, seleccionId]);

  const seleccionar = (c: InboxConversation) => {
    setSeleccionId(c.id);
    setCopia(c);
  };

  const refrescar = () => {
    if (uid) void queryClient.invalidateQueries({ queryKey: qk.admin.supportInbox(uid) });
  };

  const asignarme = async (c: InboxConversation) => {
    if (!uid) return;
    setAccion("assign");
    const { error } = await supabase.rpc("assign_admin_to_conversation", { _conv_id: c.id, _admin_id: uid });
    setAccion(null);
    if (error) {
      toast({ title: "No se ha podido asignar", description: error.message, variant: "destructive" });
      return;
    }
    setCopia({ ...c, assigned_admin_id: uid, assigned: null });
    toast({ title: "Conversación asignada a ti" });
    refrescar();
  };

  const cambiarEstado = async (c: InboxConversation, status: "open" | "closed") => {
    setAccion("status");
    const { error } = await supabase.from("support_conversations").update({ status }).eq("id", c.id);
    setAccion(null);
    if (error) {
      toast({
        title: status === "closed" ? "No se ha podido cerrar" : "No se ha podido reabrir",
        description:
          error.code === "23505"
            ? "Este usuario ya tiene otra conversación abierta: sigue en esa."
            : error.message,
        variant: "destructive",
      });
      return;
    }
    setCopia({ ...c, status });
    toast({ title: status === "closed" ? "Conversación cerrada" : "Conversación reabierta" });
    refrescar();
  };

  return (
    <div>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Conversaciones con clientes y locales. Se actualiza sola cuando alguien escribe.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtro de conversaciones">
        {FILTROS.map((f) => {
          const activo = f.id === filtro;
          const n = f.id === "unread" ? noLeidos.data?.conversations : undefined;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => {
                setFiltro(f.id);
                setLimite(PAGE);
              }}
              className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition"
              style={{
                background: activo ? "rgba(232,84,42,0.14)" : "transparent",
                borderColor: activo ? "rgba(232,84,42,0.55)" : "hsl(var(--border))",
                color: activo ? "#FF7A4D" : undefined,
              }}
            >
              {f.label}
              {n !== undefined && n > 0 && (
                <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{n}</span>
              )}
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={refrescar}
          disabled={bandeja.isFetching}
          aria-label="Refrescar"
        >
          <RefreshCw className={`h-4 w-4 ${bandeja.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        {/* Lista */}
        <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-card">
          {bandeja.isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center text-sm">
              <AlertTriangle className="h-6 w-6 text-red-500" />
              <span className="text-foreground">No se ha podido cargar la bandeja.</span>
              <span className="text-xs text-muted-foreground">{getErrorMessage(bandeja.error)}</span>
              <Button variant="outline" size="sm" onClick={() => void bandeja.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : bandeja.isPending ? (
            <div className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filas.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center text-sm text-muted-foreground">
              <MessageCircle className="mb-2 h-8 w-8 opacity-50" />
              {filtro === "unread"
                ? "Nada sin leer."
                : filtro === "mine"
                  ? "No tienes conversaciones asignadas."
                  : filtro === "closed"
                    ? "No hay conversaciones cerradas."
                    : "No hay conversaciones abiertas."}
            </div>
          ) : (
            <>
              {filas.map((conv) => {
                const activa = seleccion?.id === conv.id;
                const unread = conv.unread_for_admin ?? 0;
                const asignada = nombreAdmin(conv, uid);
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => seleccionar(conv)}
                    className={`flex w-full flex-col items-start gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${activa ? "bg-muted/60" : ""}`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className={`truncate text-sm ${unread > 0 ? "font-bold" : "font-semibold"}`}>
                        {nombrePersona(conv)}
                      </span>
                      {unread > 0 && (
                        <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
                          {unread}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{conv.last_message_preview}</p>
                    <div
                      className="flex w-full items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/70"
                      style={mono}
                    >
                      <span>
                        {conv.last_message_at
                          ? format(new Date(conv.last_message_at), "d MMM · HH:mm", { locale: esDate })
                          : ""}
                      </span>
                      <span className="truncate">
                        {conv.status === "closed" ? "Cerrada" : asignada ? `Asignada a ${asignada}` : "Sin asignar"}
                      </span>
                    </div>
                  </button>
                );
              })}
              {filas.length < total && (
                <div className="p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={bandeja.isFetching}
                    onClick={() => setLimite((l) => l + PAGE)}
                  >
                    {bandeja.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Ver más ({total - filas.length})
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Conversación */}
        <div className="min-h-[400px] rounded-2xl border border-border bg-card">
          {seleccion ? (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0 text-[11px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
                  {seleccion.status === "closed" ? "Cerrada" : "Abierta"} ·{" "}
                  {nombreAdmin(seleccion, uid) ? `Asignada a ${nombreAdmin(seleccion, uid)}` : "Sin asignar"}
                </div>
                <div className="flex items-center gap-2">
                  {seleccion.assigned_admin_id !== uid && seleccion.status !== "closed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accion !== null}
                      onClick={() => void asignarme(seleccion)}
                    >
                      {accion === "assign" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Asignarme
                    </Button>
                  )}
                  {seleccion.status === "closed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accion !== null}
                      onClick={() => void cambiarEstado(seleccion, "open")}
                    >
                      {accion === "status" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Reabrir
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accion !== null}
                      onClick={() => void cambiarEstado(seleccion, "closed")}
                    >
                      {accion === "status" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Cerrar
                    </Button>
                  )}
                </div>
              </div>
              <SupportChat
                key={seleccion.id}
                mode="admin"
                conversationId={seleccion.id}
                selectedClientId={seleccion.client_id}
                selectedClient={{
                  id: seleccion.client_id,
                  first_name: seleccion.client?.first_name ?? null,
                  last_name: seleccion.client?.last_name ?? null,
                  email: seleccion.client?.email ?? null,
                }}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <MessageCircle className="mb-3 h-10 w-10 opacity-40" />
              Selecciona una conversación de la izquierda para responder.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSupportInbox;
