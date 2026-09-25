import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { useCajonDeNavegacion, useFocoAlTitulo, usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { signOutLocal } from "@/hooks/useAuth";
import { useCurrentUserId } from "@/lib/cache/session";
import { qk } from "@/lib/cache/keys";
import { getErrorMessage } from "@/lib/sentry";
import { isNativeApp } from "@/lib/platform";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Ban,
  Banknote,
  BarChart3,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileSearch,
  HelpCircle,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  PlayCircle,
  Receipt,
  RefreshCw,
  RotateCcw,
  Scale,
  Settings,
  Shield,
  ShieldAlert,
  Store,
  Ticket,
  Users,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Wordmark from "@/components/Wordmark";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { LivePulse } from "@/components/admin/LivePulse";
import { TrustSafetyCenter } from "@/components/admin/TrustSafetyCenter";
import { AuditTrailViewer } from "@/components/admin/AuditTrailViewer";
import { NetworkFinance } from "@/components/admin/NetworkFinance";
import { AiInsightsHub } from "@/components/admin/AiInsightsHub";
import { OrganizationsHub } from "@/components/admin/OrganizationsHub";
import { ComplianceHub } from "@/components/admin/ComplianceHub";
import { AISafetyConsole } from "@/components/admin/AISafetyConsole";
import { IndustryBenchmarks } from "@/components/admin/IndustryBenchmarks";
import { AdminRefundsQueue } from "@/components/admin/AdminRefundsQueue";
import { AdminSupportInbox } from "@/components/admin/AdminSupportInbox";
import { AdminOrders } from "@/components/admin/AdminOrders";
import { AdminSettlements } from "@/components/admin/AdminSettlements";
import { OrgEstado, OrgSuspensionDialog, type SuspensionTarget } from "@/components/admin/AdminOrgSuspension";
import {
  AdminAttendeesDialog,
  AdminCancelEventDialog,
  type EventoCancelable,
  type EventoRef,
} from "@/components/admin/AdminEventTools";
import { DemoBanner } from "@/components/admin/AdminDemo";
import {
  orgSuspendida,
  useAdminEvents,
  useAdminKpis,
  useAdminPartnerOrgs,
  useAdminRealtime,
  useAdminRefundCounts,
  useAdminShowcase,
  useAdminSupportUnread,
  useAdminUserFacets,
  useAdminUsers,
  type AdminEventRow,
  type AdminPartnerOrg,
  type AdminUserRow,
} from "@/components/admin/adminQueries";
import { NavTree, type NavTreeNode } from "@/components/shared/NavTree";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SettingsSheet } from "@/components/shared/SettingsSheet";
import { HelpSheet } from "@/components/shared/HelpSheet";
import { MobileTopBar } from "@/components/shared/MobileTopBar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";

type Section =
  | "metricas"
  | "orgs"
  | "locales"
  | "clientes"
  | "eventos"
  | "pedidos"
  | "liquidaciones"
  | "finance"
  | "ai"
  | "ai_safety"
  | "benchmarks"
  | "trust"
  | "compliance"
  | "auditoria"
  | "refunds"
  | "soporte";

/**
 * Módulos maqueta (decisión D-7: no se borran, pero solo en modo demo).
 *   - En la app nativa no existen nunca (directriz 2.1(a) de Apple).
 *   - En la web solo los ve un admin con el flag admin_showcase encendido
 *     para su uid (get_feature_flag con el uid como "organización"),
 *     apagado por defecto.
 *   - Cuando se ven, llevan arriba la franja "DEMO · datos ficticios" y sus
 *     botones sin efecto van desactivados con el rótulo "Demo".
 * Live Pulse (en Métricas) sigue la misma regla.
 */
const SECCIONES_DEMO = new Set<Section>(["orgs", "finance", "ai", "ai_safety", "benchmarks", "trust", "compliance"]);

/** Título de la pestaña en cada sección («Pedidos · Pasify»). */
const TITULO_SECCION: Record<Section, string> = {
  metricas: "Métricas",
  orgs: "Organizaciones",
  locales: "Locales",
  clientes: "Clientes",
  eventos: "Eventos",
  pedidos: "Pedidos",
  liquidaciones: "Liquidaciones",
  finance: "Finanzas",
  ai: "AI Insights",
  ai_safety: "AI Safety",
  benchmarks: "Benchmarks",
  trust: "Trust & Safety",
  compliance: "Compliance",
  auditoria: "Auditoría",
  refunds: "Reembolsos",
  soporte: "Soporte",
};

