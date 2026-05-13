import { ReactNode, useEffect, useState } from "react";
import {
  Building2,
  CalendarPlus,
  CheckCircle2,
  ImagePlus,
  Sparkles,
  X,
  Rocket,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

const STORAGE_KEY_BASE = "pasify.partner.onboarding.v2";

const storageKeyFor = (userId?: string | null) =>
  userId ? `${STORAGE_KEY_BASE}.${userId}` : STORAGE_KEY_BASE;

interface WizardData {
  businessName: string;
  category: string;
  city: string;
  description: string;
  logoUrl: string;
  coverUrl: string;
  firstEventTitle: string;
  firstEventDate: string;
  firstEventPrice: string;
  firstEventCapacity: string;
}

const initialData: WizardData = {
  businessName: "",
  category: "discoteca",
  city: "",
  description: "",
  logoUrl: "",
  coverUrl: "",
  firstEventTitle: "",
  firstEventDate: "",
  firstEventPrice: "15.00",
  firstEventCapacity: "300",
};

interface Props {
  /** Datos iniciales del partner (si los hay del perfil). */
  defaults?: Partial<WizardData>;
  /** Callback al completar (recibe el snapshot final). */
  onComplete?: (data: WizardData) => void;
  /** User id del partner — usado para scopear el localStorage key por usuario. */
  userId?: string | null;
  /**
   * Si `true`, el partner YA tiene actividad real (org/venue/evento/ticket
   * vendido). En ese caso NUNCA forzamos auto-open. El partner puede abrirlo
   * manualmente desde la nav si quiere reonboardingse.
   */
  hasActivity?: boolean;
  /** Permite al padre forzar abrir/cerrar (botón "Volver al onboarding"). */
  forceOpen?: boolean;
  /** Notificar al padre cuando el wizard se cierra. */
  onClose?: () => void;
}

/**
 * Wizard de 5 pasos overlay full-screen para que el partner monte
 * su primer evento en menos de 3 minutos. Auto-open SOLO si:
 *   - El partner no ha completado el wizard antes (storage scoped por user_id)
 *   - Y `hasActivity` es false (no tiene org, venue, evento o ticket vendido)
 * Skippable, y siempre puede reabrirse desde la dashboard via `forceOpen`.
 */
export const PartnerOnboardingWizard = ({
  defaults,
  onComplete,
  userId,
  hasActivity = false,
  forceOpen = false,
  onClose,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>({ ...initialData, ...defaults });

  // Auto-open SOLO si: (a) el partner NO tiene actividad real Y (b) no ha
  // marcado el wizard como "done" para este user_id. Si `forceOpen` es true
  // (el partner pulsa "Volver al onboarding" en la nav), abrimos siempre.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (forceOpen) {
      setOpen(true);
      return;
    }
    if (hasActivity) {
      // Partner ya tiene actividad real → no molestar. Y además marcamos
      // como done para que no se abra en un futuro tras borrar localStorage.
      try {
        localStorage.setItem(storageKeyFor(userId), "done");
      } catch {
        /* localStorage puede no estar disponible (private mode iOS) */
      }
      return;
    }
    try {
      const done = localStorage.getItem(storageKeyFor(userId)) === "done";
      if (!done) setOpen(true);
    } catch {
      // Si localStorage falla, no abrimos por defecto — preferimos no molestar
      // a abrir incorrectamente.
    }
  }, [userId, hasActivity, forceOpen]);

  const skipForever = () => {
    try {
      localStorage.setItem(storageKeyFor(userId), "done");
    } catch {
      /* noop */
    }
    setOpen(false);
    onClose?.();
  };

  const complete = () => {
    try {
      localStorage.setItem(storageKeyFor(userId), "done");
    } catch {
      /* noop */
    }
    setOpen(false);
    onComplete?.(data);
    onClose?.();
  };

  if (!open) {
    return null;
  }

  const totalSteps = 5;
  const stepLabels = ["Bienvenida", "Tu local", "Branding", "Primer evento", "Listo"];

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-background/90 backdrop-blur-md">
      {/* Halo decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(120px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 bottom-0 h-[420px] w-[420px] rounded-full"
        style={{ background: "rgba(184,56,26,0.12)", filter: "blur(120px)" }}
      />

      <div className="relative flex w-full max-w-3xl flex-col">
        {/* Header — close + progress */}
        <header className="flex items-center justify-between px-5 pt-6 md:px-8 md:pt-8">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Sparkles className="h-3 w-3" />
            Pasify · Onboarding
          </div>
          <button
            type="button"
            onClick={skipForever}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Cerrar onboarding"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Progress bar */}
        <div className="px-5 pt-5 md:px-8">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.18em" }}>
            <span>
              Paso {(step + 1).toString().padStart(2, "0")} / {totalSteps.toString().padStart(2, "0")}
            </span>
            <span>{stepLabels[step]}</span>
          </div>
          <div className="relative flex h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            {stepLabels.map((_, i) => (
              <div
                key={i}
                className="h-full flex-1"
                style={{
                  background:
                    i <= step
                      ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 100%)"
                      : "transparent",
                  marginRight: i < totalSteps - 1 ? 2 : 0,
                  borderRadius: 999,
                  transition: "background .4s ease",
                }}
              />
            ))}
          </div>
        </div>

        {/* Step content */}
        <main className="flex-1 overflow-y-auto px-5 py-8 md:px-8 md:py-12">
          {step === 0 && (
            <StepWelcome onContinue={() => setStep(1)} />
          )}
          {step === 1 && (
            <StepBusiness data={data} setData={setData} />
          )}
          {step === 2 && (
            <StepBranding data={data} setData={setData} />
          )}
          {step === 3 && (
            <StepFirstEvent data={data} setData={setData} />
          )}
          {step === 4 && (
            <StepReady data={data} />
          )}
        </main>

        {/* Footer nav */}
        {step > 0 && (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-8">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500"
              disabled={step === 0}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Atrás
            </button>

            {step < totalSteps - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(totalSteps - 1, s + 1))}
                className="group/btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                }}
              >
                Continuar
                <ArrowRight className="h-4 w-4 transition group-hover/btn:translate-x-1" />
              </button>
            ) : (
              <button
                type="button"
                onClick={complete}
                className="group/btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                }}
              >
                <Rocket className="h-4 w-4" />
                Empezar a vender
                <ArrowRight className="h-4 w-4 transition group-hover/btn:translate-x-1" />
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
};

