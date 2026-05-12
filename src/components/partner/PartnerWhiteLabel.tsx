import { useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Crown,
  Download,
  Eye,
  Globe,
  ImagePlus,
  Languages,
  Lock,
  Mail,
  Palette,
  Settings,
  Smartphone,
  Sparkles,
  Star,
  Upload,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface WhiteLabelConfig {
  subdomain: string;
  customDomain: string;
  primary: string;
  accent: string;
  textColor: string;
  background: string;
  logoUrl: string;
  emailSender: string;
  emailReplyTo: string;
  legalCopyright: string;
  languages: string[];
  appWhitelabel: boolean;
  poweredByPasify: boolean;
}

const DEFAULT_CONFIG: WhiteLabelConfig = {
  subdomain: "pacha-ibiza",
  customDomain: "entradas.pachaibiza.com",
  primary: "#E8542A",
  accent: "#FF7A4D",
  textColor: "#F4EEE2",
  background: "#0B0908",
  logoUrl: "",
  emailSender: "Pacha Ibiza",
  emailReplyTo: "tickets@pachaibiza.com",
  legalCopyright: "© 2026 Pacha Ibiza · Todos los derechos reservados",
  languages: ["es", "en"],
  appWhitelabel: false,
  poweredByPasify: true,
};

export const PartnerWhiteLabel = () => {
  const [tab, setTab] = useState<"branding" | "domain" | "emails" | "legal" | "apps">("branding");
  const [config, setConfig] = useState<WhiteLabelConfig>(DEFAULT_CONFIG);

  const update = <K extends keyof WhiteLabelConfig>(key: K, value: WhiteLabelConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Enterprise badge */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7 text-white"
        style={{
          background:
            "linear-gradient(135deg, #B8381A 0%, #6F1F08 60%, #1A0F08 100%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.15) inset, 0 24px 60px -24px rgba(184,56,26,0.7)",
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
          <div className="flex items-start gap-3">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.18)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              <Crown className="h-6 w-6" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
                style={{ ...mono, letterSpacing: "0.22em", color: "rgba(255,255,255,0.85)" }}
              >
                <Star className="h-3 w-3" />
                Plan Enterprise · White-label activo
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
                Tu marca, <span style={serif}>tu universo</span>.
              </h2>
              <div
                className="mt-1 text-[12px]"
                style={{ ...mono, color: "rgba(255,255,255,0.75)" }}
              >
                Subdominio · Theme · Email · Legal · App móvil personalizada
              </div>
            </div>
          </div>
          <Button variant="outline" className="border-white/30 text-white hover:bg-white/10">
            <Eye className="mr-2 h-4 w-4" />
            Previsualizar
          </Button>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-end gap-1 overflow-x-auto border-b border-border">
        <Tab active={tab === "branding"} onClick={() => setTab("branding")} icon={<Palette className="h-4 w-4" />}>
          Branding
        </Tab>
        <Tab active={tab === "domain"} onClick={() => setTab("domain")} icon={<Globe className="h-4 w-4" />}>
          Dominio
        </Tab>
        <Tab active={tab === "emails"} onClick={() => setTab("emails")} icon={<Mail className="h-4 w-4" />}>
          Emails
        </Tab>
        <Tab active={tab === "legal"} onClick={() => setTab("legal")} icon={<Lock className="h-4 w-4" />}>
          Legal
        </Tab>
        <Tab active={tab === "apps"} onClick={() => setTab("apps")} icon={<Smartphone className="h-4 w-4" />}>
          App móvil
        </Tab>
      </div>

      {/* Split layout: settings + preview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Settings */}
        <section className="space-y-4">
          {tab === "branding" && <BrandingPanel config={config} onChange={update} />}
          {tab === "domain" && <DomainPanel config={config} onChange={update} />}
          {tab === "emails" && <EmailPanel config={config} onChange={update} />}
          {tab === "legal" && <LegalPanel config={config} onChange={update} />}
          {tab === "apps" && <AppPanel config={config} onChange={update} />}
        </section>

        {/* Live preview */}
        <section>
          <PreviewCard config={config} tab={tab} />
        </section>
      </div>
    </div>
  );
};

const Tab = ({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group relative inline-flex shrink-0 items-center gap-2 px-3 pb-3 pt-1 text-sm font-medium transition md:px-4"
    style={{ color: active ? "#F4EEE2" : "#8A8275" }}
  >
    {icon}
    {children}
    <span
      aria-hidden="true"
      className="absolute inset-x-3 -bottom-px h-0.5 transition"
      style={{
        background: active
          ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)"
          : "transparent",
        boxShadow: active ? "0 0 12px rgba(232,84,42,0.65)" : "none",
      }}
    />
  </button>
);

// =============================================================
// Panels
// =============================================================

const PanelCard = ({
  eyebrow,
  title,
  icon,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <article
    className="rounded-2xl border border-border bg-card p-5 md:p-6"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
  >
    <div className="mb-5">
      <div
        className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        {icon}
        {eyebrow}
      </div>
      <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h3>
    </div>
    {children}
  </article>
);

const BrandingPanel = ({
  config,
  onChange,
}: {
  config: WhiteLabelConfig;
  onChange: <K extends keyof WhiteLabelConfig>(k: K, v: WhiteLabelConfig[K]) => void;
}) => (
  <PanelCard
    eyebrow="Branding"
    title={<>Tu <span style={serif} className="text-orange-500">identidad</span></>}
    icon={<Palette className="h-3 w-3" />}
  >
    <div className="space-y-5">
      <div>
        <Label className="text-xs">Logo</Label>
        <div
          className="mt-1.5 flex items-center gap-3 rounded-2xl border border-dashed border-border p-4"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <div
            className="grid h-14 w-14 shrink-0 place-items-center rounded-xl"
            style={{ background: "rgba(232,84,42,0.1)", color: "#FF7A4D" }}
          >
            <ImagePlus className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              placeholder="URL del logo (SVG/PNG transparente recomendado)"
              value={config.logoUrl}
              onChange={(e) => onChange("logoUrl", e.target.value)}
              className="h-10 rounded-xl"
            />
            <p className="mt-1.5 text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.16em" }}>
              Tamaño recomendado · 280×80 · Fondo transparente
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Color primario</Label>
          <ColorInput value={config.primary} onChange={(v) => onChange("primary", v)} />
        </div>
        <div>
          <Label className="text-xs">Color de acento</Label>
          <ColorInput value={config.accent} onChange={(v) => onChange("accent", v)} />
        </div>
        <div>
          <Label className="text-xs">Fondo</Label>
          <ColorInput value={config.background} onChange={(v) => onChange("background", v)} />
        </div>
        <div>
          <Label className="text-xs">Texto</Label>
          <ColorInput value={config.textColor} onChange={(v) => onChange("textColor", v)} />
        </div>
      </div>

      <div
        className="rounded-2xl border p-3"
        style={{
          background: "rgba(232,176,76,0.08)",
          borderColor: "rgba(232,176,76,0.3)",
        }}
      >
        <div className="flex items-start gap-2">
          <Wand2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#E8B04C" }} />
          <p className="text-[12px] text-foreground/85">
            <span className="font-semibold">Sugerencia IA</span> · A partir de tu logo podemos
            generar la paleta completa automáticamente.
          </p>
          <Button size="sm" variant="ghost" className="ml-auto text-amber-400">
            Auto-generar
          </Button>
        </div>
      </div>
    </div>
  </PanelCard>
);

const ColorInput = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="mt-1.5 flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3">
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-7 cursor-pointer rounded-md border-0 bg-transparent"
      aria-label="Color"
    />
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 border-0 bg-transparent px-1 text-sm uppercase"
      style={mono}
    />
  </div>
);