const PAGE_SIZE = 25;
const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const AdminDashboard = () => {
  const navigate = useNavigate();
  const uid = useCurrentUserId();
  const [section, setSection] = useState<Section>("metricas");

  const enApp = isNativeApp();
  const showcase = useAdminShowcase(uid, !enApp).data === true && !enApp;
  const seccionVisible = (id: Section) => !SECCIONES_DEMO.has(id) || showcase;
  // Un enlace o un estado anterior que apunte a un módulo demo sin el flag
  // cae a Métricas en vez de pintar una maqueta.
  const seccionActiva: Section = seccionVisible(section) ? section : "metricas";

  // Título de la pestaña y, al cambiar de sección, el foco a su h1 (lector
  // de pantalla y teclado). «Saltar al contenido» lleva al mismo <main>.
  const mainRef = useRef<HTMLElement>(null);
  usePageTitle(TITULO_SECCION[seccionActiva]);
  useFocoAlTitulo(seccionActiva, mainRef);

  // Tiempo real del panel (bandeja de soporte y cola de reembolsos) y los
  // contadores del menú, que salen del servidor.
  useAdminRealtime(uid);
  const noLeidos = useAdminSupportUnread(uid);
  const reembolsos = useAdminRefundCounts(uid);
  const totalUnread = noLeidos.data?.messages ?? 0;
  const reembolsosPorAtender = (reembolsos.data?.pending ?? 0) + (reembolsos.data?.attention ?? 0);
  const badgeFor = (id: Section) =>
    id === "soporte" ? totalUnread : id === "refunds" ? reembolsosPorAtender : undefined;

  const handleLogout = async () => {
    await signOutLocal();
    navigate("/");
  };

  // Búsqueda de Pedidos: se conserva al cambiar de sección, y Soporte la
  // rellena con el email de quien escribe («Sus pedidos»).
  const [pedidosTexto, setPedidosTexto] = useState("");
  const buscarPedidos = (email: string) => {
    setPedidosTexto(email);
    setSection("pedidos");
  };

  // Mobile Settings/Help sheets — state lifted al padre.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Árbol de navegación. Los módulos maqueta solo aparecen en modo demo.
  const navTree = useMemo<NavTreeNode<Section>[]>(() => {
    const demo = (label: string) => `${label} · demo`;
    const tree: NavTreeNode<Section>[] = [
      { kind: "item", id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
      {
        kind: "group",
        id: "directory",
        label: "Directorio",
        icon: <Network className="h-5 w-5" />,
        children: [
          ...(showcase ? [{ id: "orgs" as const, label: demo("Organizaciones"), icon: <Network className="h-4 w-4" /> }] : []),
          { id: "locales", label: "Locales", icon: <Store className="h-4 w-4" /> },
          { id: "clientes", label: "Clientes", icon: <Users className="h-4 w-4" /> },
        ],
      },
      { kind: "item", id: "eventos", label: "Eventos", icon: <Calendar className="h-5 w-5" /> },
      { kind: "item", id: "pedidos", label: "Pedidos", icon: <Receipt className="h-5 w-5" /> },
      { kind: "item", id: "liquidaciones", label: "Liquidaciones", icon: <Banknote className="h-5 w-5" /> },
    ];
    if (showcase) {
      tree.push(
        { kind: "item", id: "finance", label: demo("Finanzas"), icon: <Landmark className="h-5 w-5" /> },
        {
          kind: "group",
          id: "intelligence",
          label: demo("Inteligencia"),
          icon: <Brain className="h-5 w-5" />,
          children: [
            { id: "ai", label: "AI Insights", icon: <Brain className="h-4 w-4" /> },
            { id: "ai_safety", label: "AI Safety", icon: <ShieldAlert className="h-4 w-4" /> },
            { id: "benchmarks", label: "Benchmarks", icon: <BarChart3 className="h-4 w-4" /> },
          ],
        },
      );
    }
    tree.push(
      {
        kind: "group",
        id: "governance",
        label: "Gobierno",
        icon: <Scale className="h-5 w-5" />,
        children: [
          { id: "refunds", label: "Reembolsos", icon: <RotateCcw className="h-4 w-4" /> },
          { id: "auditoria", label: "Auditoría", icon: <FileSearch className="h-4 w-4" /> },
          ...(showcase
            ? [
                { id: "trust" as const, label: demo("Trust & Safety"), icon: <Shield className="h-4 w-4" /> },
                { id: "compliance" as const, label: demo("Compliance"), icon: <Scale className="h-4 w-4" /> },
              ]
            : []),
        ],
      },
      { kind: "item", id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
    );
    return tree;
  }, [showcase]);

  // Bottom tab bar mobile — 4 entradas más usadas (el día a día de soporte);
  // el resto via drawer "Más".
  const tabBarItems: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
    { id: "pedidos", label: "Pedidos", icon: <Receipt className="h-5 w-5" /> },
    { id: "refunds", label: "Reembolsos", icon: <RotateCcw className="h-5 w-5" /> },
    { id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Lo primero con el teclado: salta el menú y va al contenido. */}
      <a
        href="#contenido"
        className="saltar-al-contenido"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar: fija al hacer scroll (su menú scrollea dentro). */}
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:sticky md:top-0 md:flex md:h-screen md:flex-col">
          <div className="flex flex-col items-start gap-3 border-b border-border p-5">
            <Wordmark height={84} />
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary">
                Admin
              </Badge>
              {showcase && (
                <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                  Modo demo
                </Badge>
              )}
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-3">
            <NavTree<Section> tree={navTree} section={seccionActiva} onSelect={setSection} badgeFor={badgeFor} />
          </nav>

          {/* Configuración y Ayuda también en escritorio (antes solo desde el cajón del móvil). */}
          <div className="space-y-1 border-t border-border p-3">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setSettingsOpen(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Configuración
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setHelpOpen(true)}>
              <HelpCircle className="mr-2 h-4 w-4" />
              Ayuda y docs
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </aside>

        {/* Mobile top app bar — primitiva compartida (MobileTopBar). */}
        <MobileTopBar
          role="admin"
          endSlot={
            <AdminDrawer
              navTree={navTree}
              section={seccionActiva}
              onSelect={setSection}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              badgeFor={badgeFor}
            />
          }
        />

        {/* Main content */}
        <main id="contenido" ref={mainRef} tabIndex={-1} className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
          {SECCIONES_DEMO.has(seccionActiva) && <DemoBanner />}

          {seccionActiva === "metricas" && (
            <MetricsSection
              uid={uid}
              showcase={showcase}
              unread={noLeidos.data?.messages ?? null}
              refundsPending={reembolsos.data?.pending ?? null}
              refundsAttention={reembolsos.data?.attention ?? null}
              onGo={setSection}
            />
          )}

          {seccionActiva === "locales" && <LocalesSection uid={uid} />}

          {seccionActiva === "clientes" && <ClientesSection uid={uid} />}

          {seccionActiva === "eventos" && <EventosSection uid={uid} />}

          {seccionActiva === "pedidos" && <AdminOrders uid={uid} texto={pedidosTexto} onTexto={setPedidosTexto} />}

          {seccionActiva === "liquidaciones" && <AdminSettlements uid={uid} />}

          {seccionActiva === "finance" && <NetworkFinance />}

          {seccionActiva === "ai" && <AiInsightsHub />}

          {seccionActiva === "ai_safety" && <AISafetyConsole />}

          {seccionActiva === "benchmarks" && <IndustryBenchmarks />}

          {seccionActiva === "orgs" && <OrganizationsHub />}

          {seccionActiva === "compliance" && <ComplianceHub />}

          {seccionActiva === "trust" && <TrustSafetyCenter />}

          {seccionActiva === "auditoria" && <AuditTrailViewer />}

          {seccionActiva === "refunds" && <AdminRefundsQueue uid={uid} />}

          {seccionActiva === "soporte" && <AdminSupportInbox uid={uid} onBuscarPedidos={buscarPedidos} />}
        </main>

        {/* Mobile bottom tab bar — primitiva compartida (MobileBottomNav).
            Los contadores de Soporte y Reembolsos salen del servidor. */}
        <MobileBottomNav<Section>
          items={tabBarItems.map((item) => ({ ...item, badge: badgeFor(item.id) }))}
          activeId={seccionActiva}
          onSelect={setSection}
          drawerSlot={
            <AdminDrawer
              navTree={navTree}
              section={seccionActiva}
              onSelect={setSection}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              badgeFor={badgeFor}
              variant="tab"
            />
          }
        />
      </div>

      {/* Sheets globales — abiertos desde el drawer */}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        role="admin"
        email={null}
        displayName="Pasify Admin"
      />
      <HelpSheet
        open={helpOpen}
        onOpenChange={setHelpOpen}
        role="admin"
        onOpenSupport={() => setSection("soporte")}
      />
    </div>
  );
};

