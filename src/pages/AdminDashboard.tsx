import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
  BarChart3,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  HelpCircle,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
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
import { DemoBanner } from "@/components/admin/AdminDemo";
import {
  useAdminEvents,
  useAdminKpis,
  useAdminRealtime,
  useAdminRefundCounts,
  useAdminShowcase,
  useAdminSupportUnread,
  useAdminUserFacets,
  useAdminUsers,
  type AdminUserRow,
} from "@/components/admin/adminQueries";
import { NavTree, type NavTreeNode } from "@/components/shared/NavTree";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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

  // Bottom tab bar mobile — 4 entradas más usadas; el resto via drawer "Más".
  const tabBarItems: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
    { id: "eventos", label: "Eventos", icon: <Calendar className="h-5 w-5" /> },
    { id: "refunds", label: "Reembolsos", icon: <RotateCcw className="h-5 w-5" /> },
    { id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar */}
        <aside className="hidden w-60 border-r border-border bg-card md:flex md:flex-col">
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

          <div className="border-t border-border p-3">
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
        <main className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
          {SECCIONES_DEMO.has(seccionActiva) && <DemoBanner />}

          {seccionActiva === "metricas" && (
            <MetricsSection
              uid={uid}
              showcase={showcase}
              unread={totalUnread}
              refundsPending={reembolsos.data?.pending ?? null}
              refundsAttention={reembolsos.data?.attention ?? null}
              onGo={setSection}
            />
          )}

          {seccionActiva === "locales" && <LocalesSection uid={uid} />}

          {seccionActiva === "clientes" && <ClientesSection uid={uid} />}

          {seccionActiva === "eventos" && <EventosSection uid={uid} />}

          {seccionActiva === "finance" && <NetworkFinance />}

          {seccionActiva === "ai" && <AiInsightsHub />}

          {seccionActiva === "ai_safety" && <AISafetyConsole />}

          {seccionActiva === "benchmarks" && <IndustryBenchmarks />}

          {seccionActiva === "orgs" && <OrganizationsHub />}

          {seccionActiva === "compliance" && <ComplianceHub />}

          {seccionActiva === "trust" && <TrustSafetyCenter />}

          {seccionActiva === "auditoria" && <AuditTrailViewer />}

          {seccionActiva === "refunds" && <AdminRefundsQueue uid={uid} />}

          {seccionActiva === "soporte" && <AdminSupportInbox uid={uid} />}
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
  unread: number;
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
        Las finanzas de la red (volumen de ventas, comisiones y liquidaciones) llegan en una próxima versión: hoy el
        panel no enseña ninguna cifra económica. Las entradas vendidas incluyen las de pedidos de prueba de Stripe.
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
  const rows = locales.data?.rows ?? [];
  const total = locales.data?.total ?? 0;

  // Aprobar o rechazar puede vaciar la última página de un filtro: a la anterior.
  const paginaVacia = !locales.isFetching && !!locales.data && locales.data.rows.length === 0 && page > 0;
  useEffect(() => {
    if (paginaVacia) setPage((p) => Math.max(0, p - 1));
  }, [paginaVacia]);
  const hayFiltros =
    !!filter.search || filter.category !== "all" || filter.city !== "all" || filter.status !== "all";

  const updateLocaleStatus = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ account_status: status }).eq("id", id);
    setBusyId(null);
    if (error) {
      toast({ title: "No se ha podido cambiar el estado", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "approved" ? "Local aprobado" : "Local rechazado" });
    if (uid) void queryClient.invalidateQueries({ queryKey: qk.admin.users(uid) });
  };

  return (
    <SectionShell title="Locales" subtitle="Gestión y aprobación de locales registrados.">
      <PartnerFilters
        filter={filter}
        onChange={cambiarFiltro}
        total={total}
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
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{nombreLocal(l)}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{l.business_category ?? "—"}</TableCell>
                  <TableCell>{l.city ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.email ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={l.account_status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {l.account_status !== "approved" && (
                      <Button
                        size="sm"
                        variant="default"
                        className="mr-2"
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginador page={page} total={total} onPage={setPage} cargando={locales.isFetching} />
        </>
      )}
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
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setPage(0);
          }}
          className="h-10 rounded-xl"
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
  const [page, setPage] = useState(0);
  const eventos = useAdminEvents(uid, page, PAGE_SIZE);
  const rows = eventos.data?.rows ?? [];
  const total = eventos.data?.total ?? 0;

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
                    <StatusBadge status={e.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginador page={page} total={total} onPage={setPage} cargando={eventos.isFetching} />
        </>
      )}
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
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={hasta >= total} onClick={() => onPage(page + 1)}>
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
    <Button variant="outline" size="sm" onClick={onRetry}>
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
      <SheetContent
        side="right"
        className="flex w-[88vw] max-w-sm flex-col gap-0 border-l border-border bg-card p-0"
      >
        <header className="border-b border-border p-5">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...adminDrawerMono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Pasify · Admin
          </div>
          <div className="text-lg font-semibold tracking-tight text-foreground">
            Plataforma
          </div>
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
              <span className="flex-1 text-left">Ayuda y docs</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/70 transition group-hover:text-foreground" />
            </button>
          </div>
        </nav>

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
  total: number;
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
            value={filter.search}
            onChange={(e) => update("search", e.target.value)}
            className="h-10 rounded-xl"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 md:flex md:gap-2">
          <Select value={filter.category} onValueChange={(v) => update("category", v)}>
            <SelectTrigger className="h-10 rounded-xl">
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
            <SelectTrigger className="h-10 rounded-xl">
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
            <SelectTrigger className="h-10 rounded-xl">
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
          {total.toLocaleString("es-ES")} {total === 1 ? "local" : "locales"}
          {hayFiltros ? " con estos filtros" : ""}
          {loading && <RefreshCw className="h-3 w-3 animate-spin" />}
        </span>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => onChange(SIN_FILTROS)}
            className="rounded-full border border-border px-2.5 py-1 text-orange-500 transition hover:border-orange-500/40"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
