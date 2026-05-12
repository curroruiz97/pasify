import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Upload,
  X as XIcon,
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
} from "lucide-react";
import QRScanner from "@/components/partner/QRScanner";
import Wordmark from "@/components/Wordmark";
import SupportChat from "@/components/support/SupportChat";
import { LiveWarRoom } from "@/components/partner/LiveWarRoom";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { PartnerOnboardingWizard } from "@/components/partner/PartnerOnboardingWizard";
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

type Section =
  | "metricas"
  | "live"
  | "autopilot"
  | "forecast"
  | "pricing"
  | "eventos"
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
  const [userId, setUserId] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [festivalOpen, setFestivalOpen] = useState(false);
  // Confirmación de borrado: se guarda el evento target hasta que el usuario
  // confirma o cancela. AlertDialog se monta al final del árbol.
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      setUserId(uid);

      const { data: p } = await supabase
        .from("profiles")
        .select("id, business_name, business_category, city, business_city, account_status, stripe_connect_account_id, stripe_connect_onboarded")
        .eq("id", uid)
        .maybeSingle();
      if (p) setProfile(p as Profile);

      const { data: c } = await supabase.from("cities").select("id, name, slug").eq("active", true);
      setCities((c ?? []) as City[]);

      await loadEvents(uid);
      setLoading(false);
    })();
  }, []);

  const loadEvents = async (uid: string) => {
    const { data } = await supabase
      .from("events")
      .select("id, title, description, city, date_start, status, price_cents, capacity, tickets_sold")
      .eq("partner_id", uid)
      .order("date_start", { ascending: false });
    setEvents((data ?? []) as EventRow[]);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const handleDuplicateEvent = async (source: EventRow) => {
    if (!userId) return;
    // Shift por defecto: misma hora una semana después
    const sourceDate = new Date(source.date_start);
    const next = new Date(sourceDate);
    next.setDate(next.getDate() + 7);

    const payload = {
      partner_id: userId,
      title: `${source.title} (copia)`,
      description: source.description,
      city: source.city,
      date_start: next.toISOString(),
      price_cents: source.price_cents,
      capacity: source.capacity,
      tickets_sold: 0,
      image_url: source.image_url,
      status: "draft",
    } as Record<string, unknown>;

    const { error } = await supabase.from("events").insert(payload);
    if (error) {
      toast({
        title: "No se pudo duplicar",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Evento duplicado",
      description: `Hemos creado "${payload.title}" en borrador para el ${next.toLocaleDateString(
        "es-ES",
        { day: "2-digit", month: "long" }
      )}.`,
    });
    if (userId) await loadEvents(userId);
  };

  const handleDeleteEvent = async () => {
    if (!deleteTarget || !userId) return;
    setDeleting(true);
    const { error } = await supabase.from("events").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      // Si el evento ya tiene tickets vendidos, la RLS / FK lo impedirá.
      // Mostramos el motivo real para que el partner sepa qué pasa.
      toast({
        title: "No se pudo eliminar",
        description:
          error.message.includes("foreign key") || error.message.includes("violates")
            ? "El evento tiene tickets vendidos o relacionados. Cancélalo en lugar de borrarlo."
            : error.message,
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
  ];

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
      <PartnerOnboardingWizard
        defaults={{
          businessName: profile?.business_name ?? "",
          category: profile?.business_category ?? "discoteca",
          city: profile?.city ?? "",
        }}
      />
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar desktop */}
        <aside className="hidden w-60 border-r border-border bg-card md:flex md:flex-col">
          <div className="flex flex-col items-start gap-3 border-b border-border p-5">
            <PasifyBrand size={84} />
            <Badge variant="outline" className="border-primary/40 text-primary">
              Local
            </Badge>
            {profile?.business_name && (
              <div className="truncate text-sm font-medium">{profile.business_name}</div>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            <NavTree tree={navTree} section={section} onSelect={setSection} />
          </nav>
          <div className="border-t border-border p-3">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </aside>

        {/* Mobile top app bar — patrón unificado con Client/Admin */}
        <header
          className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-3 md:hidden"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <PasifyBrand size={32} />
          <Badge variant="outline" className="border-primary/40 text-primary">
            Local
          </Badge>
          <span className="flex-1" />
          <PartnerDrawer
            navTree={navTree}
            section={section}
            onSelect={setSection}
            onLogout={handleLogout}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
            businessName={profile?.business_name ?? null}
          />
        </header>

        <main className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
          {/* MÉTRICAS — Reports & BI online */}
          {section === "metricas" && (
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
          {section === "autopilot" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">AutoPilot IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu agente Pasify ejecuta pricing, marketing, soporte y reembolsos dentro de tus políticas. Tú firmas las decisiones grandes; el agente se ocupa del resto.
              </p>
              <PartnerAutoPilot />
            </div>
          )}

          {/* LIVE WAR ROOM */}
          {section === "live" && (
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
          {section === "forecast" && (
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
          {section === "pricing" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Pricing IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Motor de pricing dinámico que sube y baja el precio según demanda, hora y aforo —
                con reglas tuyas y curva de elasticidad.
              </p>
              <PartnerDynamicPricing
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

          {/* EVENTOS */}
          {section === "eventos" && (
            <div>
              <div className="mb-6 flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">Mis eventos</h1>
                  <p className="text-sm text-muted-foreground">Crea y gestiona los eventos de tu local.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setFestivalOpen(true)}>
                    <Music className="mr-2 h-4 w-4" />
                    Festival multi-día
                  </Button>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Nuevo evento
                    </Button>
                  </DialogTrigger>
                  <CreateEventDialog
                    partnerId={userId}
                    defaultCity={profile?.city ?? profile?.business_city ?? ""}
                    cities={cities}
                    onCreated={async () => {
                      setCreateOpen(false);
                      if (userId) await loadEvents(userId);
                    }}
                  />
                </Dialog>
                </div>
              </div>

              <FestivalBuilder
                open={festivalOpen}
                onOpenChange={setFestivalOpen}
                onCreate={(draft) => {
                  toast({
                    title: "Festival guardado",
                    description: `${draft.name} con ${draft.days.length} días listo en borrador.`,
                  });
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
                  action={{ label: "Nuevo evento", onClick: () => setCreateOpen(true) }}
                />
              ) : (
                <Card>
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
              )}
            </div>
          )}

          {/* SCANNER */}
          {section === "scanner" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Escáner</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Valida la entrada de tus clientes escaneando el QR de su ticket.
              </p>
              {userId && <QRScanner partnerId={userId} />}
            </div>
          )}

          {/* DOOR VISION — Computer Vision */}
          {section === "door_vision" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Door Vision IA</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Cámara IA en puerta · cara ↔ DNI · detección de menores · heatmap densidad · GDPR safe.
              </p>
              <PartnerDoorVision />
            </div>
          )}

          {/* TPV — Cierre Z */}
          {section === "tpv" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">TPV</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Cierre de caja, turnos y resumen de ventas del día.
              </p>
              <TpvCierreZ />
            </div>
          )}

          {/* CASHLESS */}
          {section === "cashless" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Cashless</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Pulseras prepago RFID — el flujo de barra del evento en directo.
              </p>
              <PartnerCashless />
            </div>
          )}

          {/* VIP & HOSPITALITY */}
          {section === "vip" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">VIP & Hospitality</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Mesas, reservados, bottle service y concierge desde una sola pantalla.
              </p>
              <PartnerVipHospitality />
            </div>
          )}

          {/* CRM & AUDIENCE */}
          {section === "crm" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">CRM & Audience</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu base de clientes, segmentos en tiempo real y campañas multicanal.
              </p>
              <PartnerCRM />
            </div>
          )}

          {/* MARKETING ENGINE */}
          {section === "marketing" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Marketing</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Campañas multicanal, automatizaciones, ads y studio con IA — todo desde una pantalla.
              </p>
              <PartnerMarketing />
            </div>
          )}

          {/* SALES CHANNELS */}
          {section === "channels" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Canales de venta</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu mix de canales: web, redes, RRPP, hoteles y afiliados — con comisiones y revenue por canal.
              </p>
              <PartnerSalesChannels />
            </div>
          )}

          {/* TEAM */}
          {section === "team" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Equipo</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Plantilla, turnos de la semana y nómina prevista — todo en una pantalla.
              </p>
              <PartnerTeam />
            </div>
          )}

          {/* APP MARKETPLACE */}
          {section === "apps" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">App Marketplace</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Conecta Pasify con 30+ herramientas externas en un click — OAuth y webhooks listos.
              </p>
              <PartnerAppMarketplace />
            </div>
          )}

          {/* WHITE-LABEL */}
          {section === "whitelabel" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">White-label</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Tu marca, tu subdominio, tu app móvil — Pasify desaparece y tu identidad ocupa todo el espacio.
              </p>
              <PartnerWhiteLabel />
            </div>
          )}

          {/* INDUSTRY BENCHMARKS — Fase 6 */}
          {section === "benchmarks" && (
            <div>
              <IndustryBenchmarks />
            </div>
          )}

          {/* STRIPE */}
          {section === "stripe" && (
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
          {section === "soporte" && (
            <div>
              <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Chatea con el equipo Pasify. Te respondemos en menos de 5 minutos en horario laboral.
              </p>
              <SupportChat mode="client" />
            </div>
          )}
        </main>

        {/* Bottom tab bar mobile — solo 4 primarios + drawer "Más" */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-20 flex items-stretch border-t border-border bg-card md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {tabBarItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`relative flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[10px] font-medium transition ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {item.icon}
                <span className="leading-none">{item.label}</span>
                {active && (
                  <span
                    className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full"
                    style={{ background: "#E8542A" }}
                  />
                )}
              </button>
            );
          })}
          <PartnerDrawer
            navTree={navTree}
            section={section}
            onSelect={setSection}
            onLogout={handleLogout}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
            businessName={profile?.business_name ?? null}
            variant="tab"
          />
        </nav>
      </div>

      {/* Sheets globales — abiertos desde el drawer */}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        role="partner"
        email={null}
        displayName={profile?.business_name ?? "Tu local"}
      />
      <HelpSheet
        open={helpOpen}
        onOpenChange={setHelpOpen}
        role="partner"
        onOpenSupport={() => setSection("soporte")}
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
// CreateEventDialog
// ============================================================================

const CreateEventDialog = ({
  partnerId,
  defaultCity,
  cities,
  onCreated,
}: {
  partnerId: string;
  defaultCity: string;
  cities: City[];
  onCreated: () => void;
}) => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    city: defaultCity,
    date_start: "",
    price_eur: "",
    capacity: "",
    image_url: "",
  });

  useEffect(() => setForm((f) => ({ ...f, city: defaultCity })), [defaultCity]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Imagen muy grande", description: "Máximo 8 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${partnerId}/event-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("event-images").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("event-images").getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: pub.publicUrl }));
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "No se pudo subir la imagen.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = () => setForm((f) => ({ ...f, image_url: "" }));

  const submit = async (status: "draft" | "published") => {
    const title = form.title.trim();
    const city = form.city.trim();
    if (!title || !form.date_start || !city) {
      const missing: string[] = [];
      if (!title) missing.push("título");
      if (!form.date_start) missing.push("fecha y hora");
      if (!city) missing.push("ciudad");
      toast({
        title: "Faltan datos",
        description: `Completa: ${missing.join(", ")}.`,
        variant: "destructive",
      });
      return;
    }
    const priceCents = Math.round(parseFloat(form.price_eur || "0") * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      toast({ title: "Precio no válido", variant: "destructive" });
      return;
    }
    const capacity = form.capacity ? parseInt(form.capacity, 10) : null;

    setSubmitting(true);
    const { error } = await supabase.from("events").insert({
      partner_id: partnerId,
      title,
      description: form.description.trim() || null,
      city,
      date_start: new Date(form.date_start).toISOString(),
      price_cents: priceCents,
      capacity,
      image_url: form.image_url || null,
      status,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Error al crear evento", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "published" ? "Evento publicado" : "Borrador guardado" });
    onCreated();
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nuevo evento</DialogTitle>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div>
          <Label>Título *</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Saturday Night · Halloween Edition" />
        </div>
        <div>
          <Label>Descripción</Label>
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Detalles, line-up, código de vestimenta..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Fecha y hora *</Label>
            <Input
              type="datetime-local"
              value={form.date_start}
              onChange={(e) => setForm({ ...form, date_start: e.target.value })}
            />
          </div>
          <div>
            <Label>Ciudad *</Label>
            <Select value={form.city} onValueChange={(v) => setForm({ ...form, city: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona ciudad" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Precio ticket (€) *</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.price_eur}
              onChange={(e) => setForm({ ...form, price_eur: e.target.value })}
              placeholder="15.00"
            />
          </div>
          <div>
            <Label>Aforo</Label>
            <Input
              type="number"
              min="1"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              placeholder="Opcional"
            />
          </div>
        </div>
        <div>
          <Label>Póster del evento</Label>
          {form.image_url ? (
            <div className="relative mt-2 overflow-hidden rounded-xl border border-border">
              <img src={form.image_url} alt="Póster" className="aspect-[16/9] w-full object-cover" />
              <button
                type="button"
                onClick={removeImage}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
                aria-label="Quitar imagen"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-2 flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-muted/50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Subiendo...
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6" />
                  <span>Subir imagen</span>
                  <span className="text-[11px]">JPG / PNG / WEBP · máx. 8 MB</span>
                </>
              )}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFileSelect}
          />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={submitting} onClick={() => submit("draft")}>
          Guardar borrador
        </Button>
        <Button disabled={submitting} onClick={() => submit("published")}>
          Publicar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

export default PartnerDashboard;