// ============================================================================
// Métricas: datos reales (v_admin_platform_kpis) y lo que espera al admin
// ============================================================================

const MetricsSection = ({
  uid,
  showcase,
  unread,
  refundsPending,
  refundsAttention,
  onGo,
}: {
  uid: string | null;
  showcase: boolean;
  /** null mientras no se sabe: «—», no un 0 que no es verdad. */
  unread: number | null;
  refundsPending: number | null;
  refundsAttention: number | null;
  onGo: (s: Section) => void;
}) => {
  const kpis = useAdminKpis(uid);
  const k = kpis.data;
  return (
    <div>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Métricas</h1>
      <p className="mb-6 text-sm text-muted-foreground">Resumen de la plataforma Pasify con datos reales.</p>

      {showcase && (
        <>
          <DemoBanner>Live Pulse es una maqueta con cifras inventadas. Las tarjetas de debajo son reales.</DemoBanner>
          <LivePulse />
        </>
      )}

      {kpis.isError && (
        <ErrorCard
          mensaje={`No se han podido cargar las métricas: ${getErrorMessage(kpis.error)}`}
          onRetry={() => void kpis.refetch()}
        />
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Store className="h-5 w-5" />} label="Locales" value={k?.partners ?? null} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Clientes" value={k?.clients ?? null} />
        <StatCard icon={<Calendar className="h-5 w-5" />} label="Eventos publicados" value={k?.publishedEvents ?? null} />
        <StatCard
          icon={<Ticket className="h-5 w-5" />}
          label="Entradas vendidas"
          value={k?.ticketsSold ?? null}
          sub="Pagadas, incluidas las ya usadas en puerta"
        />
      </div>

      <h2
        className="mb-3 mt-8 text-[11px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.2em" }}
      >
        Pendiente
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PendingCard
          icon={<RotateCcw className="h-5 w-5" />}
          label="Reembolsos por revisar"
          value={refundsPending}
          onClick={() => onGo("refunds")}
        />
        <PendingCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Reembolsos con incidencia"
          value={refundsAttention}
          alert
          onClick={() => onGo("refunds")}
        />
        <PendingCard
          icon={<MessageCircle className="h-5 w-5" />}
          label="Mensajes de soporte sin leer"
          value={unread}
          onClick={() => onGo("soporte")}
        />
      </div>

      <p className="mt-8 max-w-2xl text-xs text-muted-foreground">
        Lo cobrado, las comisiones y lo que se debe a cada local está en{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onGo("liquidaciones")}>
          Liquidaciones
        </button>
        , sin pagos de prueba de Stripe. Las entradas vendidas de arriba sí incluyen las de pedidos de prueba.
      </p>
    </div>
  );
};

