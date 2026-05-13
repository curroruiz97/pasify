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
  Bug,
  ChevronRight,
  Clock,
  Command,
  ExternalLink,
  FileText,
  Headphones,
  HelpCircle,
  Keyboard,
  LifeBuoy,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Sparkles,
  TerminalSquare,
  Users,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

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

interface Guide {
  id: string;
  title: string;
  minutes: number;
  icon: React.ReactNode;
  isNew?: boolean;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
  isLatest?: boolean;
}

const COMMON_FAQ: FAQItem[] = [
  {
    q: "¿Cómo cambio el email o teléfono asociado a mi cuenta?",
    a: "Entra en Configuración → Cuenta → Email (o Teléfono). Te enviaremos un código de verificación al nuevo contacto antes de actualizar.",
    tag: "Cuenta",
  },
  {
    q: "He olvidado mi contraseña, ¿qué hago?",
    a: "Ve a la pantalla de login y pulsa '¿Olvidaste tu contraseña?'. Recibirás un enlace firmado por email; caduca en 60 minutos y solo funciona una vez.",
    tag: "Seguridad",
  },
  {
    q: "¿Cómo activo la verificación en 2 pasos?",
    a: "Configuración → Seguridad → Verificación en 2 pasos. Soportamos SMS y apps authenticator (Google Authenticator, 1Password, Authy).",
    tag: "Seguridad",
  },
];

const CLIENT_FAQ: FAQItem[] = [
  {
    q: "¿Puedo transferir o reembolsar mi ticket?",
    a: "Sí. Desde 'Mis tickets' pulsa el ticket y elige 'Transferir' (gratis) o 'Reembolsar' (hasta 7 días antes del evento, según política del local).",
    tag: "Tickets",
  },
  {
    q: "¿Qué son los Pasify Points y cómo se ganan?",
    a: "Ganas 1 punto por cada euro gastado en tickets y cashless. Al alcanzar 500 puntos subes a Gold; 1500 a Platinum. Los puntos se canjean por perks (entradas prioritarias, drinks gratis, descuentos VIP).",
    tag: "Loyalty",
  },
  {
    q: "¿Cómo funciona el modo evento en vivo?",
    a: "Cuando llegas al local con un ticket válido, Pasify detecta tu ubicación y activa el 'modo evento' con line-up, mapa interior, cashless NFC y muro de fotos compartido.",
    tag: "Live",
  },
  {
    q: "¿Mi pulsera cashless se reembolsa al final?",
    a: "Sí. El saldo no consumido se reembolsa automáticamente a tu tarjeta original en un plazo máximo de 24 h tras el cierre del evento.",
    tag: "Pagos",
  },
  {
    q: "¿Cómo añado un evento al calendario de mi móvil?",
    a: "Desde 'Favoritos' o 'Mis tickets', pulsa el botón 'Añadir al calendario'. Generamos un .ics compatible con Apple Calendar, Google Calendar y Outlook.",
    tag: "Calendario",
  },
];

const PARTNER_FAQ: FAQItem[] = [
  {
    q: "¿Cómo conecto mi cuenta de Stripe para cobrar?",
    a: "Configuración → Operación → Stripe Connect. El onboarding completo dura 10 minutos. Para activar payouts diarios necesitas KYC verificado.",
    tag: "Pagos",
  },
  {
    q: "¿Cómo funciona el Pricing IA?",
    a: "El módulo Pricing IA propone subidas/bajadas dentro de la banda que tú configuras (por defecto +0/+15%). Puedes auto-aceptar dentro de banda o requerir aprobación humana siempre.",
    tag: "IA",
  },
  {
    q: "¿Qué es AutoPilot y qué hace por mí?",
    a: "AutoPilot es un agente que ejecuta pricing, marketing, soporte cliente y reembolsos 24/7 dentro de tus políticas. Tú firmas las decisiones grandes; el agente se ocupa del resto.",
    tag: "IA",
  },
  {
    q: "¿Cómo invito a mi equipo a Pasify?",
    a: "Sección Equipo → 'Invitar miembro'. Roles: Owner, Manager, RRPP, Door Staff, Read-only. Cada rol tiene permisos granulares configurables.",
    tag: "Equipo",
  },
  {
    q: "¿Puedo usar mi propio dominio (white-label)?",
    a: "Sí. En el módulo White-label configuras tu subdominio (gratis: tu-marca.pasify.es) o tu dominio propio (plan Enterprise). Logo, colores, emails y app móvil quedan personalizados.",
    tag: "Marca",
  },
];

