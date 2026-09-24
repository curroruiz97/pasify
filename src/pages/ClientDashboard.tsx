import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { useSessionState } from "@/lib/useSessionState";
import { RefreshIndicator } from "@/components/ui/refresh-indicator";
import { useMyCity, useMyTickets, usePublicPartners, type WalletTicketRow } from "@/hooks/queries/clientData";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  MessageCircle,
  Ticket,
  ArrowLeft,
  Home,
  Calendar,
  Search,
  MapPin,
  Music2,
  Beer,
  Disc3,
  PartyPopper,
  Building2,
  Sun,
  Waves,
  Store as StoreIcon,
  Heart,
  LogOut,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { FavEvent } from "@/hooks/useFavorites";
import SupportChat from "@/components/support/SupportChat";
import ProfileSheet from "@/components/client/ProfileSheet";
// `Ticket` a secas es el icono de lucide-react: el tipo va renombrado.
import TicketQRModal, {
  type Ticket as WalletTicket,
  type TicketEventInfo,
} from "@/components/client/TicketQRModal";
import { TICKETS_UPDATED_EVENT } from "@/hooks/usePendingCheckoutResume";
import { eventDayMonth, eventPriceLabel, formatEventTime } from "@/components/tickets/ticketUtils";
import { useFavorites } from "@/hooks/useFavorites";
import { useFavoritePartners } from "@/hooks/useFavoritePartners";
import { MonthGrid } from "@/components/event/MonthGrid";
import { CalendarDays, List as ListIcon } from "lucide-react";
import Wordmark from "@/components/Wordmark";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { downloadIcs } from "@/lib/ics";
import { ClientLoyalty } from "@/components/client/ClientLoyalty";
import { SmartHomeStrip } from "@/components/client/SmartHomeStrip";
import { ClientLiveExperience } from "@/components/client/ClientLiveExperience";
import { ClientConcierge } from "@/components/client/ClientConcierge";
import { Crown, Radio, Gem, Menu, MoreHorizontal, HelpCircle, Settings, ChevronRight } from "lucide-react";
import { NavTree, type NavTreeNode } from "@/components/shared/NavTree";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SettingsSheet } from "@/components/shared/SettingsSheet";
import { HelpSheet } from "@/components/shared/HelpSheet";
import { useRefundRequests, type RefundRequest } from "@/hooks/useRefundRequests";
import { Sentry, getErrorMessage } from "@/lib/sentry";
import { MobileTopBar } from "@/components/shared/MobileTopBar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw } from "lucide-react";

type View = "home" | "support" | "wallet" | "favorites" | "loyalty" | "live" | "concierge";

/** Icona Calendar con badge contatore arancione (per nav "Favoritos"). */
const EventsIcon = ({ count }: { count?: number }) => (
  <span className="relative inline-flex h-5 w-5 items-center justify-center">
    <Calendar className="h-5 w-5" />
    {count != null && count > 0 && (
      <span
        className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
        style={{ background: "#E8542A" }}
      >
        {count}
      </span>
    )}
  </span>
);

type Partner = {
  id: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
};

// Nota: DEMO_PARTNERS eliminados (mayo 2026). Antes mostrábamos Pacha,
// Razzmatazz y otros locales famosos cuando el DB estaba vacío, pero eso
// engañaba al usuario en producción real (no podía comprar tickets de
// esos locales). Ahora si no hay partners aprobados se muestra un empty
// state explícito vía <PasifyEmptyState>.

const CATEGORIES = [
  { id: "all", label: "Todos", Icon: PartyPopper },
  { id: "discoteca", label: "Discotecas", Icon: Disc3 },
  { id: "bar", label: "Bares", Icon: Beer },
  { id: "club", label: "Clubs", Icon: Music2 },
  { id: "sala", label: "Salas", Icon: Building2 },
  { id: "festival", label: "Festivales", Icon: PartyPopper },
  { id: "rooftop", label: "Rooftops", Icon: Sun },
  { id: "beachclub", label: "Beach Clubs", Icon: Waves },
  { id: "otro", label: "Otros", Icon: StoreIcon },
];

const VIEWS: readonly View[] = ["home", "support", "wallet", "favorites", "loyalty", "live", "concierge"];
const isView = (value: string | undefined): value is View =>
  !!value && (VIEWS as readonly string[]).includes(value);

// Referencias estables mientras no hay datos.
const SIN_ENTRADAS: WalletTicketRow[] = [];
const SIN_LOCALES: Partner[] = [];

const ClientDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    navigate("/");
  };
  // HashRouter: ?session_id=... aparece como query del hash. `useSearchParams`
  // lo parsea correctamente porque react-router resuelve `location.search`
  // dentro del fragmento.
  const [searchParams, setSearchParams] = useSearchParams();
  const postCheckoutSessionId = searchParams.get("session_id");
  const postCheckoutOrderId = searchParams.get("order_id");
  // `?wallet=<event_id|1>`: abre la cartera (lo usan el botón "Mi entrada"
  // del calendario, TicketSuccess, la vuelta a la app tras pagar en nativo…).
  // `?refund=` y `?support=` llegan desde las notificaciones.
  const walletParam = searchParams.get("wallet");
  const refundParam = searchParams.get("refund");
  const supportParam = searchParams.get("support");

  // La vista vive en la URL (/client-dashboard/:view): atrás, recargar y los
  // enlaces llevan a la pestaña correcta. Antes era estado local: recargar (o
  // que el navegador descartara la pestaña) te devolvía a Inicio.
  const { view: viewParam } = useParams<{ view?: string }>();
  const vistaPorParametros: View | null =
    postCheckoutSessionId || postCheckoutOrderId || walletParam || refundParam
      ? "wallet"
      : supportParam
        ? "support"
        : null;
  const view: View = isView(viewParam) ? viewParam : vistaPorParametros ?? "home";
  const setView = useCallback(
    (v: View) => navigate(v === "home" ? "/client-dashboard" : `/client-dashboard/${v}`),
    [navigate],
  );

  // Los enlaces con parámetros fijan la vista en la ruta y se limpian los de
  // un solo uso (?wallet=, ?refund=). Todo en una navegación: dos seguidas se
  // pisan. La vuelta de Stripe (?session_id=) la limpia su propio efecto.
  useEffect(() => {
    if (!vistaPorParametros && !walletParam && !refundParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete("wallet");
    next.delete("refund");
    const destino = isView(viewParam) ? viewParam : vistaPorParametros ?? "home";
    const pathname = destino === "home" ? "/client-dashboard" : `/client-dashboard/${destino}`;
    const search = next.toString();
    if (pathname === location.pathname && search === searchParams.toString()) return;
    navigate({ pathname, search: search ? `?${search}` : "" }, { replace: true });
  }, [viewParam, vistaPorParametros, walletParam, refundParam, searchParams, location.pathname, navigate]);

  const uid = useCurrentUserId();
  const userId = uid ?? "";
  const userCity = useMyCity(uid).data?.city ?? "";
  const { events: favEvents, ids: favIds, toggle: toggleFav } = useFavorites();
  const [favTab, setFavTab] = useSessionState<"list" | "calendar">("cliente.favoritos.vista", "list");

  // Entradas en la caché y guardadas en el dispositivo: la cartera se abre al
  // instante (también sin conexión) y se refresca detrás. Antes cada vez que
  // se entraba en Tickets salía "Sincronizando tu wallet…" y se pedía todo.
  //
  // Error explícito: NO se camufla un fallo (RLS / red / query mal formada)
  // como "el usuario no tiene tickets"; el wallet enseña un aviso con
  // Reintentar y, si había entradas guardadas, las sigue enseñando.
  const ticketsQuery = useMyTickets(uid);
  const tickets = ticketsQuery.data ?? SIN_ENTRADAS;
  const ticketsLoading = !!uid && ticketsQuery.isPending && !ticketsQuery.isError;
  const ticketsError = ticketsQuery.error ? getErrorMessage(ticketsQuery.error) : null;
  const refrescandoEntradas = ticketsQuery.isFetching && !ticketsQuery.isPending;
  const { refetch: refetchTickets } = ticketsQuery;
  const loadTickets = useCallback(() => refetchTickets(), [refetchTickets]);
  const invalidarEntradas = useCallback(() => {
    if (uid) void queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) });
  }, [uid, queryClient]);
  // Compra recién pagada que se está confirmando (vuelta de Stripe).
  const [confirmandoCompra, setConfirmandoCompra] = useState(false);

  const [openTicket, setOpenTicket] = useState<{ ticket: WalletTicket; event: TicketEventInfo | null } | null>(null);
  const [favMonthCursor, setFavMonthCursor] = useState<Date>(new Date());
  const [favSelectedDay, setFavSelectedDay] = useState<Date | null>(null);

  const favEventsByDay = useMemo(() => {
    const map = new Map<string, FavEvent[]>();
    favEvents.forEach((e) => {
      try {
        // chiave in LOCAL time (stessa di MonthGrid) per evitare drift UTC
        const k = format(new Date(e.date_start), "yyyy-MM-dd");
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(e);
      } catch {
        /* skip malformed */
      }
    });
    return map;
  }, [favEvents]);

  // Locales de la home en la caché (y en el dispositivo). Sin fallback a
  // demo: si no hay locales aprobados, empty state explícito más abajo.
  const partnersQuery = usePublicPartners();
  const partners = (partnersQuery.data as Partner[] | undefined) ?? SIN_LOCALES;
  const loading = partnersQuery.isPending && !partnersQuery.isError;
  // Búsqueda y categoría sobreviven a cambiar de pestaña y a recargar.
  const [search, setSearch] = useSessionState("cliente.busqueda", "");
  const [activeCat, setActiveCat] = useSessionState("cliente.categoria", "all");

  // Hook compartido entre TODOS los TicketCard del wallet. Antes cada card
  // invocaba useRefundRequests por su cuenta y se duplicaban los realtime
  // channels (mismo nombre), lo que crashaba el ErrorBoundary global y
  // dejaba el dashboard en negro tras login. Subiéndolo aquí queda una
  // única subscription y una única lista de refunds compartida.
  const { statusForTicket: refundStatusForTicket, requestRefund: refundRequestRefund } =
    useRefundRequests();

  // Compra confirmada en segundo plano (usePendingCheckoutResume): refresca.
  useEffect(() => {
    window.addEventListener(TICKETS_UPDATED_EVENT, invalidarEntradas);
    return () => window.removeEventListener(TICKETS_UPDATED_EVENT, invalidarEntradas);
  }, [invalidarEntradas]);

  // Post-checkout: cuando el cliente vuelve de Stripe con ?session_id=... /
  // ?order_id=..., el webhook `stripe-webhook` puede tardar 1-5s en procesar
  // el evento checkout.session.completed (que es lo que dispara
  // `mark_order_paid` → tickets.status = 'paid'). Hacemos:
  //   1) Poll: cada 2s comprobamos `ticket_orders.status` del order. Cuando
  //      pase a 'paid', refrescamos las entradas + toast.
  //   2) Realtime: nos suscribimos a UPDATEs sobre ticket_orders del usuario
  //      para enterarnos al instante si el webhook entra antes del poll.
  //   3) Max 30s — si no llega, mostramos un toast informativo (puede que el
  //      webhook tarde más o haya fallado; el email/notif llegará igual).
  //   4) Limpiamos la URL para evitar re-disparar el flujo en refresh.
  useEffect(() => {
    if (!userId) return;
    if (!postCheckoutSessionId && !postCheckoutOrderId) return;

    // Mientras confirmamos, aviso encima de las entradas (las que ya tenía
    // siguen visibles). El usuario debe sentir que la app está en ello.
    setConfirmandoCompra(true);

    let finished = false;
    const finish = (kind: "ok" | "timeout") => {
      if (finished) return;
      finished = true;
      setConfirmandoCompra(false);
      if (kind === "ok") {
        toast({
          title: "Compra confirmada",
          description: "Tu ticket ya está disponible en tu Wallet.",
        });
      } else {
        toast({
          title: "Procesando compra",
          description:
            "El pago está siendo confirmado. Recibirás un email con tu ticket en breve.",
        });
      }
      invalidarEntradas();
      // Quita los params de la URL para que F5 no re-dispare el flujo
      setSearchParams({}, { replace: true });
    };

    // Realtime subscription a UPDATEs en ticket_orders del comprador
    const channel = supabase
      .channel(`post-checkout-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_orders",
          filter: `buyer_user_id=eq.${userId}`,
        },
        (payload: any) => {
          const next = payload.new;
          if (!next) return;
          // Solo nos interesa el order que acabamos de pagar (si tenemos id)
          if (postCheckoutOrderId && next.id !== postCheckoutOrderId) return;
          if (postCheckoutSessionId && next.stripe_session_id !== postCheckoutSessionId) return;
          if (next.status === "paid") finish("ok");
        }
      )
      .subscribe();

    // Poll de respaldo cada 2s (max 15 intentos = 30s)
    let attempts = 0;
    const interval = setInterval(async () => {
      if (finished) return;
      attempts++;
      let query = supabase.from("ticket_orders").select("id, status, stripe_session_id");
      query = postCheckoutOrderId
        ? query.eq("id", postCheckoutOrderId)
        : query.eq("stripe_session_id", postCheckoutSessionId!);
      const { data: order } = await query.maybeSingle();
      if (order?.status === "paid") {
        finish("ok");
      } else if (attempts >= 15) {
        finish("timeout");
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, postCheckoutSessionId, postCheckoutOrderId]);

  const filtered = useMemo(() => {
    return partners.filter((p) => {
      if (activeCat !== "all" && p.business_category !== activeCat) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${p.business_name ?? ""} ${p.city ?? ""} ${p.business_category ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [partners, search, activeCat]);

  // Mobile Settings/Help sheets — state lifted al padre para que
  // ambos triggers (header drawer + tab bar drawer) compartan el estado.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Tree de navegación — agrupa membership (Pasify Points + Concierge).
  const navTree: NavTreeNode<View>[] = [
    { kind: "item", id: "home", label: "Inicio", icon: <Home className="h-5 w-5" /> },
    { kind: "item", id: "favorites", label: "Favoritos", icon: <EventsIcon count={favIds.length} /> },
    { kind: "item", id: "wallet", label: "Tickets", icon: <Ticket className="h-5 w-5" /> },
    { kind: "item", id: "live", label: "En vivo", icon: <Radio className="h-5 w-5" /> },
    {
      kind: "group",
      id: "membership",
      label: "Mi membresía",
      icon: <Crown className="h-5 w-5" />,
      children: [
        { id: "loyalty", label: "Pasify Points", icon: <Crown className="h-4 w-4" /> },
        { id: "concierge", label: "Concierge", icon: <Gem className="h-4 w-4" /> },
      ],
    },
    { kind: "item", id: "support", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  // Bottom tab bar mobile — 4 entradas más usadas; el resto en el drawer "Más".
  const tabBarItems: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "home", label: "Inicio", icon: <Home className="h-5 w-5" /> },
    { id: "favorites", label: "Favoritos", icon: <EventsIcon count={favIds.length} /> },
    { id: "wallet", label: "Tickets", icon: <Ticket className="h-5 w-5" /> },
    { id: "support", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar desktop */}
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
          <div className="flex flex-col items-start gap-3 border-b border-border p-5">
            <PasifyBrand size={84} />
            {userCity && (
              <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {userCity}
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            <NavTree<View> tree={navTree} section={view} onSelect={setView} />
          </nav>
          <div className="border-t border-border p-2">
            {userId && <ProfileSheet userId={userId} variant="row" />}
          </div>
          <div className="border-t border-border p-3">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </aside>

        {/* Mobile top app bar — primitiva compartida (MobileTopBar). */}
        <MobileTopBar
          role="client"
          showBack={view !== "home"}
          onBack={() => setView("home")}
          endSlot={
            <>
              {userId && <ProfileSheet userId={userId} />}
              <ClientDrawer
                navTree={navTree}
                view={view}
                onSelect={setView}
                onLogout={handleLogout}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenHelp={() => setHelpOpen(true)}
                city={userCity}
              />
            </>
          }
        />

        <main className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
        {view === "home" && (
          <>
            {/* Search */}
            <div className="pt-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Busca locales, ciudades, categorías..."
                  className="h-13 rounded-full pl-11 text-base"
                  style={{ height: "52px" }}
                />
              </div>

              {/* Category chips */}
              <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {CATEGORIES.map((c) => {
                  const active = activeCat === c.id;
                  const Icon = c.Icon;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveCat(c.id)}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Smart Home Recommender — solo cuando sin filtros activos */}
            {!loading && !search.trim() && activeCat === "all" && partners.length > 0 && (
              <div className="mt-8">
                <SmartHomeStrip
                  partners={partners.slice(0, 8)}
                  onOpen={(id) => navigate(`/p/${id}`)}
                />
              </div>
            )}

            {/* Partner grid */}
            <div className="mt-8">
              {loading ? (
                <PasifyEmptyState
                  icon={<MapPin className="h-7 w-7" />}
                  eyebrow="Cargando"
                  title="Buscando los mejores locales…"
                  subtitle="Estamos sincronizando los locales y eventos disponibles cerca de ti."
                  spin
                  compact
                />
              ) : filtered.length === 0 ? (
                <PasifyEmptyState
                  icon={<Search className="h-7 w-7" />}
                  eyebrow={search || activeCat !== "all" ? "Sin resultados" : "Sin locales"}
                  title={
                    search || activeCat !== "all" ? (
                      <>Nada coincide con tu <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>búsqueda</span>.</>
                    ) : (
                      <>Aún no hay <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>locales</span> en tu zona.</>
                    )
                  }
                  subtitle={
                    search || activeCat !== "all"
                      ? "Prueba con otra ciudad o cambia la categoría arriba."
                      : "Pasify está creciendo cada semana. Vuelve pronto para descubrir los próximos locales."
                  }
                  action={
                    search || activeCat !== "all"
                      ? { label: "Limpiar filtros", onClick: () => { setSearch(""); setActiveCat("all"); } }
                      : undefined
                  }
                  compact
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((p) => (
                    <PartnerCard key={p.id} partner={p} onClick={() => navigate(`/p/${p.id}`)} />
                  ))}
                </div>
              )}
            </div>

          </>
        )}

        {view === "live" && (
          <div>
            <h1 className="mb-1 text-3xl font-bold tracking-tight">En vivo</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Tu modo evento — line-up en directo, mapa interno, pagos con pulsera y muro de fotos.
            </p>
            <ClientLiveExperience ticketHasEventToday />
          </div>
        )}

        {view === "concierge" && (
          <div>
            <h1 className="mb-1 text-3xl font-bold tracking-tight">Concierge</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Servicio premium: una persona organiza tu noche entera — mesas, restaurante, traslado, backstage.
            </p>
            <ClientConcierge />
          </div>
        )}

        {view === "loyalty" && (
          <div>
            <h1 className="mb-1 text-3xl font-bold tracking-tight">Pasify Points</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Tu programa de fidelidad: gana puntos en cada evento, sube de nivel y canjea perks exclusivos.
            </p>
            <ClientLoyalty />
          </div>
        )}

        {view === "support" && (
          <div>
            <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Chatea con el equipo Pasify. Te respondemos en horario laboral, de lunes a viernes.
            </p>
            <SupportChat mode="client" />
          </div>
        )}

        {view === "favorites" && (
          <div className="pt-6">
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Favoritos</h1>
            <p className="mb-4 text-sm text-muted-foreground">
              Los eventos que has guardado. Pulsa el corazón para quitar.
            </p>

            {favEvents.length === 0 ? (
              <PasifyEmptyState
                icon={<Heart className="h-7 w-7" />}
                eyebrow="Sin favoritos"
                title={<>Aún no has guardado <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>nada</span>.</>}
                subtitle="Cuando marques un evento como favorito aparecerá aquí con calendario y cuenta atrás."
                action={{ label: "Descubrir locales", onClick: () => setView("home") }}
              />
            ) : (
              <>
                {/* Tabs Lista / Calendario */}
                <div className="mb-4 inline-flex rounded-full border border-border bg-card p-1">
                  <button
                    onClick={() => setFavTab("list")}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                      favTab === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                    Lista
                  </button>
                  <button
                    onClick={() => setFavTab("calendar")}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                      favTab === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Calendario
                  </button>
                </div>

                {favTab === "list" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {favEvents.map((e) => (
                      <FavoritePosterCard
                        key={e.id}
                        event={e}
                        onOpen={() => navigate(`/p/${e.partnerId}`)}
                        onUnfav={() => toggleFav(e)}
                      />
                    ))}
                  </div>
                )}

                {favTab === "calendar" && (
                  <>
                    <MonthGrid
                      cursor={favMonthCursor}
                      setCursor={setFavMonthCursor}
                      eventsByDay={favEventsByDay}
                      selectedDay={favSelectedDay}
                      setSelectedDay={setFavSelectedDay}
                    />
                    {favSelectedDay && (
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(favEventsByDay.get(format(favSelectedDay, "yyyy-MM-dd")) ?? []).length === 0 ? (
                          <p className="col-span-full text-sm text-muted-foreground">
                            Sin favoritos este día.
                          </p>
                        ) : (
                          (favEventsByDay.get(format(favSelectedDay, "yyyy-MM-dd")) ?? []).map((e) => (
                            <FavoritePosterCard
                              key={e.id}
                              event={e}
                              onOpen={() => navigate(`/p/${e.partnerId}`)}
                              onUnfav={() => toggleFav(e)}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {view === "wallet" && (
          <Sentry.ErrorBoundary
            fallback={({ resetError }) => (
              <div className="mx-auto max-w-md py-12 text-center">
                <h1 className="mb-2 text-2xl font-bold">Wallet temporalmente no disponible</h1>
                <p className="mb-6 text-sm text-muted-foreground">
                  Hubo un problema cargando tus tickets. Tu compra está a salvo
                  — vuelve a intentarlo o recibirás un email con el QR.
                </p>
                <button
                  type="button"
                  onClick={() => resetError()}
                  className="inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-semibold text-white"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
                  }}
                >
                  Reintentar
                </button>
              </div>
            )}
          >
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Mis entradas</h1>
              <RefreshIndicator active={refrescandoEntradas && !confirmandoCompra} />
            </div>
            <p className="mb-6 text-sm text-muted-foreground">
              Tus entradas con código QR aparecen aquí después de la compra. Pulsa cualquiera para mostrar el código en la puerta.
            </p>

            {/* Vuelta de Stripe: se confirma la compra encima de las entradas
                que ya tenía, sin taparlas. */}
            {confirmandoCompra && (
              <div
                role="status"
                className="mb-6 flex items-center gap-3 rounded-2xl border p-4 text-sm"
                style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
              >
                <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                <div>
                  <div className="font-semibold text-foreground">Confirmando tu compra…</div>
                  <p className="text-[12px] text-muted-foreground">Tu entrada aparecerá aquí en unos segundos.</p>
                </div>
              </div>
            )}

            {/* Banner error explícito si falló el loader (RLS, network, etc.).
                No camufla a "wallet vacío" — el usuario sabe que hubo un fallo
                y puede reintentar. Si había entradas guardadas se siguen
                viendo (y funcionan en la puerta). */}
            {ticketsError && !ticketsLoading && (
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
                  <Ticket className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {tickets.length > 0 ? "No pudimos actualizar tus entradas" : "No pudimos cargar tu wallet"}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {tickets.length > 0 ? "Ves las últimas guardadas en este dispositivo; siguen valiendo en la puerta. " : ""}
                    Detalles: <code className="font-mono text-[11px] text-orange-400">{ticketsError}</code>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTickets()}
                  className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40"
                >
                  Reintentar
                </button>
              </div>
            )}

            {ticketsLoading ? (
              <PasifyEmptyState
                icon={<Ticket className="h-7 w-7" />}
                eyebrow="Cargando"
                title="Sincronizando tu wallet…"
                subtitle="Estamos recuperando tus tickets más recientes."
                spin
              />
            ) : tickets.length === 0 ? (
              <PasifyEmptyState
                icon={<Ticket className="h-7 w-7" />}
                eyebrow="Wallet vacío"
                title={<>Aún no tienes <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>entradas</span>.</>}
                subtitle="Cuando compres una entrada aparecerá aquí con su QR, cuenta atrás y opción de añadirla al calendario."
                action={{ label: "Descubrir locales", onClick: () => setView("home") }}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tickets.map((t) => (
                  <TicketCard
                    key={t.id}
                    ticket={t}
                    onOpenQR={() => setOpenTicket({ ticket: t, event: t.event })}
                    refundStatus={refundStatusForTicket(t.id)}
                    onRequestRefund={refundRequestRefund}
                  />
                ))}
              </div>
            )}

            <TicketQRModal
              open={!!openTicket}
              onClose={() => setOpenTicket(null)}
              ticket={openTicket?.ticket ?? null}
              event={openTicket?.event ?? null}
            />
          </div>
          </Sentry.ErrorBoundary>
        )}
      </main>

      {/* Bottom tab bar mobile — primitiva compartida (MobileBottomNav). */}
      <MobileBottomNav<View>
        items={tabBarItems}
        activeId={view}
        onSelect={setView}
        drawerSlot={
          <ClientDrawer
            navTree={navTree}
            view={view}
            onSelect={setView}
            onLogout={handleLogout}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
            city={userCity}
            variant="tab"
          />
        }
      />
      </div>

      {/* Sheets globales — abiertos desde el drawer */}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        role="client"
        email={null}
        displayName={userCity ? `Cliente · ${userCity}` : "Cliente Pasify"}
      />
      <HelpSheet
        open={helpOpen}
        onOpenChange={setHelpOpen}
        role="client"
        onOpenSupport={() => setView("support")}
      />
    </div>
  );
};

// ============================================================================
// ClientDrawer — Sheet lateral "Más" accesible desde la tab bar mobile.
// Reusa NavTree para mantener la misma estética que Partner/Admin.
// ============================================================================

const clientDrawerMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const ClientDrawer = ({
  navTree,
  view,
  onSelect,
  onLogout,
  onOpenSettings,
  onOpenHelp,
  city,
  variant = "topbar",
}: {
  navTree: NavTreeNode<View>[];
  view: View;
  onSelect: (id: View) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  city: string | null;
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
            style={{ ...clientDrawerMono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Pasify · Cliente
          </div>
          <div className="text-lg font-semibold tracking-tight text-foreground">
            {city ? `Tu noche en ${city}` : "Tu noche"}
          </div>
        </header>

        <nav className="flex-1 overflow-y-auto p-3">
          <div
            className="mb-2 px-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...clientDrawerMono, letterSpacing: "0.18em" }}
          >
            Secciones
          </div>
          <NavTree<View>
            tree={navTree}
            section={view}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />

          <div
            className="mb-2 mt-6 px-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...clientDrawerMono, letterSpacing: "0.18em" }}
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
              <span className="flex-1 text-left">Ayuda</span>
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

// ============================================================================

const PasifyBrand = ({ size = 26 }: { size?: number }) => <Wordmark height={size} />;

const CATEGORY_LABEL: Record<string, string> = {
  discoteca: "Discoteca",
  bar: "Bar",
  club: "Club",
  sala: "Sala",
  festival: "Festival",
  rooftop: "Rooftop",
  beachclub: "Beach Club",
  otro: "Otro",
};

// Card per evento favorito — stile poster identico a PartnerCard.
const FavoritePosterCard = ({
  event,
  onOpen,
  onUnfav,
}: {
  event: FavEvent;
  onOpen: () => void;
  onUnfav: () => void;
}) => {
  const date = new Date(event.date_start);
  const initial = (event.title?.[0] ?? "?").toUpperCase();
  // "Desde X €" (precio mínimo de sus tipos) o "Gratis".
  const priceLabel = eventPriceLabel(event.price_cents);
  return (
    <div
      role="button"
      onClick={onOpen}
      className="group cursor-pointer overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt={event.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
            }}
          >
            <span style={{ fontSize: 64, fontWeight: 800, color: "#F4EEE2", letterSpacing: "-0.04em" }}>
              {initial}
            </span>
          </div>
        )}

        {/* Gradient bottom */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{ background: "linear-gradient(to top, rgba(10,10,10,0.9) 0%, transparent 100%)" }}
        />

        {/* Date pill top-left */}
        <div
          className="absolute left-3 top-3 flex flex-col items-center rounded-md px-2 py-1 text-center"
          style={{ background: "rgba(232,84,42,0.95)", color: "#fff" }}
        >
          <span className="text-[10px] font-bold uppercase leading-none tracking-wider">
            {format(date, "MMM", { locale: es })}
          </span>
          <span className="mt-0.5 text-base font-bold leading-none">{format(date, "d", { locale: es })}</span>
        </div>

        {/* Heart top-right */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnfav();
          }}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur transition hover:scale-110"
          style={{ background: "rgba(10,10,10,0.45)" }}
          aria-label="Quitar de favoritos"
        >
          <Heart className="h-4 w-4" fill="#E8542A" stroke="#E8542A" />
        </button>

        {/* Title + venue bottom */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="truncate text-sm font-bold leading-tight text-white drop-shadow-md md:text-base">
            {event.title}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <div className="truncate text-[11px] text-white/85 drop-shadow">
              {event.partnerName ?? event.city}
              {event.partnerName && ` · ${event.city}`}
            </div>
            {priceLabel && (
              <div
                className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ background: "rgba(232,84,42,0.95)", color: "#fff" }}
              >
                {priceLabel}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const PartnerCard = ({ partner, onClick }: { partner: Partner; onClick: () => void }) => {
  const name = partner.business_name ?? "Local";
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const cover = partner.cover_image_url;
  const { isFavorite, toggle } = useFavoritePartners();
  const fav = isFavorite(partner.id);

  const handleFav = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggle(partner.id);
  };

  return (
    <button
      onClick={onClick}
      className="group overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10"
    >
      {/* Cover */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
        {cover ? (
          <img
            src={cover}
            alt={name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
            }}
          >
            <span style={{ fontSize: 64, fontWeight: 800, color: "#F4EEE2", letterSpacing: "-0.04em" }}>
              {initial}
            </span>
          </div>
        )}

        {/* Bottom gradient */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{ background: "linear-gradient(to top, rgba(10,10,10,0.85) 0%, transparent 100%)" }}
        />

        {/* Favorite heart top-left (span con role=button per evitare button>button) */}
        <span
          role="button"
          tabIndex={0}
          aria-label={fav ? "Quitar de favoritos" : "Añadir a favoritos"}
          aria-pressed={fav}
          onClick={handleFav}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleFav(e);
          }}
          className="absolute left-3 top-3 z-10 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full backdrop-blur-md transition hover:scale-110 active:scale-95"
          style={{
            background: fav ? "rgba(232,84,42,0.95)" : "rgba(10,10,10,0.55)",
            border: `1px solid ${fav ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.18)"}`,
            boxShadow: fav
              ? "0 6px 18px -6px rgba(232,84,42,0.65), inset 0 1px 0 rgba(255,255,255,0.25)"
              : "0 4px 12px -4px rgba(0,0,0,0.4)",
          }}
        >
          <Heart
            className="h-[18px] w-[18px] transition"
            color="#fff"
            fill={fav ? "#fff" : "transparent"}
            strokeWidth={fav ? 2 : 2.2}
          />
        </span>

        {/* Category badge top-right */}
        {partner.business_category && (
          <div
            className="absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: "rgba(232,84,42,0.95)",
              color: "#fff",
              borderColor: "rgba(255,255,255,0.2)",
            }}
          >
            {CATEGORY_LABEL[partner.business_category] ?? partner.business_category}
          </div>
        )}

        {/* Avatar circle bottom-left over cover */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2.5">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border-2"
            style={{
              background: partner.avatar_url ? "#0F0F0F" : "#E8542A",
              color: "#fff",
              fontWeight: 700,
              fontSize: 16,
              borderColor: "#F4EEE2",
            }}
          >
            {partner.avatar_url ? (
              <img src={partner.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight text-white drop-shadow-md">
              {name}
            </div>
            {partner.city && (
              <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-white/85 drop-shadow">
                <MapPin className="h-3 w-3" />
                {partner.city}
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

// ============================================================================
// TicketCard — card editorial del wallet con cuenta atrás en vivo + ICS
// ============================================================================

const ticketCardMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const useCountdown = (target: Date | string | null | undefined) => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [target]);
  if (!target) return { label: "—", state: "none" as const };
  const t = new Date(target).getTime();
  const diff = t - now;
  if (diff <= -4 * 60 * 60 * 1000) return { label: "Finalizado", state: "past" as const };
  if (diff <= 0) return { label: "Está ocurriendo", state: "live" as const };
  const min = Math.floor(diff / 60_000);
  const days = Math.floor(min / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  const minutes = min % 60;
  if (days >= 2) return { label: `En ${days}d ${hours}h`, state: "future" as const };
  if (days === 1) return { label: `Mañana · ${hours}h ${minutes}m`, state: "soon" as const };
  if (hours >= 1) return { label: `En ${hours}h ${minutes}m`, state: "soon" as const };
  return { label: `En ${minutes} min`, state: "imminent" as const };
};

const TicketCard = ({
  ticket,
  onOpenQR,
  refundStatus,
  onRequestRefund,
}: {
  ticket: WalletTicket & { event: TicketEventInfo | null };
  onOpenQR: () => void;
  /** Solicitud de reembolso de esta entrada (si hay). */
  refundStatus: RefundRequest | null;
  onRequestRefund: (ticketId: string, reason: string) => Promise<unknown> | unknown;
}) => {
  const event = ticket.event;
  const date = event ? new Date(event.date_start) : null;
  // Día, mes y hora en la hora del evento (Europe/Madrid), no la del móvil.
  const dayMonth = event ? eventDayMonth(event.date_start) : null;
  const time = event ? formatEventTime(event.date_start) : "";
  const countdown = useCountdown(date);
  const { toast } = useToast();
  const refundState = refundStatus?.status ?? null;
  const canRefund =
    !refundStatus &&
    ticket.status !== "used" &&
    ticket.status !== "refunded" &&
    countdown.state !== "past";
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const statusLabel =
    ticket.status === "used"
      ? "Usado"
      : ticket.status === "refunded"
      ? "Reembolsado"
      : countdown.state === "past"
      ? "Caducado"
      : "Válido";
  const statusColor =
    ticket.status === "used"
      ? "rgba(10,10,10,0.7)"
      : ticket.status === "refunded"
      ? "rgba(232,176,76,0.95)"
      : countdown.state === "past"
      ? "rgba(140,140,140,0.95)"
      : "rgba(232,84,42,0.95)";

  const handleIcs = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!event || !date) return;
    downloadIcs(`pasify-${ticket.id.slice(0, 8)}`, {
      uid: ticket.id,
      title: event.title ?? "Evento Pasify",
      description: event.partner_name
        ? `Pasify · ${event.partner_name}`
        : "Tu entrada en Pasify",
      location: event.venue_name ?? event.partner_name ?? undefined,
      start: date,
    });
  };

  const handleMaps = (e: React.MouseEvent) => {
    e.stopPropagation();
    const q = encodeURIComponent(event?.venue_name ?? event?.partner_name ?? "");
    if (!q) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener");
  };

  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-border bg-card transition duration-300 hover:-translate-y-0.5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 18px -10px rgba(0,0,0,0.45)" }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition duration-300 group-hover:opacity-100"
        style={{
          boxShadow: "0 22px 50px -18px rgba(232,84,42,0.25), 0 0 0 1px rgba(232,84,42,0.35)",
        }}
      />

      {/* MEDIA */}
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        {event?.image_url ? (
          <img
            src={event.image_url}
            alt={event.title ?? "Evento"}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
              color: "#F4EEE2",
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            {(event?.title?.[0] ?? "?").toUpperCase()}
          </div>
        )}

        {/* dark gradient bottom */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(10,10,10,0.05) 0%, rgba(10,10,10,0.65) 100%)",
          }}
        />

        {/* date pill top-left */}
        {dayMonth && (
          <div
            className="absolute left-3 top-3 flex flex-col items-center rounded-lg px-2.5 py-1.5 text-center backdrop-blur-md"
            style={{
              background: "rgba(232,84,42,0.94)",
              color: "#fff",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.3), 0 6px 18px -6px rgba(232,84,42,0.5)",
            }}
          >
            <span
              className="text-[9px] font-semibold uppercase leading-none"
              style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
            >
              {dayMonth.month}
            </span>
            <span
              className="mt-1 text-xl font-bold leading-none"
              style={{ ...ticketCardMono, letterSpacing: "-0.02em" }}
            >
              {dayMonth.day}
            </span>
          </div>
        )}

        {/* status badge top-right */}
        <div
          className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
          style={{ ...ticketCardMono, letterSpacing: "0.16em", background: statusColor, color: "#fff" }}
        >
          {statusLabel}
        </div>

        {/* title + venue on dark bottom */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="truncate text-base font-bold leading-tight text-white drop-shadow md:text-lg">
            {event?.title ?? "Evento"}
          </div>
          <div
            className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-white/85 drop-shadow"
            style={{ ...ticketCardMono, letterSpacing: "0.08em" }}
          >
            {time && <span>{time}H</span>}
            {time && (event?.venue_name || event?.partner_name) && (
              <span className="opacity-50">·</span>
            )}
            {(event?.venue_name || event?.partner_name) && (
              <span className="truncate">{event?.venue_name ?? event?.partner_name}</span>
            )}
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="p-4">
        {/* Tipo de entrada (si se ha podido leer) */}
        {ticket.tier_name && (
          <div
            className="mb-2 truncate text-[10px] uppercase text-muted-foreground"
            style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
          >
            Entrada · <span className="text-foreground">{ticket.tier_name}</span>
          </div>
        )}

        {/* Countdown */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <span
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
          >
            Cuenta atrás
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase"
            style={{
              ...ticketCardMono,
              letterSpacing: "0.14em",
              color:
                countdown.state === "live"
                  ? "#4DB87A"
                  : countdown.state === "past"
                  ? "#8A8275"
                  : countdown.state === "imminent" || countdown.state === "soon"
                  ? "#E8B04C"
                  : "#FF7A4D",
            }}
          >
            {(countdown.state === "live" || countdown.state === "imminent") && (
              <span className="relative inline-flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                  style={{
                    background: countdown.state === "live" ? "#4DB87A" : "#E8B04C",
                  }}
                />
                <span
                  className="relative inline-flex h-1.5 w-1.5 rounded-full"
                  style={{
                    background: countdown.state === "live" ? "#4DB87A" : "#E8B04C",
                  }}
                />
              </span>
            )}
            {countdown.label}
          </span>
        </div>

        {/* CTAs */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpenQR}
            className="group/btn flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(80,20,5,0.22), 0 6px 16px -4px rgba(232,84,42,0.5), 0 14px 32px -10px rgba(184,56,26,0.5)",
              letterSpacing: "-0.005em",
            }}
          >
            <Ticket className="h-4 w-4" />
            Ver mi QR
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1"
            >
              →
            </span>
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleIcs}
              disabled={!event || !date}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ ...ticketCardMono, letterSpacing: "0.08em" }}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              CALENDARIO
            </button>
            <button
              type="button"
              onClick={handleMaps}
              disabled={!event?.venue_name && !event?.partner_name}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ ...ticketCardMono, letterSpacing: "0.08em" }}
            >
              <MapPin className="h-3.5 w-3.5" />
              CÓMO LLEGAR
            </button>
          </div>

          {/* Refund link */}
          {canRefund && (
            <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="mx-auto block text-[10px] uppercase text-muted-foreground transition hover:text-orange-500"
                  style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
                >
                  ¿No puedes asistir? Solicita reembolso
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Solicitar reembolso</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Cuéntanos por qué necesitas el reembolso. El equipo de Pasify lo revisará en menos de 48 horas.
                  </p>
                  <Textarea
                    placeholder="Motivo (enfermedad, cambio de planes…)"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    rows={4}
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setRefundOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => {
                      if (!refundReason.trim()) {
                        toast({
                          title: "Falta motivo",
                          description: "Por favor, cuéntanos brevemente por qué necesitas el reembolso.",
                          variant: "destructive",
                        });
                        return;
                      }
                      void Promise.resolve(
                        onRequestRefund(ticket.id, refundReason.trim())
                      ).catch(() => {
                        /* el hook ya muestra toast en caso de error */
                      });
                      setRefundOpen(false);
                      setRefundReason("");
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Enviar solicitud
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {refundState === "pending" && (
            <div
              className="rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-center text-[10px] uppercase text-orange-400"
              style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
            >
              Reembolso solicitado · En revisión
            </div>
          )}
          {(refundState === "approved" ||
            refundState === "processing" ||
            refundState === "refunded") && (
            <div
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-[10px] uppercase text-emerald-400"
              style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
            >
              Reembolso aprobado
            </div>
          )}
          {refundState === "rejected" && (
            <div
              className="rounded-xl border border-muted bg-muted/10 px-3 py-2 text-center text-[10px] uppercase text-muted-foreground"
              style={{ ...ticketCardMono, letterSpacing: "0.18em" }}
            >
              Reembolso denegado
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

export default ClientDashboard;