// =============================================================
// Steps
// =============================================================

const StepWelcome = ({ onContinue }: { onContinue: () => void }) => (
  <div className="flex flex-col items-center text-center">
    <div className="relative mb-7 flex h-20 w-20 items-center justify-center">
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
        style={{ background: "rgba(232,84,42,0.3)" }}
      />
      <div
        className="relative flex h-20 w-20 items-center justify-center rounded-full text-white"
        style={{
          background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.35), 0 14px 30px -10px rgba(232,84,42,0.6)",
        }}
      >
        <Sparkles className="h-9 w-9" />
      </div>
    </div>

    <div
      className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.22em" }}
    >
      <span className="inline-block h-px w-5 bg-orange-500/70" />
      Onboarding · 3 minutos
      <span className="inline-block h-px w-5 bg-orange-500/70" />
    </div>
    <h2 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
      Vamos a montar tu primer{" "}
      <span style={serif} className="text-orange-500">
        evento
      </span>
      .
    </h2>
    <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
      Cinco pasos rápidos para que tengas un evento publicado, listo para vender entradas y para
      que tu equipo escanee en la puerta. Puedes editarlo todo después.
    </p>

    <div className="mt-8 grid w-full max-w-md grid-cols-2 gap-3 text-left">
      <CheckRow text="Datos básicos de tu local" />
      <CheckRow text="Logo y portada" />
      <CheckRow text="Tu primer evento" />
      <CheckRow text="Listo para vender" />
    </div>

    <button
      type="button"
      onClick={onContinue}
      className="group/btn mt-10 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white"
      style={{
        background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
      }}
    >
      Empezar
      <ArrowRight className="h-4 w-4 transition group-hover/btn:translate-x-1" />
    </button>
  </div>
);

