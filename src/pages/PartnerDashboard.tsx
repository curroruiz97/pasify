import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  LogOut,
  LayoutDashboard,
  Calendar,
  ScanLine,
  CreditCard,
  MessageCircle,
  Plus,
  Ticket,
  Users as UsersIcon,
  Loader2,
  Radio,
  Copy,
  ExternalLink,
  Lock,
  EyeOff,
  QrCode,
  RotateCcw,
  Send,
  XCircle,
  Share2,
  MoreVertical,
  Receipt,
  Trash2,
  Menu,
  Settings,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
} from "lucide-react";
import QRScanner from "@/components/partner/QRScanner";
import Wordmark from "@/components/Wordmark";
import SupportChat from "@/components/support/SupportChat";
import { LiveWarRoom } from "@/components/partner/LiveWarRoom";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { PartnerOnboardingWizard } from "@/components/partner/PartnerOnboardingWizard";
import { OnboardingChecklist } from "@/components/partner/OnboardingChecklist";
import { PartnerAttendees } from "@/components/partner/PartnerAttendees";
import { EventEditorWizard, type EditorMode } from "@/components/partner/EventEditorWizard";
import { usePartnerContext } from "@/hooks/usePartnerContext";
import { TpvCierreZ } from "@/components/partner/TpvCierreZ";
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
import { SectionBoundary } from "@/components/partner/SectionBoundary";
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
import { EventQrDialog } from "@/components/partner/EventQrDialog";
import { CancelEventDialog, type CancelTarget } from "@/components/partner/CancelEventDialog";
import { shareEventLink } from "@/lib/eventLinks";
import { isDoorLocked } from "@/lib/doorLock";
import { StatusBadge } from "@/components/partner/StatusBadge";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";
import { isNativeApp } from "@/lib/platform";
import { listEventChoices, pickActiveEvent } from "@/lib/pickActiveEvent";
import { useCurrentUser, useCurrentUserId } from "@/lib/cache/session";
import { qk } from "@/lib/cache/keys";
import { useEventoEnUrl } from "@/hooks/useEventoEnUrl";
import { RefreshIndicator } from "@/components/ui/refresh-indicator";
import {
  invalidarTrasCambioDeEventos,
  useCities,
  usePartnerBalance,
  usePartnerEvents,
  usePartnerProfile,
  usePartnerShowcase,
  type City,
  type PartnerEventRow,
} from "@/hooks/queries/partnerData";

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

const ALL_SECTIONS: readonly Section[] = [
  "metricas", "live", "autopilot", "forecast", "pricing", "eventos", "asistentes", "scanner",
  "door_vision", "tpv", "cashless", "vip", "crm", "marketing", "channels", "team", "apps",
  "whitelabel", "benchmarks", "stripe", "soporte",
];
const isSection = (value: string | undefined): value is Section =>
  !!value && (ALL_SECTIONS as readonly string[]).includes(value);

/**
 * SECCIONES MAQUETA — OCULTAS SALVO EN LA ORGANIZACIÓN DE DEMO.
 *
 * Estas pantallas enseñan datos inventados en el propio fichero (clientes del
 * CRM, campañas, mesas VIP, liquidaciones al equipo, cierres de caja…) o
 * funciones a medio construir (Pricing, Cashless), y muchos de sus botones no
 * hacen nada.
 *
 * Regla de la Fase 0:
 *   - En la app nativa no existen nunca. Apple rechazó la 1.0 por la
 *     directriz 2.1(a) —un botón que no respondía— y aquí habría decenas.
 *   - En la web solo las ve una organización de demostración: flag
 *     `partner_showcase` (get_feature_flag con la org del local), apagado por
 *     defecto. Un local real no ve nunca cifras inventadas sobre su negocio.
 *   - Cuando se ven, llevan arriba la franja "DEMO · datos ficticios".
 *
 * Según cada una tenga backend de verdad, se quita de esta lista.
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
  "pricing",
  "cashless",
]);

const describeError = (err: unknown): string => {
  if (err instanceof TimeoutError) {
    return "El servidor no responde. Revisa tu conexión y vuelve a intentarlo.";
  }
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Error desconocido";
};

type EventRow = PartnerEventRow;

/**
 * Editor de eventos abierto, en la URL (?editor=nuevo | editar:<id> |
 * duplicar:<id>): si el navegador recarga la pestaña (o iOS cierra la app)
 * mientras se crea un evento, al volver se reabre y recupera su borrador.
 */