const StatCard = ({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  sub?: string;
}) => (
  <Card>
    <CardContent className="p-5">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-3xl font-bold">{value === null ? "—" : value.toLocaleString("es-ES")}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </CardContent>
  </Card>
);

const PendingCard = ({
  icon,
  label,
  value,
  alert,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  alert?: boolean;
  onClick: () => void;
}) => {
  const activo = (value ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-5 text-left transition hover:bg-muted/40"
      style={{ borderColor: activo && alert ? "rgba(229,72,77,0.5)" : "hsl(var(--border))" }}
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className="text-2xl font-bold"
        style={{ color: activo ? (alert ? "#E5484D" : "#FF7A4D") : undefined }}
      >
        {value === null ? "—" : value.toLocaleString("es-ES")}
      </span>
    </button>
  );
};

// ============================================================================
// Locales y Clientes: admin_list_users, filtrado y paginado en el servidor
// ============================================================================

/** Lo tecleado en el buscador, 300 ms después de dejar de escribir. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface LocalFilter {
  search: string;
  category: string;
  city: string;
  status: string;
}

const SIN_FILTROS: LocalFilter = { search: "", category: "all", city: "all", status: "all" };

const LocalesSection = ({ uid }: { uid: string | null }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LocalFilter>(SIN_FILTROS);
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const search = useDebounced(filter.search);
  // Otro filtro, otra búsqueda: de vuelta a la primera página.
  const cambiarFiltro = (f: LocalFilter) => {
    setFilter(f);
    setPage(0);
  };

  const locales = useAdminUsers(uid, {
    role: "partner",
    search,
    status: filter.status === "all" ? null : filter.status,
    city: filter.city === "all" ? null : filter.city,
    category: filter.category === "all" ? null : filter.category,
    page,
    pageSize: PAGE_SIZE,
  });
  const facets = useAdminUserFacets(uid, "partner");
  const rows = useMemo(() => locales.data?.rows ?? [], [locales.data]);
  const total = locales.data?.total ?? 0;

  // Organizaciones de los locales de esta página: suspender es de la
  // organización (organizations.owner_id), no de la cuenta.
  const orgs = useAdminPartnerOrgs(
    uid,
    rows.map((r) => r.id),
  );
  const orgsPorDueno = useMemo(() => {
    const m = new Map<string, AdminPartnerOrg[]>();
    for (const o of orgs.data ?? []) m.set(o.owner_id, [...(m.get(o.owner_id) ?? []), o]);
    return m;
  }, [orgs.data]);
  const [suspension, setSuspension] = useState<SuspensionTarget | null>(null);

  // Aprobar o rechazar puede vaciar la última página de un filtro: a la anterior.
  const paginaVacia = !locales.isFetching && !!locales.data && locales.data.rows.length === 0 && page > 0;
  useEffect(() => {
    if (paginaVacia) setPage((p) => Math.max(0, p - 1));
  }, [paginaVacia]);
  const hayFiltros =
    !!filter.search || filter.category !== "all" || filter.city !== "all" || filter.status !== "all";

  const refrescarLocales = () => {
    if (!uid) return;
    void queryClient.invalidateQueries({ queryKey: qk.admin.users(uid) });
    void queryClient.invalidateQueries({ queryKey: qk.admin.partnerOrgs(uid) });
    // Suspender oculta sus eventos y bloquea su liquidación.
    void queryClient.invalidateQueries({ queryKey: qk.admin.eventsAll(uid) });
    void queryClient.invalidateQueries({ queryKey: qk.admin.settlements(uid) });
  };

  const updateLocaleStatus = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ account_status: status }).eq("id", id);
    setBusyId(null);
    if (error) {
      toast({ title: "No se ha podido cambiar el estado", description: error.message, variant: "destructive" });
      return;
    }
    // Rechazar la cuenta no para a un local que ya vende: eso es Suspender.
    const vende = (orgsPorDueno.get(id) ?? []).some((o) => o.status === "active" && !orgSuspendida(o));
    toast({
      title: status === "approved" ? "Local aprobado" : "Local rechazado",
      description:
        status === "rejected" && vende
          ? "Rechazar la cuenta no detiene sus ventas: para pararlas, usa «Suspender»."
          : undefined,
    });
    if (uid) void queryClient.invalidateQueries({ queryKey: qk.admin.users(uid) });
  };

  return (
    <SectionShell
      title="Locales"
      subtitle="Aprobación de las cuentas de local. Para parar las ventas de un local, «Suspender»: rechazar la cuenta no las para."
    >
      <PartnerFilters
        filter={filter}
        onChange={cambiarFiltro}
        total={locales.data ? total : null}
        loading={locales.isFetching}
        cities={facets.data?.cities ?? []}
        categories={facets.data?.categories ?? []}
        hayFiltros={hayFiltros}
      />
      {locales.isError ? (
        <ErrorCard
          mensaje={`No se han podido cargar los locales: ${getErrorMessage(locales.error)}`}
          onRetry={() => void locales.refetch()}
        />
      ) : locales.isPending ? (
        <PasifyEmptyState icon={<Store className="h-7 w-7" />} eyebrow="Cargando" title="Cargando locales…" spin compact />
      ) : rows.length === 0 ? (
        hayFiltros ? (
          <PasifyEmptyState
            icon={<Store className="h-7 w-7" />}
            eyebrow="Sin resultados"
            title="Nada coincide con los filtros."
            subtitle="Prueba a limpiar la búsqueda o cambiar las opciones."
            action={{ label: "Limpiar filtros", onClick: () => cambiarFiltro(SIN_FILTROS) }}
            compact
          />
        ) : (
          <PasifyEmptyState
            icon={<Store className="h-7 w-7" />}
            eyebrow="Sin locales"
            title="Aún no hay locales registrados."
            subtitle="Cuando los partners se den de alta aparecerán aquí con su estado."
            compact
          />
        )
      ) : (
        <>
          {orgs.isError && (
            <ErrorCard
              mensaje={`No se ha podido leer la organización de cada local (suspender no está disponible): ${getErrorMessage(orgs.error)}`}
              onRetry={() => void orgs.refetch()}
            />
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Local</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => {
                const suyas = orgsPorDueno.get(l.id) ?? [];
                const varias = suyas.length > 1;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{nombreLocal(l)}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{l.business_category ?? "—"}</TableCell>
                    <TableCell>{l.city ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{l.email ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.account_status} />
                      {suyas.map((o) => (
                        <OrgEstado key={o.org_id} org={o} varias={varias} />
                      ))}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Acciones de la fila: 44 px de alto en móvil (zona táctil). */}
                      <div className="flex flex-wrap justify-end gap-2 [&>button]:max-md:h-11">
                        {l.account_status !== "approved" && (
                          <Button
                            size="sm"
                            variant="default"
                            disabled={busyId === l.id}
                            onClick={() => void updateLocaleStatus(l.id, "approved")}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Aprobar
                          </Button>
                        )}
                        {l.account_status !== "rejected" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === l.id}
                            onClick={() => void updateLocaleStatus(l.id, "rejected")}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            Rechazar
                          </Button>
                        )}
                        {suyas
                          .filter((o) => o.status !== "closed")
                          .map((o) =>
                            orgSuspendida(o) ? (
                              <Button
                                key={o.org_id}
                                size="sm"
                                variant="outline"
                                onClick={() => setSuspension({ org: o, suspender: false })}
                              >
                                <PlayCircle className="mr-1 h-3.5 w-3.5" />
                                {varias ? `Reactivar «${o.name}»` : "Reactivar"}
                              </Button>
                            ) : (
                              <Button
                                key={o.org_id}
                                size="sm"
                                variant="outline"
                                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setSuspension({ org: o, suspender: true })}
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" />
                                {varias ? `Suspender «${o.name}»` : "Suspender"}
                              </Button>
                            ),
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Paginador page={page} total={total} onPage={setPage} cargando={locales.isFetching} />
        </>
      )}
      <OrgSuspensionDialog target={suspension} onClose={() => setSuspension(null)} onDone={refrescarLocales} />
    </SectionShell>
  );
};