const DomainPanel = ({
  config,
  onChange,
}: {
  config: WhiteLabelConfig;
  onChange: <K extends keyof WhiteLabelConfig>(k: K, v: WhiteLabelConfig[K]) => void;
}) => (
  <PanelCard
    eyebrow="Dominio"
    title={<>Tu <span style={serif} className="text-orange-500">URL</span></>}
    icon={<Globe className="h-3 w-3" />}
  >
    <div className="space-y-5">
      <div>
        <Label className="text-xs">Subdominio Pasify</Label>
        <div className="mt-1.5 flex items-stretch overflow-hidden rounded-xl border border-border bg-card">
          <Input
            value={config.subdomain}
            onChange={(e) => onChange("subdomain", e.target.value)}
            className="h-11 flex-1 border-0 bg-transparent"
          />
          <span
            className="grid place-items-center border-l border-border px-3 text-sm text-muted-foreground"
            style={mono}
          >
            .pasify.es
          </span>
        </div>
      </div>

      <div>
        <Label className="text-xs">Dominio propio (CNAME)</Label>
        <Input
          value={config.customDomain}
          onChange={(e) => onChange("customDomain", e.target.value)}
          className="mt-1.5 h-11 rounded-xl"
          placeholder="entradas.tuempresa.com"
        />
        <div
          className="mt-2 rounded-xl border p-3 text-[12px] text-foreground/85"
          style={{
            background: "rgba(77,184,122,0.08)",
            borderColor: "rgba(77,184,122,0.3)",
          }}
        >
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#4DB87A" }} />
            <div>
              <p className="font-semibold text-emerald-400">CNAME verificado · SSL emitido</p>
              <p
                className="mt-0.5 text-[11px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                Apunta a · cname.pasify.cloud · TTL 300
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 shrink-0 text-orange-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Idiomas activos</p>
            <p className="mt-0.5 text-[11px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
              {config.languages.length} · {config.languages.join(" · ").toUpperCase()}
            </p>
          </div>
          <Button size="sm" variant="outline">
            Configurar
          </Button>
        </div>
      </div>
    </div>
  </PanelCard>
);

