import { useState } from "react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Coins,
  Database,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  Headphones,
  KeyRound,
  Languages,
  Lock,
  Mail,
  MapPin,
  Moon,
  Music2,
  Palette,
  Phone,
  Save,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserCircle,
  Wand2,
  Zap,
} from "lucide-react";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export type SettingsRole = "client" | "partner" | "admin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: SettingsRole;
  /** Email del usuario para mostrar en la tarjeta de cuenta */
  email?: string | null;
  /** Nombre legible (Cliente: nombre · Partner: business_name · Admin: "Admin") */
  displayName?: string | null;
}

/* ============================================================
   SettingsSheet — configuración completa, role-aware.
   Layout: Sheet right · 92vw max-w-md · scroll body · sticky save footer.
   Cada sección sigue el patrón Pasify: eyebrow mono + heading + card rows.
   ============================================================ */

export const SettingsSheet = ({ open, onOpenChange, role, email, displayName }: Props) => {
  const { toast } = useToast();

  // Local controlled state. En prod estos vendrían del backend (Supabase).
  const [twoFA, setTwoFA] = useState(false);
  const [biometric, setBiometric] = useState(true);
  const [pushMaster, setPushMaster] = useState(true);
  const [emailMaster, setEmailMaster] = useState(true);
  const [smsMaster, setSmsMaster] = useState(false);
  const [notifEvents, setNotifEvents] = useState(true);
  const [notifTickets, setNotifTickets] = useState(true);
  const [notifPromos, setNotifPromos] = useState(true);
  const [notifLoyalty, setNotifLoyalty] = useState(true);
  const [notifNewsletter, setNotifNewsletter] = useState(false);
  const [quietHours, setQuietHours] = useState(true);
  const [shareTaste, setShareTaste] = useState(true);
  const [locationShare, setLocationShare] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [showVat, setShowVat] = useState(true);
  const [shareBenchmarks, setShareBenchmarks] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [textSize, setTextSize] = useState<"S" | "M" | "L">("M");
  const [city, setCity] = useState("Madrid");
  const [language, setLanguage] = useState<"es" | "en" | "fr" | "it">("es");
  const [searchRadius, setSearchRadius] = useState(50);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = () => {
    toast({
      title: "Cambios guardados",
      description: "Tus preferencias se han actualizado correctamente.",
    });
  };

  const roleLabel =
    role === "client" ? "Cliente" : role === "partner" ? "Local" : "Admin";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[92vw] max-w-md flex-col gap-0 border-l border-border bg-background p-0"
      >
        {/* ============ HEADER ============ */}
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
              Pasify · Ajustes · {roleLabel}
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Configuración
            </h2>
          </div>
        </header>

        {/* ============ BODY ============ */}
        <div className="flex-1 overflow-y-auto p-4 pb-[100px]">
          <div className="space-y-4">
            {/* === Account hero card === */}
            <section
              className="relative overflow-hidden rounded-2xl border p-4"
              style={{
                background:
                  "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)",
                borderColor: "rgba(232,84,42,0.32)",
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
                style={{ background: "rgba(232,84,42,0.22)", filter: "blur(60px)" }}
              />
              <div className="relative flex items-center gap-3">
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 22px -8px rgba(232,84,42,0.6)",
                  }}
                >
                  <UserCircle className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                      {displayName || "Tu cuenta"}
                    </span>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] text-muted-foreground"
                    style={mono}
                  >
                    {email ?? "—"}
                  </div>
                  <div
                    className="mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] uppercase"
                    style={{
                      ...mono,
                      letterSpacing: "0.18em",
                      borderColor: "rgba(77,184,122,0.4)",
                      color: "#4DB87A",
                      background: "rgba(77,184,122,0.08)",
                    }}
                  >
                    <span className="inline-block h-1 w-1 rounded-full bg-emerald-500" />
                    Verificada
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="relative mt-3 w-full"
              >
                <UserCircle className="mr-1.5 h-3.5 w-3.5" />
                Editar perfil
              </Button>
            </section>

            {/* === Cuenta === */}
            <SectionCard
              eyebrow="Cuenta"
              icon={<UserCircle className="h-3 w-3" />}
              title="Datos personales"
            >
              <Row
                icon={<Mail className="h-4 w-4" />}
                label="Email"
                value={email ?? "—"}
                onPress={() => toast({ title: "Cambiar email", description: "Te enviaremos un código de verificación." })}
              />
              <Divider />
              <Row
                icon={<Phone className="h-4 w-4" />}
                label="Teléfono"
                value="+34 ··· ··· 412"
                onPress={() => toast({ title: "Verifica tu teléfono", description: "Se enviará un SMS de verificación." })}
              />
              <Divider />
              <SelectChipRow
                icon={<Languages className="h-4 w-4" />}
                label="Idioma"
                value={language}
                options={[
                  { id: "es", label: "Español" },
                  { id: "en", label: "English" },
                  { id: "fr", label: "Français" },
                  { id: "it", label: "Italiano" },
                ]}
                onChange={(v) => setLanguage(v as typeof language)}
              />
              <Divider />
              <Row
                icon={<Coins className="h-4 w-4" />}
                label="Moneda"
                value="EUR €"
                onPress={() => toast({ title: "Moneda", description: "Solo EUR disponible en esta región." })}
              />
            </SectionCard>

            {/* === Seguridad === */}
            <SectionCard
              eyebrow="Seguridad"
              icon={<ShieldCheck className="h-3 w-3" />}
              title="Cómo proteges tu cuenta"
            >
              <Row
                icon={<KeyRound className="h-4 w-4" />}
                label="Contraseña"
                value="Cambiada hace 14 días"
                onPress={() => toast({ title: "Cambiar contraseña", description: "Te llevamos al flujo seguro." })}
              />
              <Divider />
              <ToggleRow
                icon={<Lock className="h-4 w-4" />}
                label="Verificación en 2 pasos"
                description="Recibirás un código por SMS o app authenticator al iniciar sesión."
                checked={twoFA}
                onChange={setTwoFA}
                meta={twoFA ? "Activa" : undefined}
              />
              <Divider />
              <ToggleRow
                icon={<Fingerprint className="h-4 w-4" />}
                label="Desbloqueo biométrico"
                description="Face ID o huella en este dispositivo."
                checked={biometric}
                onChange={setBiometric}
              />
              <Divider />
              <Row
                icon={<Smartphone className="h-4 w-4" />}
                label="Sesiones activas"
                value="2 dispositivos"
                onPress={() => toast({ title: "Sesiones activas", description: "Próximamente · iPhone 15 + MacBook Pro." })}
              />
              <Divider />
              <DangerRow
                icon={<EyeOff className="h-4 w-4" />}
                label="Cerrar otras sesiones"
                description="Desconecta todos los dispositivos excepto este."
                onPress={() => toast({ title: "Sesiones cerradas", description: "Se han cerrado 1 sesión adicional." })}
              />
            </SectionCard>

            {/* === Notificaciones === */}
            <SectionCard
              eyebrow="Notificaciones"
              icon={<Bell className="h-3 w-3" />}
              title="Cómo quieres que te avisemos"
            >
              <ToggleRow
                icon={<Smartphone className="h-4 w-4" />}
                label="Push del móvil"
                description="Avisos en tiempo real en este dispositivo."
                checked={pushMaster}
                onChange={setPushMaster}
              />
              <Divider />
              <ToggleRow
                icon={<Mail className="h-4 w-4" />}
                label="Email"
                checked={emailMaster}
                onChange={setEmailMaster}
              />
              <Divider />
              <ToggleRow
                icon={<Phone className="h-4 w-4" />}
                label="SMS"
                description="Solo para confirmaciones críticas y 2FA."
                checked={smsMaster}
                onChange={setSmsMaster}
              />

              {/* Categorías */}
              {(pushMaster || emailMaster) && (
                <>
                  <DividerLabeled label="Categorías" />
                  <ToggleRow
                    icon={<Sparkles className="h-4 w-4" />}
                    label={role === "client" ? "Eventos cerca de ti" : "Eventos & promotores"}
                    checked={notifEvents}
                    onChange={setNotifEvents}
                    compact
                  />
                  <Divider />
                  <ToggleRow
                    icon={<ScanFace className="h-4 w-4" />}
                    label={
                      role === "client"
                        ? "Recordatorios de mis tickets"
                        : role === "partner"
                          ? "Ventas y aforo en vivo"
                          : "Alertas de plataforma"
                    }
                    checked={notifTickets}
                    onChange={setNotifTickets}
                    compact
                  />
                  <Divider />
                  <ToggleRow
                    icon={<Zap className="h-4 w-4" />}
                    label={
                      role === "client"
                        ? "Promos y descuentos"
                        : role === "partner"
                          ? "Recomendaciones IA"
                          : "Anomalías AI Safety"
                    }
                    checked={notifPromos}
                    onChange={setNotifPromos}
                    compact
                  />
                  {role === "client" && (
                    <>
                      <Divider />
                      <ToggleRow
                        icon={<Sparkles className="h-4 w-4" />}
                        label="Pasify Points & perks"
                        checked={notifLoyalty}
                        onChange={setNotifLoyalty}
                        compact
                      />
                    </>
                  )}
                  <Divider />
                  <ToggleRow
                    icon={<Mail className="h-4 w-4" />}
                    label="Newsletter mensual"
                    checked={notifNewsletter}
                    onChange={setNotifNewsletter}
                    compact
                  />
                </>
              )}

              {pushMaster && (
                <>
                  <DividerLabeled label="Modo silencio" />
                  <ToggleRow
                    icon={<Moon className="h-4 w-4" />}
                    label="No molestar de noche"
                    description="No te llegan push entre 23:00 y 09:00, excepto urgencias."
                    checked={quietHours}
                    onChange={setQuietHours}
                    meta="23:00–09:00"
                  />
                </>
              )}
            </SectionCard>

            {/* === Privacidad === */}
            <SectionCard
              eyebrow="Privacidad & datos"
              icon={<Lock className="h-3 w-3" />}
              title="Tu información, tus reglas"
            >
              <ToggleRow
                icon={<Wand2 className="h-4 w-4" />}
                label="Personalización con IA"
                description={
                  role === "client"
                    ? "Pasify usa tu historial para recomendarte eventos y locales."
                    : "Pasify usa datos agregados para optimizar pricing y marketing."
                }
                checked={shareTaste}
                onChange={setShareTaste}
              />
              <Divider />
              <ToggleRow
                icon={<MapPin className="h-4 w-4" />}
                label="Datos de ubicación"
                description="Mejora 'cerca de ti' y check-in automático en eventos."
                checked={locationShare}
                onChange={setLocationShare}
              />
              {role === "partner" && (
                <>
                  <Divider />
                  <ToggleRow
                    icon={<Database className="h-4 w-4" />}
                    label="Aportar a Industry Benchmarks"
                    description="Tus métricas agregadas (k=15, anonimizadas) alimentan los benchmarks. Tú también los consumes."
                    checked={shareBenchmarks}
                    onChange={setShareBenchmarks}
                    meta="Anónimo"
                  />
                </>
              )}
              <Divider />
              <Row
                icon={<Download className="h-4 w-4" />}
                label="Descargar mis datos"
                value="GDPR · ZIP"
                onPress={() => toast({ title: "Solicitud enviada", description: "Recibirás un email con tus datos en 24h." })}
              />
              <Divider />
              <DangerRow
                icon={<Trash2 className="h-4 w-4" />}
                label="Eliminar mi cuenta"
                description="Permanente. Tus tickets, puntos y datos se perderán en 30 días."
                onPress={() => setShowDeleteConfirm(true)}
              />
              {showDeleteConfirm && (
                <div
                  className="mt-2 rounded-xl border p-3"
                  style={{
                    background: "rgba(239,68,68,0.06)",
                    borderColor: "rgba(239,68,68,0.4)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="text-[12px] leading-relaxed text-foreground">
                      Esta acción es <strong>irreversible</strong>. Si confirmas, se eliminará tu cuenta y tus datos asociados en 30 días.
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      style={{ background: "#EF4444", border: 0, color: "#fff" }}
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        toast({
                          title: "Solicitud recibida",
                          description: "Te enviaremos un email para confirmar.",
                        });
                      }}
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* === Preferencias role-specific === */}
            {role === "client" && (
              <SectionCard
                eyebrow="Preferencias"
                icon={<Sparkles className="h-3 w-3" />}
                title="Cómo descubres locales"
              >
                <Row
                  icon={<MapPin className="h-4 w-4" />}
                  label="Ciudad por defecto"
                  value={city}
                  onPress={() =>
                    setCity((c) =>
                      c === "Madrid" ? "Barcelona" : c === "Barcelona" ? "Valencia" : "Madrid"
                    )
                  }
                />
                <Divider />
                <Row
                  icon={<Music2 className="h-4 w-4" />}
                  label="Géneros musicales"
                  value="5 seleccionados"
                  onPress={() => toast({ title: "Géneros musicales", description: "Próximamente · selector multi." })}
                />
                <Divider />
                <div className="px-3 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <Globe2 className="h-4 w-4" />
                      </span>
                      <span className="text-[13px] font-medium">Distancia máx. de búsqueda</span>
                    </div>
                    <span style={mono} className="text-[12.5px] font-bold text-orange-500">
                      {searchRadius} km
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={150}
                    step={5}
                    value={searchRadius}
                    onChange={(e) => setSearchRadius(Number(e.target.value))}
                    className="mt-3 w-full accent-orange-500"
                  />
                </div>
                <Divider />
                <ToggleRow
                  icon={<Coins className="h-4 w-4" />}
                  label="Mostrar precios con IVA"
                  checked={showVat}
                  onChange={setShowVat}
                  compact
                />
              </SectionCard>
            )}

            {role === "partner" && (
              <SectionCard
                eyebrow="Operación"
                icon={<Sparkles className="h-3 w-3" />}
                title="Configuración del local"
              >
                <Row
                  icon={<Coins className="h-4 w-4" />}
                  label="Stripe Connect"
                  value="Conectado · acct_•••421"
                  onPress={() => toast({ title: "Stripe", description: "Te llevamos a Stripe dashboard." })}
                />
                <Divider />
                <Row
                  icon={<Wand2 className="h-4 w-4" />}
                  label="White-label"
                  value="Activo · pacha.pasify.es"
                  onPress={() => toast({ title: "White-label", description: "Configuración detallada en el módulo." })}
                />
                <Divider />
                <Row
                  icon={<KeyRound className="h-4 w-4" />}
                  label="API Keys"
                  value="2 activas"
                  onPress={() => toast({ title: "API Keys", description: "Sección Apps · Developer Portal." })}
                />
                <Divider />
                <Row
                  icon={<UserCircle className="h-4 w-4" />}
                  label="Equipo"
                  value="5 miembros"
                  onPress={() => toast({ title: "Equipo", description: "Sección Equipo del dashboard." })}
                />
              </SectionCard>
            )}

            {role === "admin" && (
              <SectionCard
                eyebrow="Plataforma"
                icon={<Sparkles className="h-3 w-3" />}
                title="Controles globales"
              >
                <ToggleRow
                  icon={<CircleAlert className="h-4 w-4" />}
                  label="Modo mantenimiento"
                  description="Pone la plataforma en modo solo-lectura para todos los tenants."
                  checked={maintenanceMode}
                  onChange={setMaintenanceMode}
                  meta={maintenanceMode ? "Activo" : undefined}
                  danger
                />
                <Divider />
                <Row
                  icon={<Wand2 className="h-4 w-4" />}
                  label="Feature flags"
                  value="14 activos · 3 beta"
                  onPress={() => toast({ title: "Feature flags", description: "Próximamente · panel granular." })}
                />
                <Divider />
                <Row
                  icon={<Zap className="h-4 w-4" />}
                  label="Rate limits API"
                  value="1000 req/min/tenant"
                  onPress={() => toast({ title: "Rate limits", description: "Configurable por tenant en Developer Portal." })}
                />
              </SectionCard>
            )}

            {/* === Apariencia === */}
            <SectionCard
              eyebrow="Apariencia"
              icon={<Palette className="h-3 w-3" />}
              title="Cómo se ve Pasify"
            >
              <div className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Moon className="h-4 w-4" />
                  </span>
                  <div className="flex-1">
                    <div className="text-[13px] font-medium">Tema</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Pasify <span style={serif} className="text-orange-500">nace</span> en dark. Light mode llegará en 2026.
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[9.5px] uppercase"
                    style={{
                      ...mono,
                      letterSpacing: "0.18em",
                      background: "rgba(232,84,42,0.12)",
                      color: "#FF7A4D",
                    }}
                  >
                    Dark
                  </span>
                </div>
              </div>
              <Divider />
              <div className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <span style={mono} className="text-[11px] font-bold">Aa</span>
                  </span>
                  <span className="flex-1 text-[13px] font-medium">Tamaño del texto</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {(["S", "M", "L"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setTextSize(s)}
                      className="rounded-lg border px-3 py-2 text-[12px] font-semibold transition"
                      style={{
                        ...mono,
                        background:
                          textSize === s ? "rgba(232,84,42,0.12)" : "transparent",
                        borderColor:
                          textSize === s
                            ? "rgba(232,84,42,0.45)"
                            : "rgba(244,238,226,0.10)",
                        color: textSize === s ? "#FF7A4D" : "#8A8275",
                      }}
                    >
                      {s === "S" ? "Pequeño" : s === "M" ? "Normal" : "Grande"}
                    </button>
                  ))}
                </div>
              </div>
              <Divider />
              <ToggleRow
                icon={<Eye className="h-4 w-4" />}
                label="Reducir animaciones"
                description="Respeta tu preferencia del sistema (prefers-reduced-motion)."
                checked={reduceMotion}
                onChange={setReduceMotion}
                compact
              />
            </SectionCard>

            {/* === Datos & almacenamiento === */}
            <SectionCard
              eyebrow="Datos & almacenamiento"
              icon={<Database className="h-3 w-3" />}
              title="En este dispositivo"
            >
              <Row
                icon={<Database className="h-4 w-4" />}
                label="Caché"
                value="32 MB"
                actionLabel="Limpiar"
                onPress={() => toast({ title: "Caché limpiada", description: "Liberados 32 MB." })}
              />
              <Divider />
              <Row
                icon={<Download className="h-4 w-4" />}
                label="Tickets offline"
                value="Sincronizados · hace 1m"
                actionLabel="Sincronizar"
                onPress={() => toast({ title: "Sincronización", description: "Tickets actualizados." })}
              />
            </SectionCard>

            {/* === Acerca de === */}
            <SectionCard
              eyebrow="Acerca de"
              icon={<Sparkles className="h-3 w-3" />}
              title="Pasify"
            >
              <Row
                icon={<Sparkles className="h-4 w-4" />}
                label="Versión"
                value="v0.1.0 · build 2026.05"
              />
              <Divider />
              <Row
                icon={<ChevronRight className="h-4 w-4" />}
                label="Términos de servicio"
                onPress={() => toast({ title: "ToS", description: "Próximamente · pasify.es/terms" })}
              />
              <Divider />
              <Row
                icon={<ChevronRight className="h-4 w-4" />}
                label="Política de privacidad"
                onPress={() => toast({ title: "Privacy", description: "Próximamente · pasify.es/privacy" })}
              />
              <Divider />
              <Row
                icon={<ChevronRight className="h-4 w-4" />}
                label="Licencias open source"
                onPress={() => toast({ title: "Licencias", description: "Generamos un README con todas." })}
              />
            </SectionCard>

            <div className="h-2" />
          </div>
        </div>

        {/* ============ STICKY FOOTER ============ */}
        <footer
          className="sticky bottom-0 z-10 border-t border-border bg-card/90 p-3 backdrop-blur-xl"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <Button
            onClick={handleSave}
            className="h-11 w-full text-[14px] font-semibold text-white"
            style={{
              background:
                "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              border: 0,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 22px -8px rgba(232,84,42,0.55)",
            }}
          >
            <Save className="mr-2 h-4 w-4" />
            Guardar cambios
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
};

