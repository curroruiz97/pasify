import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  Clock,
  Coins,
  Globe2,
  ImagePlus,
  Languages,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Rocket,
  Settings,
  Sparkles,
  Star,
  Trash2,
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
import { SpanishCitySelect } from "@/components/ui/spanish-city-select";
import { PartnerImageUploader } from "@/components/partner/PartnerImageUploader";
import { cn } from "@/lib/utils";
import type {
  PartnerBrand,
  PartnerOrg,
  PartnerVenue,
  OnboardingStatus,
} from "@/hooks/usePartnerContext";

/**
 * PartnerOnboardingWizard — onboarding **obligatorio** del partner.
 *
 * Reglas duras (decisión de producto, mayo 2026):
 *   - NO se puede saltar. No hay "Continuar más tarde" ni "X" cerrar.
 *     Sólo se completa cuando los campos obligatorios se guardan en
 *     organizations / venues / brands sin error.
 *   - Layout 80vw en escritorio (responsive en móvil).
 *   - Stepper móvil = sólo números, sin labels (espacio limitado).
 *   - Multi-venue: el partner declara al menos UN local; puede añadir
 *     varios. El primero reemplaza al venue placeholder "Principal" que
 *     `claim_partner_free_plan` o `create_organization` crearon.
 *   - SpanishCitySelect para todos los campos de ciudad.
 *   - Logo + portada via PartnerImageUploader (Supabase Storage real,
 *     no URL libre).
 *
 * Persistencia atómica (un solo "Finalizar"):
 *   1. create_organization (si no existe org propia)
 *   2. UPDATE organizations (datos de empresa)
 *   3. UPDATE brand principal (logo, cover, colores, web, IG)
 *   4. UPDATE venue placeholder → primer local del form
 *   5. INSERT venues adicionales
 *   6. complete_partner_onboarding RPC marca server-truth
 *   7. onContextRefresh refresca el contexto y el wizard se cierra solo
 *
 * Si cualquier paso falla, mostramos toast con el error real (no
 * genéricos) y dejamos el wizard abierto para reintentar.
 */

const mono: React.CSSProperties = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
  letterSpacing: "0.18em",
};
const serif: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic",
  fontWeight: 400,
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/̀-ͯ/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const CURRENCIES = [
  { code: "EUR", label: "Euro (€)" },
  { code: "USD", label: "Dólar (US$)" },
  { code: "GBP", label: "Libra (£)" },
] as const;

const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
] as const;

