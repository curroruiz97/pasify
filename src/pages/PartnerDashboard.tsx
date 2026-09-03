import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  LogOut,
  LayoutDashboard,
  Calendar,
  ScanLine,
  CreditCard,
  MessageCircle,
  Plus,
  Ticket,
  Euro,
  Users as UsersIcon,
  Loader2,
  Radio,
  Copy,
  MoreVertical,
  Receipt,
  FileText,
  Music,
  Trash2,
  Menu,
  Settings,
  HelpCircle,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import QRScanner from "@/components/partner/QRScanner";
import Wordmark from "@/components/Wordmark";
import SupportChat from "@/components/support/SupportChat";
import { LiveWarRoom } from "@/components/partner/LiveWarRoom";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { PartnerOnboardingWizard } from "@/components/partner/PartnerOnboardingWizard";
import { PartnerAttendees } from "@/components/partner/PartnerAttendees";
import { EventEditorWizard, type EditorMode } from "@/components/partner/EventEditorWizard";
import { usePartnerContext } from "@/hooks/usePartnerContext";
import { TpvCierreZ } from "@/components/partner/TpvCierreZ";
import { downloadEventReportPdf, buildDemoEventReport } from "@/lib/eventReportPdf";
import { FestivalBuilder } from "@/components/partner/FestivalBuilder";
import { PartnerCRM } from "@/components/partner/PartnerCRM";
import { PartnerSalesChannels } from "@/components/partner/PartnerSalesChannels";
import { PartnerVipHospitality } from "@/components/partner/PartnerVipHospitality";
import { PartnerTeam } from "@/components/partner/PartnerTeam";
import { PartnerReports } from "@/components/partner/PartnerReports";
import { PartnerMarketing } from "@/components/partner/PartnerMarketing";
import { PartnerForecast } from "@/components/partner/PartnerForecast";
import { PartnerDynamicPricing } from "@/components/partner/PartnerDynamicPricing";
import { PartnerCashless } from "@/components/partner/PartnerCashless";
import { PartnerAppMarketplace } from "@/components/partner/PartnerAppMarketplace";
import { PartnerWhiteLabel } from "@/components/partner/PartnerWhiteLabel";
import { PartnerDoorVision } from "@/components/partner/PartnerDoorVision";
import { PartnerAutoPilot } from "@/components/partner/PartnerAutoPilot";
import { IndustryBenchmarks } from "@/components/admin/IndustryBenchmarks";
import { Megaphone, Gem, Briefcase, Wand2, Brain, Gauge, Wifi, Plug, Crown, ScanFace, Bot, BarChart3, Workflow, ChevronRight } from "lucide-react";
import { NavTree, type NavTreeNode } from "@/components/shared/NavTree";
import { SettingsSheet } from "@/components/shared/SettingsSheet";
import { PartnerSettingsBlock } from "@/components/shared/PartnerSettingsBlock";
import { HelpSheet } from "@/components/shared/HelpSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileTopBar } from "@/components/shared/MobileTopBar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { EventRowCard } from "@/components/partner/EventRowCard";
import { StatusBadge } from "@/components/partner/StatusBadge";

type Section =
  | "metricas"
  | "live"
  | "autopilot"
  | "forecast"
  | "pricing"
  | "eventos"
  | "asistentes"
  | "scanner"
  | "door_vision"
  | "tpv"
  | "cashless"
  | "vip"
  | "crm"
  | "marketing"
  | "channels"
  | "team"
  | "apps"
  | "whitelabel"
  | "benchmarks"
  | "stripe"
  | "soporte";

type NavNode = NavTreeNode<Section>;

/**
 * SECCIONES QUE HOY SON MAQUETA — FUERA DE LA APP.
 *
 * Estas pantallas no hablan con la base de datos: ni una sola llamada a
 * Supabase en sus ~7.500 lineas juntas. Lo que ensenan (clientes del CRM,
 * campanas, mesas VIP, liquidaciones al equipo, cierres de caja) son datos
 * inventados en el propio fichero, y sus botones no hacen nada.
 *
 * POR QUE SE ESCONDEN EN EL MOVIL Y NO EN LA WEB. En la web sirven de
 * escaparate para ensenar a donde va el producto en una demo comercial. Dentro
 * de la app son dos problemas. Apple acaba de rechazar la 1.0 (8) por la
 * directriz 2.1(a) —"la app tiene fallos"— y el fallo era un boton que no
 * respondia; un revisor que entre con la cuenta de local y abra "CRM" o
 * "Equipo" encuentra ese mismo fallo repetido casi sesenta veces. El segundo
 * problema no es de Apple: un local de verdad que entre desde el movil ve
 * cifras inventadas sobre su propio negocio.
 *
 * Segun cada una tenga backend, se quita de esta lista.
 */
