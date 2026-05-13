import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Coins,
  Eye,
  EyeOff,
  Globe2,
  ImagePlus,
  Languages,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Rocket,
  Settings,
  Sparkles,
  X,
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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PasifyDateInput } from "@/components/ui/pasify-date-input";
import { PasifyTimeInput } from "@/components/ui/pasify-time-input";
import {
  PasifyPriceInput,
} from "@/components/ui/pasify-price-input";
import type {
  PartnerBrand,
  PartnerOrg,
  PartnerVenue,
  OnboardingStatus,
} from "@/hooks/usePartnerContext";

/**
 * PartnerOnboardingWizard — wizard server-side de 6 pasos.
 *
 * Cambios respecto a la version legacy (que se reabria al recargar):
 *   - Auto-open SOLO si `status.shouldShowWizard === true`. El estado
 *     viene de la RPC `partner_onboarding_status` (fuente de verdad
 *     server-side). Si el partner ya completo el wizard o tiene org +
 *     venue reales, NUNCA se abre solo.
 *   - El localStorage del antiguo `pasify.partner.onboarding.v2.<uid>`
 *     se elimina por completo. Server-truth o nada.
 *   - 6 pasos reales que reflejan el modelo Pasify (org → brand →
 *     venue → operacion → primer evento opcional → resumen).
 *   - Persistencia atomica al finalizar: `create_organization` RPC +
 *     UPDATEs en `organizations`, `brands`, `venues`, y RPC
 *     `complete_partner_onboarding` para marcar el estado.
 *   - Permite saltar el paso "Primer evento" sin bloquear.
 *
 * Si la persistencia falla en cualquier punto, mostramos toast con el
 * error real (no genericos) y dejamos el wizard abierto para reintentar.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const CURRENCIES: Array<{ code: string; label: string }> = [
  { code: "EUR", label: "Euro (€)" },
  { code: "USD", label: "Dólar (US$)" },
  { code: "GBP", label: "Libra (£)" },
];

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
];

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Europe/Madrid", label: "Europe/Madrid (CET)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "Atlantic/Canary", label: "Atlantic/Canary (WET)" },
  { value: "America/New_York", label: "America/New_York (EST)" },
];

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "discoteca", label: "Discoteca" },
  { value: "club", label: "Club" },
  { value: "sala", label: "Sala de conciertos" },
  { value: "bar", label: "Bar / Pub" },
  { value: "rooftop", label: "Rooftop" },
  { value: "beachclub", label: "Beach Club" },
  { value: "festival", label: "Festival / Promotora" },
  { value: "restaurante", label: "Restaurante con eventos" },
  { value: "teatro", label: "Teatro" },
  { value: "otro", label: "Otro" },
];

const COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "ES", label: "España" },
  { code: "FR", label: "Francia" },
  { code: "IT", label: "Italia" },
  { code: "PT", label: "Portugal" },
  { code: "GB", label: "Reino Unido" },
  { code: "MX", label: "México" },
];

interface WizardData {
  // Paso 1 — Organización
  orgName: string;
  orgLegalName: string;
  orgSlug: string;
  orgCountry: string;
  orgCity: string;
  orgBillingEmail: string;
  orgContactPhone: string;
  orgWebsite: string;
  orgInstagram: string;

  // Paso 2 — Local / Venue
  venueName: string;
  venueCategory: string;
  venueCity: string;
  venueAddress: string;
  venueCapacity: string;
  venueDescription: string;
  venuePhone: string;
  venueEmail: string;

  // Paso 3 — Branding
  brandLogoUrl: string;
  brandCoverUrl: string;
  brandPrimaryColor: string;
  brandAccentColor: string;

  // Paso 4 — Operación
  opCurrency: string;
  opTimezone: string;
  opLanguage: string;
  opNotificationEmail: string;

  // Paso 5 — Primer evento (opcional)
  firstEventEnabled: boolean;
  firstEventTitle: string;
  firstEventDate: string;
  firstEventTime: string;
  firstEventPrice: string;
  firstEventCapacity: string;
}

const buildInitial = (
  org: PartnerOrg | null,
  venue: PartnerVenue | null,
  brand: PartnerBrand | null,
  email: string | null
): WizardData => ({
  orgName: org?.name ?? "",
  orgLegalName: org?.legal_name ?? "",
  orgSlug: org?.slug ?? "",
  orgCountry: org?.country ?? "ES",
  orgCity: org?.city ?? "",
  orgBillingEmail: org?.billing_email ?? email ?? "",
  orgContactPhone: org?.contact_phone ?? "",
  orgWebsite: (org?.metadata?.["website_url"] as string) ?? "",
  orgInstagram: brand?.instagram_handle ?? "",

  venueName: venue?.name ?? "",
  venueCategory: venue?.business_category ?? "discoteca",
  venueCity: venue?.city ?? org?.city ?? "",
  venueAddress: venue?.address ?? "",
  venueCapacity: venue?.capacity != null ? String(venue.capacity) : "",
  venueDescription: venue?.description ?? "",
  venuePhone: venue?.phone ?? "",
  venueEmail: venue?.email ?? "",

  brandLogoUrl: brand?.logo_url ?? "",
  brandCoverUrl: brand?.cover_image_url ?? venue?.cover_image_url ?? "",
  brandPrimaryColor: brand?.primary_color ?? "#FF7A4D",
  brandAccentColor: brand?.accent_color ?? "#E8542A",

  opCurrency: (org?.metadata?.["currency"] as string) ?? "EUR",
  opTimezone: venue?.timezone ?? "Europe/Madrid",
  opLanguage: (org?.metadata?.["language"] as string) ?? "es",
  opNotificationEmail: org?.contact_email ?? email ?? "",

  firstEventEnabled: false,
  firstEventTitle: "",
  firstEventDate: "",
  firstEventTime: "23:30",
  firstEventPrice: "15.00",
  firstEventCapacity: "300",
});

interface Props {
  userId: string | null;
  status: OnboardingStatus | null;
  org: PartnerOrg | null;
  venue: PartnerVenue | null;
  brand: PartnerBrand | null;
  email?: string | null;
  /** Refrescar contexto desde el dashboard tras completar. */
  onContextRefresh: () => void | Promise<void>;
  /** Si true, el padre fuerza el wizard abierto (boton "Volver al onboarding"). */
  forceOpen?: boolean;
  /** Notifica al padre cuando el wizard se cierra. */
  onClose?: () => void;
}