const TIMEZONES = [
  { value: "Europe/Madrid", label: "Europe/Madrid (CET)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "Atlantic/Canary", label: "Atlantic/Canary (WET)" },
  { value: "America/New_York", label: "America/New_York (EST)" },
] as const;

const CATEGORIES = [
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
] as const;

const COUNTRIES = [
  { code: "ES", label: "España" },
  { code: "FR", label: "Francia" },
  { code: "IT", label: "Italia" },
  { code: "PT", label: "Portugal" },
  { code: "GB", label: "Reino Unido" },
  { code: "MX", label: "México" },
] as const;

// Regex validaciones — pragmáticas, no estrictas RFC.
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RX = /^[+()\-\s\d]{7,24}$/;

interface VenueInput {
  /** id real si ya existe en BD (placeholder o re-edición). */
  id: string | null;
  name: string;
  category: string;
  city: string;
  address: string;
  capacity: string;
  description: string;
  phone: string;
  email: string;
}

const emptyVenue = (): VenueInput => ({
  id: null,
  name: "",
  category: "discoteca",
  city: "",
  address: "",
  capacity: "",
  description: "",
  phone: "",
  email: "",
});

interface WizardData {
  // Paso 1 — Organización (obligatorio)
  orgName: string;
  orgLegalName: string;
  orgSlug: string;
  orgCountry: string;
  orgCity: string;
  orgBillingEmail: string;
  orgContactPhone: string;
  orgWebsite: string;
  orgInstagram: string;

  // Paso 2 — Locales (mínimo 1, máx 10 razonable)
  venues: VenueInput[];

  // Paso 3 — Branding (todo opcional, pero los uploaders existen)
  brandLogoUrl: string;
  brandCoverUrl: string;
  brandPrimaryColor: string;
  brandAccentColor: string;

  // Paso 4 — Operación
  opCurrency: string;
  opTimezone: string;
  opLanguage: string;
  opNotificationEmail: string;
}

const buildInitial = (
  org: PartnerOrg | null,
  venue: PartnerVenue | null,
  venues: PartnerVenue[],
  brand: PartnerBrand | null,
  email: string | null
): WizardData => {
  // Mapear venues existentes al formato del wizard. Si NO hay venues
  // reales, partimos de uno vacío. Si solo está el placeholder
  // "Principal", lo dejamos como base (el form lo va a renombrar).
  const realVenues = (venues.length > 0 ? venues : venue ? [venue] : []).map(
    (v) =>
      ({
        id: v.id,
        name: v.name === "Principal" ? "" : v.name,
        category: v.business_category ?? "discoteca",
        city: v.city ?? org?.city ?? "",
        address: v.address ?? "",
        capacity: v.capacity != null ? String(v.capacity) : "",
        description: v.description ?? "",
        phone: v.phone ?? "",
        email: v.email ?? "",
      } as VenueInput)
  );

  return {
    orgName: org?.name ?? "",
    orgLegalName: org?.legal_name ?? "",
    orgSlug: org?.slug ?? "",
    orgCountry: org?.country ?? "ES",
    orgCity: org?.city ?? "",
    orgBillingEmail: org?.billing_email ?? email ?? "",
    orgContactPhone: org?.contact_phone ?? "",
    orgWebsite: (org?.metadata?.["website_url"] as string) ?? "",
    orgInstagram: brand?.instagram_handle ?? "",

    venues: realVenues.length > 0 ? realVenues : [emptyVenue()],

    brandLogoUrl: brand?.logo_url ?? "",
    brandCoverUrl: brand?.cover_image_url ?? venue?.cover_image_url ?? "",
    brandPrimaryColor: brand?.primary_color ?? "#FF7A4D",
    brandAccentColor: brand?.accent_color ?? "#E8542A",

    opCurrency: (org?.metadata?.["currency"] as string) ?? "EUR",
    opTimezone: venue?.timezone ?? "Europe/Madrid",
    opLanguage: (org?.metadata?.["language"] as string) ?? "es",
    opNotificationEmail: org?.contact_email ?? email ?? "",
  };
};

interface Props {
  userId: string | null;
  status: OnboardingStatus | null;
  org: PartnerOrg | null;
  venue: PartnerVenue | null;
  venues?: PartnerVenue[];
  brand: PartnerBrand | null;
  email?: string | null;
  /** Refrescar contexto desde el dashboard tras completar. */
  onContextRefresh: () => void | Promise<void>;
  /** Forzar abrir el wizard (sólo se usa para re-editar cuando ya está completado). */
  forceOpen?: boolean;
  /** Notifica al padre cuando el wizard se cierra (sólo se llama tras
   *  finalize() exitoso, NUNCA por escape de usuario). */
  onClose?: () => void;
}

const STEPS = [
  { id: "org", label: "Organización", icon: <Building2 className="h-3.5 w-3.5" /> },
  { id: "venues", label: "Locales", icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: "brand", label: "Branding", icon: <ImagePlus className="h-3.5 w-3.5" /> },
  { id: "ops", label: "Operación", icon: <Settings className="h-3.5 w-3.5" /> },
  { id: "review", label: "Resumen", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
] as const;

export const PartnerOnboardingWizard = ({
  userId,
  status,
  org,
  venue,
  venues: ctxVenues,
  brand,
  email,
  onContextRefresh,
  forceOpen = false,
  onClose,
}: Props) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(() =>
    buildInitial(org, venue, ctxVenues ?? [], brand, email ?? null)
  );
  const [submitting, setSubmitting] = useState(false);

  // Recompute inicial cuando llega el contexto real (primer load del dashboard).
  useEffect(() => {
    setData(buildInitial(org, venue, ctxVenues ?? [], brand, email ?? null));
  }, [org, venue, ctxVenues, brand, email]);

  // Auto-open: server-truth manda. forceOpen permite re-editar tras completado.
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (!status) return; // todavía loading
    if (status.shouldShowWizard) {
      setOpen(true);
    }
  }, [forceOpen, status]);

  // Auto-slug
  useEffect(() => {
    if (step === 0 && data.orgName && !data.orgSlug) {
      const s = slugify(data.orgName);
      if (s) setData((d) => ({ ...d, orgSlug: s }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.orgName]);

  // --- Validation per step ---
  const validateStep = useCallback(
    (idx: number): string | null => {
      if (idx === 0) {
        if (!data.orgName.trim()) return "Pon el nombre comercial de tu empresa";
        if (!data.orgLegalName.trim())
          return "Pon la razón social (nombre legal de la empresa)";
        if (!data.orgCountry) return "Selecciona el país";
        if (!data.orgCity.trim()) return "Selecciona la ciudad principal";
        if (!data.orgBillingEmail.trim())
          return "Email de facturación es obligatorio";
        if (!EMAIL_RX.test(data.orgBillingEmail.trim()))
          return "Email de facturación no válido";
        if (!data.orgContactPhone.trim())
          return "Teléfono de contacto es obligatorio";
        if (!PHONE_RX.test(data.orgContactPhone.trim()))
          return "Teléfono no válido (mín 7 dígitos)";
      }
      if (idx === 1) {
        if (data.venues.length === 0) return "Añade al menos un local";
        for (let i = 0; i < data.venues.length; i++) {
          const v = data.venues[i];
          const ord = i + 1;
          if (!v.name.trim()) return `Local ${ord}: pon el nombre`;
          if (!v.category) return `Local ${ord}: elige una categoría`;
          if (!v.city.trim()) return `Local ${ord}: selecciona la ciudad`;
          if (!v.address.trim()) return `Local ${ord}: pon la dirección`;
          if (v.capacity) {
            const c = parseInt(v.capacity, 10);
            if (!Number.isFinite(c) || c <= 0)
              return `Local ${ord}: aforo debe ser número mayor que 0`;
          }
          if (v.email && !EMAIL_RX.test(v.email.trim()))
            return `Local ${ord}: email no válido`;
          if (v.phone && !PHONE_RX.test(v.phone.trim()))
            return `Local ${ord}: teléfono no válido`;
        }
      }
      if (idx === 3) {
        if (!data.opCurrency) return "Selecciona una moneda";
        if (!data.opTimezone) return "Selecciona una zona horaria";
        if (
          data.opNotificationEmail &&
          !EMAIL_RX.test(data.opNotificationEmail.trim())
        )
          return "Email de notificaciones no válido";
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

      // 2) UPDATE organizations con todos los datos del paso 1
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
          contact_email: data.opNotificationEmail.trim() || data.orgBillingEmail.trim() || null,
          contact_phone: data.orgContactPhone.trim() || null,
          metadata: orgMetadata,
        })
        .eq("id", orgId);
      if (orgUpdErr) throw new Error(orgUpdErr.message);

      // 3) Brand principal (create_organization crea 1)
      const { data: brandRow } = await supabase
        .from("brands")
        .select("id, metadata")
        .eq("org_id", orgId)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      const brandId = brandRow?.id ?? null;
      if (brandRow) {
        const brandMetadata: Record<string, unknown> = {
          ...((brandRow.metadata as Record<string, unknown> | null) ?? {}),
        };
        const { error: brandErr } = await supabase
          .from("brands")
          .update({
            name: data.orgName.trim(),
            description: data.venues[0]?.description?.trim() || null,
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

      // 4) Venues. Localizar TODOS los existentes para reusar IDs.
      const { data: existingVenues } = await supabase
        .from("venues")
        .select("id")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true });
      const existingIds = (existingVenues ?? []).map((v) => v.id);

      // El primer venue del form sustituye al PRIMER existente (placeholder
      // o real) — eso garantiza que el "Principal" sin datos se rellena.
      let primaryVenueId: string | null = null;
      for (let i = 0; i < data.venues.length; i++) {
        const v = data.venues[i];
        const targetId = v.id ?? existingIds[i] ?? null;
        const cap = v.capacity ? parseInt(v.capacity, 10) : null;
        const payload = {
          name: v.name.trim(),
          business_category: v.category || null,
          address: v.address.trim() || null,
          city: v.city.trim() || data.orgCity.trim() || "Madrid",
          country: data.orgCountry,
          timezone: data.opTimezone,
          capacity: cap && cap > 0 ? cap : null,
          description: v.description.trim() || null,
          phone: v.phone.trim() || null,
          email: v.email.trim() || null,
          cover_image_url:
            i === 0 ? (data.brandCoverUrl.trim() || null) : null,
        };
        if (targetId) {
          const { error: vErr } = await supabase
            .from("venues")
            .update(payload)
            .eq("id", targetId);
          if (vErr) throw new Error(`Local ${i + 1}: ${vErr.message}`);
          if (i === 0) primaryVenueId = targetId;
        } else {
          // INSERT — necesitamos brand_id + slug. El slug lo deja el
          // trigger del venue (genera desde name si está vacío). Si no
          // hay trigger, generamos aquí.
          const slug = slugify(v.name);
          const { data: ins, error: insErr } = await supabase
            .from("venues")
            .insert({
              org_id: orgId,
              brand_id: brandId,
              slug: slug || `venue-${Date.now()}-${i}`,
              status: "active",
              ...payload,
            })
            .select("id")
            .single();
          if (insErr) throw new Error(`Local ${i + 1}: ${insErr.message}`);
          if (i === 0 && ins) primaryVenueId = ins.id;
        }
      }

      // 4b) Si había más existing venues que del form, NO los borramos
      // (puede haber data viva). Eso se hace desde Settings con confirmación.

      // 5) Sync profile.business_* legacy para el resto del dashboard
      await supabase
        .from("profiles")
        .update({
          business_name: data.venues[0]?.name?.trim() || data.orgName.trim(),
          business_category: data.venues[0]?.category || null,
          business_city: data.venues[0]?.city?.trim() || data.orgCity.trim() || null,
          city: data.venues[0]?.city?.trim() || data.orgCity.trim() || null,
        })
        .eq("id", userId);

      // 6) Marcar onboarding completado (server-truth)
      const rpcAny = supabase as unknown as {
        rpc: (n: string, a?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
      const { error: completeErr } = await rpcAny.rpc("complete_partner_onboarding", {
        _org_id: orgId,
        _venue_id: primaryVenueId,
        _data: {
          completed_via: "wizard_v2",
          venues_count: data.venues.length,
        },
      });
      if (completeErr) {
        // No bloqueamos: los datos están guardados. El estado lo recalcula
        // partner_onboarding_status desde organizations/venues reales.
        console.warn("[onboarding] complete RPC error", completeErr.message);
      }

      toast({
        title: "Configuración completada",
        description: "Tu organización y tus locales están listos. Bienvenido a Pasify.",
      });

      await onContextRefresh();
      setOpen(false);
      onClose?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error guardando configuración";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Resumen agregado para el step final
  const summary = useMemo(
    () => ({
      org: data.orgName,
      legal: data.orgLegalName,
      country: COUNTRIES.find((c) => c.code === data.orgCountry)?.label ?? data.orgCountry,
      orgCity: data.orgCity,
      orgEmail: data.orgBillingEmail,
      orgPhone: data.orgContactPhone,
      venues: data.venues.map((v) => ({
        name: v.name,
        category: CATEGORIES.find((c) => c.value === v.category)?.label ?? v.category,
        city: v.city,
        address: v.address,
      })),
      currency: data.opCurrency,
      timezone: data.opTimezone,
      language: LANGUAGES.find((l) => l.code === data.opLanguage)?.label ?? data.opLanguage,
      hasLogo: !!data.brandLogoUrl,
      hasCover: !!data.brandCoverUrl,
    }),
    [data]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-background/95 backdrop-blur-md">
      {/* Halo terracota */}
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

      {/* Contenedor: 80vw en desktop, full-width en mobile */}
      <div className="relative flex w-full flex-col md:w-[80vw] md:max-w-[1280px]">
        {/* Header — sin botón X, sin "Continuar más tarde". Onboarding obligatorio. */}
        <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-6 md:px-10 md:pt-10">
          <div className="min-w-0">
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Sparkles className="h-3 w-3" />
              Pasify · Configuración inicial
            </div>
            <h2 className="text-xl font-bold leading-tight tracking-tight md:text-3xl">
              Configura tu{" "}
              <span style={serif} className="text-orange-500">
                organización
              </span>{" "}
              en {STEPS.length} pasos
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground md:text-sm">
              Necesitamos estos datos para activar tu cuenta de partner: empresa,
              al menos un local, branding y operación. Puedes editarlo todo más
              tarde desde Configuración.
            </p>
          </div>
          <div
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/5 px-3 py-1.5 text-[10px] font-semibold uppercase text-orange-400 md:inline-flex"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Clock className="h-3 w-3" />
            Paso {step + 1} / {STEPS.length}
          </div>
        </header>

        {/* Stepper: full labels en md+, sólo números en mobile */}
        <div className="shrink-0 px-5 pt-6 md:px-10">
          <ol className="flex items-center gap-1.5">
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
                      for (let k = step; k < i; k++) {
                        const err = validateStep(k);
                        if (err) {
                          toast({
                            title: "Completa el paso",
                            description: err,
                            variant: "destructive",
                          });
                          return;
                        }
                      }
                      setStep(i);
                    }}
                    className={cn(
                      "group inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border px-2 py-1.5 text-left transition md:justify-start md:px-2.5",
                      current
                        ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                        : done
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                        : "border-border bg-card/50 text-muted-foreground hover:border-orange-500/30"
                    )}
                    aria-current={current ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold md:h-5 md:w-5",
                        current
                          ? "bg-orange-500/30"
                          : done
                          ? "bg-emerald-500/30"
                          : "bg-muted"
                      )}
                      style={mono}
                    >
                      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "hidden truncate text-[10px] uppercase md:inline",
                        current ? "font-semibold" : "font-medium"
                      )}
                      style={mono}
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
        <main className="scrollbar-pasify min-h-0 flex-1 overflow-y-auto px-5 py-7 md:px-10 md:py-10">
          {step === 0 && <StepOrg data={data} setData={setData} disabled={submitting} />}
          {step === 1 && <StepVenues data={data} setData={setData} disabled={submitting} />}
          {step === 2 && (
            <StepBrand
              data={data}
              setData={setData}
              disabled={submitting}
              orgId={status?.primaryOrgId ?? null}
            />
          )}
          {step === 3 && (
            <StepOperation
              data={data}
              setData={setData}
              disabled={submitting}
              email={email}
            />
          )}
          {step === 4 && <StepReview summary={summary} />}
        </main>

        {/* Footer */}
        <footer className="shrink-0 flex items-center justify-between gap-2 border-t border-border bg-card/60 px-5 py-4 md:px-10 md:py-5">
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
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
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
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
              }}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {submitting ? "Guardando…" : "Finalizar configuración"}
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
    <header className="mx-auto mb-7 max-w-3xl text-center md:text-left">
      <div
        className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white"
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

const Required = () => <span className="ml-0.5 text-orange-500">*</span>;

const StepOrg = ({
  data,
  setData,
  disabled,
}: {
  data: WizardData;
  setData: SetData;
  disabled?: boolean;
}) => (
  <StepShell
    icon={<Building2 className="h-6 w-6" />}
    eyebrow="Paso 01 · Empresa"
    title={
      <>
        Empieza por tu{" "}
        <span style={serif} className="text-orange-500">
          organización
        </span>
        .
      </>
    }
    subtitle="Es la entidad legal que cobra (tu empresa o persona física). Dentro pueden colgar uno o varios locales."
  >
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label className="text-xs">
          Nombre comercial
          <Required />
        </Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="El nombre que verán tus clientes"
          value={data.orgName}
          onChange={(e) => setData((d) => ({ ...d, orgName: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">
          Razón social
          <Required />
        </Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="Nombre legal (registro mercantil / autónomo)"
          value={data.orgLegalName}
          onChange={(e) => setData((d) => ({ ...d, orgLegalName: e.target.value }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">Slug (URL pública)</Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="auto desde el nombre"
          value={data.orgSlug}
          onChange={(e) => setData((d) => ({ ...d, orgSlug: slugify(e.target.value) }))}
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="text-xs">
          País
          <Required />
        </Label>
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
        <SpanishCitySelect
          label="Ciudad principal"
          required
          value={data.orgCity}
          onValueChange={(v) => setData((d) => ({ ...d, orgCity: v }))}
          placeholder="Busca tu municipio…"
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Mail className="h-3 w-3 text-orange-500" />
          Email de facturación
          <Required />
        </Label>
        <Input
          type="email"
          className="mt-1.5 h-11 rounded-xl"
          placeholder="facturacion@tuempresa.com"
          value={data.orgBillingEmail}
          onChange={(e) =>
            setData((d) => ({ ...d, orgBillingEmail: e.target.value }))
          }
          disabled={disabled}
        />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Phone className="h-3 w-3 text-orange-500" />
          Teléfono de contacto
          <Required />
        </Label>
        <Input
          className="mt-1.5 h-11 rounded-xl"
          placeholder="+34 600 00 00 00"
          value={data.orgContactPhone}
          onChange={(e) =>
            setData((d) => ({ ...d, orgContactPhone: e.target.value }))
          }
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

const StepVenues = ({
  data,
  setData,
  disabled,
}: {
  data: WizardData;
  setData: SetData;
  disabled?: boolean;
}) => {
  const updateVenue = (idx: number, patch: Partial<VenueInput>) => {
    setData((d) => ({
      ...d,
      venues: d.venues.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  };
  const addVenue = () => {
    setData((d) => ({
      ...d,
      venues: [...d.venues, { ...emptyVenue(), city: d.orgCity || "" }],
    }));
  };
  const removeVenue = (idx: number) => {
    setData((d) => ({
      ...d,
      venues: d.venues.filter((_, i) => i !== idx),
    }));
  };

  return (
    <StepShell
      icon={<MapPin className="h-6 w-6" />}
      eyebrow={`Paso 02 · ${data.venues.length} ${data.venues.length === 1 ? "local" : "locales"}`}
      title={
        <>
          Tus{" "}
          <span style={serif} className="text-orange-500">
            locales
          </span>
          .
        </>
      }
      subtitle="Añade cada espacio físico que gestionas. Es la información que verán tus clientes y aparecerá en los tickets. Mínimo uno, puedes añadir más en cualquier momento."
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {data.venues.map((venue, idx) => (
          <article
            key={idx}
            className="rounded-2xl border border-border bg-card/40 p-5 transition-shadow hover:shadow-[0_22px_50px_-18px_rgba(232,84,42,0.22)] md:p-6"
          >
            <header className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-white"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  }}
                >
                  {idx === 0 ? <Star className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                </span>
                <div>
                  <div
                    className="text-[10px] uppercase text-orange-500"
                    style={{ ...mono, letterSpacing: "0.22em" }}
                  >
                    Local {String(idx + 1).padStart(2, "0")}
                    {idx === 0 && " · Principal"}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {venue.name || "Sin nombre"}
                  </div>
                </div>
              </div>
              {data.venues.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeVenue(idx)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  Quitar
                </button>
              )}
            </header>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-xs">
                  Nombre del local
                  <Required />
                </Label>
                <Input
                  className="mt-1.5 h-11 rounded-xl"
                  placeholder="Sala principal, club, terraza, etc."
                  value={venue.name}
                  onChange={(e) => updateVenue(idx, { name: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <Label className="text-xs">
                  Categoría
                  <Required />
                </Label>
                <Select
                  value={venue.category}
                  onValueChange={(v) => updateVenue(idx, { category: v })}
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
                  value={venue.capacity}
                  onChange={(e) => updateVenue(idx, { capacity: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <SpanishCitySelect
                  label="Ciudad"
                  required
                  value={venue.city}
                  onValueChange={(v) => updateVenue(idx, { city: v })}
                />
              </div>
              <div>
                <Label className="text-xs">
                  Dirección
                  <Required />
                </Label>
                <Input
                  className="mt-1.5 h-11 rounded-xl"
                  placeholder="Calle, número, CP"
                  value={venue.address}
                  onChange={(e) => updateVenue(idx, { address: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Descripción pública</Label>
                <Textarea
                  className="mt-1.5 min-h-[80px] rounded-xl"
                  placeholder="Estilo musical, edad mínima, dress code, parking…"
                  value={venue.description}
                  onChange={(e) => updateVenue(idx, { description: e.target.value })}
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
                  value={venue.phone}
                  onChange={(e) => updateVenue(idx, { phone: e.target.value })}
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
                  value={venue.email}
                  onChange={(e) => updateVenue(idx, { email: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
          </article>
        ))}

        <button
          type="button"
          onClick={addVenue}
          disabled={disabled || data.venues.length >= 10}
          className="inline-flex items-center justify-center gap-2 self-center rounded-full border border-dashed border-orange-500/40 bg-orange-500/5 px-5 py-2.5 text-sm font-semibold text-orange-400 transition hover:-translate-y-0.5 hover:border-orange-500/70 hover:bg-orange-500/10 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Añadir otro local
        </button>
      </div>
    </StepShell>
  );
};

const StepBrand = ({
  data,
  setData,
  disabled,
  orgId,
}: {
  data: WizardData;
  setData: SetData;
  disabled?: boolean;
  orgId: string | null;
}) => (
  <StepShell
    icon={<ImagePlus className="h-6 w-6" />}
    eyebrow="Paso 03 · Identidad visual"
    title={
      <>
        Tu identidad{" "}
        <span style={serif} className="text-orange-500">
          visual
        </span>
        .
      </>
    }
    subtitle="Logo y portada aparecen en tu página pública, tickets y emails. Recomendado, pero puedes saltarte este paso y subirlos después desde Configuración."
  >
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
      <div>
        <PartnerImageUploader
          orgId={orgId}
          kind="logo"
          value={data.brandLogoUrl}
          onUploaded={(url) => setData((d) => ({ ...d, brandLogoUrl: url }))}
          onCleared={() => setData((d) => ({ ...d, brandLogoUrl: "" }))}
          label="Logo"
          helperText="PNG/JPG, recomendado cuadrado"
        />
      </div>
      <div>
        <PartnerImageUploader
          orgId={orgId}
          kind="cover"
          value={data.brandCoverUrl}
          onUploaded={(url) => setData((d) => ({ ...d, brandCoverUrl: url }))}
          onCleared={() => setData((d) => ({ ...d, brandCoverUrl: "" }))}
          label="Portada (16:9)"
          helperText="Aparecerá como banner del local y en tickets"
        />
      </div>

      <div className="md:col-span-2 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="text-xs">Color primario</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="color"
              value={data.brandPrimaryColor}
              onChange={(e) =>
                setData((d) => ({ ...d, brandPrimaryColor: e.target.value }))
              }
              disabled={disabled}
              className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-card"
            />
            <Input
              className="h-11 flex-1 rounded-xl"
              value={data.brandPrimaryColor}
              onChange={(e) =>
                setData((d) => ({ ...d, brandPrimaryColor: e.target.value }))
              }
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
              onChange={(e) =>
                setData((d) => ({ ...d, brandAccentColor: e.target.value }))
              }
              disabled={disabled}
              className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-card"
            />
            <Input
              className="h-11 flex-1 rounded-xl"
              value={data.brandAccentColor}
              onChange={(e) =>
                setData((d) => ({ ...d, brandAccentColor: e.target.value }))
              }
              disabled={disabled}
              placeholder="#E8542A"
            />
          </div>
        </div>
      </div>

      {!orgId && (
        <div
          className="md:col-span-2 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-3 text-[12px] text-orange-300"
          style={mono}
        >
          Los uploaders se activan al guardar la organización (siguiente paso).
        </div>
      )}
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
    eyebrow="Paso 04 · Operación"
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
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Coins className="h-3 w-3 text-orange-500" />
          Moneda
          <Required />
        </Label>
        <Select
          value={data.opCurrency}
          onValueChange={(v) => setData((d) => ({ ...d, opCurrency: v }))}
          disabled={disabled}
        >
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
          Zona horaria
          <Required />
        </Label>
        <Select
          value={data.opTimezone}
          onValueChange={(v) => setData((d) => ({ ...d, opTimezone: v }))}
          disabled={disabled}
        >
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
        <Select
          value={data.opLanguage}
          onValueChange={(v) => setData((d) => ({ ...d, opLanguage: v }))}
          disabled={disabled}
        >
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
          onChange={(e) =>
            setData((d) => ({ ...d, opNotificationEmail: e.target.value }))
          }
          disabled={disabled}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Aquí llegan ventas, reembolsos y alertas del operativo.
        </p>
      </div>
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
    orgEmail: string;
    orgPhone: string;
    venues: Array<{ name: string; category: string; city: string; address: string }>;
    currency: string;
    timezone: string;
    language: string;
    hasLogo: boolean;
    hasCover: boolean;
  };
}) => (
  <StepShell
    icon={<CheckCircle2 className="h-6 w-6" />}
    eyebrow={`Paso 05 · Resumen`}
    title={
      <>
        Revisa antes de{" "}
        <span style={serif} className="text-orange-500">
          finalizar
        </span>
        .
      </>
    }
    subtitle="Comprueba que todo esté correcto. Después de finalizar, podrás editar cualquier dato desde Configuración del partner."
  >
    <div className="mx-auto max-w-3xl space-y-5">
      <ReviewBlock title="Organización">
        <ReviewRow label="Nombre comercial" value={summary.org || "—"} />
        <ReviewRow label="Razón social" value={summary.legal || "—"} />
        <ReviewRow label="País" value={summary.country} />
        <ReviewRow label="Ciudad" value={summary.orgCity || "—"} />
        <ReviewRow label="Email facturación" value={summary.orgEmail || "—"} />
        <ReviewRow label="Teléfono" value={summary.orgPhone || "—"} />
      </ReviewBlock>

      <ReviewBlock title={`Locales (${summary.venues.length})`}>
        <div className="space-y-3">
          {summary.venues.map((v, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-background/50 p-3">
              <div
                className="mb-1 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                Local {String(i + 1).padStart(2, "0")}
              </div>
              <div className="text-sm font-semibold text-foreground">{v.name || "—"}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {v.category} · {v.city || "—"} · {v.address || "—"}
              </div>
            </div>
          ))}
        </div>
      </ReviewBlock>

      <ReviewBlock title="Branding">
        <ReviewRow label="Logo subido" value={summary.hasLogo ? "Sí" : "No (pendiente)"} />
        <ReviewRow label="Portada subida" value={summary.hasCover ? "Sí" : "No (pendiente)"} />
      </ReviewBlock>

      <ReviewBlock title="Operación">
        <ReviewRow label="Moneda" value={summary.currency} />
        <ReviewRow label="Zona horaria" value={summary.timezone} />
        <ReviewRow label="Idioma" value={summary.language} />
      </ReviewBlock>
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
      className="w-40 shrink-0 text-[10px] uppercase text-muted-foreground"
      style={mono}
    >
      {label}
    </div>
    <div className="flex-1 text-sm font-medium text-foreground">{value}</div>
  </div>
);

export default PartnerOnboardingWizard;
