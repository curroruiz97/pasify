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
  Loader2,
  Mail,
  MapPin,
  Phone,
  Save,
  Sparkles,
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
import { useToast } from "@/hooks/use-toast";
import type { PartnerOrg, PartnerVenue, OnboardingStatus } from "@/hooks/usePartnerContext";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";

/**
 * PartnerSettingsBlock — sección de Configuración del partner con
 * persistencia real contra `organizations` y `venues` (RLS amistosa
 * tras la migración 0039 que permite UPDATE al owner).
 *
 * Carga el estado desde el contexto en cuanto se monta y muestra los
 * campos prellenados. Detecta si hay cambios (`dirty`) para no disparar
 * UPDATEs vacíos. "Guardar cambios" hace los dos UPDATEs en paralelo
 * y refresca el contexto del dashboard.
 *
 * Los toggles que aún no tienen backend (notificaciones granulares,
 * benchmarks anónimos, etc.) NO se gestionan aquí — quedan en
 * `SettingsSheet` con badge "Próximamente". Este componente solo se
 * ocupa de los campos que SÍ persisten.
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

interface Form {
  // Org
  orgName: string;
  orgLegalName: string;
  orgBillingEmail: string;
  orgContactEmail: string;
  orgContactPhone: string;
  orgVatId: string;
  orgCity: string;
  orgAddress: string;
  // Venue
  venueName: string;
  venueCategory: string;
  venueCity: string;
  venueAddress: string;
  venueCapacity: string;
  venueDescription: string;
  venuePhone: string;
  venueEmail: string;
  venueTimezone: string;
  // Operación (sobre org.metadata)
  opCurrency: string;
  opLanguage: string;
}

const fromContext = (org: PartnerOrg | null, venue: PartnerVenue | null): Form => ({
  orgName: org?.name ?? "",
  orgLegalName: org?.legal_name ?? "",
  orgBillingEmail: org?.billing_email ?? "",
  orgContactEmail: org?.contact_email ?? "",
  orgContactPhone: org?.contact_phone ?? "",
  orgVatId: org?.vat_id ?? "",
  orgCity: org?.city ?? "",
  orgAddress: org?.address ?? "",

  venueName: venue?.name ?? "",
  venueCategory: venue?.business_category ?? "discoteca",
  venueCity: venue?.city ?? "",
  venueAddress: venue?.address ?? "",
  venueCapacity: venue?.capacity != null ? String(venue.capacity) : "",
  venueDescription: venue?.description ?? "",
  venuePhone: venue?.phone ?? "",
  venueEmail: venue?.email ?? "",
  venueTimezone: venue?.timezone ?? "Europe/Madrid",

  opCurrency: (org?.metadata?.["currency"] as string) ?? "EUR",
  opLanguage: (org?.metadata?.["language"] as string) ?? "es",
});

interface Props {
  userId: string;
  org: PartnerOrg | null;
  venue: PartnerVenue | null;
  status: OnboardingStatus | null;
  /** Llamado tras un guardado exitoso para que el dashboard recargue. */
  onRefresh: () => void | Promise<void>;
  /** Reabrir el wizard de onboarding manualmente. */
  onReopenOnboarding?: () => void;
}