const CheckRow = ({ text }: { text: string }) => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-500" />
    {text}
  </div>
);

const StepBusiness = ({
  data,
  setData,
}: {
  data: WizardData;
  setData: React.Dispatch<React.SetStateAction<WizardData>>;
}) => (
  <div>
    <StepHeader
      icon={<Building2 className="h-7 w-7" />}
      eyebrow="Paso 02"
      title={<>Cuéntanos cómo se llama tu <span style={serif} className="text-orange-500">local</span>.</>}
      subtitle="Esto es lo que verán los clientes cuando descubran tu local en Pasify."
    />
    <div className="mx-auto mt-8 grid max-w-xl grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs">Nombre del local</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Pacha Ibiza"
          value={data.businessName}
          onChange={(e) => setData((d) => ({ ...d, businessName: e.target.value }))}
        />
      </div>
      <div>
        <Label className="text-xs">Categoría</Label>
        <Select
          value={data.category}
          onValueChange={(v) => setData((d) => ({ ...d, category: v }))}
        >
          <SelectTrigger className="mt-1.5 h-11 rounded-xl">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="discoteca">Discoteca</SelectItem>
            <SelectItem value="club">Club</SelectItem>
            <SelectItem value="sala">Sala de conciertos</SelectItem>
            <SelectItem value="bar">Bar / Pub</SelectItem>
            <SelectItem value="rooftop">Rooftop</SelectItem>
            <SelectItem value="beachclub">Beach Club</SelectItem>
            <SelectItem value="festival">Festival / Promotora</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Ciudad</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Ibiza"
          value={data.city}
          onChange={(e) => setData((d) => ({ ...d, city: e.target.value }))}
        />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs">Descripción corta</Label>
        <Textarea
          className="mt-1.5 min-h-[88px] rounded-xl"
          placeholder="El club más icónico de Ibiza. House, techno y la mejor música electrónica desde 1973."
          value={data.description}
          onChange={(e) => setData((d) => ({ ...d, description: e.target.value }))}
        />
      </div>
    </div>
  </div>
);

const StepBranding = ({
  data,
  setData,
}: {
  data: WizardData;
  setData: React.Dispatch<React.SetStateAction<WizardData>>;
}) => (
  <div>
    <StepHeader
      icon={<ImagePlus className="h-7 w-7" />}
      eyebrow="Paso 03"
      title={<>Tu <span style={serif} className="text-orange-500">imagen</span> de marca.</>}
      subtitle="Sube el logo y una foto de portada. Aparecen en tu página pública, en redes y en cada cartel de evento."
    />
    <div className="mx-auto mt-8 grid max-w-xl grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label className="text-xs">URL del logo (opcional)</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="https://…"
          value={data.logoUrl}
          onChange={(e) => setData((d) => ({ ...d, logoUrl: e.target.value }))}
        />
        <div className="mt-3 flex h-32 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card">
          {data.logoUrl ? (
            <img
              src={data.logoUrl}
              alt="Logo preview"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">Preview del logo</span>
          )}
        </div>
      </div>
      <div>
        <Label className="text-xs">URL de portada (opcional)</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="https://…"
          value={data.coverUrl}
          onChange={(e) => setData((d) => ({ ...d, coverUrl: e.target.value }))}
        />
        <div className="mt-3 h-32 overflow-hidden rounded-2xl border border-dashed border-border bg-card">
          {data.coverUrl ? (
            <img src={data.coverUrl} alt="Cover preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Preview de portada
            </div>
          )}
        </div>
      </div>
    </div>
    <p
      className="mx-auto mt-6 max-w-md text-center text-[11px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      Tip · Puedes saltarte este paso y subir los archivos después desde tu perfil.
    </p>
  </div>
);

