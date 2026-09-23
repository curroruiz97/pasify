import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Headphones,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, isSameDay, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_kind: "client" | "admin" | "partner";
  body: string;
  created_at: string;
  read_at: string | null;
};

type ClientInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

interface Props {
  /** "client": quien escribe es el usuario (cliente o local). "admin": el equipo Pasify responde. */
  mode: "client" | "admin";
  /** Con mode="client": "partner" abre la conversación del local con Pasify (kind partner_admin). */
  kind?: "client" | "partner";
  /** Organización del local cuando kind="partner". */
  orgId?: string | null;
  /** Admin: usuario cuya conversación se abre (la más reciente si no llega conversationId). */
  selectedClientId?: string | null;
  /** Admin: perfil que se muestra en la cabecera. */
  selectedClient?: ClientInfo | null;
  /** Admin: conversación concreta a abrir. */
  conversationId?: string | null;
}

type LoadState = "loading" | "ready" | "error" | "signed_out" | "empty";

const SUPPORT_EMAIL = "comunicacion@avenuemedia.io";
const HORARIO = "Te respondemos en horario laboral, de lunes a viernes";
const MESSAGE_COLUMNS = "id, conversation_id, sender_id, sender_kind, body, created_at, read_at";

const monoStyle = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serifStyle = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const QUICK_PROMPTS_CLIENT = [
  "¿Cómo compro entradas?",
  "Problema con un pago",
  "Cambiar datos de mi cuenta",
  "Recuperar mi entrada",
];

const QUICK_PROMPTS_PARTNER = [
  "Duda sobre un evento",
  "Problema al validar entradas",
  "Pregunta sobre una liquidación",
  "Cambiar datos de mi local",
];

// Construye la timeline con separadores por día y agrupación por remitente.
const buildTimeline = (messages: Message[]) => {
  const items: Array<
    | { kind: "divider"; key: string; label: string }
    | { kind: "msg"; msg: Message; showAvatar: boolean }
  > = [];

  let prevDay: Date | null = null;
  let prevSender: string | null = null;

  for (const m of messages) {
    const d = new Date(m.created_at);

    if (!prevDay || !isSameDay(prevDay, d)) {
      let label: string;
      if (isToday(d)) label = "Hoy";
      else if (isYesterday(d)) label = "Ayer";
      else label = format(d, "EEEE d 'de' MMMM", { locale: es });
      items.push({ kind: "divider", key: `div-${m.id}`, label });
      prevSender = null;
    }

    const showAvatar = prevSender !== m.sender_kind;
    items.push({ kind: "msg", msg: m, showAvatar });

    prevDay = d;
    prevSender = m.sender_kind;
  }

  return items;
};

const mergeMessages = (prev: Message[], incoming: Message[]) => {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
};

/* ------------------------------------------------------------------
   Chat de soporte real contra support_conversations/support_messages.
   Hasta ahora, si no habia sesion o conversacion, el componente pasaba a
   un "modo local" que guardaba los mensajes en localStorage y se inventaba
   respuestas de Pasify. Eso ya no existe: o hay conversacion de verdad o
   se muestra un error con "Reintentar" (el borrador se conserva).
   ------------------------------------------------------------------ */