const EmailPanel = ({
  config,
  onChange,
}: {
  config: WhiteLabelConfig;
  onChange: <K extends keyof WhiteLabelConfig>(k: K, v: WhiteLabelConfig[K]) => void;
}) => (
  <PanelCard
    eyebrow="Emails"
    title={<>Remitente <span style={serif} className="text-orange-500">propio</span></>}
    icon={<Mail className="h-3 w-3" />}
  >
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Nombre del remitente</Label>
        <Input
          value={config.emailSender}
          onChange={(e) => onChange("emailSender", e.target.value)}
          className="mt-1.5 h-11 rounded-xl"
        />
      </div>
      <div>
        <Label className="text-xs">Reply-to</Label>
        <Input
          value={config.emailReplyTo}
          onChange={(e) => onChange("emailReplyTo", e.target.value)}
          className="mt-1.5 h-11 rounded-xl"
          type="email"
        />
      </div>
      <div
        className="rounded-xl border p-3 text-[12px] text-foreground/85"
        style={{
          background: "rgba(77,184,122,0.08)",
          borderColor: "rgba(77,184,122,0.3)",
        }}
      >
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#4DB87A" }} />
          <div>
            <p className="font-semibold text-emerald-400">SPF · DKIM · DMARC OK</p>
            <p
              className="mt-0.5 text-[11px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.14em" }}
            >
              Deliverability score · 98.4/100
            </p>
          </div>
        </div>
      </div>
    </div>
  </PanelCard>
);

const LegalPanel = ({
  config,
  onChange,
}: {
  config: WhiteLabelConfig;
  onChange: <K extends keyof WhiteLabelConfig>(k: K, v: WhiteLabelConfig[K]) => void;
}) => (
  <PanelCard
    eyebrow="Legal"
    title={<>TyC <span style={serif} className="text-orange-500">propios</span></>}
    icon={<Lock className="h-3 w-3" />}
  >
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Copyright</Label>
        <Input
          value={config.legalCopyright}
          onChange={(e) => onChange("legalCopyright", e.target.value)}
          className="mt-1.5 h-11 rounded-xl"
        />
      </div>
      <div>
        <Label className="text-xs">Términos y condiciones</Label>
        <Textarea
          className="mt-1.5 min-h-[100px] rounded-xl"
          placeholder="Pega aquí tus TyC personalizados — sobreescriben los de Pasify cuando se compra en tu dominio."
        />
      </div>
      <div
        className="flex items-center justify-between rounded-xl border border-border p-3"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">"Powered by Pasify"</p>
          <p className="text-[11px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
            Logo Pasify en footer
          </p>
        </div>
        <Toggle
          on={config.poweredByPasify}
          onChange={(v) => onChange("poweredByPasify", v)}
        />
      </div>
    </div>
  </PanelCard>
);

const AppPanel = ({
  config,
  onChange,
}: {
  config: WhiteLabelConfig;
  onChange: <K extends keyof WhiteLabelConfig>(k: K, v: WhiteLabelConfig[K]) => void;
}) => (
  <PanelCard
    eyebrow="App móvil"
    title={<>App <span style={serif} className="text-orange-500">propia</span></>}
    icon={<Smartphone className="h-3 w-3" />}
  >
    <div className="space-y-5">
      <div
        className="flex items-start gap-3 rounded-2xl border p-3"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
          style={{
            background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 100%)",
          }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">App móvil con tu marca</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Publica una app iOS + Android con tu logo, splash y nombre. Pasify la mantiene.
            Coste único 2.490€ + 99€/mes.
          </p>
        </div>
        <Toggle on={config.appWhitelabel} onChange={(v) => onChange("appWhitelabel", v)} />
      </div>

      {config.appWhitelabel && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-3 text-center" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="mx-auto h-12 w-12 rounded-2xl" style={{ background: config.primary }} />
              <p
                className="mt-2 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                App icon
              </p>
            </div>
            <div
              className="rounded-xl border border-border p-3 text-center"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div
                className="mx-auto h-12 w-12 rounded-2xl"
                style={{ background: `linear-gradient(135deg, ${config.primary} 0%, ${config.background} 100%)` }}
              />
              <p
                className="mt-2 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                Splash
              </p>
            </div>
          </div>
          <Button variant="outline" className="w-full">
            <Download className="mr-2 h-4 w-4" />
            Solicitar build (ETA 3 días)
          </Button>
        </div>
      )}
    </div>
  </PanelCard>
);

