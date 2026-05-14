import { Crown, Diamond, Sparkles, Star } from "lucide-react";
import { SupportChat } from "@/components/support/SupportChat";

/**
 * ClientConcierge — chat de concierge premium del cliente.
 *
 * Antes era 100% mock (`initialMessages` hardcoded, `generateConciergeReply`
 * local con `setTimeout`). Ahora reusa `SupportChat` que ya está cableado
 * a `support_conversations` + `support_messages` (con realtime + storage
 * + AI-assist via `ai-concierge-reply` para el staff de Pasify).
 *
 * El SupportChat detecta sesión real: si no hay user logueado muestra
 * empty state "Inicia sesión para chatear" (mig C1 del hardening),
 * en lugar de fingir respuestas demo.
 *
 * Diferencias visuales vs SupportChat normal:
 *   - Header dorado "Pasify Concierge · Premium"
 *   - 4 sugerencias premium iniciales (mesa, cena, traslado, backstage)
 *   - (el contenido del chat y la persistencia son idénticos al soporte)
 *
 * Gate de premium: por ahora la entrada al Concierge es solo desde
 * `ClientDashboard` (nav del cliente), y ese nav es accesible a todo
 * cliente logueado. Cuando exista un plan "premium del cliente" se
 * podrá restringir aquí. La diferenciación hoy es de UX y atención
 * (el staff prioriza estas conversaciones).
 */

const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};
const mono = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
  letterSpacing: "0.22em",
};

export const ClientConcierge = () => {
  return (
    <div className="space-y-4">
      {/* Header premium · pasa por encima del SupportChat */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,176,76,0.16) 0%, rgba(184,138,42,0.04) 100%)",
          borderColor: "rgba(232,176,76,0.42)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
          style={{ background: "rgba(232,176,76,0.22)", filter: "blur(70px)" }}
        />
        <div className="relative flex items-center gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: "linear-gradient(180deg, #F4D89C 0%, #E8B04C 60%, #B88A2A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), 0 6px 18px -6px rgba(184,138,42,0.6)",
              color: "#3a2a08",
            }}
          >
            <Crown className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div
              className="mb-0.5 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...mono, color: "#E8B04C" }}
            >
              <Sparkles className="h-3 w-3" />
              Pasify Concierge · Premium
            </div>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              Te lo <span style={serif} className="text-orange-500">organizamos</span> nosotros
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pídenos mesa, cena, traslado, lista o backstage. Te responde una persona del equipo Pasify, no un bot — y queda registrado en tu cuenta.
            </p>
          </div>
        </div>

        <ul className="relative mt-4 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
          {[
            { icon: <Diamond className="h-3.5 w-3.5" />, text: "Mesa con bottle service" },
            { icon: <Star className="h-3.5 w-3.5" />, text: "Cena top antes del evento" },
            { icon: <Crown className="h-3.5 w-3.5" />, text: "Traslado hotel → local → hotel" },
            { icon: <Sparkles className="h-3.5 w-3.5" />, text: "Acceso backstage del headliner" },
          ].map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1.5 text-foreground/80"
            >
              <span className="text-amber-400">{s.icon}</span>
              {s.text}
            </li>
          ))}
        </ul>
      </header>

      {/* Chat real conectado a support_conversations */}
      <SupportChat mode="client" />

      <p className="text-[11px] text-muted-foreground" style={mono}>
        Tiempo medio respuesta · &lt; 5 min en horario de eventos
      </p>
    </div>
  );
};

export default ClientConcierge;