type EditorState = { mode: EditorMode; eventId?: string } | null;

const leerEditor = (raw: string | null): EditorState => {
  if (!raw) return null;
  if (raw === "nuevo") return { mode: "create" };
  const [accion, id] = raw.split(":");
  if (id && accion === "editar") return { mode: "edit", eventId: id };
  if (id && accion === "duplicar") return { mode: "duplicate", eventId: id };
  return null;
};

const escribirEditor = (e: NonNullable<EditorState>) =>
  e.mode === "create" ? "nuevo" : `${e.mode === "edit" ? "editar" : "duplicar"}:${e.eventId ?? ""}`;

// Referencias estables mientras no hay datos (evitan recalcular memos hijos).
const SIN_EVENTOS: EventRow[] = [];
const SIN_CIUDADES: City[] = [];

const PartnerDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // La sección vive en la URL (/partner-dashboard/:section): atrás, recargar
  // y los enlaces de las notificaciones llevan a la sección correcta. El
  // evento elegido (?evento=, Asistentes/En vivo) viaja con ella.
  const { section: sectionParam } = useParams<{ section?: string }>();
  const section: Section = isSection(sectionParam) ? sectionParam : "metricas";
  const [eventoElegido] = useEventoEnUrl();
  const setSection = useCallback(
    (id: Section) =>
      navigate({
        pathname: id === "metricas" ? "/partner-dashboard" : `/partner-dashboard/${id}`,
        search: eventoElegido ? `?evento=${encodeURIComponent(eventoElegido)}` : "",
      }),
    [navigate, eventoElegido],
  );

  // Sesión síncrona (src/lib/cache/session): el primer render ya sabe quién
  // es y encuentra sus datos en la caché, sin esperar a auth.getUser().
  const uid = useCurrentUserId();
  const userId = uid ?? "";
  // Email del user (para autocompletar email facturación del wizard)
  const userEmail = useCurrentUser()?.email ?? null;

  // Datos del panel en la caché (hooks/queries/partnerData): al volver a una
  // sección, a la pestaña o al recargar se pintan al instante y se refrescan
  // detrás. Solo la primera vez, sin nada guardado, hay "Cargando…".
  const eventsQuery = usePartnerEvents(uid);
  const events = eventsQuery.data ?? SIN_EVENTOS;
  const loading = !!uid && eventsQuery.isPending;
  // Fallo de la carga de eventos sin nada que enseñar. Mientras no es null no
  // se pinta nada que dependa de la lista: ni "Tu primer evento" ni KPIs a
  // cero. Con datos de antes, un refresco fallido no los tapa.
  const loadError =
    eventsQuery.isError && eventsQuery.data === undefined ? describeError(eventsQuery.error) : null;
  const refrescandoEventos = eventsQuery.isFetching && !eventsQuery.isPending;
  const profile = usePartnerProfile(uid).data ?? null;
  const cities = useCities().data ?? SIN_CIUDADES;

  // Editor state: única fuente para create/edit/duplicate. Cuando es null
  // el modal está cerrado. Cuando hay objeto, el wizard se abre en el modo
  // y con el evento indicado. Vive en la URL (?editor=).
  const [searchParams, setSearchParams] = useSearchParams();
  const editorParam = searchParams.get("editor");
  const editor = useMemo(() => leerEditor(editorParam), [editorParam]);
  const setEditor = useCallback(
    (next: EditorState) =>
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set("editor", escribirEditor(next));
          else p.delete("editor");
          return p;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  // Confirmación de borrado: se guarda el evento target hasta que el usuario
  // confirma o cancela. AlertDialog se monta al final del árbol.
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  // Retirar de la venta (publicado → borrador), con confirmación.
  const [unpublishTarget, setUnpublishTarget] = useState<EventRow | null>(null);
  // QR del enlace público de un evento (cartelería).
  const [qrTarget, setQrTarget] = useState<EventRow | null>(null);
  // Cancelar con reembolso, o reintentar los reembolsos de uno cancelado.
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Permite reabrir manualmente el onboarding desde el HelpSheet.
  const [reopenOnboarding, setReopenOnboarding] = useState(false);
  // Lista de primeros pasos ocultada en esta visita.
  const [checklistHidden, setChecklistHidden] = useState(false);

  // Contexto de partner: organización, venue, brand y estado real del
  // onboarding (server-truth, NO localStorage). Es la única fuente para
  // decidir si el wizard debe abrirse.
  const partnerCtx = usePartnerContext(uid);
  const orgId = partnerCtx.org?.id ?? null;

  // Dentro de la app nativa las maquetas no existen; en la web, solo con el
  // flag partner_showcase activo para la organización.
  const enApp = isNativeApp();
  const showcase = usePartnerShowcase(uid, orgId, !enApp).data === true && !enApp;
  const seccionVisible = (id: Section) => !SECCIONES_SOLO_WEB.has(id) || (!enApp && showcase);
  // Si un enlace guardado apunta a una seccion que no se puede ver, se cae a
  // Metricas en vez de pintar una pantalla que no deberia estar ahi.
  const seccionActiva: Section = seccionVisible(section) ? section : "metricas";

  // Modo puerta activo en este dispositivo: el panel no se abre.
  useEffect(() => {
    if (uid && isDoorLocked(uid)) navigate("/door", { replace: true });
  }, [uid, navigate]);

  // Recarga tras crear/editar/borrar: si falla se avisa y se conserva la
  // lista. También quedan obsoletos En vivo, asistentes, informes, cobros…
  const { refetch: refetchEvents } = eventsQuery;
  const reloadEvents = useCallback(async () => {
    if (!uid) return;
    await invalidarTrasCambioDeEventos(queryClient, uid);
    const r = await refetchEvents();
    if (r.isError) {
      toast({
        title: "No se pudo actualizar la lista de eventos",
        description: describeError(r.error),
        variant: "destructive",
      });
    }
  }, [uid, queryClient, refetchEvents, toast]);

  // Cuando el wizard finaliza, refrescamos profile + events + contexto.
  const refreshAllPartnerData = async () => {
    if (!uid) return;
    await Promise.all([
      partnerCtx.refresh(),
      reloadEvents(),
      queryClient.invalidateQueries({ queryKey: qk.partner.profile(uid) }),
    ]);
  };

  const handleLogout = async () => {
    try {
      // scope local: cierra esta sesión, no las de otros dispositivos del local.
      const { error } = await withTimeout(
        supabase.auth.signOut({ scope: "local" }),
        8_000,
        "auth.signOut"
      );
      if (error) throw error;
      navigate("/");
    } catch (err) {
      console.error("[PartnerDashboard] signOut:", err);
      toast({
        title: "No se pudo cerrar sesión",
        description: "Revisa tu conexión y vuelve a intentarlo.",
        variant: "destructive",
      });
    }
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

  // Cambios de estado explícitos: editar un evento ya no los hace (el
  // editor guarda sin tocar el estado).
  const changeEventStatus = async (target: EventRow, to: "draft" | "published") => {
    if (!userId) return;
    setChangingStatus(true);
    try {
      if (to === "published") {
        const { count, error: tierErr } = await supabase
          .from("ticket_tiers")
          .select("id", { count: "exact", head: true })
          .eq("event_id", target.id)
          .eq("status", "active");
        if (tierErr) throw tierErr;
        if (!count) {
          toast({
            title: "Falta un tipo de entrada",
            description: "Añade al menos un tipo de entrada activo antes de publicar.",
            variant: "destructive",
          });
          setEditor({ mode: "edit", eventId: target.id });
          return;
        }
      }
      const { error } = await supabase.from("events").update({ status: to }).eq("id", target.id);
      if (error) throw error;
      toast(
        to === "published"
          ? { title: "Evento publicado", description: `"${target.title}" ya está a la venta.` }
          : {
              title: "Retirado de la venta",
              description: "Ya no aparece en el calendario. Las entradas vendidas siguen siendo válidas.",
            },
      );
      await reloadEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "";
      toast({
        title: "No se pudo cambiar el estado",
        description: msg.includes("cancelado")
          ? "Un evento cancelado no se puede volver a publicar."
          : msg.includes("42501") || msg.includes("permission") || msg.includes("row-level")
          ? "Tu cuenta no puede publicar eventos ahora mismo. Escríbenos desde Soporte."
          : "Revisa tu conexión y vuelve a intentarlo.",
        variant: "destructive",
      });
    } finally {
      setChangingStatus(false);
      setUnpublishTarget(null);
    }
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
        ? "Este evento ya tiene entradas vendidas y no se puede eliminar. Puedes retirarlo de la venta desde su menú."
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
    await reloadEvents();
  };

  // Mobile Settings/Help sheets — state lifted al padre para que
  // los triggers del drawer (header + tab bar) compartan el estado.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Arbol de navegación — agrupa secciones por dominio para reducir scroll.
  // Cada grupo se auto-expande cuando su sección activa está dentro.
  // Va en su propia constante tipada: con `.flatMap` encadenado al literal,
  // TypeScript deja de tiparlo como NavNode[] y los `id` pasan a ser string.
  const arbol: NavNode[] = [
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
        { id: "stripe", label: "Cobros", icon: <CreditCard className="h-4 w-4" /> },
      ],
    },
    { kind: "item", id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];
  // Fuera del arbol lo que no se puede ver; si un grupo se queda sin hijos,
  // desaparece el grupo entero en vez de dejar una carpeta vacia.
  const navTree = arbol.flatMap<NavNode>((nodo) => {
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

  // "Recaudado" ya no sale de aquí: tickets_sold × price_cents del evento no
  // es lo cobrado (price_cents es el "desde" del tipo más barato). La cifra
  // real está en PartnerReports, justo debajo.
  const stats = {
    totalEventos: events.length,
    proximos: events.filter((e) => new Date(e.date_start) > new Date()).length,
    ticketsVendidos: events.reduce((s, e) => s + (e.tickets_sold ?? 0), 0),
  };

  const retryLoad = () => void refetchEvents();
  const reintentando = eventsQuery.isFetching;

  /** Secciones que dependen de la lista de eventos: cargando, error o contenido. */
  const eventsGate = (content: React.ReactNode) =>
    loading ? (
      <PasifyEmptyState
        icon={<Calendar className="h-7 w-7" />}
        eyebrow="Cargando"
        title="Sincronizando tus eventos…"
        spin
        compact
      />
    ) : loadError ? (
      <LoadErrorCard message={loadError} onRetry={retryLoad} retrying={reintentando} />
    ) : (
      content
    );

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
            <NavTree<Section> tree={navTree} section={seccionActiva} onSelect={setSection} />
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
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => void handleLogout()}>
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
              onLogout={() => void handleLogout()}
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

          {/* Maquetas visibles (solo org de demo en web): siempre avisadas. */}
          {SECCIONES_SOLO_WEB.has(seccionActiva) && <DemoBanner />}

          {/* Cada sección en su propio boundary: si una revienta, el resto del
              panel sigue vivo. La key lo remonta limpio al cambiar de sección. */}
          <SectionBoundary
            key={seccionActiva}
            sectionId={seccionActiva}
            onGoHome={seccionActiva === "metricas" ? undefined : () => setSection("metricas")}
          >
          {/* MÉTRICAS — Reports & BI online */}
          {seccionActiva === "metricas" && (
            <div>
              {!checklistHidden && partnerCtx.status && (
                <OnboardingChecklist
                  onDismiss={() => setChecklistHidden(true)}
                  steps={[
                    {
                      id: "local",
                      title: "Completa los datos de tu local",
                      description: "Nombre, dirección y cómo te encuentran los clientes.",
                      done: !partnerCtx.status.shouldShowWizard,
                      actionLabel: "Completar",
                      onAction: () => setReopenOnboarding(true),
                    },
                    {
                      id: "evento",
                      title: "Crea tu primer evento",
                      description: "Con sus tipos de entrada y precios.",
                      done: events.length > 0 || partnerCtx.status.hasEvent,
                      actionLabel: "Crear evento",
                      // Sección y editor en una sola navegación: dos seguidas se pisan.
                      onAction: () => navigate("/partner-dashboard/eventos?editor=nuevo"),
                    },
                    {
                      id: "publicar",
                      title: "Publícalo y compártelo",
                      description: "Sale a la venta y tienes un enlace y un QR para redes y carteles.",
                      done: events.some((e) => e.status === "published" || e.status === "past"),
                      actionLabel: "Ir a Mis eventos",
                      onAction: () => setSection("eventos"),
                    },
                  ]}
                />
              )}
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Métricas</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Ventas e ingresos de tus eventos: evolución diaria, eventos que más venden y horas de compra.
              </p>

              {profile?.account_status === "pending" && (
                <Card className="mb-6 border-warning/40 bg-warning/10">
                  <CardContent className="p-4 text-sm">
                    Tu cuenta de local está pendiente de aprobación. Podrás publicar eventos cuando el admin la apruebe.
                  </CardContent>
                </Card>
              )}

              {loadError ? (
                <div className="mb-6">
                  <LoadErrorCard message={loadError} onRetry={retryLoad} retrying={reintentando} />
                </div>
              ) : (
                <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                  <StatCard icon={<Calendar className="h-5 w-5" />} label="Eventos" value={loading ? "—" : stats.totalEventos} />
                  <StatCard icon={<Calendar className="h-5 w-5" />} label="Próximos" value={loading ? "—" : stats.proximos} />
                  <StatCard icon={<Ticket className="h-5 w-5" />} label="Tickets vendidos" value={loading ? "—" : stats.ticketsVendidos} />
                </div>
              )}

              <PartnerReports />
            </div>
          )}

          {/* AUTOPILOT IA — maqueta */}
          {seccionActiva === "autopilot" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">AutoPilot IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de un asistente que propondrá acciones de precio, marketing y soporte para que tú las apruebes.
              </p>
              <PartnerAutoPilot />
            </div>
          )}

          {/* EN VIVO */}
          {seccionActiva === "live" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">En vivo</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Aforo y ventas por tipo de entrada del evento en curso.
              </p>
              {eventsGate(
                <LiveSection events={events} partnerName={partnerCtx.org?.name ?? profile?.business_name ?? null} />
              )}
            </div>
          )}

          {/* FORECAST IA */}
          {seccionActiva === "forecast" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Forecast IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Previsión de venta de tus próximos eventos a partir de tu histórico.
              </p>
              {eventsGate(
                <PartnerForecast
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    date_start: e.date_start,
                    capacity: e.capacity ?? null,
                    tickets_sold: e.tickets_sold ?? 0,
                    status: e.status,
                  }))}
                />
              )}
            </div>
          )}

          {/* PRICING — maqueta hasta que haya propuestas automáticas */}
          {seccionActiva === "pricing" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Pricing IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Propuestas de subida o bajada de precio según la velocidad de venta de cada tipo de entrada. Tú decides si se aplican.
              </p>
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
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Mis eventos</h1>
                    <RefreshIndicator active={refrescandoEventos} />
                  </div>
                  <p className="text-sm text-muted-foreground">Crea y gestiona los eventos de tu local.</p>
                </div>
                {/* "Festival multi-día" oculto hasta la Fase 3: el pase se
                    invalidaba el primer día (scan_ticket no tiene acceso por
                    día). FestivalBuilder sigue en el repo. */}
                <div className="flex items-center gap-2">
                <Button
                  className="flex-1 md:flex-initial"
                  onClick={() => setEditor({ mode: "create" })}
                  disabled={!userId}
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
                defaultCity={partnerCtx.venue?.city || profile?.city || profile?.business_city || ""}
                defaultVenueName={partnerCtx.venue?.name || profile?.business_name || ""}
                venues={partnerCtx.venues}
                defaultVenueId={partnerCtx.venue?.id ?? null}
                onSaved={reloadEvents}
              />

              {loading ? (
                <PasifyEmptyState
                  icon={<Calendar className="h-7 w-7" />}
                  eyebrow="Cargando"
                  title="Sincronizando tus eventos…"
                  spin
                  compact
                />
              ) : loadError ? (
                // Nunca "Tu primer evento" si la carga ha fallado.
                <LoadErrorCard message={loadError} onRetry={retryLoad} retrying={reintentando} />
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
                                    {e.status === "draft" && (
                                      <DropdownMenuItem
                                        disabled={changingStatus}
                                        onClick={() => void changeEventStatus(e, "published")}
                                      >
                                        <Send className="mr-2 h-4 w-4" />
                                        Publicar
                                      </DropdownMenuItem>
                                    )}
                                    {e.status === "published" && (
                                      <>
                                        <DropdownMenuItem onClick={() => void shareEventLink(e.id, e.title)}>
                                          <Share2 className="mr-2 h-4 w-4" />
                                          Compartir enlace
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => navigate(`/e/${e.id}`)}>
                                          <ExternalLink className="mr-2 h-4 w-4" />
                                          Ver página del evento
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setQrTarget(e)}>
                                          <QrCode className="mr-2 h-4 w-4" />
                                          QR para cartel
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    {e.status === "published" && (
                                      <DropdownMenuItem onClick={() => setUnpublishTarget(e)}>
                                        <EyeOff className="mr-2 h-4 w-4" />
                                        Retirar de la venta
                                      </DropdownMenuItem>
                                    )}
                                    {(e.status === "published" || e.status === "draft") && (
                                      <DropdownMenuItem
                                        onClick={() => setCancelTarget(e)}
                                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                      >
                                        <XCircle className="mr-2 h-4 w-4" />
                                        Cancelar evento
                                      </DropdownMenuItem>
                                    )}
                                    {e.status === "cancelled" && e.tickets_sold > 0 && (
                                      <DropdownMenuItem onClick={() => setCancelTarget(e)}>
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Reintentar reembolsos
                                      </DropdownMenuItem>
                                    )}
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
                        onDelete={() => setDeleteTarget(e)}
                        onPublish={() => void changeEventStatus(e, "published")}
                        onUnpublish={() => setUnpublishTarget(e)}
                        onShare={() => void shareEventLink(e.id, e.title)}
                        onOpenPublic={() => navigate(`/e/${e.id}`)}
                        onShowQr={() => setQrTarget(e)}
                        onCancel={() => setCancelTarget(e)}
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
              {eventsGate(
                <PartnerAttendees
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    date_start: e.date_start,
                    date_end: e.date_end,
                    city: e.city,
                    capacity: e.capacity,
                    tickets_sold: e.tickets_sold,
                    status: e.status,
                  }))}
                />
              )}
            </div>
          )}

          {/* ESCÁNER — no espera a la lista de eventos: la puerta no se para */}
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
                  La cámara se activa sola. Apunta al QR de la entrada: el resultado sale a pantalla
                  completa y los accesos validados aparecen al momento en Asistentes.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/door")}>
                  <Lock className="mr-2 h-4 w-4" />
                  Modo puerta con PIN
                </Button>
              </div>
              {userId ? (
                <QRScanner
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    date_start: e.date_start,
                    date_end: e.date_end,
                    status: e.status,
                  }))}
                  eventsState={loading ? "loading" : loadError ? "error" : "ready"}
                />
              ) : (
                // Sin sesión resuelta todavía (o falló el arranque): nunca una pantalla vacía.
                eventsGate(null)
              )}
            </div>
          )}

          {/* DOOR VISION — maqueta */}
          {seccionActiva === "door_vision" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Door Vision IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de verificación en puerta.
              </p>
              <PartnerDoorVision />
            </div>
          )}

          {/* TPV — maqueta */}
          {seccionActiva === "tpv" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">TPV</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa del cierre de caja y el resumen de ventas del día.
              </p>
              <TpvCierreZ />
            </div>
          )}

          {/* CASHLESS — maqueta hasta que existan las pulseras */}
          {seccionActiva === "cashless" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Cashless</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa del pago sin efectivo en barra, por evento.
              </p>
              {eventsGate(
                <PartnerCashless
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    date_start: e.date_start,
                    date_end: e.date_end,
                    status: e.status,
                  }))}
                />
              )}
            </div>
          )}

          {/* VIP & HOSPITALITY — maqueta */}
          {seccionActiva === "vip" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">VIP & Hospitality</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de la gestión de mesas y reservados.
              </p>
              <PartnerVipHospitality />
            </div>
          )}

          {/* CRM & AUDIENCE — maqueta */}
          {seccionActiva === "crm" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">CRM & Audience</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de la base de clientes y sus segmentos.
              </p>
              <PartnerCRM />
            </div>
          )}

          {/* MARKETING ENGINE — maqueta */}
          {seccionActiva === "marketing" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Marketing</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de campañas y automatizaciones de marketing.
              </p>
              <PartnerMarketing />
            </div>
          )}

          {/* SALES CHANNELS — maqueta */}
          {seccionActiva === "channels" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Canales de venta</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa del reparto de ventas por canal.
              </p>
              <PartnerSalesChannels />
            </div>
          )}

          {/* TEAM — maqueta */}
          {seccionActiva === "team" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Equipo</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de plantilla y turnos.
              </p>
              <PartnerTeam />
            </div>
          )}

          {/* APP MARKETPLACE — maqueta */}
          {seccionActiva === "apps" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">App Marketplace</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Integraciones con herramientas externas (próximamente).
              </p>
              <PartnerAppMarketplace />
            </div>
          )}

          {/* WHITE-LABEL — maqueta */}
          {seccionActiva === "whitelabel" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">White-label</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Vista previa de la personalización con tu marca.
              </p>
              <PartnerWhiteLabel />
            </div>
          )}

          {/* INDUSTRY BENCHMARKS — maqueta */}
          {seccionActiva === "benchmarks" && (
            <div>
              <IndustryBenchmarks />
            </div>
          )}

          {/* STRIPE */}
          {seccionActiva === "stripe" && <StripeSection orgId={orgId} />}

          {/* SOPORTE */}
          {seccionActiva === "soporte" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Escríbenos y te respondemos en horario laboral.
              </p>
              <SupportChat mode="client" kind="partner" orgId={orgId} />
            </div>
          )}
          </SectionBoundary>
        </main>

        {/* Bottom tab bar mobile — primitiva compartida (MobileBottomNav).
            Labels truncadas y safe-area-inset-bottom respetado. */}
        <MobileBottomNav<Section>
          items={tabBarItems}
          activeId={seccionActiva}
          onSelect={setSection}
          drawerSlot={
            <PartnerDrawer
              navTree={navTree}
              section={seccionActiva}
              onSelect={setSection}
              onLogout={() => void handleLogout()}
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

      <EventQrDialog event={qrTarget} onOpenChange={(open) => !open && setQrTarget(null)} />
      <CancelEventDialog
        target={cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onDone={reloadEvents}
      />

      {/* Confirmación de retirar de la venta */}
      <AlertDialog
        open={unpublishTarget !== null}
        onOpenChange={(open) => !open && !changingStatus && setUnpublishTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Retirar de la venta?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-foreground">"{unpublishTarget?.title}"</span>{" "}
              dejará de verse en el calendario y no se podrán comprar más entradas. Las
              entradas ya vendidas siguen siendo válidas en la puerta. Puedes volver a
              publicarlo cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changingStatus}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                if (unpublishTarget) void changeEventStatus(unpublishTarget, "draft");
              }}
              disabled={changingStatus}
            >
              {changingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <EyeOff className="mr-2 h-4 w-4" />}
              Retirar de la venta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

