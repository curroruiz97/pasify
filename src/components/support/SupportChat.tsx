import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Send,
  Paperclip,
  MessageCircle,
  Headphones,
  CheckCheck,
  Check,
  Clock,
  X,
  FileText,
  History,
  Plus,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, isSameDay, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";

type Attachment = { name: string; size: number; type: string };

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_kind: "client" | "admin";
  body: string;
  created_at: string;
  read_at: string | null;
  attachment?: Attachment | null;
};

type Conversation = {
  id: string;
  client_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_for_admin: number;
  unread_for_client: number;
};

type ClientInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

interface Props {
  /** "client" → l'utente è il cliente (vede solo la propria conv). "admin" → vede tutte e seleziona. */
  mode: "client" | "admin";
  /** Per admin: id del client la cui conv è aperta. Per client: ignorato. */
  selectedClientId?: string | null;
  /** Profilo del cliente quando admin → mostrato come header. */
  selectedClient?: ClientInfo | null;
}

const monoStyle = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serifStyle = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const QUICK_PROMPTS_CLIENT = [
  "¿Cómo compro entradas?",
  "Problema con un pago",
  "Cambiar datos de mi cuenta",
  "Recuperar mi entrada",
];

const QUICK_PROMPTS_ADMIN = [
  "Hola, ¿en qué puedo ayudarte?",
  "Lo reviso ahora mismo.",
  "Te he enviado el reembolso.",
  "¿Puedes confirmar tu email?",
];

// Generatore di risposte automatiche per la demo locale (quando Supabase
// non è configurato). Match keyword → reply tematica; fallback generico.
const generateDemoReply = (userBody: string): string => {
  const t = userBody.toLowerCase();
  if (/pag(o|ar)|cobr|tarjet|stripe|reembols/.test(t)) {
    return "Veo tu pago en nuestro sistema. Dame un momento mientras lo verifico con el equipo de cobros.";
  }
  if (/evento|festival|cartel|line[- ]?up/.test(t)) {
    return "Claro, te ayudo con el evento. ¿Tienes el código de la entrada o el nombre del local?";
  }
  if (/entrada|ticket|qr/.test(t)) {
    return "Para recuperar la entrada necesitamos el email con el que compraste. ¿Me lo confirmas?";
  }
  if (/cuenta|email|contraseña|password|datos/.test(t)) {
    return "Para cambiar los datos de tu cuenta puedes ir a Perfil → Editar. Si prefieres lo hacemos nosotros, dime qué necesitas actualizar.";
  }
  if (/cancel|baja|borrar/.test(t)) {
    return "Sin problema, te ayudo con la cancelación. ¿Me confirmas el número de pedido?";
  }
  if (/hola|buenas|hey/.test(t)) {
    return "¡Hola! Soy del equipo de soporte Pasify. Cuéntame, ¿en qué te ayudo?";
  }
  if (/gracias|graci/.test(t)) {
    return "Un placer ayudarte. Si necesitas algo más, aquí estamos.";
  }
  return "Recibido. Estoy revisando tu mensaje y te respondo en un momento.";
};

type LocalSession = {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  preview: string;
  messages: Message[];
};

const SESSIONS_KEY_PREFIX = "pasify.support.sessions";
const sessionsStorageKey = (mode: "client" | "admin", peerId: string) =>
  `${SESSIONS_KEY_PREFIX}.${mode}.${peerId}.v2`;

const readSessions = (key: string): LocalSession[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: any) =>
        s &&
        typeof s.id === "string" &&
        typeof s.startedAt === "string" &&
        Array.isArray(s.messages)
    );
  } catch {
    return [];
  }
};

