import { useState } from "react";
import {
  Car,
  Crown,
  Diamond,
  Gem,
  Hotel,
  MapPin,
  MessageSquare,
  Phone,
  Plane,
  Send,
  Sparkles,
  Star,
  Wine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface ConciergeMessage {
  id: string;
  role: "user" | "concierge";
  name: string;
  text: string;
  at: Date;
}

const initialMessages: ConciergeMessage[] = [
  {
    id: "cm-0",
    role: "concierge",
    name: "Alba · Concierge",
    text:
      "Buenas noches. Soy Alba del equipo Concierge de Pasify. Veo que tienes entrada en Pacha el sábado — ¿quieres que te organice la noche completa? Mesa, restaurante antes y vuelta al hotel después si lo necesitas.",
    at: new Date(Date.now() - 30 * 60 * 1000),
  },
];

const SUGGESTIONS = [
  "Quiero mesa para 6 con bottle service",
  "Cena pija antes del evento, sushi top en Ibiza",
  "Traslado del hotel al evento y vuelta",
  "Acceso backstage del headliner",
];

export const ClientConcierge = () => {
  const [messages, setMessages] = useState<ConciergeMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = (text?: string) => {
    const body = (text ?? input).trim();
    if (!body) return;
    const userMsg: ConciergeMessage = {
      id: `m-${Date.now()}`,
      role: "user",
      name: "Tú",
      text: body,
      at: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setTimeout(() => {
      const reply: ConciergeMessage = {
        id: `m-${Date.now() + 1}`,
        role: "concierge",
        name: "Alba · Concierge",
        text: generateConciergeReply(body),
        at: new Date(),
      };
      setMessages((prev) => [...prev, reply]);
      setSending(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Hero premium */}
      <header
        className="relative overflow-hidden rounded-2xl border p-6 md:p-8 text-white"
        style={{
          background:
            "linear-gradient(135deg, #B8381A 0%, #6F1F08 60%, #1A0F08 100%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.15), 0 24px 60px -24px rgba(184,56,26,0.7)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            mixBlendMode: "overlay",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.4)", filter: "blur(80px)" }}
        />

        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.22em", color: "rgba(255,255,255,0.85)" }}
            >
              <Crown className="h-3 w-3" />
              Concierge Premium · Icon tier
            </div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              Tu noche, <span style={serif}>orquestada</span>.
            </h2>
            <p
              className="mt-2 max-w-xl text-sm leading-relaxed"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Una persona del equipo Pasify te organiza la noche entera: mesa VIP, restaurante, traslado, hotel, backstage. Respuesta en menos de 10 minutos, 7 días a la semana.
            </p>
          </div>
          <div className="hidden sm:block">
            <div
              className="grid h-20 w-20 place-items-center rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.15)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
              }}
            >
              <Gem className="h-10 w-10" />
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ServiceTile icon={<Wine className="h-4 w-4" />} label="Mesas VIP" />
          <ServiceTile icon={<Hotel className="h-4 w-4" />} label="Restaurante" />
          <ServiceTile icon={<Car className="h-4 w-4" />} label="Transporte" />
          <ServiceTile icon={<Star className="h-4 w-4" />} label="Backstage" />
        </div>
      </header>

      {/* Concierge chat */}
      <article
        className="relative flex h-[68vh] flex-col overflow-hidden rounded-2xl border border-border bg-card"
        style={{
          boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
        }}
      >
        <header className="flex items-center gap-3 border-b border-border px-4 py-4 md:px-5">
          <div className="relative shrink-0">
            <div
              className="grid h-11 w-11 place-items-center rounded-full text-base font-bold text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.55)",
              }}
            >
              <Crown className="h-5 w-5" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
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
              className="text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              Concierge Premium
            </div>
            <div className="truncate text-base font-semibold tracking-tight text-foreground">
              Alba · tu concierge
            </div>
            <div
              className="mt-0.5 text-[11px]"
              style={{ ...mono, color: "#4DB87A" }}
            >
              En línea · Respuesta &lt; 10 min
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="space-y-3">
            {messages.map((m) => {
              const mine = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
                >
                  {!mine && (
                    <div
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
                      style={{
                        background:
                          "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                      }}
                    >
                      <Crown className="h-3 w-3" />
                    </div>
                  )}
                  <div className="max-w-[78%]">
                    <div
                      className={`mb-1 px-1 text-[9px] uppercase ${mine ? "text-right" : ""}`}
                      style={{
                        ...mono,
                        letterSpacing: "0.18em",
                        color: mine ? "rgba(232,84,42,0.85)" : "rgba(244,238,226,0.5)",
                      }}
                    >
                      {m.name}
                    </div>
                    <div
                      className="rounded-2xl px-3.5 py-2.5"
                      style={{
                        background: mine
                          ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                          : "#161412",
                        color: mine ? "#fff" : "#F4EEE2",
                        fontSize: 14,
                        lineHeight: 1.5,
                        boxShadow: mine
                          ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 18px -8px rgba(232,84,42,0.5)"
                          : "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 8px -4px rgba(0,0,0,0.4)",
                        border: mine ? "none" : "1px solid rgba(244,238,226,0.06)",
                      }}
                    >
                      {m.text}
                    </div>
                    <div
                      className={`mt-1 text-[10px] ${mine ? "text-right" : ""}`}
                      style={{ ...mono, color: "rgba(244,238,226,0.4)", letterSpacing: "0.08em" }}
                    >
                      {m.at.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })}
            {sending && (
              <div className="flex items-end gap-2">
                <div
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  }}
                >
                  <Crown className="h-3 w-3" />
                </div>
                <div
                  className="inline-flex items-center gap-1 rounded-2xl border border-border px-4 py-3"
                  style={{ background: "#161412" }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "#8A8275", animation: "pasify-typing-bounce 1.2s ease-in-out infinite" }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "#8A8275", animation: "pasify-typing-bounce 1.2s ease-in-out infinite", animationDelay: "160ms" }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "#8A8275", animation: "pasify-typing-bounce 1.2s ease-in-out infinite", animationDelay: "320ms" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Suggestions */}
        {messages.length <= 1 && (
          <div className="border-t border-border px-4 pt-3 md:px-6">
            <div
              className="mb-2 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.18em" }}
            >
              Sugerencias
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:-translate-y-0.5 hover:border-orange-500/50 hover:text-orange-500"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Composer */}
        <footer className="border-t border-border bg-card/90 px-3 py-3 md:px-4 md:py-4">
          <div
            className="flex items-end gap-2 rounded-2xl border border-border bg-background/40 px-3 py-2 transition focus-within:border-orange-500/60"
          >
            <textarea
              rows={1}
              placeholder="Pide lo que necesites…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              className="flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
              style={{ minHeight: 22, maxHeight: 140 }}
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="group/send inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: input.trim()
                  ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                  : "rgba(232,84,42,0.18)",
                boxShadow: input.trim()
                  ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.6)"
                  : "none",
              }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </article>
    </div>
  );
};