const nombreLocal = (l: AdminUserRow) =>
  l.business_name || `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "—";

const ClientesSection = ({ uid }: { uid: string | null }) => {
  const [texto, setTexto] = useState("");
  const [page, setPage] = useState(0);
  const search = useDebounced(texto);

  const clientes = useAdminUsers(uid, {
    role: "client",
    search,
    status: null,
    city: null,
    category: null,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = clientes.data?.rows ?? [];
  const total = clientes.data?.total ?? 0;

  return (
    <SectionShell title="Clientes" subtitle="Usuarios que han comprado o pueden comprar entradas.">
      <div className="border-b border-border p-3 md:p-4">
        <Input
          placeholder="Buscar por nombre o email…"
          aria-label="Buscar clientes por nombre o email"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setPage(0);
          }}
          className="h-10 rounded-xl max-md:h-11"
        />
      </div>
      {clientes.isError ? (
        <ErrorCard
          mensaje={`No se han podido cargar los clientes: ${getErrorMessage(clientes.error)}`}
          onRetry={() => void clientes.refetch()}
        />
      ) : clientes.isPending ? (
        <PasifyEmptyState icon={<Users className="h-7 w-7" />} eyebrow="Cargando" title="Cargando clientes…" spin compact />
      ) : rows.length === 0 ? (
        <PasifyEmptyState
          icon={<Users className="h-7 w-7" />}
          eyebrow={search ? "Sin resultados" : "Sin clientes"}
          title={search ? "Nadie coincide con la búsqueda." : "Aún no hay clientes registrados."}
          subtitle={search ? undefined : "Cuando los usuarios creen su cuenta aparecerán aquí, los más recientes primero."}
          compact
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Registrado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell>{c.city ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("es-ES")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginador page={page} total={total} onPage={setPage} cargando={clientes.isFetching} />
        </>
      )}
    </SectionShell>
  );
};

// ============================================================================
// Eventos (todos, paginados)
// ============================================================================

const EventosSection = ({ uid }: { uid: string | null }) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [asistentes, setAsistentes] = useState<EventoRef | null>(null);
  const [cancelando, setCancelando] = useState<EventoCancelable | null>(null);
  const eventos = useAdminEvents(uid, page, PAGE_SIZE);
  const rows = eventos.data?.rows ?? [];
  const total = eventos.data?.total ?? 0;

  // Cancelar mueve el evento, las entradas, la cola de reembolsos y los saldos.
  const refrescar = () => {
    if (!uid) return;
    for (const key of [
      qk.admin.eventsAll(uid),
      qk.admin.refundQueue(uid),
      qk.admin.kpis(uid),
      qk.admin.orders(uid),
      qk.admin.settlements(uid),
      qk.admin.eventAttendees(uid, cancelando?.id ?? ""),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const cancelable = (e: AdminEventRow): EventoCancelable => ({
    id: e.id,
    title: e.title,
    status: e.status,
    date_start: e.date_start,
    date_end: e.date_end,
    tickets_sold: e.tickets_sold,
  });

  return (
    <SectionShell title="Eventos" subtitle="Eventos de los locales en Pasify, los más recientes primero.">
      {eventos.isError ? (
        <ErrorCard
          mensaje={`No se han podido cargar los eventos: ${getErrorMessage(eventos.error)}`}
          onRetry={() => void eventos.refetch()}
        />
      ) : eventos.isPending ? (
        <PasifyEmptyState icon={<Calendar className="h-7 w-7" />} eyebrow="Cargando" title="Cargando eventos…" spin compact />
      ) : rows.length === 0 ? (
        <PasifyEmptyState
          icon={<Calendar className="h-7 w-7" />}
          eyebrow="Sin eventos"
          title="Aún no hay eventos."
          subtitle="Los eventos que creen los locales aparecerán aquí."
          compact
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Evento</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Precio desde</TableHead>
                <TableHead>Vendidas</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell className="text-muted-foreground">{e.localName ?? "—"}</TableCell>
                  <TableCell>{e.city}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(e.date_start).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>{(e.price_cents / 100).toFixed(2)} €</TableCell>
                  <TableCell>
                    {e.tickets_sold}
                    {e.capacity ? <span className="text-muted-foreground"> / {e.capacity}</span> : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={e.status} />
                      {e.orgSuspended && (
                        <Badge
                          variant="outline"
                          className="border-destructive/30 bg-destructive/15 text-destructive"
                          title="Su local está suspendido: el evento no se ve ni se vende"
                        >
                          Local suspendido
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="max-md:h-11 max-md:w-11"
                          aria-label={`Acciones de ${e.title}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a href={`#/e/${e.id}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Ficha pública
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAsistentes({ id: e.id, title: e.title })}>
                          <Users className="mr-2 h-4 w-4" />
                          Asistentes
                        </DropdownMenuItem>
                        {(e.status === "published" || e.status === "draft") && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setCancelando(cancelable(e))}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancelar y reembolsar
                            </DropdownMenuItem>
                          </>
                        )}
                        {e.status === "cancelled" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setCancelando(cancelable(e))}>
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Reintentar reembolsos
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginador page={page} total={total} onPage={setPage} cargando={eventos.isFetching} />
        </>
      )}
      <AdminAttendeesDialog uid={uid} event={asistentes} onClose={() => setAsistentes(null)} />
      <AdminCancelEventDialog event={cancelando} onClose={() => setCancelando(null)} onDone={refrescar} />
    </SectionShell>
  );
};

// ============================================================================
// Piezas comunes
// ============================================================================

const SectionShell = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <div>
    <h1 className="mb-1 text-3xl font-bold tracking-tight">{title}</h1>
    {subtitle && <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>}
    <Card>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  </div>
);

const Paginador = ({
  page,
  total,
  onPage,
  cargando,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
  cargando?: boolean;
}) => {
  const desde = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const hasta = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div
      className="flex items-center justify-between border-t border-border px-4 py-3 text-[11px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.14em" }}
    >
      <span className="inline-flex items-center gap-2">
        {desde}–{hasta} de {total.toLocaleString("es-ES")}
        {cargando && <RefreshCw className="h-3 w-3 animate-spin" />}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-11"
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-11"
          disabled={hasta >= total}
          onClick={() => onPage(page + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
};

const ErrorCard = ({ mensaje, onRetry }: { mensaje: string; onRetry: () => void }) => (
  <div
    role="alert"
    className="m-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
    style={{ borderColor: "rgba(229,72,77,0.45)", background: "rgba(229,72,77,0.06)" }}
  >
    <span className="flex items-start gap-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      {mensaje}
    </span>
    <Button variant="outline" size="sm" className="max-md:h-11" onClick={onRetry}>
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      Reintentar
    </Button>
  </div>
);

// ============================================================================
// AdminDrawer — Sheet lateral con todas las secciones (sidebar mobile).
// Mismo patrón que PartnerDrawer/ClientDrawer; reusa NavTree.
// ============================================================================

const adminDrawerMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const AdminDrawer = ({
  navTree,
  section,
  onSelect,
  onLogout,
  onOpenSettings,
  onOpenHelp,
  badgeFor,
  variant = "topbar",
}: {
  navTree: NavTreeNode<Section>[];
  section: Section;
  onSelect: (id: Section) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  badgeFor: (id: Section) => number | undefined;
  variant?: "topbar" | "tab";
}) => {
  const [open, setOpen] = useState(false);
  // Al cambiar de sección desde el cajón, el foco va al título de la nueva.
  const cajon = useCajonDeNavegacion(section);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {variant === "tab" ? (
          <button
            className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[10px] font-medium transition ${
              open ? "text-primary" : "text-muted-foreground"
            }`}
            aria-label="Más opciones"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="leading-none">Más</span>
          </button>
        ) : (
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-[88vw] max-w-sm flex-col gap-0 border-l border-border bg-card p-0"
        aria-describedby={undefined}
        {...cajon}
      >
        <header className="border-b border-border p-5">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...adminDrawerMono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Pasify · Admin
          </div>
          {/* Nombre del diálogo para el lector de pantalla. */}
          <SheetTitle className="tracking-tight">Plataforma</SheetTitle>
        </header>

        <nav className="flex-1 overflow-y-auto p-3">
          <div
            className="mb-2 px-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...adminDrawerMono, letterSpacing: "0.18em" }}
          >
            Secciones
          </div>
          <NavTree<Section>
            tree={navTree}
            section={section}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
            badgeFor={badgeFor}
          />

          <div
            className="mb-2 mt-6 px-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...adminDrawerMono, letterSpacing: "0.18em" }}
          >
            Cuenta
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="group flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
              className="group flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setTimeout(onOpenHelp, 120);
              }}
            >
              <HelpCircle className="h-5 w-5" />
              <span className="flex-1 text-left">Ayuda y docs</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/70 transition group-hover:text-foreground" />
            </button>
          </div>
        </nav>

        <footer className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-full justify-start"
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

