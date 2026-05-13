import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  LogOut,
  LayoutDashboard,
  Store,
  Users,
  Calendar,
  Ticket,
  MessageCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Check,
  X as XIcon,
} from "lucide-react";
import SupportChat from "@/components/support/SupportChat";
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
import { Shield, Landmark, Brain, Network, Scale, ShieldAlert, BarChart3, Menu, MoreHorizontal, HelpCircle, Settings, ChevronRight } from "lucide-react";
import { NavTree, type NavTreeNode } from "@/components/shared/NavTree";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SettingsSheet } from "@/components/shared/SettingsSheet";
import { HelpSheet } from "@/components/shared/HelpSheet";
import { useRefundRequests, type RefundStatus } from "@/hooks/useRefundRequests";
import { MobileTopBar } from "@/components/shared/MobileTopBar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { format } from "date-fns";
import { es as esDate } from "date-fns/locale";

const UsersIcon2 = Users;
const CalendarIcon2 = Calendar;

type Profile = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  business_name: string | null;
  business_category: string | null;
  account_status: string;
  created_at: string;
};

type EventRow = {
  id: string;
  partner_id: string;
  title: string;
  city: string;
  date_start: string;
  status: string;
  price_cents: number;
  tickets_sold: number;
  partner?: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
};

type SupportConv = {
  id: string;
  client_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_for_admin: number;
};

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
  | "refunds"
  | "soporte";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [section, setSection] = useState<Section>("metricas");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ locales: 0, clientes: 0, eventos: 0, ticketsVendidos: 0 });
  const [locales, setLocales] = useState<Profile[]>([]);
  const [clientes, setClientes] = useState<Profile[]>([]);
  const [localFilter, setLocalFilter] = useState({
    search: "",
    category: "all",
    city: "all",
    status: "all",
  });
  const [eventos, setEventos] = useState<EventRow[]>([]);
  const [conversations, setConversations] = useState<SupportConv[]>([]);
  const [selectedClient, setSelectedClient] = useState<Profile | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data: localeRoles } = await supabase.from("user_roles").select("user_id").eq("role", "partner");
      const localeIds = (localeRoles ?? []).map((r) => r.user_id);
      const localeProfilesRes = localeIds.length
        ? await supabase.from("profiles").select("*").in("id", localeIds).order("created_at", { ascending: false })
        : { data: [] as any[] };

      const { data: clientRoles } = await supabase.from("user_roles").select("user_id").eq("role", "client");
      const clientIds = (clientRoles ?? []).map((r) => r.user_id);
      const clientProfilesRes = clientIds.length
        ? await supabase.from("profiles").select("*").in("id", clientIds).order("created_at", { ascending: false })
        : { data: [] as any[] };

      const { data: eventsData } = await supabase
        .from("events")
        .select("id, partner_id, title, city, date_start, status, price_cents, tickets_sold")
        .order("date_start", { ascending: false })
        .limit(100);

      const eventsWithPartner: EventRow[] = (eventsData ?? []).map((e: any) => {
        const partner = (localeProfilesRes.data ?? []).find((p: any) => p.id === e.partner_id);
        return {
          ...e,
          partner: partner
            ? { business_name: partner.business_name, first_name: partner.first_name, last_name: partner.last_name }
            : null,
        };
      });

      const { count: ticketsCount } = await supabase
        .from("tickets")
        .select("*", { count: "exact", head: true })
        .eq("status", "paid");

      const { data: convsData } = await supabase
        .from("support_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false });

      setLocales((localeProfilesRes.data ?? []) as Profile[]);
      setClientes((clientProfilesRes.data ?? []) as Profile[]);
      setEventos(eventsWithPartner);
      setConversations((convsData ?? []) as SupportConv[]);
      setStats({
        locales: (localeProfilesRes.data ?? []).length,
        clientes: (clientProfilesRes.data ?? []).length,
        eventos: eventsWithPartner.length,
        ticketsVendidos: ticketsCount ?? 0,
      });
    } catch (e: any) {
      console.error("Error loading admin data:", e);
      toast({ title: "Error", description: e?.message ?? "Error cargando datos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const updateLocaleStatus = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase.from("profiles").update({ account_status: status }).eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "approved" ? "Local aprobado" : "Local rechazado" });
    setLocales((prev) => prev.map((l) => (l.id === id ? { ...l, account_status: status } : l)));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Mobile Settings/Help sheets — state lifted al padre.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Tree de navegación — 4 grupos por dominio para reducir scroll.
  const navTree: NavTreeNode<Section>[] = [
    { kind: "item", id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
    {
      kind: "group", id: "directory", label: "Directorio", icon: <Network className="h-5 w-5" />,
      children: [
        { id: "orgs", label: "Organizations", icon: <Network className="h-4 w-4" /> },
        { id: "locales", label: "Locales", icon: <Store className="h-4 w-4" /> },
        { id: "clientes", label: "Clientes", icon: <Users className="h-4 w-4" /> },
      ],
    },
    { kind: "item", id: "eventos", label: "Eventos", icon: <Calendar className="h-5 w-5" /> },
    { kind: "item", id: "finance", label: "Finanzas", icon: <Landmark className="h-5 w-5" /> },
    {
      kind: "group", id: "intelligence", label: "Inteligencia", icon: <Brain className="h-5 w-5" />,
      children: [
        { id: "ai", label: "AI Insights", icon: <Brain className="h-4 w-4" /> },
        { id: "ai_safety", label: "AI Safety", icon: <ShieldAlert className="h-4 w-4" /> },
        { id: "benchmarks", label: "Benchmarks", icon: <BarChart3 className="h-4 w-4" /> },
      ],
    },
    {
      kind: "group", id: "governance", label: "Gobierno", icon: <Scale className="h-5 w-5" />,
      children: [
        { id: "trust", label: "Trust & Safety", icon: <Shield className="h-4 w-4" /> },
        { id: "compliance", label: "Compliance", icon: <Scale className="h-4 w-4" /> },
        { id: "refunds", label: "Reembolsos", icon: <RotateCcw className="h-4 w-4" /> },
      ],
    },
    { kind: "item", id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  // Bottom tab bar mobile — 4 entradas más usadas; el resto via drawer "Más".
  const tabBarItems: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "metricas", label: "Métricas", icon: <LayoutDashboard className="h-5 w-5" /> },
    { id: "eventos", label: "Eventos", icon: <Calendar className="h-5 w-5" /> },
    { id: "finance", label: "Finanzas", icon: <Landmark className="h-5 w-5" /> },
    { id: "soporte", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_for_admin ?? 0), 0);

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
            <Badge variant="outline" className="border-primary/40 text-primary">
              Admin
            </Badge>
          </div>

          <nav className="flex-1 overflow-y-auto p-3">
            <NavTree<Section>
              tree={navTree}
              section={section}
              onSelect={(id) => {
                setSection(id);
                setSelectedClient(null);
              }}
              badgeFor={(id) => (id === "soporte" ? totalUnread : undefined)}
            />
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
              section={section}
              onSelect={(id) => {
                setSection(id);
                setSelectedClient(null);
              }}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              totalUnread={totalUnread}
            />
          }
        />

        {/* Main content */}
        <main className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
          {section === "metricas" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Métricas</h1>
              <p className="mb-6 text-sm text-muted-foreground">Resumen general de la plataforma Pasify.</p>

              <LivePulse
                liveEvents={Math.min(3, eventos.length)}
                gmvCentsToday={stats.ticketsVendidos * 1500}
                scansPerMin={47 + Math.floor(stats.ticketsVendidos / 100)}
                openAlerts={totalUnread > 0 ? 2 : 0}
              />

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard icon={<Store className="h-5 w-5" />} label="Locales" value={stats.locales} />
                <StatCard icon={<Users className="h-5 w-5" />} label="Clientes" value={stats.clientes} />
                <StatCard icon={<Calendar className="h-5 w-5" />} label="Eventos" value={stats.eventos} />
                <StatCard
                  icon={<Ticket className="h-5 w-5" />}
                  label="Tickets vendidos"
                  value={stats.ticketsVendidos}
                />
              </div>
            </div>
          )}

          {section === "locales" && (
            <SectionShell title="Locales" subtitle="Gestión y aprobación de locales registrados.">
              {/* Filtros */}
              {locales.length > 0 && (
                <PartnerFilters
                  filter={localFilter}
                  onChange={setLocalFilter}
                  total={locales.length}
                  filtered={applyLocalFilter(locales, localFilter).length}
                  cities={Array.from(new Set(locales.map((l) => l.city).filter(Boolean))) as string[]}
                  categories={
                    Array.from(
                      new Set(locales.map((l) => l.business_category).filter(Boolean))
                    ) as string[]
                  }
                />
              )}
              {loading ? (
                <PasifyEmptyState icon={<Store className="h-7 w-7" />} eyebrow="Cargando" title="Sincronizando locales…" spin compact />
              ) : locales.length === 0 ? (
                <PasifyEmptyState
                  icon={<Store className="h-7 w-7" />}
                  eyebrow="Sin locales"
                  title="Aún no hay locales registrados."
                  subtitle="Cuando los partners se den de alta aparecerán aquí con su estado de KYC."
                  compact
                />
              ) : applyLocalFilter(locales, localFilter).length === 0 ? (
                <PasifyEmptyState
                  icon={<Store className="h-7 w-7" />}
                  eyebrow="Sin resultados"
                  title="Nada coincide con los filtros."
                  subtitle="Prueba a limpiar la búsqueda o cambiar las opciones."
                  action={{
                    label: "Limpiar filtros",
                    onClick: () => setLocalFilter({ search: "", category: "all", city: "all", status: "all" }),
                  }}
                  compact
                />
              ) : (
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
                    {applyLocalFilter(locales, localFilter).map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">
                          {l.business_name ?? (`${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "—")}
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {l.business_category ?? "—"}
                        </TableCell>
                        <TableCell>{l.city ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{l.email ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={l.account_status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {l.account_status !== "approved" && (
                            <Button
                              size="sm"
                              variant="default"
                              className="mr-2"
                              onClick={() => updateLocaleStatus(l.id, "approved")}
                            >
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              Aprobar
                            </Button>
                          )}
                          {l.account_status !== "rejected" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateLocaleStatus(l.id, "rejected")}
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
              )}
            </SectionShell>
          )}

          {section === "clientes" && (
            <SectionShell title="Clientes" subtitle="Usuarios que han comprado o pueden comprar tickets.">
              {loading ? (
                <PasifyEmptyState icon={<UsersIcon2 className="h-7 w-7" />} eyebrow="Cargando" title="Sincronizando clientes…" spin compact />
              ) : clientes.length === 0 ? (
                <PasifyEmptyState
                  icon={<UsersIcon2 className="h-7 w-7" />}
                  eyebrow="Sin clientes"
                  title="Aún no hay clientes registrados."
                  subtitle="Cuando los usuarios creen su cuenta aparecerán aquí ordenados por última actividad."
                  compact
                />
              ) : (
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
                    {clientes.map((c) => (
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
              )}
            </SectionShell>
          )}

          {section === "eventos" && (
            <SectionShell title="Eventos" subtitle="Eventos publicados por los locales en Pasify.">
              {loading ? (
                <PasifyEmptyState icon={<CalendarIcon2 className="h-7 w-7" />} eyebrow="Cargando" title="Sincronizando eventos…" spin compact />
              ) : eventos.length === 0 ? (
                <PasifyEmptyState
                  icon={<CalendarIcon2 className="h-7 w-7" />}
                  eyebrow="Sin eventos"
                  title="Aún no hay eventos publicados."
                  subtitle="Los eventos que los partners creen aparecerán aquí en tiempo real."
                  compact
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Local</TableHead>
                      <TableHead>Ciudad</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Precio</TableHead>
                      <TableHead>Vendidos</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eventos.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.title}</TableCell>
                        <TableCell className="text-muted-foreground">{e.partner?.business_name ?? "—"}</TableCell>
                        <TableCell>{e.city}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(e.date_start).toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell>{(e.price_cents / 100).toFixed(2)} €</TableCell>
                        <TableCell>{e.tickets_sold}</TableCell>
                        <TableCell>
                          <StatusBadge status={e.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionShell>
          )}

          {section === "finance" && <NetworkFinance />}

          {section === "ai" && <AiInsightsHub />}

          {section === "ai_safety" && <AISafetyConsole />}

          {section === "benchmarks" && <IndustryBenchmarks />}

          {section === "orgs" && <OrganizationsHub />}

          {section === "compliance" && <ComplianceHub />}

          {section === "trust" && (
            <div className="space-y-8">
              <TrustSafetyCenter />
              <AuditTrailViewer />
            </div>
          )}

          {section === "refunds" && <RefundsQueue />}

          {section === "soporte" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Inbox de conversaciones con clientes. Click en una para responder.
              </p>

              <div className="grid gap-4 md:grid-cols-[320px_1fr]">
                {/* Conversation list */}
                <div className="rounded-2xl border border-border bg-card max-h-[70vh] overflow-y-auto">
                  {conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-10 text-center text-sm text-muted-foreground">
                      <MessageCircle className="mb-2 h-8 w-8 opacity-50" />
                      Aún no hay conversaciones.
                    </div>
                  ) : (
                    conversations.map((conv) => {
                      const client = clientes.find((c) => c.id === conv.client_id) || null;
                      const fullName =
                        [client?.first_name, client?.last_name].filter(Boolean).join(" ") ||
                        client?.email ||
                        "Cliente sin nombre";
                      const isActive = selectedClient?.id === conv.client_id;
                      const unread = conv.unread_for_admin ?? 0;
                      return (
                        <button
                          key={conv.id}
                          onClick={() => setSelectedClient(client)}
                          className={`flex w-full flex-col items-start gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${isActive ? "bg-muted/60" : ""}`}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold">{fullName}</span>
                            {unread > 0 && (
                              <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
                                {unread}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {conv.last_message_preview || "(Sin mensajes)"}
                          </p>
                          {conv.last_message_at && (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                              {new Date(conv.last_message_at).toLocaleString("es-ES", {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Selected conversation */}
                <div className="rounded-2xl border border-border bg-card min-h-[400px]">
                  {selectedClient ? (
                    <SupportChat
                      mode="admin"
                      selectedClientId={selectedClient.id}
                      selectedClient={{
                        id: selectedClient.id,
                        first_name: selectedClient.first_name ?? null,
                        last_name: selectedClient.last_name ?? null,
                        email: selectedClient.email ?? null,
                      }}
                    />
                  ) : (
                    <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                      <MessageCircle className="mb-3 h-10 w-10 opacity-40" />
                      Selecciona una conversación de la izquierda para responder.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Mobile bottom tab bar — primitiva compartida (MobileBottomNav).
            El badge de unread sigue mostrándose sobre el icono de Soporte. */}
        <MobileBottomNav<Section>
          items={tabBarItems.map((item) => ({
            ...item,
            badge: item.id === "soporte" ? totalUnread : undefined,
          }))}
          activeId={section}
          onSelect={(id) => {
            setSection(id);
            setSelectedClient(null);
          }}
          drawerSlot={
            <AdminDrawer
              navTree={navTree}
              section={section}
              onSelect={(id) => {
                setSection(id);
                setSelectedClient(null);
              }}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              totalUnread={totalUnread}
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
        onOpenSupport={() => {
          setSection("soporte");
          setSelectedClient(null);
        }}
      />
    </div>
  );
};

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
  totalUnread,
  variant = "topbar",
}: {
  navTree: NavTreeNode<Section>[];
  section: Section;
  onSelect: (id: Section) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  totalUnread: number;
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
            badgeFor={(id) => (id === "soporte" ? totalUnread : undefined)}
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

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
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
// RefundsQueue — cola de reembolsos pendientes
// ============================================================================

const refundsMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const RefundsQueue = () => {
  const { requests, setStatus } = useRefundRequests();
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Reembolsos</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Cola de solicitudes de reembolso enviadas por los clientes. Aprueba o rechaza con un click.
      </p>

      <div
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] uppercase text-orange-500"
        style={{ ...refundsMono, letterSpacing: "0.2em" }}
      >
        <span className="inline-block h-px w-5 bg-orange-500/70" />
        En cola · {pending.length.toString().padStart(2, "0")} pendientes
      </div>

      {requests.length === 0 ? (
        <PasifyEmptyState
          icon={<RotateCcw className="h-7 w-7" />}
          eyebrow="Sin reembolsos"
          title="Aún no hay solicitudes."
          subtitle="Cuando un cliente solicite un reembolso aparecerá aquí con su motivo y datos del ticket."
          compact
        />
      ) : (
        <>
          {pending.length > 0 && (
            <section className="mb-8">
              <div
                className="mb-3 text-[10px] uppercase text-muted-foreground"
                style={{ ...refundsMono, letterSpacing: "0.2em" }}
              >
                Pendientes
              </div>
              <div className="space-y-3">
                {pending.map((r) => (
                  <RefundRow
                    key={r.id}
                    request={r}
                    onApprove={() => setStatus(r.id, "approved")}
                    onReject={() => setStatus(r.id, "rejected")}
                  />
                ))}
              </div>
            </section>
          )}

          {decided.length > 0 && (
            <section>
              <div
                className="mb-3 text-[10px] uppercase text-muted-foreground"
                style={{ ...refundsMono, letterSpacing: "0.2em" }}
              >
                Histórico
              </div>
              <div className="space-y-2 opacity-75">
                {decided.map((r) => (
                  <RefundRow key={r.id} request={r} readonly />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

const RefundRow = ({
  request,
  onApprove,
  onReject,
  readonly,
}: {
  request: ReturnType<typeof useRefundRequests>["requests"][number];
  onApprove?: () => void;
  onReject?: () => void;
  readonly?: boolean;
}) => {
  const statusColor: Record<RefundStatus, string> = {
    pending: "#E8B04C",
    approved: "#4DB87A",
    rejected: "#8A8275",
  };
  const statusLabel: Record<RefundStatus, string> = {
    pending: "En revisión",
    approved: "Aprobado",
    rejected: "Denegado",
  };
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[9px] uppercase"
            style={{
              ...refundsMono,
              letterSpacing: "0.18em",
              background: `${statusColor[request.status]}22`,
              color: statusColor[request.status],
              border: `1px solid ${statusColor[request.status]}44`,
            }}
          >
            {statusLabel[request.status]}
          </span>
          <span
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...refundsMono, letterSpacing: "0.14em" }}
          >
            {format(new Date(request.requestedAt), "d MMM · HH:mm", { locale: esDate })}
          </span>
        </div>
        <div className="mt-1 truncate text-base font-semibold text-foreground">
          {request.eventTitle}
        </div>
        <div
          className="mt-0.5 text-[12px] text-muted-foreground"
          style={refundsMono}
        >
          {request.partnerName ?? "Local"} ·{" "}
          {request.eventDate
            ? format(new Date(request.eventDate), "d MMM · HH:mm", { locale: esDate })
            : "—"}{" "}
          · {(request.amount_cents / 100).toFixed(2)} €
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-foreground/85">
          <span className="text-muted-foreground">Motivo: </span>
          {request.reason}
        </p>
      </div>

      {!readonly && (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            <XIcon className="mr-1.5 h-3.5 w-3.5" />
            Denegar
          </Button>
          <Button size="sm" onClick={onApprove}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Aprobar
          </Button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Partner filters (search + categoría + ciudad + estado)
// ============================================================================

const filterMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

interface LocalFilter {
  search: string;
  category: string;
  city: string;
  status: string;
}

const applyLocalFilter = (list: Profile[], f: LocalFilter): Profile[] => {
  const q = f.search.trim().toLowerCase();
  return list.filter((l) => {
    if (q) {
      const hay = `${l.business_name ?? ""} ${l.first_name ?? ""} ${l.last_name ?? ""} ${l.email ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.category !== "all" && (l.business_category ?? "") !== f.category) return false;
    if (f.city !== "all" && (l.city ?? "") !== f.city) return false;
    if (f.status !== "all" && (l.account_status ?? "") !== f.status) return false;
    return true;
  });
};

const PartnerFilters = ({
  filter,
  onChange,
  total,
  filtered,
  cities,
  categories,
}: {
  filter: LocalFilter;
  onChange: (f: LocalFilter) => void;
  total: number;
  filtered: number;
  cities: string[];
  categories: string[];
}) => {
  const update = <K extends keyof LocalFilter>(k: K, v: LocalFilter[K]) =>
    onChange({ ...filter, [k]: v });
  return (
    <div
      className="mb-4 rounded-2xl border border-border bg-card p-3 md:p-4"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
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
        <span>
          {filtered === total ? `${total} locales` : `${filtered} de ${total} locales`}
        </span>
        {(filter.search || filter.category !== "all" || filter.city !== "all" || filter.status !== "all") && (
          <button
            type="button"
            onClick={() => onChange({ search: "", category: "all", city: "all", status: "all" })}
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