const ServiceTile = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
  <div
    className="rounded-xl border p-3"
    style={{
      background: "rgba(255,255,255,0.08)",
      borderColor: "rgba(255,255,255,0.15)",
    }}
  >
    <div className="flex items-center gap-2">
      <span style={{ color: "rgba(255,255,255,0.9)" }}>{icon}</span>
      <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.95)" }}>
        {label}
      </span>
    </div>
  </div>
);

const generateConciergeReply = (input: string): string => {
  const t = input.toLowerCase();
  if (/mesa|reservar|bottle|botella/.test(t)) {
    return "Perfecto. He bloqueado tentativamente la Mesa 02 (zona VIP Center, capacidad 8, mínimo 80€). ¿Veu Cliquot Rosé o algo más fuerte tipo Belvedere? Te confirmo en cuanto la cocina lo registre, normalmente 5 min.";
  }
  if (/cena|restaurante|sushi/.test(t)) {
    return "Te recomiendo Sushi Cabeza en Ibiza ciudad — minimal, sin colas si reservo desde aquí. Mesa para 2/4/6/8/+. ¿A qué hora os quedaríais antes del evento?";
  }
  if (/traslado|coche|taxi|hotel/.test(t)) {
    return "Tenemos servicio de transporte VIP por 35€ ida + vuelta. Mercedes Clase V o Tesla Model Y según preferencia. ¿A qué hora la recogida y desde qué hotel?";
  }
  if (/backstage|meet|artista/.test(t)) {
    return "Confirmo: el headliner de mañana acepta meet&greet de 10 min para clientes Icon tier. Plazas limitadas a 6. ¿Reservo tu plaza?";
  }
  return "Te he leído — voy a coordinarlo con el local y vuelvo en 5-10 minutos con confirmación. ¿Algo más que añada al plan?";
};

export default ClientConcierge;