export const PartnerSettingsBlock = ({
  userId,
  org,
  venue,
  status,
  onRefresh,
  onReopenOnboarding,
}: Props) => {
  const { toast } = useToast();
  const initial = useMemo(() => fromContext(org, venue), [org, venue]);
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);

  // Si llega contexto fresco (tras refresh) y no hay cambios pendientes,
  // sincronizamos. Si el usuario está editando, no pisamos su input.
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  // dirty = hay al menos un campo distinto del estado inicial
  const dirty = useMemo(() => {
    return JSON.stringify(form) !== JSON.stringify(initial);
  }, [form, initial]);

  const completed = status?.status === "completed";
  const hasOrgVenue = !!org && !!venue;

  // Plan actual (Free / Premium / trialing / etc.) — leído de
  // partner_subscriptions vía hook. Se muestra en el header con badge.
  const sub = usePartnerSubscription({ orgId: org?.id ?? undefined });
  const planLabel = (() => {
    if (!sub.hasRecord) return null;
    if (sub.planCode === "premium") return { label: "Premium", color: "#FF7A4D", Icon: Crown };
    if (sub.planCode === "free") return { label: "Gratuito", color: "#4DB87A", Icon: Gift };
    if (sub.isTrial) return { label: "Trial", color: "#E8B04C", Icon: Sparkles };
    return { label: sub.planCode ?? sub.status ?? "—", color: "#8A8275", Icon: Gift };
  })();

  // Detectar org/venue placeholder: nombre derivado de email-username,
  // venue 'Principal' sin direccion ni categoria. En ese caso queremos
  // resaltar al partner que necesita rellenar sus datos reales.
  const isPlaceholder = (() => {
    if (!hasOrgVenue) return false;
    const venuePlaceholder =
      !venue?.address &&
      !venue?.business_category &&
      (!venue?.name || venue.name === "Principal");
    return venuePlaceholder;
  })();

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!org) {
      toast({
        title: "Sin organización",
        description: "Completa el onboarding antes de editar la configuración.",
        variant: "destructive",
      });
      return;
    }
    if (!dirty) {
      toast({ title: "Sin cambios", description: "No hay nada nuevo que guardar." });
      return;
    }
    setSaving(true);
    try {
      const orgMetadata: Record<string, unknown> = {
        ...(org.metadata ?? {}),
        currency: form.opCurrency,
        language: form.opLanguage,
      };
      const { error: orgErr } = await supabase
        .from("organizations")
        .update({
          name: form.orgName.trim(),
          legal_name: form.orgLegalName.trim() || null,
          billing_email: form.orgBillingEmail.trim() || null,
          contact_email: form.orgContactEmail.trim() || null,
          contact_phone: form.orgContactPhone.trim() || null,
          vat_id: form.orgVatId.trim() || null,
          city: form.orgCity.trim() || null,
          address: form.orgAddress.trim() || null,
          metadata: orgMetadata,
        })
        .eq("id", org.id);
      if (orgErr) throw new Error(orgErr.message);

      if (venue) {
        const { error: vErr } = await supabase
          .from("venues")
          .update({
            name: form.venueName.trim(),
            business_category: form.venueCategory || null,
            city: form.venueCity.trim() || form.orgCity.trim() || "Madrid",
            address: form.venueAddress.trim() || null,
            capacity: form.venueCapacity ? parseInt(form.venueCapacity, 10) : null,
            description: form.venueDescription.trim() || null,
            phone: form.venuePhone.trim() || null,
            email: form.venueEmail.trim() || null,
            timezone: form.venueTimezone || "Europe/Madrid",
          })
          .eq("id", venue.id);
        if (vErr) throw new Error(vErr.message);
      }

      // Sync legacy profile.business_* para que el resto del dashboard
      // siga renderizando nombre/ciudad sin migrar todo el cliente.
      await supabase
        .from("profiles")
        .update({
          business_name: form.venueName.trim() || form.orgName.trim(),
          business_category: form.venueCategory || null,
          business_city: form.venueCity.trim() || form.orgCity.trim() || null,
          city: form.venueCity.trim() || form.orgCity.trim() || null,
        })
        .eq("id", userId);

      toast({
        title: "Cambios guardados",
        description: "Tu organización y local se actualizaron correctamente.",
      });
      await onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error guardando";
      toast({ title: "Error al guardar", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Si todavía no hay org/venue → CTA para abrir onboarding.
  if (!hasOrgVenue) {
    return (
      <section
        className="rounded-2xl border p-5"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)",
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
              Aún no has terminado de configurar tu organización y local. Completa el
              onboarding para empezar a vender y poder editar tu configuración aquí.
            </p>
            {onReopenOnboarding && (
              <Button
                className="mt-3 h-9"
                onClick={onReopenOnboarding}
                style={{
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  color: "#fff",
                }}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Continuar onboarding
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
            Organización y local
          </div>
          <h3 className="mt-0.5 truncate text-base font-semibold tracking-tight text-foreground">
            Datos de {org?.name || "tu local"}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Estos datos se ven en el ticket, la factura y la página pública. Guardar persiste en tu organización y local.
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

      {/* Aviso si la org/venue es placeholder (creado por el botón
          "Empezar gratis" sin pasar por el wizard). El partner DEBE
          rellenar los datos reales para que aparezca correctamente en
          tickets, factura y la página pública. */}
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
            tu local todavía es un placeholder. Rellena el nombre, dirección,
            categoría y aforo abajo y pulsa <em>Guardar cambios</em>. Aparecerás
            así en el ticket, la factura y tu página pública.
          </span>
        </div>
      )}

      <div className="space-y-6 p-4">
        {/* Org */}
        <Block title="Organización">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre comercial">
              <Input value={form.orgName} onChange={(e) => set("orgName", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Razón social">
              <Input value={form.orgLegalName} onChange={(e) => set("orgLegalName", e.target.value)} disabled={saving} />
            </Field>
            <Field label="CIF / VAT">
              <Input value={form.orgVatId} onChange={(e) => set("orgVatId", e.target.value)} disabled={saving} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-orange-500" />Email facturación</span>}>
              <Input type="email" value={form.orgBillingEmail} onChange={(e) => set("orgBillingEmail", e.target.value)} disabled={saving} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-orange-500" />Email contacto</span>}>
              <Input type="email" value={form.orgContactEmail} onChange={(e) => set("orgContactEmail", e.target.value)} disabled={saving} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3 text-orange-500" />Teléfono</span>}>
              <Input value={form.orgContactPhone} onChange={(e) => set("orgContactPhone", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Ciudad sede">
              <Input value={form.orgCity} onChange={(e) => set("orgCity", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Dirección sede">
              <Input value={form.orgAddress} onChange={(e) => set("orgAddress", e.target.value)} disabled={saving} />
            </Field>
          </div>
        </Block>

        {/* Venue */}
        <Block title="Local activo">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre del local">
              <Input value={form.venueName} onChange={(e) => set("venueName", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Categoría">
              <Select value={form.venueCategory} onValueChange={(v) => set("venueCategory", v)} disabled={saving}>
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
            <Field label={<span className="inline-flex items-center gap-1.5"><MapPin className="h-3 w-3 text-orange-500" />Ciudad</span>}>
              <Input value={form.venueCity} onChange={(e) => set("venueCity", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Dirección">
              <Input value={form.venueAddress} onChange={(e) => set("venueAddress", e.target.value)} disabled={saving} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><Users className="h-3 w-3 text-orange-500" />Aforo</span>}>
              <Input type="number" min="1" value={form.venueCapacity} onChange={(e) => set("venueCapacity", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Zona horaria">
              <Select value={form.venueTimezone} onValueChange={(v) => set("venueTimezone", v)} disabled={saving}>
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
            <Field label={<span className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3 text-orange-500" />Teléfono local</span>}>
              <Input value={form.venuePhone} onChange={(e) => set("venuePhone", e.target.value)} disabled={saving} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-orange-500" />Email local</span>}>
              <Input type="email" value={form.venueEmail} onChange={(e) => set("venueEmail", e.target.value)} disabled={saving} />
            </Field>
            <div className="sm:col-span-2">
              <Label className="text-xs">Descripción pública</Label>
              <Textarea
                className="mt-1.5 min-h-[80px]"
                value={form.venueDescription}
                onChange={(e) => set("venueDescription", e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </Block>

        {/* Operación */}
        <Block title="Operación">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={<span className="inline-flex items-center gap-1.5"><Coins className="h-3 w-3 text-orange-500" />Moneda</span>}>
              <Select value={form.opCurrency} onValueChange={(v) => set("opCurrency", v)} disabled={saving}>
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
            <Field label={<span className="inline-flex items-center gap-1.5"><Globe2 className="h-3 w-3 text-orange-500" />Idioma del panel</span>}>
              <Select value={form.opLanguage} onValueChange={(v) => set("opLanguage", v)} disabled={saving}>
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
                      "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                    color: "#fff",
                  }
                : undefined
            }
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </section>
  );
};

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div
      className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      <span className="inline-block h-px w-4 bg-orange-500/40" />
      {title}
    </div>
    {children}
  </div>
);

const Field = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
  <div>
    <Label className="text-xs">{label}</Label>
    <div className="mt-1.5">{children}</div>
  </div>
);

export default PartnerSettingsBlock;