export const SupportChat = ({
  mode,
  kind = "client",
  orgId,
  selectedClientId,
  selectedClient,
  conversationId,
}: Props) => {
  const { toast } = useToast();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const readerKind = mode === "admin" ? "admin" : "client";
  const isMine = useCallback(
    (m: Message) => (mode === "admin" ? m.sender_kind === "admin" : m.sender_kind !== "admin"),
    [mode]
  );

  const markRead = useCallback(
    (id: string) => {
      void supabase
        .rpc("mark_conversation_read", { _conversation_id: id, _as_kind: readerKind })
        .then(({ error }) => {
          if (error) console.warn("[SupportChat] mark_conversation_read:", error.message);
        });
    },
    [readerKind]
  );

  // Abre (o crea) la conversación y carga sus mensajes.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setConvId(null);
    setMessages([]);

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const uid = session?.user?.id ?? null;
        if (cancelled) return;
        setUserId(uid);
        if (!uid) {
          setLoadState("signed_out");
          return;
        }

        let id: string | null = null;

        if (mode === "admin") {
          if (conversationId) {
            id = conversationId;
          } else if (selectedClientId) {
            const { data, error } = await supabase
              .from("support_conversations")
              .select("id")
              .eq("client_id", selectedClientId)
              .order("last_message_at", { ascending: false, nullsFirst: false })
              .limit(1);
            if (error) throw error;
            id = data?.[0]?.id ?? null;
          }
          if (!id) {
            if (!cancelled) setLoadState("empty");
            return;
          }
        } else if (kind === "partner") {
          // Si el panel aún no ha cargado la organización se resuelve aquí,
          // para no abrir una conversación sin org y otra con org después.
          let org = orgId ?? null;
          if (!org) {
            const { data: tenant, error: tenantError } = await supabase.rpc("tenant_for_user");
            if (tenantError) throw tenantError;
            org = (Array.isArray(tenant) ? tenant[0]?.org_id : null) ?? null;
          }
          const { data, error } = await supabase.rpc("open_conversation", {
            _kind: "partner_admin",
            ...(org ? { _org_id: org } : {}),
          });
          if (error) throw error;
          if (!data) throw new Error("open_conversation no devolvió conversación");
          id = data;
        } else {
          // Un mismo usuario puede tener varias conversaciones (por tipo o ya
          // cerradas), así que nada de maybeSingle(): la abierta más reciente.
          const { data: existing, error } = await supabase
            .from("support_conversations")
            .select("id")
            .eq("client_id", uid)
            .eq("kind", "client_admin")
            .eq("status", "open")
            .order("created_at", { ascending: false })
            .limit(1);
          if (error) throw error;
          id = existing?.[0]?.id ?? null;
          if (!id) {
            const { data: created, error: insertError } = await supabase
              .from("support_conversations")
              .insert({ client_id: uid, kind: "client_admin" })
              .select("id")
              .single();
            if (insertError) throw insertError;
            id = created.id;
          }
        }

        const { data: rows, error: messagesError } = await supabase
          .from("support_messages")
          .select(MESSAGE_COLUMNS)
          .eq("conversation_id", id)
          .order("created_at", { ascending: true });
        if (messagesError) throw messagesError;
        if (cancelled) return;

        setConvId(id);
        setMessages((rows ?? []) as Message[]);
        setLoadState("ready");
        markRead(id);
      } catch (err) {
        console.error("[SupportChat] no se pudo abrir la conversación:", err);
        if (!cancelled) setLoadState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, kind, orgId, selectedClientId, conversationId, reloadKey, markRead]);

  // Mensajes nuevos en tiempo real.
  useEffect(() => {
    if (!convId) return;
    const channel = supabase
      .channel(`support_${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const next = payload.new as Message;
          setMessages((prev) => mergeMessages(prev, [next]));
          if (!isMine(next)) markRead(convId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [convId, isMine, markRead]);

  // Realtime no reenvía lo que llegó con la app en segundo plano: al volver
  // a primer plano se recargan los mensajes.
  useEffect(() => {
    if (!convId) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const { data, error } = await supabase
        .from("support_messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      if (error || !data) return;
      setMessages((prev) => mergeMessages(prev, data as Message[]));
      markRead(convId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [convId, markRead]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, loadState]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [input]);

  const sendMessage = useCallback(
    async (overrideBody?: string) => {
      const body = (overrideBody ?? input).trim();
      if (!body || !convId || !userId || sending) return;

      setSending(true);
      // Remitente 'client' también para el local: la RLS de support_messages
      // solo acepta ese valor para quien figura como client_id de la
      // conversación, y en partner_admin ese es el propio local.
      const { data, error } = await supabase
        .from("support_messages")
        .insert({
          conversation_id: convId,
          sender_id: userId,
          sender_kind: mode === "admin" ? "admin" : "client",
          body,
        })
        .select(MESSAGE_COLUMNS)
        .single();

      if (error) {
        console.error("[SupportChat] envío fallido:", error);
        // El borrador no se pierde: sigue en el cuadro de texto para reenviarlo.
        if (overrideBody) setInput(body);
        toast({
          title: "No se ha enviado el mensaje",
          description: "Revisa tu conexión y vuelve a intentarlo.",
          variant: "destructive",
        });
      } else {
        if (!overrideBody) setInput("");
        if (data) setMessages((prev) => mergeMessages(prev, [data as Message]));
      }
      setSending(false);
    },
    [convId, userId, mode, input, sending, toast]
  );

  const otherName = useMemo(() => {
    return mode === "client"
      ? "Equipo Pasify"
      : `${selectedClient?.first_name ?? ""} ${selectedClient?.last_name ?? ""}`.trim() ||
          selectedClient?.email ||
          "Cliente";
  }, [mode, selectedClient]);

  const otherInitial = (otherName.trim()[0] ?? "?").toUpperCase();

  // Sin sesión: nada de chat simulado, se pide iniciar sesión.
  if (loadState === "signed_out" && mode === "client") {
    return (
      <div
        className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 text-center"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)" }}
      >
        <MessageCircle className="mb-3 h-10 w-10 text-orange-500/70" />
        <h3 className="text-lg font-semibold text-foreground">Soporte Pasify</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Inicia sesión para escribir al equipo de Pasify. {HORARIO}.
        </p>
        <a
          href="/#/login"
          className="mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
          style={{
            background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
          }}
        >
          Iniciar sesión
        </a>
      </div>
    );
  }

  if (mode === "admin" && (loadState === "empty" || loadState === "signed_out")) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-border bg-card text-center">
        <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">
          {loadState === "empty"
            ? "Este usuario aún no ha abierto ninguna conversación."
            : "Tu sesión ha caducado. Vuelve a iniciar sesión."}
        </p>
      </div>
    );
  }

  const timeline = buildTimeline(messages);
  const quickPrompts = kind === "partner" ? QUICK_PROMPTS_PARTNER : QUICK_PROMPTS_CLIENT;
  const ready = loadState === "ready";
  const canSend = ready && !!input.trim() && !sending;

  return (
    <article
      // Altura responsive. En móvil restamos top header (~64) + section heading
      // (~80) + bottom nav (~64) ≈ 208 px del viewport dinámico (100dvh respeta
      // la URL bar de Safari iOS). En sm+ volvemos al 70/75vh original.
      className="relative flex h-[calc(100dvh-208px)] flex-col overflow-hidden rounded-2xl border border-border bg-card sm:h-[70vh] md:h-[75vh]"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
      }}
    >
      {/* Soft terracota glow top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full"
        style={{ background: "rgba(232,84,42,0.16)", filter: "blur(80px)" }}
      />

      {/* HEADER */}
      <header className="relative flex items-center gap-3 border-b border-border px-4 py-4 md:px-5">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold"
          style={{
            background:
              mode === "client"
                ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                : "#1a1714",
            color: "#fff",
            boxShadow:
              mode === "client"
                ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.55)"
                : "inset 0 1px 0 rgba(255,255,255,0.12)",
            border: mode === "admin" ? "1px solid rgba(244,238,226,0.15)" : "none",
          }}
        >
          {mode === "client" ? <Headphones className="h-5 w-5" /> : otherInitial}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...monoStyle, letterSpacing: "0.2em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            {mode === "client" ? "Soporte · Pasify" : `Usuario · ${selectedClient?.email ?? "sin email"}`}
          </div>
          <div className="mt-0.5 truncate text-base font-semibold tracking-tight text-foreground md:text-lg">
            {otherName}
          </div>
          {mode === "client" && (
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{HORARIO}.</div>
          )}
        </div>

        {ready && (
          <div
            className="hidden text-[9px] uppercase text-muted-foreground sm:block"
            style={{ ...monoStyle, letterSpacing: "0.18em" }}
          >
            {messages.length.toString().padStart(2, "0")} mensajes
          </div>
        )}
      </header>

      {/* TIMELINE */}
      <div
        ref={scrollerRef}
        className="relative flex-1 overflow-y-auto px-4 py-5 md:px-6"
        style={{ scrollBehavior: "smooth" }}
      >
        {loadState === "loading" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs" style={{ ...monoStyle, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              Conectando…
            </span>
          </div>
        ) : loadState === "error" ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center" role="alert">
            <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-500/10 text-red-500">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h3 className="text-base font-semibold text-foreground">No hemos podido abrir el chat</h3>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Revisa tu conexión y vuelve a intentarlo. Lo que hayas escrito se conserva. Si el problema
              sigue, escríbenos a{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-orange-500 underline-offset-4 hover:underline">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-orange-500/50 hover:text-orange-500"
            >
              <RotateCcw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            mode={mode}
            quickPrompts={quickPrompts}
            onPick={(p) => {
              if (mode === "client") void sendMessage(p);
              else setInput((prev) => (prev ? `${prev} ${p}` : p));
            }}
            onStartChat={() => textareaRef.current?.focus()}
            disabled={sending}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {timeline.map((it) => {
              if (it.kind === "divider") {
                return (
                  <div key={it.key} className="my-3 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] uppercase text-muted-foreground"
                      style={{
                        ...monoStyle,
                        letterSpacing: "0.2em",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(244,238,226,0.08)",
                      }}
                    >
                      {it.label}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                );
              }

              const m = it.msg;
              const mine = isMine(m);

              return (
                <div key={m.id} className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                  {!mine && (
                    <div className="w-7 shrink-0">
                      {it.showAvatar && (
                        <div
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
                          style={{
                            background:
                              mode === "client"
                                ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                                : "#1a1714",
                            color: "#fff",
                            border: mode === "admin" ? "1px solid rgba(244,238,226,0.15)" : "none",
                          }}
                        >
                          {mode === "client" ? <Headphones className="h-3 w-3" /> : otherInitial}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`max-w-[78%] ${it.showAvatar ? "mt-2" : ""}`}>
                    {it.showAvatar && (
                      <div
                        className={`mb-1 px-1 text-[9px] uppercase ${mine ? "text-right" : ""}`}
                        style={{
                          ...monoStyle,
                          letterSpacing: "0.18em",
                          color: mine ? "rgba(232,84,42,0.85)" : "rgba(244,238,226,0.45)",
                        }}
                      >
                        {mine ? "Tú" : mode === "client" ? "Pasify" : otherName.split(" ")[0]}
                      </div>
                    )}

                    <div
                      className="rounded-2xl px-3.5 py-2.5"
                      style={{
                        background: mine
                          ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                          : "#161412",
                        color: mine ? "#fff" : "#F4EEE2",
                        fontSize: 14,
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                        boxShadow: mine
                          ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 18px -8px rgba(232,84,42,0.5)"
                          : "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 8px -4px rgba(0,0,0,0.4)",
                        border: mine ? "none" : "1px solid rgba(244,238,226,0.06)",
                      }}
                    >
                      <div className="whitespace-pre-wrap">{m.body}</div>
                    </div>

                    <div
                      className={`mt-1 flex items-center gap-1 px-1 text-[10px] ${mine ? "justify-end" : ""}`}
                      style={{ ...monoStyle, color: "rgba(244,238,226,0.4)", letterSpacing: "0.08em" }}
                    >
                      <span>{format(new Date(m.created_at), "HH:mm", { locale: es })}</span>
                      {mine && (
                        <span aria-label={m.read_at ? "Leído" : "Enviado"} className="inline-flex">
                          {m.read_at ? (
                            <CheckCheck className="h-3 w-3" style={{ color: "#4DB87A" }} />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* COMPOSER */}
      <footer className="relative border-t border-border bg-card/90 px-3 py-3 md:px-4 md:py-4">
        <div
          className="flex items-end gap-2 rounded-2xl border border-border bg-background/40 px-3 py-2 transition focus-within:border-orange-500/60"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={mode === "client" ? "Escribe tu mensaje…" : "Responde al usuario…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            className="flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
            style={{ minHeight: 22, maxHeight: 140 }}
            disabled={sending}
          />

          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!canSend}
            className="group/send inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: canSend
                ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                : "rgba(232,84,42,0.18)",
              boxShadow: canSend
                ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.6)"
                : "none",
            }}
            aria-label="Enviar mensaje"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4 transition group-hover/send:translate-x-0.5" />
            )}
          </button>
        </div>

        <div
          className="mt-2 hidden items-center px-1 text-[10px] uppercase text-muted-foreground/70 sm:flex"
          style={{ ...monoStyle, letterSpacing: "0.16em" }}
        >
          <kbd className="rounded bg-white/[0.06] px-1 py-0.5">↵</kbd>&nbsp;enviar ·&nbsp;
          <kbd className="rounded bg-white/[0.06] px-1 py-0.5">⇧↵</kbd>&nbsp;nueva línea
        </div>
      </footer>
    </article>
  );
};

// =============================================================
// Empty state with greeting + quick prompts
// =============================================================
const EmptyState = ({
  mode,
  quickPrompts,
  onPick,
  onStartChat,
  disabled,
}: {
  mode: "client" | "admin";
  quickPrompts: string[];
  onPick: (p: string) => void;
  onStartChat: () => void;
  disabled: boolean;
}) => {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-4 text-center sm:px-2 sm:py-0">
      <div
        className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-full sm:mb-6"
        style={{
          background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.6)",
        }}
      >
        <Headphones className="h-7 w-7 text-white" />
      </div>

      <div
        className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...monoStyle, letterSpacing: "0.22em" }}
      >
        <span className="inline-block h-px w-5 bg-orange-500/70" />
        Empieza la conversación
      </div>

      <h3 className="max-w-md text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
        ¿En qué te podemos{" "}
        <span style={serifStyle} className="text-orange-500">
          ayudar
        </span>
        ?
      </h3>

      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {mode === "client"
          ? `Una persona del equipo de Pasify lee cada mensaje. ${HORARIO}.`
          : "Aún no hay mensajes. Cuando el usuario escriba aparecerá aquí."}
      </p>

      {mode === "client" && (
        <>
          <div
            className="mt-7 mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...monoStyle, letterSpacing: "0.18em" }}
          >
            <span className="inline-block h-px w-4 bg-border" />
            Sugerencias
            <span className="inline-block h-px w-4 bg-border" />
          </div>

          <div className="flex max-w-md flex-wrap justify-center gap-2">
            {quickPrompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPick(p)}
                disabled={disabled}
                className="rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition hover:-translate-y-0.5 hover:border-orange-500/50 hover:text-orange-500 disabled:opacity-50"
                style={{ boxShadow: "0 2px 8px -4px rgba(0,0,0,0.3)" }}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Enfoca el composer: en móvil la entrada quedaba bajo la bottom nav
              y al pulsar el botón el teclado virtual sube. */}
          <button
            type="button"
            onClick={onStartChat}
            className="mt-7 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
            }}
          >
            <MessageCircle className="h-4 w-4" />
            Escribir mensaje
          </button>
        </>
      )}
    </div>
  );
};

export default SupportChat;