const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!on)}
    className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition"
    style={{
      background: on
        ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 100%)"
        : "rgba(255,255,255,0.1)",
    }}
    aria-pressed={on}
  >
    <span
      className="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition"
      style={{
        transform: on ? "translateX(22px)" : "translateX(2px)",
      }}
    />
  </button>
);

// =============================================================
// Live preview
// =============================================================

const PreviewCard = ({ config, tab }: { config: WhiteLabelConfig; tab: string }) => {
  void tab;
  return (
    <article
      className="sticky top-6 overflow-hidden rounded-2xl border border-border bg-card"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <header className="border-b border-border p-4">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <Eye className="h-3 w-3" />
          Preview · landing live
        </div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {config.customDomain || `${config.subdomain}.pasify.es`}
        </h3>
      </header>

      {/* Browser chrome */}
      <div className="border-b border-border bg-background/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#FF5F57" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#FEBC2E" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28C840" }} />
          <div
            className="ml-2 flex-1 truncate rounded-md px-2 py-1 text-[10px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.12em",
              background: "rgba(255,255,255,0.04)",
              color: "#C9BFA8",
            }}
          >
            🔒 https://{config.customDomain || `${config.subdomain}.pasify.es`}
          </div>
        </div>
      </div>

      {/* Live preview content */}
      <div
        className="p-6"
        style={{
          background: config.background,
          color: config.textColor,
          fontFamily: "'Geist', system-ui, sans-serif",
        }}
      >
        {/* Nav */}
        <nav className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {config.logoUrl ? (
              <img
                src={config.logoUrl}
                alt="logo"
                className="h-7 w-auto"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            ) : (
              <span className="text-xl font-bold tracking-tight" style={{ color: config.textColor }}>
                {config.emailSender}
              </span>
            )}
          </div>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{
              background: `linear-gradient(180deg, ${config.accent} 0%, ${config.primary} 100%)`,
              color: "#fff",
            }}
          >
            Entrar
          </button>
        </nav>

        {/* Hero */}
        <div>
          <div
            className="mb-2 inline-flex items-center gap-2 text-[9px] uppercase"
            style={{ ...mono, letterSpacing: "0.22em", color: config.accent }}
          >
            <span className="inline-block h-px w-4" style={{ background: config.accent }} />
            Próximo evento
          </div>
          <h2
            className="text-2xl font-semibold leading-tight tracking-tight md:text-3xl"
            style={{ color: config.textColor }}
          >
            Saturday Night ·{" "}
            <span style={{ ...serif, color: config.accent }}>en directo</span>
          </h2>
          <p
            className="mt-2 text-sm leading-relaxed"
            style={{ color: config.textColor, opacity: 0.7 }}
          >
            Compra tu entrada en segundos. Sin colas, sin papel.
          </p>

          <button
            type="button"
            className="mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white"
            style={{
              background: `linear-gradient(180deg, ${config.accent} 0%, ${config.primary} 60%, ${shade(config.primary, -25)} 100%)`,
              boxShadow: `0 6px 16px -6px ${config.primary}AA`,
            }}
          >
            Comprar entrada
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Footer */}
        <div
          className="mt-8 border-t pt-4"
          style={{ borderColor: `${config.textColor}20` }}
        >
          <p
            className="text-[10px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.14em",
              color: config.textColor,
              opacity: 0.5,
            }}
          >
            {config.legalCopyright}
          </p>
          {config.poweredByPasify && (
            <p
              className="mt-1 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.14em",
                color: config.textColor,
                opacity: 0.3,
              }}
            >
              Powered by Pasify
            </p>
          )}
        </div>
      </div>
    </article>
  );
};

const shade = (hex: string, percent: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v + (v * percent) / 100)));
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

export default PartnerWhiteLabel;
