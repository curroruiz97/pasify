import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Coins,
  Crown,
  Gift,
  Globe2,
  ImagePlus,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type {
  PartnerOrg,
  PartnerBrand,
  PartnerVenue,
  OnboardingStatus,
} from "@/hooks/usePartnerContext";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import { SpanishCitySelect } from "@/components/ui/spanish-city-select";
import { PartnerImageUploader } from "@/components/partner/PartnerImageUploader";
import { cn } from "@/lib/utils";

/**
 * PartnerSettingsBlock — sección de Configuración del partner.
 *
 * Tras la migración 0039 que abrió RLS al owner, este bloque puede leer
 * y escribir directamente en `organizations`, `brands` y `venues`.
 *
 * Estructura (todo en una sola vista scrollable, con un único "Guardar"
 * global):
 *   1. Header con plan badge + estado onboarding + aviso si placeholder
 *   2. Organización — datos legales y de contacto (SpanishCitySelect)
 *   3. Branding — logo + portada (PartnerImageUploader real) + colores
 *   4. Locales — multi-venue, editar inline, añadir, quitar
 *   5. Operación — moneda / idioma / zona horaria del primary venue
 *
 * Las acciones "Añadir local" y "Quitar local" se hacen vía RPC/UPDATE
 * inmediato (sin esperar al Save global) porque son cambios estructurales
 * que el usuario espera ver reflejados al instante.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

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

const CURRENCIES = ["EUR", "USD", "GBP"];
const LANGUAGES = ["es", "en", "fr", "it"];
const TIMEZONES = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Paris",
  "Atlantic/Canary",
  "America/New_York",
];

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/̀-ͯ/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RX = /^[+()\-\s\d]{7,24}$/;

interface VenueForm {
  /** id real si el venue ya existe en BD. Null = se acaba de añadir. */
  id: string | null;
  name: string;
  category: string;
  city: string;
  address: string;
  capacity: string;
  description: string;
  phone: string;
  email: string;
  timezone: string;
}

const venueToForm = (v: PartnerVenue): VenueForm => ({
  id: v.id,
  name: v.name === "Principal" ? "" : v.name ?? "",
  category: v.business_category ?? "discoteca",
  city: v.city ?? "",
  address: v.address ?? "",
  capacity: v.capacity != null ? String(v.capacity) : "",
  description: v.description ?? "",
  phone: v.phone ?? "",
  email: v.email ?? "",
  timezone: v.timezone ?? "Europe/Madrid",
});

const emptyVenueForm = (city: string): VenueForm => ({
  id: null,
  name: "",
  category: "discoteca",
  city,
  address: "",
  capacity: "",
  description: "",
  phone: "",
  email: "",
  timezone: "Europe/Madrid",
});

interface OrgForm {
  name: string;
  legalName: string;
  billingEmail: string;
  contactEmail: string;
  contactPhone: string;
  vatId: string;
  city: string;
  address: string;
}

interface BrandForm {
  logoUrl: string;
  coverUrl: string;
  primaryColor: string;
  accentColor: string;
  websiteUrl: string;
  instagramHandle: string;
}

interface OpsForm {
  currency: string;
  language: string;
}

interface Props {
  userId: string;
  org: PartnerOrg | null;
  brand?: PartnerBrand | null;
  venue: PartnerVenue | null;
  venues?: PartnerVenue[];
  status: OnboardingStatus | null;
  onRefresh: () => void | Promise<void>;
  onReopenOnboarding?: () => void;
}