const writeSessions = (key: string, sessions: LocalSession[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(sessions));
  } catch {
    /* storage piena / disabilitata */
  }
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// Costruisce la timeline con day-dividers e raggruppamento per sender.
const buildTimeline = (messages: Message[]) => {
  const items: Array<
    | { kind: "divider"; key: string; label: string }
    | { kind: "msg"; msg: Message; showAvatar: boolean }
  > = [];

  let prevDay: Date | null = null;
  let prevSender: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
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

export const SupportChat = ({ mode, selectedClientId, selectedClient }: Props) => {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [remoteMessages, setRemoteMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replyTimerRef = useRef<number | null>(null);

  // Init: prova a connettersi a Supabase. Se non c'è user o conv → modo locale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (cancelled) return;
        const uid = u.user?.id ?? null;
        setUserId(uid);

        if (mode === "client" && uid) {
          const { data: existing } = await supabase
            .from("support_conversations")
            .select("*")
            .eq("client_id", uid)
            .maybeSingle();
          if (cancelled) return;
          if (existing) {
            setConv(existing as Conversation);
          } else {
            const { data: created } = await supabase
              .from("support_conversations")
              .insert({ client_id: uid })
              .select()
              .single();
            if (!cancelled && created) setConv(created as Conversation);
          }
        } else if (mode === "admin" && selectedClientId) {
          const { data: existing } = await supabase
            .from("support_conversations")
            .select("*")
            .eq("client_id", selectedClientId)
            .maybeSingle();
          if (!cancelled) setConv((existing as Conversation) ?? null);
        }
      } catch {
        /* offline / modo locale */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedClientId]);

  // Modo locale: load list di sessioni storiche. NON auto-selezioniamo nessuna —
  // ogni apertura del chat parte da zero (currentSessionId=null).
  const peerKey = mode === "client" ? "self" : selectedClientId ?? "none";
  const sessionsKey = sessionsStorageKey(mode, peerKey);
  useEffect(() => {
    setSessions(readSessions(sessionsKey));
    setCurrentSessionId(null);
  }, [sessionsKey]);

  // Persiste le sessioni a ogni cambio.
  useEffect(() => {
    writeSessions(sessionsKey, sessions);
  }, [sessionsKey, sessions]);

  // Determina mode online (Supabase ok) vs locale (fallback).
  const isLocalMode = !conv || !userId;
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId]
  );
  const localMessages = currentSession?.messages ?? [];
  const displayedMessages = isLocalMode ? localMessages : remoteMessages;

  // Online: load + subscribe realtime
  useEffect(() => {
    if (!conv) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true });
      if (error) return;
      if (!cancelled) setRemoteMessages((data ?? []) as Message[]);
    })();

    const channel = supabase
      .channel(`support_${conv.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${conv.id}` },
        (payload) => {
          setRemoteMessages((prev) => {
            const next = payload.new as Message;
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conv]);

  // Auto-scroll on any timeline update (incl. typing indicator).
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [displayedMessages, peerTyping]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [input]);

  // Cleanup pending reply timer
  useEffect(() => {
    return () => {
      if (replyTimerRef.current) window.clearTimeout(replyTimerRef.current);
    };
  }, []);

  const newMessageId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  };

  const sendMessage = useCallback(
    async (overrideBody?: string) => {
      const body = (overrideBody ?? input).trim();
      const attachment = pendingAttachment;
      if (!body && !attachment) return;

      setSending(true);

      // Modo locale: crea/append a sessione, e (per il client) genera reply demo.
      if (isLocalMode) {
        const now = new Date().toISOString();
        const msg: Message = {
          id: newMessageId(),
          conversation_id: "local",
          sender_id: "local-self",
          sender_kind: mode,
          body,
          attachment,
          created_at: now,
          read_at: null,
        };
        const preview = body || (attachment ? `📎 ${attachment.name}` : "");

        // Determina/crea la sessione attiva.
        let sessionId = currentSessionId;
        if (!sessionId) {
          sessionId = newMessageId();
          setCurrentSessionId(sessionId);
          setSessions((prev) => [
            ...prev,
            {
              id: sessionId!,
              startedAt: now,
              lastMessageAt: now,
              preview: preview.slice(0, 80),
              messages: [msg],
            },
          ]);
        } else {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    lastMessageAt: now,
                    preview: s.messages.length === 0 ? preview.slice(0, 80) : s.preview,
                    messages: [...s.messages, msg],
                  }
                : s
            )
          );
        }

        setInput("");
        setPendingAttachment(null);

        // Solo il client riceve auto-reply (l'admin sta scrivendo "come admin").
        if (mode === "client") {
          if (replyTimerRef.current) window.clearTimeout(replyTimerRef.current);
          setPeerTyping(true);
          const sid = sessionId;
          replyTimerRef.current = window.setTimeout(() => {
            const reply: Message = {
              id: newMessageId(),
              conversation_id: "local",
              sender_id: "local-pasify",
              sender_kind: "admin",
              body: generateDemoReply(body || (attachment ? `Archivo: ${attachment.name}` : "")),
              created_at: new Date().toISOString(),
              read_at: new Date().toISOString(),
            };
            setSessions((prev) =>
              prev.map((s) =>
                s.id === sid
                  ? {
                      ...s,
                      lastMessageAt: reply.created_at,
                      messages: [
                        ...s.messages.map((m) =>
                          m.sender_kind === "client" && !m.read_at
                            ? { ...m, read_at: new Date().toISOString() }
                            : m
                        ),
                        reply,
                      ],
                    }
                  : s
              )
            );
            setPeerTyping(false);
          }, 1200 + Math.random() * 800);
        }

        setSending(false);
        return;
      }

      // Modo online: invio reale a Supabase.
      const { error } = await supabase.from("support_messages").insert({
        conversation_id: conv!.id,
        sender_id: userId!,
        sender_kind: mode,
        body: attachment ? `${body}\n📎 ${attachment.name} · ${formatFileSize(attachment.size)}` : body,
      });

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setInput(body);
      } else {
        setInput("");
        setPendingAttachment(null);
      }
      setSending(false);
    },
    [conv, userId, mode, input, pendingAttachment, isLocalMode, currentSessionId, toast]
  );

  const handleFilePick = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Archivo demasiado grande", description: "Máximo 10 MB.", variant: "destructive" });
      return;
    }
    setPendingAttachment({ name: file.name, size: file.size, type: file.type });
    textareaRef.current?.focus();
  };

  const otherName = useMemo(() => {
    return mode === "client"
      ? "Equipo Pasify"
      : `${selectedClient?.first_name ?? ""} ${selectedClient?.last_name ?? ""}`.trim() ||
          selectedClient?.email ||
          "Cliente";
  }, [mode, selectedClient]);

  const otherInitial = (otherName.trim()[0] ?? "?").toUpperCase();

  if (loading) {
    return (
      <div
        className="flex h-[70vh] items-center justify-center rounded-2xl border border-border bg-card"
        style={{ boxShadow: "0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Clock className="h-5 w-5 animate-spin" />
          <span className="text-xs" style={{ ...monoStyle, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Conectando…
          </span>
        </div>
      </div>
    );
  }

  if (mode === "admin" && !conv && !isLocalMode) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-border bg-card text-center">
        <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Este cliente aún no ha abierto la conversación.</p>
      </div>
    );
  }

  const timeline = buildTimeline(displayedMessages);
  const quickPrompts = mode === "client" ? QUICK_PROMPTS_CLIENT : QUICK_PROMPTS_ADMIN;
  const hasMessages = displayedMessages.length > 0;
  const canSend = !!(input.trim() || pendingAttachment);

  return (
    <article
      className="relative flex h-[75vh] flex-col overflow-hidden rounded-2xl border border-border bg-card"
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
        <div className="relative shrink-0">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full text-base font-bold"
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
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3" aria-label="Online">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ background: "#4DB87A" }}
            />
            <span
              className="relative inline-flex h-3 w-3 rounded-full border-2"
              style={{ background: "#4DB87A", borderColor: "#1f1f1f" }}
            />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...monoStyle, letterSpacing: "0.2em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            {mode === "client" ? "Soporte · Pasify" : `Cliente · ${selectedClient?.email ?? "anónimo"}`}
          </div>
          <div className="mt-0.5 truncate text-base font-semibold tracking-tight text-foreground md:text-lg">
            {otherName}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: "#4DB87A" }}>
              <span className="relative inline-flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                  style={{ background: "#4DB87A" }}
                />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#4DB87A" }} />
              </span>
              En línea
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span style={monoStyle}>Respuesta &lt; 5 min</span>
          </div>
        </div>

        <div className="hidden flex-col items-end gap-0.5 sm:flex">
          <div className="text-[9px] uppercase text-muted-foreground" style={{ ...monoStyle, letterSpacing: "0.18em" }}>
            {displayedMessages.length.toString().padStart(2, "0")} mensajes
          </div>
          {isLocalMode && (
            <div
              className="rounded-full px-2 py-0.5 text-[9px] uppercase"
              style={{
                ...monoStyle,
                letterSpacing: "0.18em",
                background: "rgba(232,176,76,0.12)",
                color: "#E8B04C",
                border: "1px solid rgba(232,176,76,0.3)",
              }}
              title="Sin conexión a Supabase: los mensajes se guardan en este dispositivo"
            >
              Modo demo
            </div>
          )}
        </div>

        {/* Header action buttons — Nueva + Historial */}
        <div className="flex shrink-0 items-center gap-1">
          {currentSessionId && (
            <button
              type="button"
              onClick={() => {
                setCurrentSessionId(null);
                setInput("");
                setPendingAttachment(null);
                if (replyTimerRef.current) window.clearTimeout(replyTimerRef.current);
                setPeerTyping(false);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-orange-500"
              aria-label="Nueva conversación"
              title="Nueva conversación"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full transition ${
              historyOpen
                ? "bg-orange-500/15 text-orange-500"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-orange-500"
            }`}
            aria-label="Historial de conversaciones"
            title="Historial de conversaciones"
            aria-expanded={historyOpen}
          >
            <History className="h-4 w-4" />
            {sessions.length > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white"
                style={{
                  ...monoStyle,
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 100%)",
                  boxShadow: "0 2px 6px -2px rgba(232,84,42,0.6)",
                }}
              >
                {sessions.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* TIMELINE */}
      <div
        ref={scrollerRef}
        className="relative flex-1 overflow-y-auto px-4 py-5 md:px-6"
        style={{ scrollBehavior: "smooth" }}
      >
        {!hasMessages ? (
          <EmptyState
            mode={mode}
            quickPrompts={quickPrompts}
            onPick={(p) => {
              if (mode === "client") sendMessage(p);
              else setInput((prev) => (prev ? `${prev} ${p}` : p));
            }}
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
              const mine =
                (mode === "client" && m.sender_kind === "client") ||
                (mode === "admin" && m.sender_kind === "admin");

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
                      {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                      {m.attachment && (
                        <div
                          className={`${m.body ? "mt-2" : ""} inline-flex items-center gap-2 rounded-lg px-2 py-1.5`}
                          style={{
                            background: mine ? "rgba(255,255,255,0.18)" : "rgba(244,238,226,0.05)",
                            border: `1px solid ${mine ? "rgba(255,255,255,0.25)" : "rgba(244,238,226,0.1)"}`,
                          }}
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium">{m.attachment.name}</div>
                            <div
                              className="text-[10px] opacity-80"
                              style={{ ...monoStyle, letterSpacing: "0.08em" }}
                            >
                              {formatFileSize(m.attachment.size)}
                            </div>
                          </div>
                        </div>
                      )}
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

            {/* Typing indicator */}
            {peerTyping && (
              <div className="mt-1 flex items-end gap-2">
                <div className="w-7 shrink-0">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full"
                    style={{
                      background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                      color: "#fff",
                    }}
                  >
                    <Headphones className="h-3 w-3" />
                  </div>
                </div>
                <div
                  className="inline-flex items-center gap-1 rounded-2xl px-4 py-3"
                  style={{
                    background: "#161412",
                    border: "1px solid rgba(244,238,226,0.06)",
                  }}
                >
                  <TypingDot delay="0ms" />
                  <TypingDot delay="160ms" />
                  <TypingDot delay="320ms" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* COMPOSER */}
      <footer className="relative border-t border-border bg-card/90 px-3 py-3 md:px-4 md:py-4">
        {/* Pending attachment pill */}
        {pendingAttachment && (
          <div
            className="mb-2 inline-flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2"
            style={{ boxShadow: "0 4px 12px -6px rgba(0,0,0,0.3)" }}
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 100%)",
                color: "#fff",
              }}
            >
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">{pendingAttachment.name}</div>
              <div
                className="text-[10px] uppercase text-muted-foreground"
                style={{ ...monoStyle, letterSpacing: "0.14em" }}
              >
                {formatFileSize(pendingAttachment.size)} · Listo para enviar
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
              aria-label="Quitar adjunto"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            handleFilePick(e.target.files?.[0] ?? null);
            // reset so picking the same file again re-triggers onChange
            e.target.value = "";
          }}
        />

        <div
          className="flex items-end gap-2 rounded-2xl border border-border bg-background/40 px-3 py-2 transition focus-within:border-orange-500/60"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-white/[0.06] hover:text-orange-500"
            aria-label="Adjuntar archivo"
            title="Adjuntar archivo"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={mode === "client" ? "Escribe tu mensaje…" : "Responde al cliente…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            className="flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
            style={{ minHeight: 22, maxHeight: 140 }}
            disabled={sending}
          />

          <button
            type="button"
            onClick={() => sendMessage()}
            disabled={sending || !canSend}
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
            <Send className="h-4 w-4 transition group-hover/send:translate-x-0.5" />
          </button>
        </div>

        <div
          className="mt-2 flex items-center justify-between px-1 text-[10px] uppercase text-muted-foreground/70"
          style={{ ...monoStyle, letterSpacing: "0.16em" }}
        >
          <span>
            <kbd className="rounded bg-white/[0.06] px-1 py-0.5">↵</kbd> enviar ·{" "}
            <kbd className="rounded bg-white/[0.06] px-1 py-0.5">⇧↵</kbd> nueva línea
          </span>
          <span>{isLocalMode ? "Demo · Local" : "End-to-end · Pasify"}</span>
        </div>
      </footer>

      {/* HISTORY PANEL — overlay desde la derecha */}
      {historyOpen && (
        <div
          className="absolute inset-0 z-30 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Conversaciones anteriores"
        >
          {/* Backdrop */}
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            className="flex-1 cursor-default bg-black/40 backdrop-blur-sm"
            aria-label="Cerrar historial"
          />
          {/* Panel */}
          <aside
            className="flex w-full max-w-sm flex-col border-l border-border bg-card"
            style={{ boxShadow: "-20px 0 60px -20px rgba(0,0,0,0.6)" }}
          >
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <div
                  className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                  style={{ ...monoStyle, letterSpacing: "0.2em" }}
                >
                  <span className="inline-block h-px w-5 bg-orange-500/70" />
                  Historial
                </div>
                <h3 className="mt-0.5 text-base font-semibold tracking-tight text-foreground">
                  Conversaciones ({sessions.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-3">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <MessageCircle className="mb-3 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    Aún no tienes conversaciones guardadas.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {[...sessions]
                    .sort(
                      (a, b) =>
                        new Date(b.lastMessageAt).getTime() -
                        new Date(a.lastMessageAt).getTime()
                    )
                    .map((s) => {
                      const isActive = s.id === currentSessionId;
                      const d = new Date(s.lastMessageAt);
                      const label = isToday(d)
                        ? `Hoy · ${format(d, "HH:mm", { locale: es })}`
                        : isYesterday(d)
                        ? `Ayer · ${format(d, "HH:mm", { locale: es })}`
                        : format(d, "d MMM · HH:mm", { locale: es });
                      return (
                        <li key={s.id}>
                          <div
                            className={`group/sess relative flex items-start gap-3 rounded-xl border p-3 transition ${
                              isActive
                                ? "border-orange-500/60 bg-orange-500/[0.08]"
                                : "border-border bg-card hover:border-orange-500/40 hover:bg-white/[0.02]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentSessionId(s.id);
                                setHistoryOpen(false);
                              }}
                              className="flex flex-1 items-start gap-3 text-left"
                            >
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                                style={{
                                  background:
                                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                                  color: "#fff",
                                  boxShadow:
                                    "inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 10px -4px rgba(232,84,42,0.5)",
                                }}
                              >
                                <Headphones className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div
                                  className="text-[10px] uppercase"
                                  style={{
                                    ...monoStyle,
                                    letterSpacing: "0.16em",
                                    color: isActive ? "#FF7A4D" : "rgba(244,238,226,0.5)",
                                  }}
                                >
                                  {label}
                                  <span className="mx-1.5 opacity-50">·</span>
                                  {s.messages.length.toString().padStart(2, "0")} msj
                                </div>
                                <div
                                  className="mt-1 line-clamp-2 text-sm leading-snug text-foreground"
                                  style={{ letterSpacing: "-0.005em" }}
                                >
                                  {s.preview || "(sin contenido)"}
                                </div>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSessions((prev) => prev.filter((x) => x.id !== s.id));
                                if (currentSessionId === s.id) setCurrentSessionId(null);
                              }}
                              className="opacity-0 transition group-hover/sess:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-red-400"
                              aria-label="Eliminar conversación"
                              title="Eliminar"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>

            <footer className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => {
                  setCurrentSessionId(null);
                  setHistoryOpen(false);
                  setInput("");
                  setPendingAttachment(null);
                  if (replyTimerRef.current) window.clearTimeout(replyTimerRef.current);
                  setPeerTyping(false);
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white transition"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                }}
              >
                <Plus className="h-4 w-4" />
                Nueva conversación
              </button>
              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("¿Borrar todo el historial de conversaciones?")) {
                      setSessions([]);
                      setCurrentSessionId(null);
                    }
                  }}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] uppercase text-muted-foreground transition hover:text-red-400"
                  style={{ ...monoStyle, letterSpacing: "0.16em" }}
                >
                  <Trash2 className="h-3 w-3" />
                  Borrar todo
                </button>
              )}
            </footer>
          </aside>
        </div>
      )}
    </article>
  );
};