const SECCIONES_SOLO_WEB = new Set<Section>([
  "autopilot",
  "door_vision",
  "tpv",
  "vip",
  "crm",
  "marketing",
  "channels",
  "team",
  "apps",
  "whitelabel",
  "benchmarks",
]);

/** Dentro de la app nativa esas secciones no existen. */
const enApp = Capacitor.isNativePlatform();
const seccionVisible = (id: Section) => !enApp || !SECCIONES_SOLO_WEB.has(id);


type EventRow = {
  id: string;
  title: string;
  description: string | null;
  city: string;
  date_start: string;
  status: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
};

type City = { id: string; name: string; slug: string };

type Profile = {
  id: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  business_city: string | null;
  account_status: string;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean;
};

const PartnerDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [section, setSection] = useState<Section>("metricas");
  // Si un enlace guardado apunta a una seccion que en la app no existe, se cae
  // a Metricas en vez de pintar una pantalla que no deberia estar ahi.
  const seccionActiva: Section = seccionVisible(section) ? section : "metricas";
  const [userId, setUserId] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [festivalOpen, setFestivalOpen] = useState(false);
  // Editor state: única fuente para create/edit/duplicate. Cuando es null
  // el modal está cerrado. Cuando hay objeto, el wizard se abre en el modo
  // y con el evento indicado.
  const [editor, setEditor] = useState<{ mode: EditorMode; eventId?: string } | null>(null);
  // Confirmación de borrado: se guarda el evento target hasta que el usuario
  // confirma o cancela. AlertDialog se monta al final del árbol.
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Email del user (para autocompletar email facturación del wizard)
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Permite reabrir manualmente el onboarding desde el HelpSheet.
  const [reopenOnboarding, setReopenOnboarding] = useState(false);

  // Contexto de partner: organización, venue, brand y estado real del
  // onboarding (server-truth, NO localStorage). Es la única fuente para
  // decidir si el wizard debe abrirse.
  const partnerCtx = usePartnerContext(userId || null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      setUserId(uid);
      setUserEmail(u.user?.email ?? null);

      const { data: p } = await supabase
        .from("profiles")
        .select("id, business_name, business_category, city, business_city, account_status, stripe_connect_account_id, stripe_connect_onboarded")
        .eq("id", uid)
        .maybeSingle();
      if (p) setProfile(p as Profile);

      const { data: c } = await supabase.from("cities").select("id, name, slug").eq("active", true);
      setCities((c ?? []) as City[]);

      await loadEvents(uid);

      // El estado del onboarding ahora vive en `usePartnerContext` →
      // RPC `partner_onboarding_status`. No mas localStorage ni checks
      // imprecisos de hasActivity. La fuente de verdad es server-side.

      setLoading(false);
    })();
  }, []);

  // Cuando el wizard finaliza, refrescamos profile + events + contexto.
  const refreshAllPartnerData = async () => {
    if (!userId) return;
    await Promise.all([
      partnerCtx.refresh(),
      loadEvents(userId),
      (async () => {
        const { data: p } = await supabase
          .from("profiles")
          .select("id, business_name, business_category, city, business_city, account_status, stripe_connect_account_id, stripe_connect_onboarded")
          .eq("id", userId)
          .maybeSingle();
        if (p) setProfile(p as Profile);
      })(),
    ]);
  };

  const loadEvents = async (uid: string) => {
    // Multi-tenant load: el partner ve sus eventos si es partner_id directo
    // (legacy) O si pertenece a la org que es dueña del evento. Esto resuelve
    // el caso super-admin Francisco testeando con Avenue Media: como owner
    // de la org, debe ver los eventos creados por la org aunque no estén
    // técnicamente como partner_id=su_uid.
    //
    // Estrategia: primero traemos el conjunto de org_ids del partner via
    // RPC tenant_for_user (cacheada), luego un único query con `or` que
    // une partner_id+org_id.
    let orgIds: string[] = [];
    try {
      const { data: orgs } = await supabase
        .from("organization_members")
        .select("org_id")
        .eq("user_id", uid)
        .eq("status", "active");
      orgIds = (orgs ?? []).map((m: any) => m.org_id).filter(Boolean);

      // Fallback: organizations donde el user es owner_id directo
      const { data: owned } = await supabase
        .from("organizations")
        .select("id")
        .eq("owner_id", uid);
      for (const o of owned ?? []) {
        if (!orgIds.includes((o as any).id)) orgIds.push((o as any).id);
      }
    } catch {
      /* RLS o tabla no existente — caemos a sólo partner_id */
    }

    const filter =
      orgIds.length > 0
        ? `partner_id.eq.${uid},org_id.in.(${orgIds.join(",")})`
        : `partner_id.eq.${uid}`;

    const { data } = await supabase
      .from("events")
      .select(
        "id, title, description, city, date_start, status, price_cents, capacity, tickets_sold, image_url"
      )
      .or(filter)
      .order("date_start", { ascending: false });
    setEvents((data ?? []) as EventRow[]);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Abre el wizard en modo duplicate — clona el evento via wizard (no
  // crea hasta que el partner confirma). Esto reemplaza el INSERT directo
  // anterior, que duplicaba sin cargar los tiers ni dejar editar.
  const handleDuplicateEvent = (source: EventRow) => {
    if (!userId) return;
    setEditor({ mode: "duplicate", eventId: source.id });
  };

  const handleEditEvent = (source: EventRow) => {
    if (!userId) return;
    setEditor({ mode: "edit", eventId: source.id });
  };

  const handleDeleteEvent = async () => {
    if (!deleteTarget || !userId) return;
    setDeleting(true);
    const { error } = await supabase.from("events").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      // El trigger BD enforce_event_no_delete_on_sales bloquea el delete si
      // hay tickets vendidos. Mostramos un mensaje útil según el motivo
      // real del fallo para que el partner entienda la causa.
      const msg = error.message ?? "";
      const friendly = msg.includes("Cannot delete event")
        ? "Este evento ya tiene entradas vendidas. No se puede eliminar — cámbialo a borrador o crea uno nuevo."
        : msg.includes("foreign key") || msg.includes("violates")
        ? "El evento tiene tickets vendidos o relacionados. Cancélalo en lugar de borrarlo."
        : msg;
      toast({
        title: "No se pudo eliminar",
        description: friendly,
        variant: "destructive",
      });
      setDeleteTarget(null);
      return;
    }
    toast({
      title: "Evento eliminado",
      description: `"${deleteTarget.title}" ya no aparece en tu lista.`,
    });
    setDeleteTarget(null);
    await loadEvents(userId);
  };

  // Mobile Settings/Help sheets — state lifted al padre para que
  // los triggers del drawer (header + tab bar) compartan el estado.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Arbol de navegación — agrupa secciones por dominio para reducir scroll.
  // Cada grupo se auto-expande cuando su sección activa está dentro.
  const navTree: NavNode[] = [
    { kind: "item", id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
    { kind: "item", id: "live", label: "En vivo", icon: <Radio className="h-5 w-5" /> },
    { kind: "item", id: "eventos", label: "Mis eventos", icon: <Calendar className="h-5 w-5" /> },
    {
      kind: "group", id: "ai", label: "Pasify IA", icon: <Bot className="h-5 w-5" />,
      children: [
        { id: "autopilot", label: "AutoPilot", icon: <Bot className="h-4 w-4" /> },
        { id: "forecast", label: "Forecast", icon: <Brain className="h-4 w-4" /> },
        { id: "pricing", label: "Pricing", icon: <Gauge className="h-4 w-4" /> },
        { id: "door_vision", label: "Door Vision", icon: <ScanFace className="h-4 w-4" /> },
      ],
    },
    {
      kind: "group", id: "ops", label: "Operaciones", icon: <Workflow className="h-5 w-5" />,
      children: [
        { id: "asistentes", label: "Asistentes", icon: <UsersIcon className="h-4 w-4" /> },
        { id: "scanner", label: "Escáner", icon: <ScanLine className="h-4 w-4" /> },
        { id: "tpv", label: "TPV", icon: <Receipt className="h-4 w-4" /> },
        { id: "cashless", label: "Cashless", icon: <Wifi className="h-4 w-4" /> },
        { id: "vip", label: "VIP", icon: <Gem className="h-4 w-4" /> },
      ],
    },
    {
      kind: "group", id: "audience", label: "Audiencia", icon: <Megaphone className="h-5 w-5" />,
      children: [
        { id: "crm", label: "CRM", icon: <UsersIcon className="h-4 w-4" /> },
        { id: "marketing", label: "Marketing", icon: <Wand2 className="h-4 w-4" /> },
        { id: "channels", label: "Canales", icon: <Megaphone className="h-4 w-4" /> },
      ],
    },
    {
      kind: "group", id: "platform", label: "Plataforma", icon: <Settings className="h-5 w-5" />,
      children: [
        { id: "team", label: "Equipo", icon: <Briefcase className="h-4 w-4" /> },
        { id: "apps", label: "Apps", icon: <Plug className="h-4 w-4" /> },
        { id: "whitelabel", label: "White-label", icon: <Crown className="h-4 w-4" /> },
        { id: "benchmarks", label: "Benchmarks", icon: <BarChart3 className="h-4 w-4" /> },
        { id: "stripe", label: "Stripe", icon: <CreditCard className="h-4 w-4" /> },
      ],
    },
    { kind: "item", id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ]
    // Fuera del arbol lo que en la app no existe; si un grupo se queda sin
    // hijos, desaparece el grupo entero en vez de dejar una carpeta vacia.
    .flatMap<NavNode>((nodo) => {
      if (nodo.kind === "item") return seccionVisible(nodo.id) ? [nodo] : [];
      const hijos = nodo.children.filter((h) => seccionVisible(h.id));
      return hijos.length ? [{ ...nodo, children: hijos }] : [];
    });

  // Bottom tab bar mobile — 4 entradas más usadas; el resto en el drawer "Más".
  const tabBarItems: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
    { id: "live", label: "En vivo", icon: <Radio className="h-5 w-5" /> },
    { id: "eventos", label: "Eventos", icon: <Calendar className="h-5 w-5" /> },
    { id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  const stats = {
    totalEventos: events.length,
    proximos: events.filter((e) => new Date(e.date_start) > new Date()).length,
    ticketsVendidos: events.reduce((s, e) => s + (e.tickets_sold ?? 0), 0),
    recaudado: events.reduce((s, e) => s + (e.tickets_sold ?? 0) * e.price_cents, 0),
  };

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Onboarding wizard: usa estado server-side de partner_onboarding_state
          via usePartnerContext. NUNCA depende de localStorage. */}
      <PartnerOnboardingWizard
        userId={userId || null}
        status={partnerCtx.status}
        org={partnerCtx.org}
        venue={partnerCtx.venue}
        venues={partnerCtx.venues}
        brand={partnerCtx.brand}
        email={userEmail}
        forceOpen={reopenOnboarding}
        onClose={() => setReopenOnboarding(false)}
        onContextRefresh={refreshAllPartnerData}
      />
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar desktop */}
        <aside className="hidden w-60 border-r border-border bg-card md:flex md:flex-col">
          <div className="flex flex-col items-start gap-3 border-b border-border p-5">
            <PasifyBrand size={84} />
            <Badge variant="outline" className="border-primary/40 text-primary">
              Local
            </Badge>
            {(partnerCtx.org?.name || profile?.business_name) && (
              <div className="w-full">
                <div className="truncate text-sm font-semibold leading-tight">
                  {partnerCtx.org?.name || profile?.business_name}
                </div>
                {partnerCtx.venue && (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {partnerCtx.venue.name}
                    {partnerCtx.venue.city ? ` · ${partnerCtx.venue.city}` : ""}
                  </div>
                )}
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            <NavTree tree={navTree} section={seccionActiva} onSelect={setSection} />
          </nav>
          <div className="space-y-1 border-t border-border p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="mr-2 h-4 w-4" />
              Configuración
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </aside>

        {/* Mobile top app bar — primitiva compartida (MobileTopBar). Reserva
            el espacio del PanelSwitcher flotante cuando canSwitchPanels=true. */}
        <MobileTopBar
          role="partner"
          endSlot={
            <PartnerDrawer
              navTree={navTree}
              section={seccionActiva}
              onSelect={setSection}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              businessName={profile?.business_name ?? null}
            />
          }
        />

        <main className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
          {/* Banner de error de contexto: si la RPC partner_onboarding_status
              falla (mig no aplicada, RPC revocada, etc.) NO fingimos un
              dashboard funcional — pedimos al usuario que reintente. */}
          {partnerCtx.error && (
            <div
              className="mb-6 flex items-start gap-3 rounded-2xl border p-4"
              style={{
                background: "rgba(232,84,42,0.08)",
                borderColor: "rgba(232,84,42,0.32)",
              }}
            >
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)" }}
              >
                <Radio className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">
                  No pudimos cargar tu configuración
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  Detalles técnicos: <code className="font-mono text-[11px] text-orange-400">{partnerCtx.error}</code>
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void partnerCtx.refresh()}
                disabled={partnerCtx.refreshing}
                className="shrink-0"
              >
                {partnerCtx.refreshing ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Reintentar
              </Button>
            </div>
          )}

          {/* MÉTRICAS — Reports & BI online */}
          {seccionActiva === "metricas" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Métricas</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Reports y BI en vivo: evolución diaria, top RRPP, heatmap, canales y retención.
              </p>

              {profile?.account_status === "pending" && (
                <Card className="mb-6 border-warning/40 bg-warning/10">
                  <CardContent className="p-4 text-sm">
                    Tu cuenta de local está pendiente de aprobación. Podrás publicar eventos cuando el admin la apruebe.
                  </CardContent>
                </Card>
              )}

              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard icon={<Calendar className="h-5 w-5" />} label="Eventos" value={stats.totalEventos} />
                <StatCard icon={<Calendar className="h-5 w-5" />} label="Próximos" value={stats.proximos} />
                <StatCard icon={<Ticket className="h-5 w-5" />} label="Tickets vendidos" value={stats.ticketsVendidos} />
                <StatCard icon={<Euro className="h-5 w-5" />} label="Recaudado" value={`${(stats.recaudado / 100).toFixed(2)} €`} />
              </div>

              <PartnerReports />
            </div>
          )}

          {/* AUTOPILOT IA — Fase 6 */}
          {seccionActiva === "autopilot" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">AutoPilot IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu agente Pasify ejecuta pricing, marketing, soporte y reembolsos dentro de tus políticas. Tú firmas las decisiones grandes; el agente se ocupa del resto.
              </p>
              <PartnerAutoPilot />
            </div>
          )}

          {/* LIVE WAR ROOM */}
          {seccionActiva === "live" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">En vivo</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Aforo en tiempo real, velocidad de entrada y revenue del evento activo.
              </p>
              <LiveWarRoom
                event={(() => {
                  const upcoming = events
                    .filter((e) => new Date(e.date_start).getTime() >= Date.now() - 6 * 60 * 60 * 1000)
                    .sort(
                      (a, b) =>
                        new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
                    )[0];
                  if (!upcoming) return null;
                  return {
                    id: upcoming.id,
                    title: upcoming.title,
                    date_start: upcoming.date_start,
                    capacity: upcoming.capacity ?? 800,
                    tickets_sold: upcoming.tickets_sold ?? 0,
                    price_cents: upcoming.price_cents ?? 1500,
                    partner_category: profile?.business_category ?? null,
                    partner_name: profile?.business_name ?? null,
                  };
                })()}
              />
            </div>
          )}

          {/* FORECAST IA */}
          {seccionActiva === "forecast" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Forecast IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Predicción de venta para cada evento futuro con intervalo de confianza y factores explicables.
              </p>
              <PartnerForecast
                events={events.map((e) => ({
                  id: e.id,
                  title: e.title,
                  date_start: e.date_start,
                  capacity: e.capacity ?? 800,
                  tickets_sold: e.tickets_sold ?? 0,
                  price_cents: e.price_cents ?? 1500,
                }))}
              />
            </div>
          )}

          {/* DYNAMIC PRICING */}
          {seccionActiva === "pricing" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Pricing IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Motor de pricing dinámico que sube y baja el precio según demanda, hora y aforo —
                con reglas tuyas y curva de elasticidad.
              </p>
              {/* Cableado real con pricing_proposals · ya no necesita
                  prop `events` (lo cargaba para mock); la UI ahora
                  resuelve eventos via JOIN en cada proposal. */}
              <PartnerDynamicPricing />
            </div>
          )}

          {/* EVENTOS */}
          {seccionActiva === "eventos" && (
            <div>
              {/* Mobile-first: stack del título + acciones a flex-col, recupera
                  fila lateral en md+. Botones flex-1 en móvil para repartir
                  el ancho disponible sin overflow. */}
              <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-3">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Mis eventos</h1>
                  <p className="text-sm text-muted-foreground">Crea y gestiona los eventos de tu local.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 md:flex-initial"
                    onClick={() => setFestivalOpen(true)}
                  >
                    <Music className="mr-2 h-4 w-4" />
                    Festival multi-día
                  </Button>
                <Button
                  className="flex-1 md:flex-initial"
                  onClick={() => setEditor({ mode: "create" })}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo evento
                </Button>
                </div>
              </div>

              {/* Editor unificado: create / edit / duplicate. La key remonta
                  el wizard cuando el target cambia (importante porque el
                  efecto de carga inicial corre on mount/open). */}
              <EventEditorWizard
                key={`${editor?.mode ?? "none"}-${editor?.eventId ?? "new"}`}
                mode={editor?.mode ?? "create"}
                open={editor !== null}
                onOpenChange={(o) => {
                  if (!o) setEditor(null);
                }}
                partnerId={userId}
                eventId={editor?.eventId}
                cities={cities}
                defaultCity={profile?.city ?? profile?.business_city ?? ""}
                defaultVenueName={profile?.business_name ?? ""}
                onSaved={async () => {
                  if (userId) await loadEvents(userId);
                }}
              />

              <FestivalBuilder
                open={festivalOpen}
                onOpenChange={setFestivalOpen}
                partnerId={userId}
                defaultCity={profile?.city ?? profile?.business_city ?? ""}
                defaultVenueName={profile?.business_name ?? ""}
                cities={cities}
                onCreated={async () => {
                  setFestivalOpen(false);
                  if (userId) await loadEvents(userId);
                }}
              />

              {loading ? (
                <PasifyEmptyState
                  icon={<Calendar className="h-7 w-7" />}
                  eyebrow="Cargando"
                  title="Sincronizando tus eventos…"
                  spin
                  compact
                />
              ) : events.length === 0 ? (
                <PasifyEmptyState
                  icon={<Calendar className="h-7 w-7" />}
                  eyebrow="Sin eventos"
                  title={<>Tu primer <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>evento</span> está a un click.</>}
                  subtitle="Crea un evento, define tu aforo y tu precio, y empieza a vender entradas hoy mismo."
                  action={{ label: "Nuevo evento", onClick: () => setEditor({ mode: "create" }) }}
                />
              ) : (
                <>
                  {/* Desktop: tabla densa (≥ md). En móvil queda oculta para
                      evitar el truncado de las 8 columnas. */}
                  <Card className="hidden md:block">
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Evento</TableHead>
                            <TableHead>Ciudad</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Precio</TableHead>
                            <TableHead>Aforo</TableHead>
                            <TableHead>Vendidos</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {events.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="font-medium">{e.title}</TableCell>
                              <TableCell>{e.city}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {new Date(e.date_start).toLocaleString("es-ES", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </TableCell>
                              <TableCell>{(e.price_cents / 100).toFixed(2)} €</TableCell>
                              <TableCell>{e.capacity ?? "—"}</TableCell>
                              <TableCell>{e.tickets_sold}</TableCell>
                              <TableCell>
                                <StatusBadge status={e.status} />
                              </TableCell>
                              <TableCell className="p-1 text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" aria-label="Acciones del evento">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleEditEvent(e)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Editar evento
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDuplicateEvent(e)}>
                                      <Copy className="mr-2 h-4 w-4" />
                                      Duplicar evento
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        downloadEventReportPdf(
                                          buildDemoEventReport({
                                            eventTitle: e.title,
                                            eventDate: e.date_start,
                                            venueName: profile?.business_name ?? "Local",
                                            city: e.city,
                                            capacity: e.capacity ?? 800,
                                            ticketsSold: e.tickets_sold ?? 0,
                                            revenueCents:
                                              (e.tickets_sold ?? 0) * (e.price_cents ?? 1500),
                                          })
                                        )
                                      }
                                    >
                                      <FileText className="mr-2 h-4 w-4" />
                                      Report PDF post-evento
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => setDeleteTarget(e)}
                                      className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Eliminar evento
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* Móvil: grid de EventRowCards. Stack vertical, sin scroll
                      horizontal, con la info esencial + DropdownMenu de
                      acciones por card. */}
                  <div className="grid gap-3 md:hidden">
                    {events.map((e) => (
                      <EventRowCard
                        key={e.id}
                        event={e}
                        onEdit={() => handleEditEvent(e)}
                        onDuplicate={() => handleDuplicateEvent(e)}
                        onReportPdf={() =>
                          downloadEventReportPdf(
                            buildDemoEventReport({
                              eventTitle: e.title,
                              eventDate: e.date_start,
                              venueName: profile?.business_name ?? "Local",
                              city: e.city,
                              capacity: e.capacity ?? 800,
                              ticketsSold: e.tickets_sold ?? 0,
                              revenueCents:
                                (e.tickets_sold ?? 0) * (e.price_cents ?? 1500),
                            })
                          )
                        }
                        onDelete={() => setDeleteTarget(e)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ASISTENTES — control de puerta estilo Eventbrite */}
          {seccionActiva === "asistentes" && (
            <div>
              <PartnerAttendees
                events={events.map((e) => ({
                  id: e.id,
                  title: e.title,
                  date_start: e.date_start,
                  city: e.city,
                  capacity: e.capacity,
                  tickets_sold: e.tickets_sold,
                  status: e.status,
                }))}
              />
            </div>
          )}

          {/* SCANNER */}
          {seccionActiva === "scanner" && (
            <div>
              <div className="mb-6">
                <div
                  className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                  style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: "0.22em" }}
                >
                  <span className="inline-block h-px w-5 bg-orange-500/70" />
                  Control de puerta
                </div>
                <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">
                  Escáner{" "}
                  <span
                    style={{
                      fontFamily: "'Instrument Serif', Georgia, serif",
                      fontStyle: "italic",
                      fontWeight: 400,
                    }}
                    className="text-orange-500"
                  >
                    en vivo
                  </span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  La cámara se activa automáticamente. Apunta al QR del cliente para
                  validar su entrada. Cada escaneo se registra en Asistentes.
                </p>
              </div>
              {userId && <QRScanner partnerId={userId} />}
            </div>
          )}

          {/* DOOR VISION — Computer Vision */}
          {seccionActiva === "door_vision" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Door Vision IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Cámara IA en puerta · cara ↔ DNI · detección de menores · heatmap densidad · GDPR safe.
              </p>
              <PartnerDoorVision />
            </div>
          )}

          {/* TPV — Cierre Z */}
          {seccionActiva === "tpv" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">TPV</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Cierre de caja, turnos y resumen de ventas del día.
              </p>
              <TpvCierreZ />
            </div>
          )}

          {/* CASHLESS */}
          {seccionActiva === "cashless" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Cashless</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Pulseras prepago RFID — el flujo de barra del evento en directo.
              </p>
              <PartnerCashless />
            </div>
          )}

          {/* VIP & HOSPITALITY */}
          {seccionActiva === "vip" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">VIP & Hospitality</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Mesas, reservados, bottle service y concierge desde una sola pantalla.
              </p>
              <PartnerVipHospitality />
            </div>
          )}

          {/* CRM & AUDIENCE */}
          {seccionActiva === "crm" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">CRM & Audience</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu base de clientes, segmentos en tiempo real y campañas multicanal.
              </p>
              <PartnerCRM />
            </div>
          )}

          {/* MARKETING ENGINE */}
          {seccionActiva === "marketing" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Marketing</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Campañas multicanal, automatizaciones, ads y studio con IA — todo desde una pantalla.
              </p>
              <PartnerMarketing />
            </div>
          )}

          {/* SALES CHANNELS */}
          {seccionActiva === "channels" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Canales de venta</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu mix de canales: web, redes, RRPP, hoteles y afiliados — con comisiones y revenue por canal.
              </p>
              <PartnerSalesChannels />
            </div>
          )}

          {/* TEAM */}
          {seccionActiva === "team" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Equipo</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Plantilla, turnos de la semana y nómina prevista — todo en una pantalla.
              </p>
              <PartnerTeam />
            </div>
          )}

          {/* APP MARKETPLACE */}
          {seccionActiva === "apps" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">App Marketplace</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Conecta Pasify con 30+ herramientas externas en un click — OAuth y webhooks listos.
              </p>
              <PartnerAppMarketplace />
            </div>
          )}

          {/* WHITE-LABEL */}
          {seccionActiva === "whitelabel" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">White-label</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu marca, tu subdominio, tu app móvil — Pasify desaparece y tu identidad ocupa todo el espacio.
              </p>
              <PartnerWhiteLabel />
            </div>
          )}

          {/* INDUSTRY BENCHMARKS — Fase 6 */}
          {seccionActiva === "benchmarks" && (
            <div>
              <IndustryBenchmarks />
            </div>
          )}

          {/* STRIPE */}
          {seccionActiva === "stripe" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Stripe Connect</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Conecta tu cuenta Stripe para cobrar los tickets directamente.
              </p>

              <Card>
                <CardContent className="p-6">
                  {profile?.stripe_connect_onboarded ? (
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-6 w-6 text-success" />
                      <div>
                        <div className="font-semibold text-success">Conectado</div>
                        <div className="text-xs text-muted-foreground">
                          Cuenta: {profile.stripe_connect_account_id}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Aún no has conectado tu cuenta Stripe. El flujo de Stripe Connect estará disponible próximamente.
                        Mientras tanto, puedes crear eventos en modo borrador.
                      </p>
                      <Button disabled>
                        <CreditCard className="mr-2 h-4 w-4" />
                        Conectar Stripe (próximamente)
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* SOPORTE */}
          {seccionActiva === "soporte" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Chatea con el equipo Pasify. Te respondemos en menos de 5 minutos en horario laboral.
              </p>
              <SupportChat mode="client" />
            </div>
          )}
        </main>

        {/* Bottom tab bar mobile — primitiva compartida (MobileBottomNav).
            Labels truncadas y safe-area-inset-bottom respetado. */}
        <MobileBottomNav<Section>
          items={tabBarItems}
          activeId={section}
          onSelect={setSection}
          drawerSlot={
            <PartnerDrawer
              navTree={navTree}
              section={seccionActiva}
              onSelect={setSection}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              businessName={profile?.business_name ?? null}
              variant="tab"
            />
          }
        />
      </div>

      {/* Sheets globales — abiertos desde el drawer */}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        role="partner"
        email={userEmail}
        displayName={partnerCtx.org?.name ?? profile?.business_name ?? "Tu local"}
        partnerSlot={
          userId ? (
            <PartnerSettingsBlock
              userId={userId}
              org={partnerCtx.org}
              brand={partnerCtx.brand}
              venue={partnerCtx.venue}
              venues={partnerCtx.venues}
              status={partnerCtx.status}
              onRefresh={refreshAllPartnerData}
              onReopenOnboarding={() => {
                setSettingsOpen(false);
                setTimeout(() => setReopenOnboarding(true), 100);
              }}
            />
          ) : null
        }
      />
      <HelpSheet
        open={helpOpen}
        onOpenChange={setHelpOpen}
        role="partner"
        onOpenSupport={() => setSection("soporte")}
        onReopenOnboarding={() => setReopenOnboarding(true)}
      />

      {/* Confirmación de borrado de evento — destructive */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este evento?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a borrar <span className="font-semibold text-foreground">"{deleteTarget?.title}"</span>{" "}
              de tu lista. Esta acción no se puede deshacer. Si el evento ya tiene tickets
              vendidos, cancélalo en su lugar para mantener el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void handleDeleteEvent();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Eliminando…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Sí, eliminar
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ============================================================================

const PasifyBrand = ({ size = 28 }: { size?: number }) => <Wordmark height={size} />;

// ============================================================================
// PartnerDrawer — Sheet lateral con todas las secciones + extras
// ============================================================================

const drawerMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const PartnerDrawer = ({
  navTree,
  section,
  onSelect,
  onLogout,
  onOpenSettings,
  onOpenHelp,
  businessName,
  variant = "topbar",
}: {
  navTree: NavNode[];
  section: Section;
  onSelect: (id: Section) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  businessName: string | null;
  variant?: "topbar" | "tab";
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {variant === "tab" ? (
          <button
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[10px] font-medium transition ${
              open ? "text-primary" : "text-muted-foreground"
            }`}
            aria-label="Más opciones"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="leading-none">Más</span>
          </button>
        ) : (
          <Button variant="ghost" size="icon" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[88vw] max-w-sm flex-col gap-0 border-l border-border bg-card p-0">
        {/* Header del drawer */}
        <header className="border-b border-border p-5">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...drawerMono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Pasify · Local
          </div>
          <div className="text-lg font-semibold tracking-tight text-foreground">
            {businessName ?? "Tu local"}
          </div>
        </header>

        {/* Navegación principal */}
        <nav className="flex-1 overflow-y-auto p-3">
          <div
            className="mb-2 px-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...drawerMono, letterSpacing: "0.18em" }}
          >
            Secciones
          </div>
          <NavTree
            tree={navTree}
            section={seccionActiva}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />

          {/* Extras */}
          <div
            className="mb-2 mt-6 px-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...drawerMono, letterSpacing: "0.18em" }}
          >
            Cuenta
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setTimeout(onOpenSettings, 120);
              }}
            >
              <Settings className="h-5 w-5" />
              <span className="flex-1 text-left">Configuración</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/70 transition group-hover:text-foreground" />
            </button>
            <button
              type="button"
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setTimeout(onOpenHelp, 120);
              }}
            >
              <HelpCircle className="h-5 w-5" />
              <span className="flex-1 text-left">Ayuda y guías</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/70 transition group-hover:text-foreground" />
            </button>
          </div>
        </nav>

        {/* Logout fixed bottom */}
        <footer className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
};

const StatCard = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) => (
  <Card>
    <CardContent className="p-5">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </CardContent>
  </Card>
);

// StatusBadge moved to @/components/partner/StatusBadge (reused by EventRowCard).
// CreateEventDialog inline ha sido extraído a EventEditorWizard.tsx, que es
// reutilizado para create / edit / duplicate. Eso elimina ~450 LOC duplicadas
// y garantiza que la edición sigue exactamente la misma UX que la creación.

export default PartnerDashboard;