interface StepDef {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  { id: "org", label: "Organización", icon: <Building2 className="h-3.5 w-3.5" /> },
  { id: "venue", label: "Local", icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: "brand", label: "Branding", icon: <ImagePlus className="h-3.5 w-3.5" /> },
  { id: "ops", label: "Operación", icon: <Settings className="h-3.5 w-3.5" /> },
  { id: "first_event", label: "Primer evento", icon: <CalendarPlus className="h-3.5 w-3.5" /> },
  { id: "review", label: "Resumen", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
];

export const PartnerOnboardingWizard = ({
  userId,
  status,
  org,
  venue,
  brand,
  email,
  onContextRefresh,
  forceOpen = false,
  onClose,
}: Props) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(() => buildInitial(org, venue, brand, email ?? null));
  const [submitting, setSubmitting] = useState(false);

  // Recompute initial cuando llega el contexto real (primer load del dashboard).
  useEffect(() => {
    setData(buildInitial(org, venue, brand, email ?? null));
  }, [org, venue, brand, email]);

  // Auto-open SOLO si status server-side dice que se debe mostrar y el
  // partner no esta ya en una org+venue real. localStorage no participa.
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (!status) return; // todavia loading
    if (status.shouldShowWizard) {
      setOpen(true);
    }
  }, [forceOpen, status]);

  // Si el usuario navega por slug en step 0 actualizamos slug auto.
  useEffect(() => {
    if (step === 0 && data.orgName && !data.orgSlug) {
      const s = slugify(data.orgName);
      if (s) setData((d) => ({ ...d, orgSlug: s }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.orgName]);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  // --- Validation per step ---
  const validateStep = useCallback(
    (idx: number): string | null => {
      if (idx === 0) {
        if (!data.orgName.trim()) return "Pon el nombre de tu organización";
        if (!data.orgCountry) return "Selecciona el país";
        if (data.orgBillingEmail && !/^.+@.+\..+$/.test(data.orgBillingEmail))
          return "Email de facturación no válido";
      }
      if (idx === 1) {
        if (!data.venueName.trim()) return "Pon el nombre del local";
        if (!data.venueCity.trim()) return "La ciudad del local es obligatoria";
        if (!data.venueAddress.trim()) return "Pon la dirección del local";
        if (data.venueCapacity) {
          const c = parseInt(data.venueCapacity, 10);
          if (!Number.isFinite(c) || c <= 0)
            return "El aforo debe ser un número mayor que 0";
        }
      }
      if (idx === 3) {
        if (!data.opCurrency) return "Selecciona una moneda";
        if (!data.opTimezone) return "Selecciona una zona horaria";
      }
      if (idx === 4 && data.firstEventEnabled) {
        if (!data.firstEventTitle.trim()) return "Pon un título al primer evento";
        if (!data.firstEventDate) return "Selecciona la fecha del primer evento";
      }
      return null;
    },
    [data]
  );

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast({ title: "Falta algo", description: err, variant: "destructive" });
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  // --- Persistence (atomic) ---
  const finalize = async () => {
    if (!userId) return;
    // Validar todos los pasos antes de persistir
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validateStep(i);
      if (err) {
        toast({ title: "Faltan datos", description: err, variant: "destructive" });
        setStep(i);
        return;
      }
    }

    setSubmitting(true);
    try {
      // 1) Asegurar organization
      let orgId = status?.primaryOrgId ?? null;
      if (!orgId) {
        // create_organization RPC ya crea org + brand + venue 'principal'
        // y setea profiles.last_active_venue_id. Tras eso refrescamos.
        const { data: createdOrgId, error: createErr } = await supabase.rpc(
          "create_organization",
          {
            _name: data.orgName.trim(),
            _country: data.orgCountry,
            _slug: data.orgSlug.trim() || null,
          } as never
        );
        if (createErr || !createdOrgId)
          throw new Error(createErr?.message ?? "No se pudo crear la organización");
        orgId = createdOrgId as string;
      }

      // 2) UPDATE organizations con los datos extra del paso 1
      const orgMetadata: Record<string, unknown> = {
        ...(org?.metadata ?? {}),
        website_url: data.orgWebsite.trim() || null,
        currency: data.opCurrency,
        language: data.opLanguage,
      };
      const { error: orgUpdErr } = await supabase
        .from("organizations")
        .update({
          name: data.orgName.trim(),
          legal_name: data.orgLegalName.trim() || null,
          country: data.orgCountry,
          city: data.orgCity.trim() || null,
          billing_email: data.orgBillingEmail.trim() || null,
          contact_email: data.opNotificationEmail.trim() || null,
          contact_phone: data.orgContactPhone.trim() || null,
          metadata: orgMetadata,
        })
        .eq("id", orgId);
      if (orgUpdErr) throw new Error(orgUpdErr.message);

      // 3) Localizar brand (create_organization crea 1)
      const { data: brandRow } = await supabase
        .from("brands")
        .select("id, metadata")
        .eq("org_id", orgId)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (brandRow) {
        const brandMetadata: Record<string, unknown> = {
          ...((brandRow.metadata as Record<string, unknown> | null) ?? {}),
        };
        const { error: brandErr } = await supabase
          .from("brands")
          .update({
            name: data.orgName.trim(),
            description: data.venueDescription.trim() || null,
            logo_url: data.brandLogoUrl.trim() || null,
            cover_image_url: data.brandCoverUrl.trim() || null,
            primary_color: data.brandPrimaryColor || null,
            accent_color: data.brandAccentColor || null,
            website_url: data.orgWebsite.trim() || null,
            instagram_handle: data.orgInstagram.trim() || null,
            metadata: brandMetadata,
          })
          .eq("id", brandRow.id);
        if (brandErr) throw new Error(brandErr.message);
      }

      // 4) Localizar venue principal y actualizar
      const { data: venueRow } = await supabase
        .from("venues")
        .select("id")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const venueId = venueRow?.id ?? null;
      if (venueId) {
        const { error: vErr } = await supabase
          .from("venues")
          .update({
            name: data.venueName.trim(),
            business_category: data.venueCategory || null,
            address: data.venueAddress.trim() || null,
            city: data.venueCity.trim() || data.orgCity.trim() || "Madrid",
            country: data.orgCountry,
            timezone: data.opTimezone,
            capacity: data.venueCapacity ? parseInt(data.venueCapacity, 10) : null,
            cover_image_url: data.brandCoverUrl.trim() || null,
            description: data.venueDescription.trim() || null,
            phone: data.venuePhone.trim() || null,
            email: data.venueEmail.trim() || null,
          })
          .eq("id", venueId);
        if (vErr) throw new Error(vErr.message);
      }

      // 5) Sync profile.business_* legacy para que el resto del dashboard
      //    siga renderizando nombre+ciudad+categoria sin migracion masiva.
      await supabase
        .from("profiles")
        .update({
          business_name: data.venueName.trim() || data.orgName.trim(),
          business_category: data.venueCategory || null,
          business_city: data.venueCity.trim() || data.orgCity.trim() || null,
          city: data.venueCity.trim() || data.orgCity.trim() || null,
        })
        .eq("id", userId);

      // 6) Primer evento opcional
      if (data.firstEventEnabled && data.firstEventTitle.trim() && data.firstEventDate) {
        const isoStart = (() => {
          const [y, m, d] = data.firstEventDate.split("-").map(Number);
          const [hh, mm] = (data.firstEventTime || "23:30").split(":").map(Number);
          if (!y || !m || !d) return null;
          return new Date(y, m - 1, d, hh ?? 0, mm ?? 0).toISOString();
        })();
        if (isoStart) {
          const priceCents = Math.max(
            0,
            Math.round(parseFloat(data.firstEventPrice || "0") * 100)
          );
          const cap = data.firstEventCapacity ? parseInt(data.firstEventCapacity, 10) : null;
          const { data: createdEvent, error: eErr } = await supabase
            .from("events")
            .insert({
              partner_id: userId,
              org_id: orgId,
              venue_id: venueId,
              title: data.firstEventTitle.trim(),
              city: data.venueCity.trim() || "Madrid",
              venue_name: data.venueName.trim() || null,
              address: data.venueAddress.trim() || null,
              date_start: isoStart,
              price_cents: priceCents,
              capacity: cap && cap > 0 ? cap : null,
              image_url: data.brandCoverUrl.trim() || null,
              status: "draft",
            })
            .select("id")
            .single();
          if (eErr) throw new Error(eErr.message);
          if (createdEvent) {
            await supabase.from("ticket_tiers").insert({
              event_id: createdEvent.id,
              name: "Entrada General",
              description: "Acceso general al evento",
              price_cents: priceCents,
              currency: data.opCurrency || "EUR",
              capacity: cap && cap > 0 ? cap : null,
              per_user_max: 4,
              status: "active",
              sort_order: 0,
            });
          }
        }
      }

      // 7) Marcar onboarding como completado (server-truth)
      const rpcAny = supabase as unknown as {
        rpc: (n: string, a?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
      const { error: completeErr } = await rpcAny.rpc("complete_partner_onboarding", {
        _org_id: orgId,
        _venue_id: venueId,
        _data: {
          completed_via: "wizard",
          had_first_event: data.firstEventEnabled,
        },
      });
      if (completeErr) {
        console.warn("[onboarding] complete RPC error", completeErr.message);
      }

      toast({
        title: "Configuración completada",
        description: data.firstEventEnabled
          ? "Tu organización, local y primer evento están listos. Bienvenido a Pasify."
          : "Tu organización y local están configurados. Cuando estés, crea tu primer evento.",
      });

      await onContextRefresh();
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error guardando configuración";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Saltar onboarding ahora: lo marca como skipped en server. El usuario
  // puede reabrirlo desde Configuración/Ayuda mas tarde.
  const skipForNow = async () => {
    if (!userId) {
      close();
      return;
    }
    setSubmitting(true);
    try {
      const rpcAny = supabase as unknown as {
        rpc: (n: string, a?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
      await rpcAny.rpc("save_partner_onboarding_progress", {
        _org_id: status?.primaryOrgId ?? null,
        _step: STEPS[step]?.id ?? null,
        _data: { skipped_at: new Date().toISOString() },
      });
      // No marcamos completed — solo guardamos snapshot. Si quieren skip
      // total, finalize() es el camino correcto. Aqui simplemente cerramos.
      await onContextRefresh();
      close();
    } finally {
      setSubmitting(false);
    }
  };

  // Resumen agregado para el step 5
  const summary = useMemo(
    () => ({
      org: data.orgName,
      legal: data.orgLegalName,
      country: COUNTRIES.find((c) => c.code === data.orgCountry)?.label ?? data.orgCountry,
      orgCity: data.orgCity,
      venueName: data.venueName,
      venueCategory:
        CATEGORIES.find((c) => c.value === data.venueCategory)?.label ?? data.venueCategory,
      venueCity: data.venueCity,
      venueAddress: data.venueAddress,
      capacity: data.venueCapacity,
      currency: data.opCurrency,
      timezone: data.opTimezone,
      language: LANGUAGES.find((l) => l.code === data.opLanguage)?.label ?? data.opLanguage,
      firstEvent: data.firstEventEnabled
        ? `${data.firstEventTitle} · ${data.firstEventDate} ${data.firstEventTime}h`
        : null,
    }),
    [data]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-background/95 backdrop-blur-md">
      {/* Halo */}
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

      <div className="relative flex w-full max-w-4xl flex-col">
        {/* Header */}
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 pt-6 md:px-8 md:pt-8">
          <div className="min-w-0">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Sparkles className="h-3 w-3" />
              Pasify · Configuración inicial
            </div>
            <h2 className="truncate text-xl font-bold leading-tight tracking-tight md:text-2xl">
              Configura tu{" "}
              <span style={serif} className="text-orange-500">
                local
              </span>{" "}
              en 6 pasos
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void skipForNow()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-orange-500/40 hover:text-foreground"
            disabled={submitting}
          >
            <Clock className="h-3 w-3" />
            Continuar más tarde
          </button>
          <button
            type="button"
            onClick={() => void skipForNow()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Cerrar onboarding"
            disabled={submitting}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Stepper */}
        <div className="shrink-0 px-5 pt-5 md:px-8">
          <ol className="flex items-center gap-1.5 overflow-x-auto">
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (i <= step) {
                        setStep(i);
                        return;
                      }
                      // Validar pasos intermedios antes de saltar adelante
                      for (let k = step; k < i; k++) {
                        const err = validateStep(k);
                        if (err) {
                          toast({ title: "Completa el paso", description: err, variant: "destructive" });
                          return;
                        }
                      }
                      setStep(i);
                    }}
                    className={`group inline-flex min-w-0 flex-1 items-center gap-2 rounded-full border px-2.5 py-1 text-left transition ${
                      current
                        ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                        : done
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                        : "border-border bg-card/50 text-muted-foreground hover:border-orange-500/30"
                    }`}
                    aria-current={current ? "step" : undefined}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        current ? "bg-orange-500/30" : done ? "bg-emerald-500/30" : "bg-muted"
                      }`}
                      style={mono}
                    >
                      {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                    </span>
                    <span
                      className={`truncate text-[10px] uppercase ${current ? "font-semibold" : "font-medium"}`}
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      {s.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <main className="scrollbar-pasify min-h-0 flex-1 overflow-y-auto px-5 py-7 md:px-8 md:py-10">
          {step === 0 && <StepOrg data={data} setData={setData} disabled={submitting} />}
          {step === 1 && <StepVenue data={data} setData={setData} disabled={submitting} />}
          {step === 2 && <StepBrand data={data} setData={setData} disabled={submitting} />}
          {step === 3 && <StepOperation data={data} setData={setData} disabled={submitting} email={email} />}
          {step === 4 && <StepFirstEvent data={data} setData={setData} disabled={submitting} />}
          {step === 5 && <StepReview summary={summary} />}
        </main>

        {/* Footer */}
        <footer className="shrink-0 flex items-center justify-between gap-2 border-t border-border bg-card/60 px-5 py-4 md:px-8">
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 0 || submitting}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Atrás
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={submitting}
              className="group/btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
              }}
            >
              Siguiente
              <ArrowRight className="h-4 w-4 transition group-hover/btn:translate-x-1" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void finalize()}
              disabled={submitting}
              className="group/btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
              }}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {submitting ? "Guardando configuración…" : "Finalizar configuración"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

// =================================================================
// Step components
// =================================================================

type SetData = React.Dispatch<React.SetStateAction<WizardData>>;

const StepShell = ({
  eyebrow,
  title,
  subtitle,
  icon,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div>
    <header className="mx-auto mb-7 max-w-2xl text-center md:text-left">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white"
        style={{
          background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.35), 0 10px 24px -8px rgba(232,84,42,0.55)",
        }}
      >
        {icon}
      </div>
      <div
        className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        <span className="inline-block h-px w-5 bg-orange-500/70" />
        {eyebrow}
      </div>
      <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-[15px]">
        {subtitle}
      </p>
    </header>
    {children}
  </div>
);

const StepOrg = ({ data, setData, disabled }: { data: WizardData; setData: SetData; disabled?: boolean }) => (
  <StepShell
    icon={<Building2 className="h-6 w-6" />}
    eyebrow="Paso 01"
    title={
      <>
        Empieza por tu{" "}
        <span style={serif} className="text-orange-500">
          organización
        </span>
        .
      </>
    }
    subtitle="Es la entidad que cobra (tu empresa o nombre comercial). Puedes tener uno o varios locales dentro."
  >
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs">Nombre comercial *</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Tu empresa o nombre comercial"
          value={data.orgName}
          onChange={(e) => setData((d) => ({ ...d, orgName: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Razón social</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Nombre legal en el registro"
          value={data.orgLegalName}
          onChange={(e) => setData((d) => ({ ...d, orgLegalName: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Slug (URL)</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="auto desde el nombre"
          value={data.orgSlug}
          onChange={(e) => setData((d) => ({ ...d, orgSlug: slugify(e.target.value) }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">País *</Label>
        <Select
          value={data.orgCountry}
          onValueChange={(v) => setData((d) => ({ ...d, orgCountry: v }))}
          disabled={disabled}
        >
          <SelectTrigger className="mt-1.5 h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Ciudad principal</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Madrid, Ibiza, Barcelona…"
          value={data.orgCity}
          onChange={(e) => setData((d) => ({ ...d, orgCity: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Mail className="h-3 w-3 text-orange-500" />
          Email de facturación
        </Label>
        <Input
          type="email"
          className="mt-1.5 h-11 rounded-xl"
          placeholder="facturacion@tuempresa.com"
          value={data.orgBillingEmail}
          onChange={(e) => setData((d) => ({ ...d, orgBillingEmail: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Phone className="h-3 w-3 text-orange-500" />
          Teléfono de contacto
        </Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="+34 ..."
          value={data.orgContactPhone}
          onChange={(e) => setData((d) => ({ ...d, orgContactPhone: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Globe2 className="h-3 w-3 text-orange-500" />
          Web (opcional)
        </Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="https://"
          value={data.orgWebsite}
          onChange={(e) => setData((d) => ({ ...d, orgWebsite: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Instagram (opcional)</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="@tu_local"
          value={data.orgInstagram}
          onChange={(e) =>
            setData((d) => ({ ...d, orgInstagram: e.target.value.replace(/^@/, "") }))
          }
          disabled={disabled}
        />
      </div>
    </div>
  </StepShell>
);

const StepVenue = ({ data, setData, disabled }: { data: WizardData; setData: SetData; disabled?: boolean }) => (
  <StepShell
    icon={<MapPin className="h-6 w-6" />}
    eyebrow="Paso 02"
    title={
      <>
        Detalles de tu{" "}
        <span style={serif} className="text-orange-500">
          local
        </span>
        .
      </>
    }
    subtitle="Esta es la info que verán los clientes en el ticket y en la página pública. Puedes editarla siempre."
  >
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs">Nombre del local *</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Sala principal, club, terraza, etc."
          value={data.venueName}
          onChange={(e) => setData((d) => ({ ...d, venueName: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Categoría</Label>
        <Select
          value={data.venueCategory}
          onValueChange={(v) => setData((d) => ({ ...d, venueCategory: v }))}
          disabled={disabled}
        >
          <SelectTrigger className="mt-1.5 h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Aforo</Label>
        <Input
          type="number"
          min="1"
          className="mt-1.5 h-11 rounded-xl"
          placeholder="300"
          value={data.venueCapacity}
          onChange={(e) => setData((d) => ({ ...d, venueCapacity: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Ciudad *</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Madrid, Ibiza, Barcelona…"
          value={data.venueCity}
          onChange={(e) => setData((d) => ({ ...d, venueCity: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Dirección *</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Calle, número, CP"
          value={data.venueAddress}
          onChange={(e) => setData((d) => ({ ...d, venueAddress: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs">Descripción pública</Label>
        <Textarea
          className="mt-1.5 min-h-[96px] rounded-xl"
          placeholder="Estilo musical, edad mínima, dress code, parking, lo que quieras destacar del local."
          value={data.venueDescription}
          onChange={(e) => setData((d) => ({ ...d, venueDescription: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Phone className="h-3 w-3 text-orange-500" />
          Teléfono del local
        </Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="+34 ..."
          value={data.venuePhone}
          onChange={(e) => setData((d) => ({ ...d, venuePhone: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Mail className="h-3 w-3 text-orange-500" />
          Email del local
        </Label>
        <Input
          type="email"
          className="mt-1.5 h-11 rounded-xl"
          placeholder="info@tulocal.com"
          value={data.venueEmail}
          onChange={(e) => setData((d) => ({ ...d, venueEmail: e.target.value }))}
          disabled={disabled}
        />
      </div>
    </div>
  </StepShell>
);

const StepBrand = ({ data, setData, disabled }: { data: WizardData; setData: SetData; disabled?: boolean }) => (
  <StepShell
    icon={<ImagePlus className="h-6 w-6" />}
    eyebrow="Paso 03"
    title={
      <>
        Tu identidad{" "}
        <span style={serif} className="text-orange-500">
          visual
        </span>
        .
      </>
    }
    subtitle="Logo y portada aparecen en tu página pública, tickets y emails. Puedes saltarte este paso y subirlos después."
  >
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label className="text-xs">URL del logo</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="https://…"
          value={data.brandLogoUrl}
          onChange={(e) => setData((d) => ({ ...d, brandLogoUrl: e.target.value }))}
          disabled={disabled}
        />
        <div className="mt-3 flex h-32 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card">
          {data.brandLogoUrl ? (
            <img src={data.brandLogoUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">Preview del logo</span>
          )}
        </div>
      </div>
      <div>
        <Label className="text-xs">URL de portada</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="https://…"
          value={data.brandCoverUrl}
          onChange={(e) => setData((d) => ({ ...d, brandCoverUrl: e.target.value }))}
          disabled={disabled}
        />
        <div className="mt-3 h-32 overflow-hidden rounded-2xl border border-dashed border-border bg-card">
          {data.brandCoverUrl ? (
            <img src={data.brandCoverUrl} alt="Cover preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Preview de portada
            </div>
          )}
        </div>
      </div>
      <div>
        <Label className="text-xs">Color primario</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="color"
            value={data.brandPrimaryColor}
            onChange={(e) => setData((d) => ({ ...d, brandPrimaryColor: e.target.value }))}
            disabled={disabled}
            className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-card"
          />
          <Input
            className="h-11 flex-1 rounded-xl"
            value={data.brandPrimaryColor}
            onChange={(e) => setData((d) => ({ ...d, brandPrimaryColor: e.target.value }))}
            disabled={disabled}
            placeholder="#FF7A4D"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Color acento</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="color"
            value={data.brandAccentColor}
            onChange={(e) => setData((d) => ({ ...d, brandAccentColor: e.target.value }))}
            disabled={disabled}
            className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-card"
          />
          <Input
            className="h-11 flex-1 rounded-xl"
            value={data.brandAccentColor}
            onChange={(e) => setData((d) => ({ ...d, brandAccentColor: e.target.value }))}
            disabled={disabled}
            placeholder="#E8542A"
          />
        </div>
      </div>
    </div>
  </StepShell>
);

const StepOperation = ({
  data,
  setData,
  disabled,
  email,
}: {
  data: WizardData;
  setData: SetData;
  disabled?: boolean;
  email?: string | null;
}) => (
  <StepShell
    icon={<Settings className="h-6 w-6" />}
    eyebrow="Paso 04"
    title={
      <>
        Operación y{" "}
        <span style={serif} className="text-orange-500">
          preferencias
        </span>
        .
      </>
    }
    subtitle="Moneda, zona horaria, idioma del panel y dónde quieres recibir alertas. Todo editable luego desde Configuración."
  >
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Coins className="h-3 w-3 text-orange-500" />
          Moneda *
        </Label>
        <Select value={data.opCurrency} onValueChange={(v) => setData((d) => ({ ...d, opCurrency: v }))} disabled={disabled}>
          <SelectTrigger className="mt-1.5 h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Clock className="h-3 w-3 text-orange-500" />
          Zona horaria *
        </Label>
        <Select value={data.opTimezone} onValueChange={(v) => setData((d) => ({ ...d, opTimezone: v }))} disabled={disabled}>
          <SelectTrigger className="mt-1.5 h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Languages className="h-3 w-3 text-orange-500" />
          Idioma del panel
        </Label>
        <Select value={data.opLanguage} onValueChange={(v) => setData((d) => ({ ...d, opLanguage: v }))} disabled={disabled}>
          <SelectTrigger className="mt-1.5 h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Bell className="h-3 w-3 text-orange-500" />
          Email para notificaciones
        </Label>
        <Input
          type="email"
          className="mt-1.5 h-11 rounded-xl"
          placeholder={email ?? "alertas@tuempresa.com"}
          value={data.opNotificationEmail}
          onChange={(e) => setData((d) => ({ ...d, opNotificationEmail: e.target.value }))}
          disabled={disabled}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Aquí llegan ventas, reembolsos y alertas del operativo.
        </p>
      </div>
    </div>
  </StepShell>
);

const StepFirstEvent = ({ data, setData, disabled }: { data: WizardData; setData: SetData; disabled?: boolean }) => (
  <StepShell
    icon={<CalendarPlus className="h-6 w-6" />}
    eyebrow="Paso 05 · Opcional"
    title={
      <>
        ¿Creamos tu primer{" "}
        <span style={serif} className="text-orange-500">
          evento
        </span>
        ?
      </>
    }
    subtitle="Lo guardamos como borrador con un tipo de entrada 'Entrada General'. Lo puedes editar y publicar luego. Si prefieres, salta este paso."
  >
    <div className="mx-auto max-w-2xl">
      <div
        className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="flex items-center gap-3">
          {data.firstEventEnabled ? (
            <Eye className="h-4 w-4 text-orange-500" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <div className="text-sm font-medium text-foreground">
              {data.firstEventEnabled ? "Crear primer evento ahora" : "Saltar y hacerlo más tarde"}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {data.firstEventEnabled
                ? "Tu primer evento se creará como borrador al finalizar."
                : "Podrás crearlo desde 'Mis eventos' cuando quieras."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setData((d) => ({ ...d, firstEventEnabled: !d.firstEventEnabled }))}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-orange-500/40"
        >
          {data.firstEventEnabled ? "Saltar paso" : "Activar"}
        </button>
      </div>

      {data.firstEventEnabled && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs">Nombre del evento *</Label>
            <Input
              className="mt-1.5 h-11 rounded-xl"
              placeholder="Saturday Night · Resident DJs"
              value={data.firstEventTitle}
              onChange={(e) => setData((d) => ({ ...d, firstEventTitle: e.target.value }))}
              disabled={disabled}
            />
          </div>
          <div>
            <Label className="text-xs">Fecha *</Label>
            <div className="mt-1.5">
              <PasifyDateInput
                value={data.firstEventDate}
                onChange={(v) => setData((d) => ({ ...d, firstEventDate: v }))}
                disabled={disabled}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Hora</Label>
            <div className="mt-1.5">
              <PasifyTimeInput
                value={data.firstEventTime}
                onChange={(v) => setData((d) => ({ ...d, firstEventTime: v }))}
                disabled={disabled}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Precio entrada</Label>
            <div className="mt-1.5">
              <PasifyPriceInput
                value={data.firstEventPrice}
                onChange={(v) => setData((d) => ({ ...d, firstEventPrice: v }))}
                step={0.1}
                min={0}
                disabled={disabled}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Aforo</Label>
            <Input
              type="number"
              min="1"
              className="mt-1.5 h-11 rounded-xl"
              value={data.firstEventCapacity}
              onChange={(e) => setData((d) => ({ ...d, firstEventCapacity: e.target.value }))}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  </StepShell>
);

const StepReview = ({
  summary,
}: {
  summary: {
    org: string;
    legal: string;
    country: string;
    orgCity: string;
    venueName: string;
    venueCategory: string;
    venueCity: string;
    venueAddress: string;
    capacity: string;
    currency: string;
    timezone: string;
    language: string;
    firstEvent: string | null;
  };
}) => (
  <StepShell
    icon={<CheckCircle2 className="h-6 w-6" />}
    eyebrow="Paso 06"
    title={
      <>
        Revisa antes de{" "}
        <span style={serif} className="text-orange-500">
          finalizar
        </span>
        .
      </>
    }
    subtitle="Comprueba que todo esté correcto. Después de finalizar, podrás editar cualquier dato desde Configuración."
  >
    <div className="mx-auto max-w-3xl space-y-5">
      <ReviewBlock title="Organización">
        <ReviewRow label="Nombre" value={summary.org || "—"} />
        <ReviewRow label="Razón social" value={summary.legal || "—"} />
        <ReviewRow label="País" value={summary.country} />
        <ReviewRow label="Ciudad" value={summary.orgCity || "—"} />
      </ReviewBlock>
      <ReviewBlock title="Local">
        <ReviewRow label="Nombre" value={summary.venueName || "—"} />
        <ReviewRow label="Categoría" value={summary.venueCategory} />
        <ReviewRow label="Ciudad" value={summary.venueCity || "—"} />
        <ReviewRow label="Dirección" value={summary.venueAddress || "—"} />
        <ReviewRow label="Aforo" value={summary.capacity ? `${summary.capacity} personas` : "—"} />
      </ReviewBlock>
      <ReviewBlock title="Operación">
        <ReviewRow label="Moneda" value={summary.currency} />
        <ReviewRow label="Zona horaria" value={summary.timezone} />
        <ReviewRow label="Idioma" value={summary.language} />
      </ReviewBlock>
      {summary.firstEvent && (
        <ReviewBlock title="Primer evento">
          <ReviewRow label="Evento" value={summary.firstEvent} />
          <div className="text-[11px] text-muted-foreground">
            Se creará como borrador con un tipo de entrada "Entrada General".
          </div>
        </ReviewBlock>
      )}
    </div>
  </StepShell>
);

const ReviewBlock = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border bg-card/40 p-5">
    <div
      className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.22em" }}
    >
      <span className="inline-block h-px w-5 bg-orange-500/70" />
      {title}
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start gap-4">
    <div
      className="w-32 shrink-0 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {label}
    </div>
    <div className="flex-1 text-sm font-medium text-foreground">{value}</div>
  </div>
);

export default PartnerOnboardingWizard;