const monoStyle = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** Franja fija de las secciones maqueta: nadie debe confundirlas con datos reales. */
const DemoBanner = () => (
  <div
    role="note"
    className="mb-6 flex flex-col gap-1 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
    style={{ background: "rgba(232,176,76,0.12)", borderColor: "rgba(232,176,76,0.45)" }}
  >
    <span
      className="text-[11px] font-semibold uppercase"
      style={{ ...monoStyle, letterSpacing: "0.22em", color: "#E8B04C" }}
    >
      DEMO · datos ficticios
    </span>
    <span className="text-[12px] text-muted-foreground">
      Sección de demostración: los datos que ves son de ejemplo, no de tu local.
    </span>
  </div>
);

/** Error de carga de eventos con reintento (Eventos, Métricas y secciones que dependen de ellos). */
const LoadErrorCard = ({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
    style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
  >
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
        style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)" }}
      >
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">No pudimos cargar tus eventos</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{message}</p>
      </div>
    </div>
    <Button size="sm" onClick={onRetry} disabled={retrying} className="shrink-0">
      {retrying ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCcw className="mr-2 h-3.5 w-3.5" />
      )}
      Reintentar
    </Button>
  </div>
);

/**
 * En vivo: el evento de ahora (pickActiveEvent) y, si esta noche hay más de
 * uno, un selector con los que tiene sentido mirar. El elegido va en la URL
 * (?evento=): se conserva al ir a otra sección y volver, y al recargar.
 */