const ADMIN_FAQ: FAQItem[] = [
  {
    q: "¿Cómo activo o desactivo una capability de IA en producción?",
    a: "AI Safety Console → kill-switch por capability. La acción detiene la capability en TODOS los tenants instantáneamente y queda registrada en el audit trail.",
    tag: "Trust",
  },
  {
    q: "¿Cómo gestiono los reembolsos pendientes?",
    a: "Sección Reembolsos. Cada solicitud muestra evidencia, cliente, importe y razón. Acciones: Aprobar, Rechazar (requiere justificación) o Escalar.",
    tag: "Operación",
  },
  {
    q: "¿Cómo respondo a una solicitud GDPR?",
    a: "Compliance → DSAR. Tienes 30 días naturales. Pasify auto-genera el ZIP con los datos del usuario (perfil, eventos, tickets, transacciones).",
    tag: "Compliance",
  },
  {
    q: "¿Cómo funcionan los Industry Benchmarks?",
    a: "Datos agregados k-anonimato 15 + ruido diferencial. Ningún corte se publica con menos de 15 tenants coincidentes. Los partners pueden opt-out granular.",
    tag: "Datos",
  },
];

const CLIENT_GUIDES: Guide[] = [
  { id: "g1", title: "Tu primer ticket en 30 segundos", minutes: 1, icon: <Sparkles className="h-4 w-4" />, isNew: true },
  { id: "g2", title: "Modo evento: vivir la noche con Pasify", minutes: 3, icon: <Zap className="h-4 w-4" /> },
  { id: "g3", title: "Pasify Points: cómo subir de nivel", minutes: 2, icon: <Sparkles className="h-4 w-4" /> },
  { id: "g4", title: "Cashless NFC: pagas con un tap", minutes: 2, icon: <Headphones className="h-4 w-4" /> },
];

const PARTNER_GUIDES: Guide[] = [
  { id: "g1", title: "Crea tu primer evento en 5 minutos", minutes: 5, icon: <Sparkles className="h-4 w-4" />, isNew: true },
  { id: "g2", title: "Configurar AutoPilot · políticas seguras", minutes: 8, icon: <Zap className="h-4 w-4" />, isNew: true },
  { id: "g3", title: "Stripe Connect: del onboarding al primer payout", minutes: 6, icon: <Headphones className="h-4 w-4" /> },
  { id: "g4", title: "White-label: subdominio y branding", minutes: 7, icon: <Sparkles className="h-4 w-4" /> },
];

const ADMIN_GUIDES: Guide[] = [
  { id: "g1", title: "AI Safety: kill-switch y anomalías", minutes: 6, icon: <Zap className="h-4 w-4" />, isNew: true },
  { id: "g2", title: "Compliance GDPR · responder un DSAR", minutes: 5, icon: <FileText className="h-4 w-4" /> },
  { id: "g3", title: "Industry Benchmarks: monetizar los datos", minutes: 9, icon: <Sparkles className="h-4 w-4" />, isNew: true },
];

const PARTNER_SHORTCUTS: Shortcut[] = [
  { keys: ["G", "M"], description: "Ir a Métricas" },
  { keys: ["G", "L"], description: "Ir a En vivo" },
  { keys: ["G", "A"], description: "Ir a AutoPilot" },
  { keys: ["G", "E"], description: "Ir a Eventos" },
  { keys: ["⌘", "K"], description: "Buscar globalmente" },
  { keys: ["N"], description: "Nuevo evento" },
  { keys: ["?"], description: "Abrir esta ayuda" },
];

const ADMIN_SHORTCUTS: Shortcut[] = [
  { keys: ["G", "M"], description: "Ir a Métricas" },
  { keys: ["G", "O"], description: "Ir a Organizations" },
  { keys: ["G", "S"], description: "Ir a AI Safety" },
  { keys: ["G", "C"], description: "Ir a Compliance" },
  { keys: ["⌘", "K"], description: "Buscar globalmente" },
  { keys: ["⌘", "⇧", "K"], description: "Kill-switch · panel rápido" },
  { keys: ["?"], description: "Abrir esta ayuda" },
];

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "v0.1.0",
    date: "2026-05-10",
    isLatest: true,
    highlights: [
      "AutoPilot IA en beta abierta para partners",
      "Industry Benchmarks · nuevos cortes regionales",
      "Door Vision con detección anti-suplantación",
    ],
  },
  {
    version: "v0.0.9",
    date: "2026-04-22",
    highlights: [
      "AI Safety Console · kill-switch por capability",
      "Compliance DSAR auto-generador GDPR",
      "Heatmap demanda 7×24 en Industry Benchmarks",
    ],
  },
  {
    version: "v0.0.8",
    date: "2026-04-03",
    highlights: [
      "Cashless NFC en evento live",
      "White-label · subdominios personalizados",
      "Stripe Connect onboarding rediseñado",
    ],
  },
];