const StepFirstEvent = ({
  data,
  setData,
}: {
  data: WizardData;
  setData: React.Dispatch<React.SetStateAction<WizardData>>;
}) => (
  <div>
    <StepHeader
      icon={<CalendarPlus className="h-7 w-7" />}
      eyebrow="Paso 04"
      title={<>Tu primer <span style={serif} className="text-orange-500">evento</span>.</>}
      subtitle="Crea un evento de prueba con tu próxima fecha. Lo dejaremos en borrador para que puedas afinar antes de publicar."
    />
    <div className="mx-auto mt-8 grid max-w-xl grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs">Nombre del evento</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Saturday Night · Resident DJs"
          value={data.firstEventTitle}
          onChange={(e) => setData((d) => ({ ...d, firstEventTitle: e.target.value }))}
        />
      </div>
      <div>
        <Label className="text-xs">Fecha y hora</Label>
        <Input
          type="datetime-local"
          className="mt-1.5 h-11 rounded-xl"
          value={data.firstEventDate}
          onChange={(e) => setData((d) => ({ ...d, firstEventDate: e.target.value }))}
        />
      </div>
      <div>
        <Label className="text-xs">Precio entrada (€)</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          type="number"
          step="0.50"
          value={data.firstEventPrice}
          onChange={(e) => setData((d) => ({ ...d, firstEventPrice: e.target.value }))}
        />
      </div>
      <div>
        <Label className="text-xs">Aforo</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          type="number"
          value={data.firstEventCapacity}
          onChange={(e) => setData((d) => ({ ...d, firstEventCapacity: e.target.value }))}
        />
      </div>
    </div>
  </div>
);

const StepReady = ({ data }: { data: WizardData }) => (
  <div className="flex flex-col items-center text-center">
    <div className="relative mb-7 flex h-20 w-20 items-center justify-center">
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
        style={{ background: "rgba(77,184,122,0.35)" }}
      />
      <div
        className="relative flex h-20 w-20 items-center justify-center rounded-full text-white"
        style={{
          background: "linear-gradient(180deg, #4DB87A 0%, #2D7A4F 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 14px 30px -10px rgba(77,184,122,0.6)",
        }}
      >
        <CheckCircle2 className="h-9 w-9" />
      </div>
    </div>

    <div
      className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.22em", color: "#4DB87A" }}
    >
      <span className="inline-block h-px w-5 bg-emerald-500/70" />
      Todo listo
      <span className="inline-block h-px w-5 bg-emerald-500/70" />
    </div>
    <h2 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
      Bienvenido a <span style={serif} className="text-orange-500">Pasify</span>,{" "}
      {data.businessName || "tu local"}.
    </h2>
    <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
      Tu evento <span className="font-semibold text-foreground">{data.firstEventTitle || "primer evento"}</span> queda guardado en borrador. Cuando lo publiques aparecerá en la app de Pasify y empezará a vender.
    </p>

    <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-3 text-left md:grid-cols-2">
      <SummaryRow label="Local" value={data.businessName || "—"} />
      <SummaryRow label="Categoría" value={data.category} capitalize />
      <SummaryRow label="Ciudad" value={data.city || "—"} />
      <SummaryRow label="Evento" value={data.firstEventTitle || "—"} />
      <SummaryRow
        label="Fecha"
        value={
          data.firstEventDate
            ? new Date(data.firstEventDate).toLocaleString("es-ES", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"
        }
      />
      <SummaryRow label="Precio" value={`${data.firstEventPrice} €`} />
    </div>
  </div>
);

const SummaryRow = ({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) => (
  <div
    className="rounded-xl border border-border bg-card p-3"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div
      className="text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div className={`mt-0.5 truncate text-sm font-semibold text-foreground ${capitalize ? "capitalize" : ""}`}>
      {value}
    </div>
  </div>
);

const StepHeader = ({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
}) => (
  <div className="flex flex-col items-center text-center">
    <div className="relative mb-5 flex h-14 w-14 items-center justify-center">
      <div
        className="relative flex h-14 w-14 items-center justify-center rounded-2xl text-white"
        style={{
          background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.35), 0 10px 24px -8px rgba(232,84,42,0.55)",
        }}
      >
        {icon}
      </div>
    </div>
    <div
      className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.22em" }}
    >
      <span className="inline-block h-px w-5 bg-orange-500/70" />
      {eyebrow}
    </div>
    <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
      {title}
    </h2>
    <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
      {subtitle}
    </p>
  </div>
);

export default PartnerOnboardingWizard;