const LiveSection = ({ events, partnerName }: { events: EventRow[]; partnerName: string | null }) => {
  const options = useMemo(() => listEventChoices(events), [events]);
  const [eventoUrl, setEventoUrl] = useEventoEnUrl();
  const selectedId =
    eventoUrl && options.some((e) => e.id === eventoUrl)
      ? eventoUrl
      : pickActiveEvent(events)?.id ?? options[0]?.id ?? null;
  const setSelectedId = setEventoUrl;

  const selected = options.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      {options.length > 1 && (
        <select
          value={selectedId ?? ""}
          onChange={(ev) => setSelectedId(ev.target.value || null)}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground sm:w-auto"
          aria-label="Evento"
        >
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} ·{" "}
              {new Date(e.date_start).toLocaleString("es-ES", {
                weekday: "short",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </option>
          ))}
        </select>
      )}
      <LiveWarRoom
        event={
          selected
            ? {
                id: selected.id,
                title: selected.title,
                date_start: selected.date_start,
                date_end: selected.date_end,
                capacity: selected.capacity ?? null,
                partner_name: partnerName,
              }
            : null
        }
      />
    </div>
  );
};

/**
 * Stripe: sin botones que no hacen nada. El estado "conectada" sale de la
 * organización (lo que de verdad usa el checkout), no de profiles.
 * Los datos vienen de la caché (usePartnerBalance): al volver a Cobros salen
 * al instante y se refrescan detrás.
 */