// =============================================================
// Typing indicator dot
// =============================================================
const TypingDot = ({ delay }: { delay: string }) => (
  <span
    className="inline-block h-2 w-2 rounded-full"
    style={{
      background: "#8A8275",
      animation: "pasify-typing-bounce 1.2s ease-in-out infinite",
      animationDelay: delay,
    }}
  />
);

// =============================================================
// Empty state with greeting + quick prompts
// =============================================================
const EmptyState = ({
  mode,
  quickPrompts,
  onPick,
}: {
  mode: "client" | "admin";
  quickPrompts: string[];
  onPick: (p: string) => void;
}) => {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 text-center">
      <div className="relative mb-6 flex h-16 w-16 items-center justify-center">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
          style={{ background: "rgba(232,84,42,0.3)" }}
        />
        <div
          className="relative flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.6)",
          }}
        >
          <Headphones className="h-7 w-7 text-white" />
        </div>
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
          ? "Una persona real del equipo Pasify te responde en menos de 5 minutos. Sin bots, sin filas."
          : "Aún no hay mensajes. Cuando el cliente escriba aparecerá aquí."}
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
                className="rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition hover:-translate-y-0.5 hover:border-orange-500/50 hover:text-orange-500"
                style={{ boxShadow: "0 2px 8px -4px rgba(0,0,0,0.3)" }}
              >
                {p}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SupportChat;
