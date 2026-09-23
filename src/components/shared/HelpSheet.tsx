import { useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeft,
  Clock,
  HelpCircle,
  LifeBuoy,
  Mail,
  MessageCircle,
  Search,
  Sparkles,
} from "lucide-react";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

/** Mismo correo que publica la página pública /soporte. */
const SUPPORT_EMAIL = "comunicacion@avenuemedia.io";
const HORARIO = "Te respondemos en horario laboral, de lunes a viernes.";

export type HelpRole = "client" | "partner" | "admin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: HelpRole;
  /** Callback opcional para que el host abra la conversación de soporte */
  onOpenSupport?: () => void;
  /** Si está, muestra un quick-action para reabrir el onboarding (rol partner). */
  onReopenOnboarding?: () => void;
}

interface FAQItem {
  q: string;
  a: string;
  tag?: string;
}

/* Solo preguntas sobre funciones que existen hoy en la app. Si una
   pantalla cambia de nombre o desaparece, su respuesta tiene que cambiar
   con ella. */

const COMMON_FAQ: FAQItem[] = [
  {
    q: "He olvidado mi contraseña, ¿qué hago?",
    a: "En la pantalla de inicio de sesión pulsa «¿Olvidaste tu contraseña?» y te enviaremos un enlace por email para crear una nueva.",
    tag: "Cuenta",
  },
  {
    q: "¿Cómo cambio mi contraseña?",
    a: "En Configuración → Seguridad → Cambiar contraseña. Debe tener al menos 8 caracteres.",
    tag: "Seguridad",
  },
  {
    q: "He iniciado sesión en un dispositivo que ya no uso",
    a: "En Configuración → Seguridad → Cerrar sesión en otros dispositivos. El dispositivo en el que estás sigue conectado.",
    tag: "Seguridad",
  },
  {
    q: "¿Cómo pido una copia de mis datos?",
    a: "En Configuración → Privacidad → Descargar mis datos. Se abre tu correo con la solicitud ya redactada y te respondemos en un plazo máximo de 30 días.",
    tag: "Privacidad",
  },
];

const CLIENT_FAQ: FAQItem[] = [
  {
    q: "¿Dónde están mis entradas?",
    a: "En la pestaña Tickets. Pulsa una entrada para mostrar su código QR en la puerta. Entra siempre con la misma cuenta con la que compraste.",
    tag: "Entradas",
  },
  {
    q: "El QR no se valida en la puerta",
    a: "Sube el brillo de la pantalla y muestra el código completo, sin recortes. Comprueba también que entras con la cuenta con la que compraste la entrada.",
    tag: "Entradas",
  },
  {
    q: "¿Puedo pedir una devolución?",
    a: "Las devoluciones dependen de la política de cada local. Escríbenos con el número de tu entrada y lo gestionamos con el organizador.",
    tag: "Pagos",
  },
  {
    q: "¿Cómo elimino mi cuenta?",
    a: "En Configuración → Privacidad → Eliminar mi cuenta. El borrado es inmediato y no se puede deshacer.",
    tag: "Cuenta",
  },
];

const PARTNER_FAQ: FAQItem[] = [
  {
    q: "¿Cuánto cuesta Pasify para mi local?",
    a: "Pasify es gratis para locales: sin cuotas. Solo se aplica una comisión por entrada vendida.",
    tag: "Plan",
  },
  {
    q: "¿Cómo cobro las entradas que vendo?",
    a: "Pasify cobra las entradas por ti y te liquida lo vendido. Si tienes cualquier duda sobre una liquidación, escríbenos.",
    tag: "Cobros",
  },
  {
    q: "¿Cómo creo un evento?",
    a: "En Mis eventos pulsa «Nuevo evento». El asistente te pide los datos básicos, la fecha y el lugar, los tipos de entrada con su precio y cupo, y la imagen. Al final lo guardas como borrador o lo publicas.",
    tag: "Eventos",
  },
  {
    q: "¿Puedo editar o duplicar un evento?",
    a: "Sí. En Mis eventos abre el menú del evento y elige «Editar evento» o «Duplicar evento».",
    tag: "Eventos",
  },
  {
    q: "¿Cómo valido las entradas en la puerta?",
    a: "Abre Escáner y apunta la cámara al QR del cliente. Cada entrada solo se valida una vez. Si la cámara no puede leer un QR, en «Código manual» puedes pegar el código de la entrada.",
    tag: "Puerta",
  },
  {
    q: "¿Dónde veo quién ha comprado entradas?",
    a: "En Asistentes tienes los compradores de cada evento y quién ha entrado ya.",
    tag: "Eventos",
  },
  {
    q: "¿Cómo elimino la cuenta de mi local?",
    a: "En Configuración → Privacidad → Eliminar mi cuenta. Si tienes eventos próximos con entradas vendidas todavía no se puede: escríbenos y lo resolvemos contigo.",
    tag: "Cuenta",
  },
];