export const PartnerSettingsBlock = ({
  userId,
  org,
  brand: brandProp,
  venue,
  venues: ctxVenues,
  status,
  onRefresh,
  onReopenOnboarding,
}: Props) => {
  const { toast } = useToast();

  // -------- State --------
  const initialOrg = useMemo<OrgForm>(
    () => ({
      name: org?.name ?? "",
      legalName: org?.legal_name ?? "",
      billingEmail: org?.billing_email ?? "",
      contactEmail: org?.contact_email ?? "",
      contactPhone: org?.contact_phone ?? "",
      vatId: org?.vat_id ?? "",
      city: org?.city ?? "",
      address: org?.address ?? "",
    }),
    [org]
  );

  const initialBrand = useMemo<BrandForm>(
    () => ({
      logoUrl: brandProp?.logo_url ?? "",
      coverUrl: brandProp?.cover_image_url ?? venue?.cover_image_url ?? "",
      primaryColor: brandProp?.primary_color ?? "#FF7A4D",
      accentColor: brandProp?.accent_color ?? "#E8542A",
      websiteUrl:
        brandProp?.website_url ?? (org?.metadata?.["website_url"] as string) ?? "",
      instagramHandle: brandProp?.instagram_handle ?? "",
    }),
    [brandProp, venue, org]
  );

  const initialOps = useMemo<OpsForm>(
    () => ({
      currency: (org?.metadata?.["currency"] as string) ?? "EUR",
      language: (org?.metadata?.["language"] as string) ?? "es",
    }),
    [org]
  );

  const initialVenues = useMemo<VenueForm[]>(() => {
    const source = ctxVenues && ctxVenues.length > 0 ? ctxVenues : venue ? [venue] : [];
    return source.map(venueToForm);
  }, [ctxVenues, venue]);

  const [orgForm, setOrgForm] = useState<OrgForm>(initialOrg);
  const [brandForm, setBrandForm] = useState<BrandForm>(initialBrand);
  const [opsForm, setOpsForm] = useState<OpsForm>(initialOps);
  const [venueForms, setVenueForms] = useState<VenueForm[]>(initialVenues);
  const [saving, setSaving] = useState(false);
  const [addingVenue, setAddingVenue] = useState(false);
  const [deleteVenueIdx, setDeleteVenueIdx] = useState<number | null>(null);
  const [deletingVenue, setDeletingVenue] = useState(false);

  // Sync cuando llega contexto fresco (sin pisar lo que el usuario editó)
  useEffect(() => setOrgForm(initialOrg), [initialOrg]);
  useEffect(() => setBrandForm(initialBrand), [initialBrand]);
  useEffect(() => setOpsForm(initialOps), [initialOps]);
  useEffect(() => setVenueForms(initialVenues), [initialVenues]);

  const dirty = useMemo(() => {
    return (
      JSON.stringify(orgForm) !== JSON.stringify(initialOrg) ||
      JSON.stringify(brandForm) !== JSON.stringify(initialBrand) ||
      JSON.stringify(opsForm) !== JSON.stringify(initialOps) ||
      JSON.stringify(venueForms) !== JSON.stringify(initialVenues)
    );
  }, [orgForm, brandForm, opsForm, venueForms, initialOrg, initialBrand, initialOps, initialVenues]);

  const completed = status?.status === "completed";
  const hasOrgVenue = !!org && !!venue;

  const sub = usePartnerSubscription({ orgId: org?.id ?? undefined });
  const planLabel = (() => {
    if (!sub.hasRecord) return null;
    if (sub.planCode === "premium")
      return { label: "Premium", color: "#FF7A4D", Icon: Crown };
    if (sub.planCode === "free")
      return { label: "Gratuito", color: "#4DB87A", Icon: Gift };
    if (sub.isTrial)
      return { label: "Trial", color: "#E8B04C", Icon: Sparkles };
    return {
      label: sub.planCode ?? sub.status ?? "—",
      color: "#8A8275",
      Icon: Gift,
    };
  })();

  const isPlaceholder = (() => {
    if (!hasOrgVenue) return false;
    return (
      !venue?.address &&
      !venue?.business_category &&
      (!venue?.name || venue.name === "Principal")
    );
  })();

  // -------- Mutaciones inmediatas (venues add/remove) --------
  const addVenueRow = async () => {
    if (!org) return;
    const row = emptyVenueForm(orgForm.city || orgForm.address || "");
    // Estado optimista — el usuario rellenará en sitio
    setVenueForms((vs) => [...vs, row]);
    setAddingVenue(false);
    toast({
      title: "Nuevo local añadido",
      description: "Rellena los datos y pulsa Guardar para persistirlo.",
    });
  };

  const confirmDeleteVenue = async () => {
    if (deleteVenueIdx === null) return;
    const v = venueForms[deleteVenueIdx];
    setDeletingVenue(true);
    try {
      if (v.id) {
        // Soft-delete: status='archived'. Mantenemos historial de eventos.
        const { error } = await supabase
          .from("venues")
          .update({ status: "archived" })
          .eq("id", v.id);
        if (error) throw new Error(error.message);
      }
      setVenueForms((vs) => vs.filter((_, i) => i !== deleteVenueIdx));
      setDeleteVenueIdx(null);
      toast({
        title: "Local archivado",
        description: "Ya no aparecerá en tu listado público.",
      });
      await onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error eliminando";
      toast({
        title: "No se pudo archivar",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setDeletingVenue(false);
    }
  };

  // -------- Save global --------
  const handleSave = async () => {
    if (!org) {
      toast({
        title: "Sin organización",
        description: "Completa el onboarding antes de editar la configuración.",
        variant: "destructive",
      });
      return;
    }

    // Validación
    if (!orgForm.name.trim()) {
      toast({ title: "Falta nombre comercial", variant: "destructive" });
      return;
    }
    if (orgForm.billingEmail && !EMAIL_RX.test(orgForm.billingEmail)) {
      toast({ title: "Email de facturación no válido", variant: "destructive" });
      return;
    }
    if (orgForm.contactEmail && !EMAIL_RX.test(orgForm.contactEmail)) {
      toast({ title: "Email de contacto no válido", variant: "destructive" });
      return;
    }
    if (orgForm.contactPhone && !PHONE_RX.test(orgForm.contactPhone)) {
      toast({ title: "Teléfono no válido", variant: "destructive" });
      return;
    }
    for (let i = 0; i < venueForms.length; i++) {
      const v = venueForms[i];
      const ord = i + 1;
      if (!v.name.trim()) {
        toast({
          title: `Local ${ord}: falta nombre`,
          variant: "destructive",
        });
        return;
      }
      if (!v.city.trim()) {
        toast({ title: `Local ${ord}: falta ciudad`, variant: "destructive" });
        return;
      }
      if (!v.address.trim()) {
        toast({ title: `Local ${ord}: falta dirección`, variant: "destructive" });
        return;
      }
      if (v.email && !EMAIL_RX.test(v.email)) {
        toast({
          title: `Local ${ord}: email no válido`,
          variant: "destructive",
        });
        return;
      }
      if (v.phone && !PHONE_RX.test(v.phone)) {
        toast({
          title: `Local ${ord}: teléfono no válido`,
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const orgMetadata: Record<string, unknown> = {
        ...(org.metadata ?? {}),
        currency: opsForm.currency,
        language: opsForm.language,
        website_url: brandForm.websiteUrl.trim() || null,
      };
      const { error: orgErr } = await supabase
        .from("organizations")
        .update({
          name: orgForm.name.trim(),
          legal_name: orgForm.legalName.trim() || null,
          billing_email: orgForm.billingEmail.trim() || null,
          contact_email: orgForm.contactEmail.trim() || null,
          contact_phone: orgForm.contactPhone.trim() || null,
          vat_id: orgForm.vatId.trim() || null,
          city: orgForm.city.trim() || null,
          address: orgForm.address.trim() || null,
          metadata: orgMetadata,
        })
        .eq("id", org.id);
      if (orgErr) throw new Error(orgErr.message);

      // Brand
      const { data: brandRow } = await supabase
        .from("brands")
        .select("id")
        .eq("org_id", org.id)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      const brandId = brandRow?.id ?? null;
      if (brandId) {
        const { error: brandErr } = await supabase
          .from("brands")
          .update({
            name: orgForm.name.trim(),
            logo_url: brandForm.logoUrl.trim() || null,
            cover_image_url: brandForm.coverUrl.trim() || null,
            primary_color: brandForm.primaryColor || null,
            accent_color: brandForm.accentColor || null,
            website_url: brandForm.websiteUrl.trim() || null,
            instagram_handle: brandForm.instagramHandle.trim() || null,
          })
          .eq("id", brandId);
        if (brandErr) throw new Error(brandErr.message);
      }

      // Venues: UPDATE existentes, INSERT nuevos
      for (let i = 0; i < venueForms.length; i++) {
        const v = venueForms[i];
        const cap = v.capacity ? parseInt(v.capacity, 10) : null;
        const payload = {
          name: v.name.trim(),
          business_category: v.category || null,
          address: v.address.trim() || null,
          city: v.city.trim() || orgForm.city.trim() || "Madrid",
          country: org.country,
          timezone: v.timezone || "Europe/Madrid",
          capacity: cap && cap > 0 ? cap : null,
          description: v.description.trim() || null,
          phone: v.phone.trim() || null,
          email: v.email.trim() || null,
          cover_image_url: i === 0 ? (brandForm.coverUrl.trim() || null) : null,
        };
        if (v.id) {
          const { error } = await supabase
            .from("venues")
            .update(payload)
            .eq("id", v.id);
          if (error) throw new Error(`Local ${i + 1}: ${error.message}`);
        } else {
          const slug = slugify(v.name) || `venue-${Date.now()}-${i}`;
          const { data: ins, error } = await supabase
            .from("venues")
            .insert({
              org_id: org.id,
              brand_id: brandId,
              slug,
              status: "active",
              ...payload,
            })
            .select("id")
            .single();
          if (error) throw new Error(`Local ${i + 1}: ${error.message}`);
          if (ins) {
            setVenueForms((vs) =>
              vs.map((row, j) => (j === i ? { ...row, id: ins.id } : row))
            );
          }
        }
      }

      // Sync legacy profile.business_*
      const primary = venueForms[0];
      if (primary) {
        await supabase
          .from("profiles")
          .update({
            business_name: primary.name.trim() || orgForm.name.trim(),
            business_category: primary.category || null,
            business_city: primary.city.trim() || orgForm.city.trim() || null,
            city: primary.city.trim() || orgForm.city.trim() || null,
          })
          .eq("id", userId);
      }

      toast({
        title: "Cambios guardados",
        description: "Tu organización, locales y branding están actualizados.",
      });
      await onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error guardando";
      toast({ title: "Error al guardar", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateVenue = (idx: number, patch: Partial<VenueForm>) => {
    setVenueForms((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };
  const setOrg = <K extends keyof OrgForm>(k: K, v: OrgForm[K]) =>
    setOrgForm((f) => ({ ...f, [k]: v }));
  const setBrand = <K extends keyof BrandForm>(k: K, v: BrandForm[K]) =>
    setBrandForm((f) => ({ ...f, [k]: v }));
  const setOps = <K extends keyof OpsForm>(k: K, v: OpsForm[K]) =>
    setOpsForm((f) => ({ ...f, [k]: v }));

  // Si todavía no hay org/venue → CTA para abrir onboarding.
  if (!hasOrgVenue) {
    return (
      <section
        className="rounded-2xl border p-5"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)",
          borderColor: "rgba(232,84,42,0.32)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)",
            }}
          >
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Configuración inicial pendiente
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Aún no has terminado de configurar tu organización y local.
              Completa el onboarding para empezar a vender y poder editar tu
              configuración aquí.
            </p>
            {onReopenOnboarding && (
              <Button
                className="mt-3 h-9"
                onClick={onReopenOnboarding}
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  color: "#fff",
                }}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Completar onboarding
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/60 p-4">
        <div className="min-w-0">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Building2 className="h-3 w-3" />
            Configuración de organización
          </div>
          <h3 className="mt-0.5 truncate text-base font-semibold tracking-tight text-foreground">
            {org?.name || "Tu organización"}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Datos legales, branding, locales y operación. Todo persiste en tu
            organización.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {planLabel && (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.16em",
                background: `${planLabel.color}1A`,
                borderColor: `${planLabel.color}52`,
                color: planLabel.color,
              }}
              title={`Plan actual: ${planLabel.label}`}
            >
              <planLabel.Icon className="h-3 w-3" />
              Plan {planLabel.label}
            </span>
          )}
          {completed && (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.16em",
                background: "rgba(77,184,122,0.10)",
                borderColor: "rgba(77,184,122,0.32)",
                color: "#4DB87A",
              }}
            >
              <CheckCircle2 className="h-3 w-3" />
              Onboarding completado
            </span>
          )}
        </div>
      </header>

      {isPlaceholder && (
        <div
          className="mx-4 mt-4 flex items-start gap-2 rounded-xl border p-3 text-[12px] leading-relaxed"
          style={{
            background: "rgba(232,176,76,0.08)",
            borderColor: "rgba(232,176,76,0.40)",
            color: "#E8B04C",
          }}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong className="font-semibold">Completa tu configuración:</strong>{" "}
            tu local todavía es un placeholder. Rellena nombre, dirección,
            categoría y aforo abajo y pulsa <em>Guardar cambios</em>. Aparecerás
            así en el ticket, la factura y tu página pública.
          </span>
        </div>
      )}

      <div className="space-y-8 p-4 md:p-6">
        {/* === Organización === */}
        <Block title="Organización" icon={<Building2 className="h-3 w-3" />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre comercial">
              <Input
                value={orgForm.name}
                onChange={(e) => setOrg("name", e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field label="Razón social">
              <Input
                value={orgForm.legalName}
                onChange={(e) => setOrg("legalName", e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field label="CIF / VAT">
              <Input
                value={orgForm.vatId}
                onChange={(e) => setOrg("vatId", e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3 w-3 text-orange-500" />
                  Email facturación
                </span>
              }
            >
              <Input
                type="email"
                value={orgForm.billingEmail}
                onChange={(e) => setOrg("billingEmail", e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3 w-3 text-orange-500" />
                  Email contacto
                </span>
              }
            >
              <Input
                type="email"
                value={orgForm.contactEmail}
                onChange={(e) => setOrg("contactEmail", e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-orange-500" />
                  Teléfono
                </span>
              }
            >
              <Input
                value={orgForm.contactPhone}
                onChange={(e) => setOrg("contactPhone", e.target.value)}
                disabled={saving}
              />
            </Field>
            <div>
              <SpanishCitySelect
                label="Ciudad sede"
                value={orgForm.city}
                onValueChange={(v) => setOrg("city", v)}
                disabled={saving}
              />
            </div>
            <Field label="Dirección sede">
              <Input
                value={orgForm.address}
                onChange={(e) => setOrg("address", e.target.value)}
                disabled={saving}
              />
            </Field>
          </div>
        </Block>

        {/* === Branding === */}
        <Block title="Branding" icon={<ImagePlus className="h-3 w-3" />}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
            <PartnerImageUploader
              orgId={org?.id ?? null}
              kind="logo"
              value={brandForm.logoUrl}
              onUploaded={(url) => setBrand("logoUrl", url)}
              onCleared={() => setBrand("logoUrl", "")}
              label="Logo"
              helperText="PNG/JPG, recomendado cuadrado"
            />
            <PartnerImageUploader
              orgId={org?.id ?? null}
              kind="cover"
              value={brandForm.coverUrl}
              onUploaded={(url) => setBrand("coverUrl", url)}
              onCleared={() => setBrand("coverUrl", "")}
              label="Portada (16:9)"
              helperText="Aparecerá como banner del local y en tickets"
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Color primario">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandForm.primaryColor}
                  onChange={(e) => setBrand("primaryColor", e.target.value)}
                  disabled={saving}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-card"
                />
                <Input
                  value={brandForm.primaryColor}
                  onChange={(e) => setBrand("primaryColor", e.target.value)}
                  disabled={saving}
                />
              </div>
            </Field>
            <Field label="Color acento">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandForm.accentColor}
                  onChange={(e) => setBrand("accentColor", e.target.value)}
                  disabled={saving}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-card"
                />
                <Input
                  value={brandForm.accentColor}
                  onChange={(e) => setBrand("accentColor", e.target.value)}
                  disabled={saving}
                />
              </div>
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Globe2 className="h-3 w-3 text-orange-500" />
                  Web (opcional)
                </span>
              }
            >
              <Input
                value={brandForm.websiteUrl}
                onChange={(e) => setBrand("websiteUrl", e.target.value)}
                disabled={saving}
                placeholder="https://"
              />
            </Field>
            <Field label="Instagram (opcional)">
              <Input
                value={brandForm.instagramHandle}
                onChange={(e) =>
                  setBrand("instagramHandle", e.target.value.replace(/^@/, ""))
                }
                disabled={saving}
                placeholder="@tu_local"
              />
            </Field>
          </div>
        </Block>

        {/* === Locales (multi-venue) === */}
        <Block
          title={`Locales (${venueForms.length})`}
          icon={<MapPin className="h-3 w-3" />}
        >
          <div className="space-y-4">
            {venueForms.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aún no tienes locales. Añade el primero para empezar a vender.
              </p>
            )}
            {venueForms.map((v, idx) => (
              <article
                key={v.id ?? `new-${idx}`}
                className="rounded-2xl border border-border bg-background/40 p-4 transition-shadow hover:shadow-[0_22px_50px_-18px_rgba(232,84,42,0.18)]"
              >
                <header className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-lg text-white",
                        idx === 0 ? "" : ""
                      )}
                      style={{
                        background:
                          "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                      }}
                    >
                      {idx === 0 ? (
                        <Star className="h-3.5 w-3.5" />
                      ) : (
                        <MapPin className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div
                        className="text-[10px] uppercase text-orange-500"
                        style={{ ...mono, letterSpacing: "0.22em" }}
                      >
                        Local {String(idx + 1).padStart(2, "0")}
                        {idx === 0 && " · Principal"}
                        {!v.id && " · Nuevo"}
                      </div>
                      <div className="truncate text-sm font-semibold text-foreground">
                        {v.name || "Sin nombre"}
                      </div>
                    </div>
                  </div>
                  {venueForms.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDeleteVenueIdx(idx)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      Archivar
                    </button>
                  )}
                </header>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Nombre del local">
                    <Input
                      value={v.name}
                      onChange={(e) => updateVenue(idx, { name: e.target.value })}
                      disabled={saving}
                    />
                  </Field>
                  <Field label="Categoría">
                    <Select
                      value={v.category}
                      onValueChange={(val) => updateVenue(idx, { category: val })}
                      disabled={saving}
                    >
                      <SelectTrigger>
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
                  </Field>
                  <div>
                    <SpanishCitySelect
                      label="Ciudad"
                      value={v.city}
                      onValueChange={(val) => updateVenue(idx, { city: val })}
                      disabled={saving}
                    />
                  </div>
                  <Field label="Dirección">
                    <Input
                      value={v.address}
                      onChange={(e) =>
                        updateVenue(idx, { address: e.target.value })
                      }
                      disabled={saving}
                    />
                  </Field>
                  <Field
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3 w-3 text-orange-500" />
                        Aforo
                      </span>
                    }
                  >
                    <Input
                      type="number"
                      min="1"
                      value={v.capacity}
                      onChange={(e) =>
                        updateVenue(idx, { capacity: e.target.value })
                      }
                      disabled={saving}
                    />
                  </Field>
                  <Field label="Zona horaria">
                    <Select
                      value={v.timezone}
                      onValueChange={(val) => updateVenue(idx, { timezone: val })}
                      disabled={saving}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="h-3 w-3 text-orange-500" />
                        Teléfono local
                      </span>
                    }
                  >
                    <Input
                      value={v.phone}
                      onChange={(e) => updateVenue(idx, { phone: e.target.value })}
                      disabled={saving}
                    />
                  </Field>
                  <Field
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3 w-3 text-orange-500" />
                        Email local
                      </span>
                    }
                  >
                    <Input
                      type="email"
                      value={v.email}
                      onChange={(e) => updateVenue(idx, { email: e.target.value })}
                      disabled={saving}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Descripción pública</Label>
                    <Textarea
                      className="mt-1.5 min-h-[80px]"
                      value={v.description}
                      onChange={(e) =>
                        updateVenue(idx, { description: e.target.value })
                      }
                      disabled={saving}
                    />
                  </div>
                </div>
              </article>
            ))}

            <button
              type="button"
              onClick={() => void addVenueRow()}
              disabled={saving || addingVenue || venueForms.length >= 10}
              className="inline-flex items-center justify-center gap-2 self-center rounded-full border border-dashed border-orange-500/40 bg-orange-500/5 px-5 py-2.5 text-sm font-semibold text-orange-400 transition hover:-translate-y-0.5 hover:border-orange-500/70 hover:bg-orange-500/10 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              Añadir otro local
            </button>
          </div>
        </Block>

        {/* === Operación === */}
        <Block title="Operación" icon={<Coins className="h-3 w-3" />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Coins className="h-3 w-3 text-orange-500" />
                  Moneda
                </span>
              }
            >
              <Select
                value={opsForm.currency}
                onValueChange={(v) => setOps("currency", v)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Globe2 className="h-3 w-3 text-orange-500" />
                  Idioma del panel
                </span>
              }
            >
              <Select
                value={opsForm.language}
                onValueChange={(v) => setOps("language", v)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Block>

        {/* Footer Save */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div
            className="text-[11px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            {dirty ? "Cambios sin guardar" : "Sin cambios pendientes"}
          </div>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="h-10"
            style={
              dirty && !saving
                ? {
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
                    color: "#fff",
                  }
                : undefined
            }
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>

      {/* Confirm delete venue */}
      <AlertDialog
        open={deleteVenueIdx !== null}
        onOpenChange={(open) => !open && !deletingVenue && setDeleteVenueIdx(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar este local?</AlertDialogTitle>
            <AlertDialogDescription>
              El local pasará a estado <em>archived</em> y dejará de aparecer en
              tu listado público. Los eventos y tickets ya creados se conservan.
              Puedes contactar con soporte si necesitas restaurarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingVenue}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void confirmDeleteVenue();
              }}
              disabled={deletingVenue}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingVenue && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archivar local
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

const Block = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div>
    <div
      className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.22em" }}
    >
      <span className="inline-block h-px w-5 bg-orange-500/70" />
      {icon}
      {title}
    </div>
    {children}
  </div>
);

const Field = ({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div>
    <Label className="text-xs">{label}</Label>
    <div className="mt-1.5">{children}</div>
  </div>
);