/* ============================================================
   PRIMITIVES — reutilizables dentro del Sheet
   ============================================================ */

const SectionCard = ({
  eyebrow,
  icon,
  title,
  children,
}: {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) => (
  <section
    className="rounded-2xl border border-border bg-card"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div className="border-b border-border/60 p-4">
      <div
        className="inline-flex items-center gap-2 text-[9.5px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        {icon}
        {eyebrow}
      </div>
      <h3 className="mt-0.5 text-[14.5px] font-semibold tracking-tight text-foreground">
        {title}
      </h3>
    </div>
    <div className="p-1">{children}</div>
  </section>
);

const Row = ({
  icon,
  label,
  value,
  onPress,
  actionLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
  actionLabel?: string;
}) => (
  <button
    type="button"
    onClick={onPress}
    disabled={!onPress}
    className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
  >
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
      {icon}
    </span>
    <span className="flex-1 truncate text-[13px] font-medium text-foreground">
      {label}
    </span>
    {value && (
      <span
        className="truncate text-right text-[11.5px] text-muted-foreground"
        style={mono}
      >
        {value}
      </span>
    )}
    {actionLabel && onPress && (
      <span
        className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-orange-500 transition group-hover:border-orange-500/50"
        style={{ ...mono, letterSpacing: "0.16em", borderColor: "rgba(232,84,42,0.32)" }}
      >
        {actionLabel}
      </span>
    )}
    {!actionLabel && onPress && (
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70 transition group-hover:text-foreground" />
    )}
  </button>
);

const ToggleRow = ({
  icon,
  label,
  description,
  checked,
  onChange,
  meta,
  compact,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  meta?: string;
  compact?: boolean;
  danger?: boolean;
}) => (
  <div className={`flex items-start gap-3 rounded-xl px-3 ${compact ? "py-2" : "py-2.5"}`}>
    <span
      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
      style={{
        background: danger ? "rgba(239,68,68,0.12)" : "hsl(var(--muted))",
        color: danger ? "#EF4444" : "hsl(var(--muted-foreground))",
      }}
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {meta && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9.5px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.16em",
              background: danger ? "rgba(239,68,68,0.12)" : "rgba(77,184,122,0.12)",
              color: danger ? "#EF4444" : "#4DB87A",
            }}
          >
            {meta}
          </span>
        )}
      </div>
      {description && (
        <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

const SelectChipRow = ({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="flex-1 text-left text-[13px] font-medium text-foreground">
          {label}
        </span>
        <span style={mono} className="text-[11.5px] text-orange-500">
          {options.find((o) => o.id === value)?.label ?? value}
        </span>
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground/70 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className="rounded-full border px-2.5 py-1 text-[11.5px] transition"
                style={{
                  borderColor: active ? "rgba(232,84,42,0.45)" : "rgba(244,238,226,0.10)",
                  background: active ? "rgba(232,84,42,0.10)" : "transparent",
                  color: active ? "#FF7A4D" : "#8A8275",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DangerRow = ({
  icon,
  label,
  description,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onPress: () => void;
}) => (
  <button
    type="button"
    onClick={onPress}
    className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-red-500/5"
  >
    <span
      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
      style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <span className="text-[13px] font-medium text-red-500">{label}</span>
      {description && (
        <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
    </div>
    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-red-500/70" />
  </button>
);

const Divider = () => (
  <div className="mx-3 h-px" style={{ background: "rgba(244,238,226,0.06)" }} />
);

const DividerLabeled = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 px-3 pt-3 pb-1">
    <div className="h-px flex-1" style={{ background: "rgba(244,238,226,0.06)" }} />
    <span
      className="text-[9.5px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.2em" }}
    >
      {label}
    </span>
    <div className="h-px flex-1" style={{ background: "rgba(244,238,226,0.06)" }} />
  </div>
);

export default SettingsSheet;