const euros = (cents: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format((cents ?? 0) / 100);

const StripeSection = ({ orgId }: { orgId: string | null }) => {
  const uid = useCurrentUserId();
  const query = usePartnerBalance(uid, orgId);
  // Sin organización no hay nada que leer: ni conectada ni ventas.
  const sinOrg = !orgId;
  const connected: boolean | null = sinOrg ? false : query.data ? query.data.connected : query.isError ? false : null;
  const balance = query.data?.balance ?? null;
  const balanceState: "loading" | "ready" | "error" = sinOrg
    ? "ready"
    : query.data
      ? "ready"
      : query.isError
        ? "error"
        : "loading";

  const rows: Array<{ label: string; value: number; sign?: "-" ; strong?: boolean }> = balance
    ? [
        { label: "Cobrado por tus entradas", value: balance.gross_cents },
        { label: "Reembolsado a compradores", value: balance.refunded_cents, sign: "-" },
        { label: "Comisión de Pasify", value: balance.fee_cents, sign: "-" },
        { label: "Neto de tus ventas", value: balance.net_cents, strong: true },
      ]
    : [];

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Cobros</h1>
        <RefreshIndicator active={query.isFetching && !!query.data} />
      </div>
      <p className="mb-6 text-sm text-muted-foreground">Cómo cobras las entradas que vendes y cuánto llevas.</p>

      <Card>
        <CardContent className="p-6">
          {connected === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando…
            </div>
          ) : connected ? (
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-6 w-6 shrink-0 text-success" />
              <p className="text-sm text-foreground">
                Tu cuenta de Stripe está conectada: lo que cobras por tus entradas va directamente a ella.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />
              <p className="text-sm text-foreground">
                Pasify cobra las entradas por ti y te liquida lo vendido por transferencia. Pronto podrás
                conectar tu propia cuenta de Stripe para cobrar directamente.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold">Tus ventas hasta hoy</h2>
          {balanceState === "loading" ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando…
            </div>
          ) : balanceState === "error" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              No hemos podido cargar tus cobros.
              <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Reintentar
              </Button>
            </div>
          ) : !balance || balance.paid_orders === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Aún no has vendido entradas. Cuando vendas, aquí verás lo cobrado, la comisión y tu neto.
            </p>
          ) : (
            <>
              <dl className="mt-4 divide-y divide-border">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between py-2.5 text-sm">
                    <dt className={r.strong ? "font-semibold text-foreground" : "text-muted-foreground"}>{r.label}</dt>
                    <dd className={`tabular-nums ${r.strong ? "text-base font-semibold text-foreground" : "text-foreground"}`}>
                      {r.sign === "-" && r.value > 0 ? "−" : ""}
                      {euros(r.value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                {balance.paid_orders} {balance.paid_orders === 1 ? "pedido pagado" : "pedidos pagados"}. El neto es
                lo que te corresponde antes de descontar las liquidaciones ya hechas. Si tienes dudas sobre una
                liquidación, escríbenos desde Soporte.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

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
            section={section}
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