const StatusBadge = ({ status }: { status: string }) => {
  const variant: Record<string, { label: string; cls: string }> = {
    approved: { label: "Aprobado", cls: "bg-success/15 text-success border-success/30" },
    pending: { label: "Pendiente", cls: "bg-warning/15 text-warning border-warning/30" },
    rejected: { label: "Rechazado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    published: { label: "Publicado", cls: "bg-success/15 text-success border-success/30" },
    draft: { label: "Borrador", cls: "bg-muted text-muted-foreground border-border" },
    cancelled: { label: "Cancelado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    past: { label: "Pasado", cls: "bg-muted text-muted-foreground border-border" },
  };
  const v = variant[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge variant="outline" className={v.cls}>
      {v.label}
    </Badge>
  );
};

// ============================================================================
// Filtros de Locales (búsqueda + categoría + ciudad + estado), en el servidor
// ============================================================================

const filterMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const PartnerFilters = ({
  filter,
  onChange,
  total,
  loading,
  cities,
  categories,
  hayFiltros,
}: {
  filter: LocalFilter;
  onChange: (f: LocalFilter) => void;
  /** null en la primera carga: no se enseña un «0 locales» que no es verdad. */
  total: number | null;
  loading: boolean;
  cities: string[];
  categories: string[];
  hayFiltros: boolean;
}) => {
  const update = <K extends keyof LocalFilter>(k: K, v: LocalFilter[K]) => onChange({ ...filter, [k]: v });
  return (
    <div className="border-b border-border p-3 md:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Input
            placeholder="Buscar local, contacto o email…"
            aria-label="Buscar local, contacto o email"
            value={filter.search}
            onChange={(e) => update("search", e.target.value)}
            className="h-10 rounded-xl max-md:h-11"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 md:flex md:gap-2">
          <Select value={filter.category} onValueChange={(v) => update("category", v)}>
            <SelectTrigger className="h-10 rounded-xl max-md:h-11">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda categoría</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.city} onValueChange={(v) => update("city", v)}>
            <SelectTrigger className="h-10 rounded-xl max-md:h-11">
              <SelectValue placeholder="Ciudad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda ciudad</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.status} onValueChange={(v) => update("status", v)}>
            <SelectTrigger className="h-10 rounded-xl max-md:h-11">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo estado</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="approved">Aprobado</SelectItem>
              <SelectItem value="rejected">Rechazado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div
        className="mt-3 flex items-center justify-between text-[10px] uppercase text-muted-foreground"
        style={{ ...filterMono, letterSpacing: "0.18em" }}
      >
        <span className="inline-flex items-center gap-2">
          {total === null
            ? loading
              ? "Cargando locales"
              : "—"
            : `${total.toLocaleString("es-ES")} ${total === 1 ? "local" : "locales"}`}
          {total !== null && hayFiltros ? " con estos filtros" : ""}
          {loading && <RefreshCw className="h-3 w-3 animate-spin" />}
        </span>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => onChange(SIN_FILTROS)}
            className="rounded-full border border-border px-2.5 py-1 text-orange-500 transition hover:border-orange-500/40 max-md:min-h-[44px] max-md:px-4"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Las animaciones de framer-motion del panel (hojas inferiores) respetan
 * «reducir movimiento» del sistema. Sobra si App.tsx pone el mismo
 * MotionConfig en la raíz.
 */
const AdminDashboardConMovimientoReducido = () => (
  <MotionConfig reducedMotion="user">
    <AdminDashboard />
  </MotionConfig>
);

export default AdminDashboardConMovimientoReducido;