const ADMIN_FAQ: FAQItem[] = [
  {
    q: "¿Dónde respondo los mensajes de soporte?",
    a: "En Soporte están las conversaciones, ordenadas por el último mensaje. Elige una para leerla y responder; la persona ve la respuesta en su chat de la app.",
    tag: "Soporte",
  },
  {
    q: "¿Cómo llegan las solicitudes de datos (RGPD)?",
    a: `Por email a ${SUPPORT_EMAIL}, redactadas desde Configuración → Descargar mis datos. Hay que responder en un plazo máximo de 30 días.`,
    tag: "Privacidad",
  },
];

/* ============================================================
   HelpSheet — ayuda role-aware: FAQ reales + contacto real.
   ============================================================ */

export const HelpSheet = ({
  open,
  onOpenChange,
  role,
  onOpenSupport,
  onReopenOnboarding,
}: Props) => {
  const [query, setQuery] = useState("");

  const faq: FAQItem[] = useMemo(() => {
    const roleFaq = role === "client" ? CLIENT_FAQ : role === "partner" ? PARTNER_FAQ : ADMIN_FAQ;
    const all = [...roleFaq, ...COMMON_FAQ];
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter(
      (f) =>
        f.q.toLowerCase().includes(q) ||
        f.a.toLowerCase().includes(q) ||
        f.tag?.toLowerCase().includes(q)
    );
  }, [query, role]);

  const handleSupport = onOpenSupport
    ? () => {
        onOpenChange(false);
        setTimeout(onOpenSupport, 100);
      }
    : undefined;

  const handleEmail = () => {
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Ayuda con Pasify")}`;
  };

  const roleLabel =
    role === "client" ? "Cliente" : role === "partner" ? "Local" : "Admin";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[92vw] max-w-md flex-col gap-0 border-l border-border bg-background p-0"
      >
        {/* HEADER */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div
              className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="inline-block h-px w-4 bg-orange-500/70" />
              Pasify · Ayuda · {roleLabel}
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              ¿En qué te <span style={serif} className="text-orange-500">ayudamos</span>?
            </h2>
          </div>
        </header>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-4 pb-6">
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca una pregunta o tema…"
                className="h-11 rounded-2xl pl-11"
              />
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-2.5">
              {handleSupport && (
                <QuickAction
                  icon={<MessageCircle className="h-4 w-4" />}
                  title={role === "admin" ? "Bandeja de soporte" : "Chat con soporte"}
                  subtitle={role === "admin" ? "Conversaciones abiertas" : "Lunes a viernes"}
                  tone="primary"
                  onPress={handleSupport}
                />
              )}
              <QuickAction
                icon={<Mail className="h-4 w-4" />}
                title="Escríbenos"
                subtitle="Por email"
                onPress={handleEmail}
              />
              {role === "partner" && onReopenOnboarding && (
                <QuickAction
                  icon={<Sparkles className="h-4 w-4" />}
                  title="Volver al onboarding"
                  subtitle="Reabre el wizard inicial"
                  onPress={() => {
                    onOpenChange(false);
                    setTimeout(() => onReopenOnboarding(), 100);
                  }}
                />
              )}
            </div>

            {/* FAQ */}
            <section
              className="rounded-2xl border border-border bg-card"
              style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
            >
              <div className="border-b border-border/60 p-4">
                <div
                  className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
                  style={{ ...mono, letterSpacing: "0.22em" }}
                >
                  <HelpCircle className="h-3 w-3" />
                  Preguntas frecuentes
                </div>
                <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
                  {query.trim() ? `${faq.length} resultado${faq.length === 1 ? "" : "s"}` : "Lo más consultado"}
                </h3>
              </div>
              {faq.length === 0 ? (
                <div className="p-8 text-center">
                  <Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground/60" />
                  <div className="text-[13px] font-medium text-foreground">
                    Nada coincide con tu búsqueda
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    Escríbenos y te ayudamos. {HORARIO}
                  </div>
                </div>
              ) : (
                <Accordion type="single" collapsible className="px-2">
                  {faq.map((f) => (
                    <AccordionItem key={f.q} value={f.q} className="border-b-0">
                      <AccordionTrigger className="px-2 py-3 text-left text-[13px] font-medium hover:no-underline">
                        <span className="flex flex-1 items-center gap-2 pr-2">
                          {f.tag && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                              style={{
                                ...mono,
                                letterSpacing: "0.16em",
                                background: "rgba(232,84,42,0.10)",
                                color: "#FF7A4D",
                              }}
                            >
                              {f.tag}
                            </span>
                          )}
                          <span className="flex-1">{f.q}</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-2 pb-3 text-[12px] leading-relaxed text-muted-foreground">
                        {f.a}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </section>

            {/* Contacto directo */}
            <section
              className="relative overflow-hidden rounded-2xl border p-4"
              style={{
                background:
                  "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)",
                borderColor: "rgba(232,84,42,0.30)",
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
                style={{ background: "rgba(232,84,42,0.18)", filter: "blur(60px)" }}
              />
              <div className="relative">
                <div
                  className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
                  style={{ ...mono, letterSpacing: "0.22em" }}
                >
                  <LifeBuoy className="h-3 w-3" />
                  Contacto directo
                </div>
                <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
                  Te atiende una <span style={serif} className="text-orange-500">persona</span>
                </h3>
                <div className="mt-3 flex flex-col gap-2">
                  <ContactRow
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="Email"
                    value={SUPPORT_EMAIL}
                    onPress={handleEmail}
                  />
                  <ContactRow
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Horario"
                    value="Lunes a viernes"
                    subValue="Horario laboral"
                  />
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* STICKY FOOTER */}
        {handleSupport && (
          <footer
            className="sticky bottom-0 z-10 border-t border-border bg-card/90 p-3 backdrop-blur-xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
          >
            <Button
              onClick={handleSupport}
              className="h-11 w-full text-[14px] font-semibold text-white"
              style={{
                background:
                  "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                border: 0,
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 22px -8px rgba(232,84,42,0.55)",
              }}
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              {role === "admin" ? "Abrir bandeja de soporte" : "Abrir chat con soporte"}
            </Button>
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
};

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

const QuickAction = ({
  icon,
  title,
  subtitle,
  tone,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: "primary";
  onPress: () => void;
}) => (
  <button
    type="button"
    onClick={onPress}
    className="group relative flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
    style={{
      borderColor: tone === "primary" ? "rgba(232,84,42,0.40)" : "rgba(244,238,226,0.10)",
      background:
        tone === "primary"
          ? "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)"
          : "hsl(var(--card))",
      boxShadow:
        tone === "primary"
          ? "0 8px 22px -10px rgba(232,84,42,0.45)"
          : "0 1px 0 rgba(255,255,255,0.02) inset",
    }}
  >
    <span
      className="grid h-9 w-9 place-items-center rounded-lg"
      style={{
        background: tone === "primary" ? "rgba(232,84,42,0.20)" : "hsl(var(--muted))",
        color: tone === "primary" ? "#FF7A4D" : "hsl(var(--muted-foreground))",
      }}
    >
      {icon}
    </span>
    <div className="min-w-0">
      <span className="text-[12.5px] font-semibold text-foreground">{title}</span>
      {subtitle && (
        <div className="mt-0.5 text-[10.5px] text-muted-foreground" style={mono}>
          {subtitle}
        </div>
      )}
    </div>
  </button>
);

const ContactRow = ({
  icon,
  label,
  value,
  subValue,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  onPress?: () => void;
}) => {
  const content = (
    <>
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
        style={{ background: "rgba(232,84,42,0.10)", color: "#FF7A4D" }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[9.5px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          {label}
        </div>
        <div className="truncate text-[12.5px] font-medium text-foreground" style={mono}>
          {value}
        </div>
        {subValue && (
          <div className="truncate text-[10.5px] text-muted-foreground" style={mono}>
            {subValue}
          </div>
        )}
      </div>
    </>
  );
  const className = "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left";
  const style = { borderColor: "rgba(244,238,226,0.08)", background: "rgba(255,255,255,0.02)" };

  return onPress ? (
    <button type="button" onClick={onPress} className={`${className} transition hover:border-orange-500/40`} style={style}>
      {content}
    </button>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
};

export default HelpSheet;