/* ============================================================
   HelpSheet — centro de ayuda completo, role-aware.
   ============================================================ */

export const HelpSheet = ({
  open,
  onOpenChange,
  role,
  onOpenSupport,
  onReopenOnboarding,
}: Props) => {
  const { toast } = useToast();
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

  const guides =
    role === "client" ? CLIENT_GUIDES : role === "partner" ? PARTNER_GUIDES : ADMIN_GUIDES;

  const shortcuts =
    role === "partner" ? PARTNER_SHORTCUTS : role === "admin" ? ADMIN_SHORTCUTS : null;

  const handleSupport = () => {
    onOpenChange(false);
    setTimeout(() => {
      if (onOpenSupport) onOpenSupport();
      else
        toast({
          title: "Abriendo chat",
          description: "Te llevamos al soporte en directo.",
        });
    }, 100);
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
        <div className="flex-1 overflow-y-auto p-4 pb-[100px]">
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

            {/* Service status pill */}
            <div
              className="flex items-center justify-between rounded-2xl border p-3"
              style={{
                background: "rgba(77,184,122,0.06)",
                borderColor: "rgba(77,184,122,0.32)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <div>
                  <div className="text-[12.5px] font-medium text-foreground">Todos los sistemas operativos</div>
                  <div className="text-[10.5px] text-muted-foreground" style={mono}>
                    Última comprobación · hace 1 min · status.pasify.es
                  </div>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-emerald-500" />
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-2.5">
              <QuickAction
                icon={<MessageCircle className="h-4 w-4" />}
                title="Chat con soporte"
                subtitle="< 5 min · directo"
                tone="primary"
                onPress={handleSupport}
              />
              <QuickAction
                icon={<Bug className="h-4 w-4" />}
                title="Reportar un bug"
                subtitle="Adjunta screenshot"
                onPress={() =>
                  toast({
                    title: "Reporte",
                    description: "Te llevamos al formulario de bugs.",
                  })
                }
              />
              <QuickAction
                icon={<FileText className="h-4 w-4" />}
                title="Centro de ayuda"
                subtitle="ayuda.pasify.es"
                external
                onPress={() =>
                  toast({
                    title: "Centro de ayuda",
                    description: "Abriendo en una pestaña nueva.",
                  })
                }
              />
              <QuickAction
                icon={<Users className="h-4 w-4" />}
                title="Comunidad"
                subtitle={role === "client" ? "Discord" : "Slack partners"}
                external
                onPress={() =>
                  toast({
                    title: "Comunidad",
                    description:
                      role === "client"
                        ? "Únete al Discord oficial de Pasify."
                        : "Slack privado para partners y admins.",
                  })
                }
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
                    Prueba a hablar con soporte — te respondemos en menos de 5 min.
                  </div>
                </div>
              ) : (
                <Accordion type="single" collapsible className="px-2">
                  {faq.slice(0, 8).map((f, i) => (
                    <AccordionItem key={i} value={`faq-${i}`} className="border-b-0">
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

            {/* Guías rápidas */}
            <section
              className="rounded-2xl border border-border bg-card p-4"
              style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
            >
              <div className="mb-3">
                <div
                  className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
                  style={{ ...mono, letterSpacing: "0.22em" }}
                >
                  <Sparkles className="h-3 w-3" />
                  Guías rápidas
                </div>
                <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
                  Aprende lo esencial
                </h3>
              </div>
              <div className="flex flex-col gap-2">
                {guides.map((g) => (
                  <button
                    key={g.id}
                    onClick={() =>
                      toast({
                        title: g.title,
                        description: `Abriendo guía · ${g.minutes} min de lectura.`,
                      })
                    }
                    className="group flex items-center gap-3 rounded-xl border border-border p-3 text-left transition hover:border-orange-500/40 hover:bg-muted"
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      style={{ background: "rgba(232,84,42,0.10)", color: "#FF7A4D" }}
                    >
                      {g.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {g.title}
                        </span>
                        {g.isNew && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                            style={{
                              ...mono,
                              letterSpacing: "0.16em",
                              background: "rgba(77,184,122,0.12)",
                              color: "#4DB87A",
                            }}
                          >
                            Nuevo
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"
                        style={mono}
                      >
                        <Clock className="h-3 w-3" />
                        {g.minutes} min
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70 transition group-hover:text-foreground" />
                  </button>
                ))}
              </div>
            </section>

            {/* Atajos de teclado (partner/admin) */}
            {shortcuts && (
              <section
                className="rounded-2xl border border-border bg-card p-4"
                style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div
                      className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
                      style={{ ...mono, letterSpacing: "0.22em" }}
                    >
                      <Keyboard className="h-3 w-3" />
                      Atajos de teclado
                    </div>
                    <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
                      Más rápido con el teclado
                    </h3>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[9.5px] uppercase"
                    style={{
                      ...mono,
                      letterSpacing: "0.18em",
                      background: "rgba(244,238,226,0.06)",
                      color: "#8A8275",
                    }}
                  >
                    Desktop
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {shortcuts.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted"
                    >
                      <span className="text-[12.5px] text-muted-foreground">
                        {s.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {s.keys.map((k, idx) => (
                          <span key={idx} className="flex items-center gap-1">
                            <kbd
                              className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                              style={{
                                ...mono,
                                borderColor: "rgba(244,238,226,0.12)",
                                background: "rgba(244,238,226,0.04)",
                                boxShadow: "0 1px 0 rgba(0,0,0,0.3) inset",
                              }}
                            >
                              {k}
                            </kbd>
                            {idx < s.keys.length - 1 && (
                              <span className="text-[10px] text-muted-foreground/50">
                                +
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Changelog */}
            <section
              className="rounded-2xl border border-border bg-card p-4"
              style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
            >
              <div className="mb-3">
                <div
                  className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
                  style={{ ...mono, letterSpacing: "0.22em" }}
                >
                  <TerminalSquare className="h-3 w-3" />
                  Cambios recientes
                </div>
                <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
                  Qué hay de nuevo
                </h3>
              </div>
              <div className="flex flex-col gap-3">
                {CHANGELOG.map((c) => (
                  <div
                    key={c.version}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: c.isLatest ? "rgba(232,84,42,0.32)" : "rgba(244,238,226,0.08)",
                      background: c.isLatest ? "rgba(232,84,42,0.04)" : "transparent",
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="text-[12.5px] font-bold tracking-tight"
                        style={{ ...mono, color: c.isLatest ? "#FF7A4D" : "#F4EEE2" }}
                      >
                        {c.version}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground" style={mono}>
                        {c.date}
                      </span>
                      {c.isLatest && (
                        <span
                          className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                          style={{
                            ...mono,
                            letterSpacing: "0.18em",
                            background: "rgba(232,84,42,0.14)",
                            color: "#FF7A4D",
                          }}
                        >
                          Última
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1">
                      {c.highlights.map((h, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground"
                        >
                          <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-orange-500/70" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
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
                  Hablamos de <span style={serif} className="text-orange-500">verdad</span>
                </h3>
                <div className="mt-3 flex flex-col gap-2">
                  <ContactRow
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="Email"
                    value={
                      role === "partner" ? "partners@pasify.es" : role === "admin" ? "admin@pasify.es" : "hola@pasify.es"
                    }
                  />
                  <ContactRow
                    icon={<Phone className="h-3.5 w-3.5" />}
                    label="Teléfono"
                    value="+34 900 ··· 042"
                    subValue="L-D · 09:00-02:00"
                  />
                  <ContactRow
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Tiempo medio"
                    value="< 5 min"
                    subValue="Respuesta humana en horario"
                    accent
                  />
                </div>
              </div>
            </section>

            <div className="h-2" />
          </div>
        </div>

        {/* STICKY FOOTER */}
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
            Abrir chat con soporte
          </Button>
        </footer>
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
  external,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: "primary";
  external?: boolean;
  onPress: () => void;
}) => (
  <button
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
      <div className="flex items-center gap-1">
        <span className="text-[12.5px] font-semibold text-foreground">{title}</span>
        {external && (
          <ExternalLink className="h-3 w-3 text-muted-foreground/70" />
        )}
      </div>
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
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  accent?: boolean;
}) => (
  <div
    className="flex items-center gap-3 rounded-xl border px-3 py-2"
    style={{
      borderColor: accent ? "rgba(77,184,122,0.32)" : "rgba(244,238,226,0.08)",
      background: accent ? "rgba(77,184,122,0.06)" : "rgba(255,255,255,0.02)",
    }}
  >
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
      style={{
        background: accent ? "rgba(77,184,122,0.14)" : "rgba(232,84,42,0.10)",
        color: accent ? "#4DB87A" : "#FF7A4D",
      }}
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
  </div>
);

export default HelpSheet;
