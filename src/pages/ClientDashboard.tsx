import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signOutLocal } from "@/hooks/useAuth";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { useSessionState } from "@/lib/useSessionState";
import { RefreshIndicator } from "@/components/ui/refresh-indicator";
import {
  TODA_ESPANA,
  enCiudad,
  useCiudadElegida,
  useClientShowcase,
  useMyProfile,
  useMyTickets,
  usePublicPartners,
  type WalletTicketRow,
} from "@/hooks/queries/clientData";
import { useFavoritePartners } from "@/hooks/useFavoritePartners";
import CitySelector from "@/components/shared/CitySelector";
import { AccionesEntrada } from "@/components/client/AccionesEntrada";
import { loginPathWithNext } from "@/lib/eventLinks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageCircle,
  Ticket,
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
  Utensils,
  Theater,
  Heart,
  LogOut,
  WifiOff,
  AlertTriangle,
  Ban,
  ChevronDown,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { FavEvent } from "@/hooks/useFavorites";
import SupportChat from "@/components/support/SupportChat";
import ProfileSheet from "@/components/client/ProfileSheet";
import TicketQRModal from "@/components/client/TicketQRModal";
import { TICKETS_UPDATED_EVENT } from "@/hooks/usePendingCheckoutResume";
import {
  DEFAULT_EVENT_TIMEZONE,
  eventDayMonth,
  eventPriceLabel,
  formatEventDateTime,
  formatEventTime,
  formatPriceCents,
  isEventOver,
} from "@/components/tickets/ticketUtils";
import { useFavorites } from "@/hooks/useFavorites";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { MonthGrid } from "@/components/event/MonthGrid";
import { CalendarDays, List as ListIcon } from "lucide-react";
import Wordmark from "@/components/Wordmark";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { downloadIcs } from "@/lib/ics";
import { publicEventUrl } from "@/lib/eventLinks";
import { isNativeApp } from "@/lib/platform";
import { normalizeForSearch } from "@/data/spanish-cities";
import { ClientLoyalty, PUNTOS_TEXTO_HONESTO } from "@/components/client/ClientLoyalty";
import { SmartHomeStrip } from "@/components/client/SmartHomeStrip";
import { ClientLiveExperience } from "@/components/client/ClientLiveExperience";
import { ClientConcierge } from "@/components/client/ClientConcierge";
import { ClientDemoBanner } from "@/components/client/ClientDemoBanner";
import { UpcomingEventsStrip } from "@/components/client/UpcomingEventsStrip";
import { Crown, Radio, Gem, Menu, MoreHorizontal, HelpCircle, Settings, ChevronRight } from "lucide-react";
import { NavTree, type NavTreeNode } from "@/components/shared/NavTree";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SettingsSheet } from "@/components/shared/SettingsSheet";
import { HelpSheet } from "@/components/shared/HelpSheet";
import { useRefundRequests, type RefundRequest } from "@/hooks/useRefundRequests";
import { Sentry } from "@/lib/sentry";
import { MobileTopBar } from "@/components/shared/MobileTopBar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw } from "lucide-react";

type View = "home" | "support" | "wallet" | "favorites" | "loyalty" | "live" | "concierge";

/**
 * VISTAS MAQUETA — SOLO EN MODO DEMO (D-7).
 *
 * "En vivo" (asistentes y fotos inventados, pulsera cashless) y el Concierge
 * "Premium" (promete backstage y traslados) no tienen nada real detrás. No se
 * borran, pero solo existen cuando se cumplen a la vez:
 *   - la cuenta es de demo: flag `client_showcase` de get_feature_flag con el
 *     uid del usuario (tenant_overrides), apagado para todos por defecto;
 *   - estamos en la web: en la app nativa, nunca (isNativeApp);
 *   - y van debajo de la franja "DEMO · datos ficticios".
 * Sin demo desaparecen del menú y sus URL (/client-dashboard/live…) llevan a
 * Inicio. Lo mismo para las recomendaciones inventadas de la home
 * (SmartHomeStrip): fuera de la demo, la home enseña eventos de verdad.
 */
const VISTAS_DEMO: ReadonlySet<View> = new Set<View>(["live", "concierge"]);

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

// Mismas categorías que eligen los locales (PartnerOnboardingWizard y
// PartnerSettingsBlock), restaurantes y teatros incluidos.
const CATEGORIES = [
  { id: "all", label: "Todos", Icon: PartyPopper },
  { id: "discoteca", label: "Discotecas", Icon: Disc3 },
  { id: "bar", label: "Bares", Icon: Beer },
  { id: "club", label: "Clubs", Icon: Music2 },
  { id: "sala", label: "Salas", Icon: Building2 },
  { id: "festival", label: "Festivales", Icon: PartyPopper },
  { id: "rooftop", label: "Rooftops", Icon: Sun },
  { id: "beachclub", label: "Beach Clubs", Icon: Waves },
  { id: "restaurante", label: "Restaurantes", Icon: Utensils },
  { id: "teatro", label: "Teatros", Icon: Theater },
  { id: "otro", label: "Otros", Icon: StoreIcon },
];

const VIEWS: readonly View[] = ["home", "support", "wallet", "favorites", "loyalty", "live", "concierge"];
const isView = (value: string | undefined): value is View =>
  !!value && (VIEWS as readonly string[]).includes(value);

// Referencias estables mientras no hay datos.
const SIN_ENTRADAS: WalletTicketRow[] = [];
const SIN_LOCALES: Partner[] = [];

const serifAccent = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
  color: "#FF7A4D",
};

// Día de un evento en SU zona horaria (Europe/Madrid), con el formato de las
// claves de MonthGrid (yyyy-MM-dd). Con la hora del móvil, un evento a las
// 00:30 en Madrid caía en otro día visto desde Canarias o Londres.
const diaEventoFmt = new Intl.DateTimeFormat("es-ES", {
  timeZone: DEFAULT_EVENT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const claveDiaEvento = (iso: string): string | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = diaEventoFmt.formatToParts(d);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
};

const ClientDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();
  const handleLogout = async () => {
    await signOutLocal();
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
  // Una sola ciudad (B2-10): la del perfil, que filtra los locales y los
  // próximos eventos de Inicio y el Calendario. null = «Toda España». Antes
  // la home decía «tu zona» y enseñaba los locales de toda España.
  const { ciudad, cambiarCiudad, cargando: cargandoCiudad } = useCiudadElegida();
  const userCity = ciudad ?? "";
  const [selectorCiudadAbierto, setSelectorCiudadAbierto] = useState(false);
  const abrirSelectorCiudad = useCallback(() => setSelectorCiudadAbierto(true), []);
  const perfil = useMyProfile(uid).data ?? null;
  const nombrePerfil = [perfil?.first_name, perfil?.last_name].filter(Boolean).join(" ").trim();

  // Modo demo (ver VISTAS_DEMO): nunca en la app; en la web, solo la cuenta de demo.
  const enApp = isNativeApp();
  const showcaseQuery = useClientShowcase(uid, !enApp);
  const showcase = !enApp && showcaseQuery.data === true;
  // ¿Ya se sabe? Mientras llega la primera respuesta, una URL de maqueta
  // enseña Inicio en vez de mandar fuera a la cuenta de demo antes de tiempo.
  const showcaseDecidido = enApp || showcaseQuery.data !== undefined || showcaseQuery.fetchStatus !== "fetching";
  const esVistaDemo = VISTAS_DEMO.has(view);
  const vistaActiva: View = esVistaDemo && !showcase ? "home" : view;
  // Enlace guardado a una maqueta sin modo demo: a Inicio, sin dejarla en el historial.
  useEffect(() => {
    if (esVistaDemo && showcaseDecidido && !showcase) navigate("/client-dashboard", { replace: true });
  }, [esVistaDemo, showcaseDecidido, showcase, navigate]);

  const favoritos = useFavorites();
  const { events: favEvents, toggle: toggleFav } = favoritos;
  const [favTab, setFavTab] = useSessionState<"list" | "calendar">("cliente.favoritos.vista", "list");
  // Favoritos: eventos o locales (B2-03).
  const [favSeccion, setFavSeccion] = useSessionState<"eventos" | "locales">("cliente.favoritos.seccion", "eventos");

  // Locales favoritos: una sola consulta para toda la pantalla (tarjetas de
  // Inicio y sección «Locales»). Sin sesión, el corazón lleva al login.
  const localesFavoritos = useFavoritePartners();
  const { sinSesion: favLocalesSinSesion, toggle: toggleLocalFav } = localesFavoritos;
  const alternarLocalFavorito = useCallback(
    (p: Partner) => {
      if (favLocalesSinSesion) {
        navigate(loginPathWithNext(`/p/${p.id}`));
        return;
      }
      void toggleLocalFav(p);
    },
    [favLocalesSinSesion, toggleLocalFav, navigate],
  );
  const [verFavPasados, setVerFavPasados] = useState(false);
  // Próximos (en fecha) y Pasados (ya terminados, misma regla que el servidor
  // para dejar de vender). Solo los próximos cuentan en el menú.
  const { favProximos, favPasados } = useMemo(() => {
    const ahora = Date.now();
    const proximos: FavEvent[] = [];
    const pasados: FavEvent[] = [];
    for (const e of favEvents) (isEventOver(e, ahora) ? pasados : proximos).push(e);
    proximos.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
    pasados.sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
    return { favProximos: proximos, favPasados: pasados };
  }, [favEvents]);

  // Entradas en la caché y guardadas en el dispositivo: la cartera se abre al
  // instante (también sin conexión) y se refresca detrás. Antes cada vez que
  // se entraba en Tickets salía "Sincronizando tu wallet…" y se pedía todo.
  //
  // Error explícito: NO se camufla un fallo (RLS / red / query mal formada)
  // como "el usuario no tiene tickets": sin entradas guardadas sale el error
  // con Reintentar (y nada más); con entradas guardadas se siguen enseñando,
  // con un aviso de cuándo se actualizaron por última vez.
  const ticketsQuery = useMyTickets(uid);
  const tickets = ticketsQuery.data ?? SIN_ENTRADAS;
  // Sin red React Query deja la consulta en pausa (no es un error ni "cargando").
  const ticketsEnPausa = ticketsQuery.fetchStatus === "paused";
  const ticketsSinRed = !!uid && ticketsQuery.isPending && ticketsEnPausa;
  const ticketsLoading = !!uid && ticketsQuery.isPending && !ticketsQuery.isError && !ticketsSinRed;
  const ticketsFallo = ticketsQuery.isError || ticketsSinRed;
  // Con entradas guardadas: aviso si el último refresco falló o no hay red.
  const avisoEntradas = ticketsQuery.isError || ticketsEnPausa || !isOnline;
  const refrescandoEntradas = ticketsQuery.isFetching && !ticketsQuery.isPending;
  const { refetch: refetchTickets } = ticketsQuery;
  const loadTickets = useCallback(() => refetchTickets(), [refetchTickets]);
  const invalidarEntradas = useCallback(() => {
    if (uid) void queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) });
  }, [uid, queryClient]);
  // Reembolsadas: aparte, en una sección plegada (antes desaparecían).
  const { entradasActivas, entradasReembolsadas } = useMemo(
    () => ({
      entradasActivas: tickets.filter((t) => t.status !== "refunded"),
      entradasReembolsadas: tickets.filter((t) => t.status === "refunded"),
    }),
    [tickets],
  );
  const [verReembolsadas, setVerReembolsadas] = useState(false);
  // Compra recién pagada que se está confirmando (vuelta de Stripe).
  const [confirmandoCompra, setConfirmandoCompra] = useState(false);

  // El QR abierto se lee siempre de la lista actual: si mientras está en
  // pantalla llega un reembolso o la cancelación del evento, el modal lo
  // refleja (y si la entrada deja de ser tuya, se cierra).
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const openTicket = openTicketId ? tickets.find((t) => t.id === openTicketId) ?? null : null;
  const [favMonthCursor, setFavMonthCursor] = useState<Date>(new Date());
  const [favSelectedDay, setFavSelectedDay] = useState<Date | null>(null);

  const favEventsByDay = useMemo(() => {
    const map = new Map<string, FavEvent[]>();
    favEvents.forEach((e) => {
      const k = claveDiaEvento(e.date_start);
      if (!k) return; // fecha mal formada
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    });
    return map;
  }, [favEvents]);

  // Locales de la home en la caché (y en el dispositivo). Sin fallback a
  // demo: si no hay locales aprobados, empty state explícito más abajo. Un
  // fallo (o no tener red) sin nada guardado ya no se confunde con "aún no
  // hay locales": sale el error con Reintentar.
  const partnersQuery = usePublicPartners();
  const partners = (partnersQuery.data as Partner[] | undefined) ?? SIN_LOCALES;
  const partnersSinRed = partnersQuery.isPending && partnersQuery.fetchStatus === "paused";
  // Mientras llega la ciudad del perfil (primera vez, sin nada guardado) no se
  // pintan los de toda España para quitarlos un instante después.
  const loading = (partnersQuery.isPending && !partnersQuery.isError && !partnersSinRed) || cargandoCiudad;
  const partnersFallo = partnersQuery.data === undefined && (partnersQuery.isError || partnersSinRed);
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

  // Búsqueda sin acentos ni mayúsculas ("mas alla" encuentra "Más Allá"),
  // dentro de la ciudad elegida (enCiudad: "Palma" encuentra "Palma de
  // Mallorca"; sin ciudad, toda España).
  const filtered = useMemo(() => {
    const q = normalizeForSearch(search);
    return partners.filter((p) => {
      if (!enCiudad(p.city, ciudad)) return false;
      if (activeCat !== "all" && p.business_category !== activeCat) return false;
      if (q) {
        const categoria = CATEGORY_LABEL[p.business_category ?? ""] ?? p.business_category ?? "";
        const hay = normalizeForSearch(`${p.business_name ?? ""} ${p.city ?? ""} ${categoria}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [partners, search, activeCat, ciudad]);

  // Mobile Settings/Help sheets — state lifted al padre para que
  // ambos triggers (header drawer + tab bar drawer) compartan el estado.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const abrirAjustes = useCallback(() => setSettingsOpen(true), []);

  // Tree de navegación. Las maquetas (En vivo, Concierge) solo con modo demo;
  // sin él, Pasify Points va suelto (un grupo de un solo hijo no tiene sentido).
  const nodosMembresia: NavTreeNode<View>[] = showcase
    ? [
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
      ]
    : [{ kind: "item", id: "loyalty", label: "Pasify Points", icon: <Crown className="h-5 w-5" /> }];
  const navTree: NavTreeNode<View>[] = [
    { kind: "item", id: "home", label: "Inicio", icon: <Home className="h-5 w-5" /> },
    { kind: "item", id: "favorites", label: "Favoritos", icon: <EventsIcon count={favProximos.length} /> },
    { kind: "item", id: "wallet", label: "Tickets", icon: <Ticket className="h-5 w-5" /> },
    ...nodosMembresia,
    { kind: "item", id: "support", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  // Bottom tab bar mobile — 4 entradas más usadas; el resto en el drawer "Más".
  const tabBarItems: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "home", label: "Inicio", icon: <Home className="h-5 w-5" /> },
    { id: "favorites", label: "Favoritos", icon: <EventsIcon count={favProximos.length} /> },
    { id: "wallet", label: "Tickets", icon: <Ticket className="h-5 w-5" /> },
    { id: "support", label: "Soporte", icon: <MessageCircle className="h-5 w-5" /> },
  ];

  const hayFiltros = !!search.trim() || activeCat !== "all";
  const abrirFavorito = (e: FavEvent) => navigate(`/e/${e.id}`);

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar desktop */}
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
          <div className="flex flex-col items-start gap-3 border-b border-border p-5">
            <PasifyBrand size={84} />
            <button
              type="button"
              onClick={abrirSelectorCiudad}
              aria-label={`Tu ciudad: ${ciudad ?? TODA_ESPANA}. Cambiar`}
              className="-mx-1 inline-flex min-h-[32px] items-center gap-1 rounded-full px-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <MapPin className="h-3 w-3" />
              {ciudad ?? TODA_ESPANA}
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            <NavTree<View> tree={navTree} section={vistaActiva} onSelect={setView} />
          </nav>
          <div className="border-t border-border p-2">
            {userId && <ProfileSheet userId={userId} variant="row" onOpenSettings={abrirAjustes} />}
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
          showBack={vistaActiva !== "home"}
          onBack={() => setView("home")}
          endSlot={
            <>
              {userId && <ProfileSheet userId={userId} onOpenSettings={abrirAjustes} />}
              <ClientDrawer
                navTree={navTree}
                view={vistaActiva}
                onSelect={setView}
                onLogout={handleLogout}
                onOpenSettings={abrirAjustes}
                onOpenHelp={() => setHelpOpen(true)}
                city={userCity}
              />
            </>
          }
        />

        <main className="flex-1 overflow-x-auto p-6 pb-24 md:p-8 md:pb-8">
        {vistaActiva === "home" && (
          <>
            {/* Ciudad (una sola, la del perfil) y búsqueda */}
            <div className="pt-4">
              <button
                type="button"
                onClick={abrirSelectorCiudad}
                aria-label={`Tu ciudad: ${ciudad ?? TODA_ESPANA}. Cambiar`}
                className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:border-primary/40"
              >
                <MapPin className="h-4 w-4 text-primary" />
                {ciudad ?? TODA_ESPANA}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={ciudad ? `Busca locales o categorías en ${ciudad}…` : "Busca locales, ciudades, categorías..."}
                  aria-label="Buscar locales"
                  className="h-13 rounded-full pl-11 text-base"
                  style={{ height: "52px" }}
                />
              </div>

              {/* Category chips — 44 px de alto como mínimo (zona táctil). */}
              <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {CATEGORIES.map((c) => {
                  const active = activeCat === c.id;
                  const Icon = c.Icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setActiveCat(c.id)}
                      aria-pressed={active}
                      className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs font-medium transition ${
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

            {/* Próximos eventos de verdad (calendario público) de la ciudad, sin filtros activos. */}
            {!hayFiltros && !cargandoCiudad && (
              <div className="mt-8">
                <UpcomingEventsStrip
                  city={ciudad}
                  onOpen={(id) => navigate(`/e/${id}`)}
                  onSeeAll={() => navigate("/calendar")}
                />
              </div>
            )}

            {/* Recomendaciones inventadas: SOLO en modo demo y con la franja. */}
            {showcase && !loading && !hayFiltros && partners.length > 0 && (
              <div className="mt-8">
                <ClientDemoBanner />
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
              ) : partnersFallo ? (
                <ErrorDeCarga
                  sinConexion={partnersSinRed || !isOnline}
                  que="los locales"
                  reintentando={partnersQuery.isFetching}
                  onRetry={() => void partnersQuery.refetch()}
                />
              ) : filtered.length === 0 ? (
                <PasifyEmptyState
                  icon={<Search className="h-7 w-7" />}
                  eyebrow={hayFiltros ? "Sin resultados" : "Sin locales"}
                  title={
                    hayFiltros ? (
                      <>Nada coincide con tu <span style={serifAccent}>búsqueda</span>.</>
                    ) : ciudad ? (
                      <>Aún no hay <span style={serifAccent}>locales</span> en {ciudad}.</>
                    ) : (
                      <>Aún no hay <span style={serifAccent}>locales</span> en Pasify.</>
                    )
                  }
                  subtitle={
                    hayFiltros
                      ? ciudad
                        ? `Buscamos solo en ${ciudad}. Prueba con otra búsqueda, otra categoría o toda España.`
                        : "Prueba con otra búsqueda o cambia la categoría arriba."
                      : ciudad
                        ? "Pasify está creciendo cada semana. Mientras tanto, mira lo que hay en el resto de España."
                        : "Pasify está creciendo cada semana. Vuelve pronto para descubrir los próximos locales."
                  }
                  action={
                    hayFiltros
                      ? { label: "Limpiar filtros", onClick: () => { setSearch(""); setActiveCat("all"); } }
                      : ciudad
                        ? { label: "Ver toda España", onClick: () => void cambiarCiudad(null) }
                        : undefined
                  }
                  secondaryAction={
                    hayFiltros && ciudad
                      ? { label: "Buscar en toda España", onClick: () => void cambiarCiudad(null), variant: "ghost" }
                      : !hayFiltros && ciudad
                        ? { label: "Cambiar ciudad", onClick: abrirSelectorCiudad, variant: "ghost" }
                        : undefined
                  }
                  compact
                />
              ) : (
                <>
                  {(partnersQuery.isError || !isOnline) && (
                    <AvisoRefresco
                      sinConexion={!isOnline}
                      texto="No hemos podido actualizar los locales: ves los últimos guardados."
                      reintentando={partnersQuery.isFetching}
                      onRetry={() => void partnersQuery.refetch()}
                    />
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((p) => (
                      <PartnerCard
                        key={p.id}
                        partner={p}
                        onClick={() => navigate(`/p/${p.id}`)}
                        favorito={localesFavoritos.ids.has(p.id)}
                        onToggleFavorito={() => alternarLocalFavorito(p)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

          </>
        )}

        {vistaActiva === "live" && showcase && (
          <div>
            <ClientDemoBanner />
            <h1 className="mb-1 text-3xl font-bold tracking-tight">En vivo</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Tu modo evento — line-up en directo, mapa interno, pagos con pulsera y muro de fotos.
            </p>
            <ClientLiveExperience ticketHasEventToday />
          </div>
        )}

        {vistaActiva === "concierge" && showcase && (
          <div>
            <ClientDemoBanner />
            <h1 className="mb-1 text-3xl font-bold tracking-tight">Concierge</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Servicio premium: una persona organiza tu noche entera — mesas, restaurante, traslado, backstage.
            </p>
            <ClientConcierge />
          </div>
        )}

        {vistaActiva === "loyalty" && (
          <div>
            <h1 className="mb-1 text-3xl font-bold tracking-tight">Pasify Points</h1>
            <p className="mb-6 text-sm text-muted-foreground">{PUNTOS_TEXTO_HONESTO}</p>
            <ClientLoyalty />
          </div>
        )}

        {vistaActiva === "support" && (
          <div>
            <h1 className="mb-1 text-3xl font-bold tracking-tight">Soporte</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Chatea con el equipo Pasify. Te respondemos en horario laboral, de lunes a viernes.
            </p>
            <SupportChat mode="client" />
          </div>
        )}

        {vistaActiva === "favorites" && (
          <div className="pt-6">
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Favoritos</h1>
            <p className="mb-4 text-sm text-muted-foreground">
              Los eventos y locales que has guardado. Pulsa el corazón para quitar.
            </p>

            {/* Eventos / Locales (B2-03) */}
            <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Qué favoritos ver">
              <PestanaFavoritos
                activa={favSeccion === "eventos"}
                onClick={() => setFavSeccion("eventos")}
                icono={<CalendarDays className="h-4 w-4" />}
                texto="Eventos"
                cuenta={favoritos.hasData ? favEvents.length : null}
              />
              <PestanaFavoritos
                activa={favSeccion === "locales"}
                onClick={() => setFavSeccion("locales")}
                icono={<StoreIcon className="h-4 w-4" />}
                texto="Locales"
                cuenta={localesFavoritos.hasData ? localesFavoritos.locales.length : null}
              />
            </div>

            {favSeccion === "locales" ? (
              localesFavoritos.loading ? (
                <PasifyEmptyState
                  icon={<Heart className="h-7 w-7" />}
                  eyebrow="Cargando"
                  title="Cargando tus locales…"
                  spin
                  compact
                />
              ) : !localesFavoritos.hasData && (localesFavoritos.isError || localesFavoritos.offline) ? (
                <ErrorDeCarga
                  sinConexion={localesFavoritos.offline || !isOnline}
                  que="tus locales"
                  reintentando={localesFavoritos.isFetching}
                  onRetry={() => void localesFavoritos.refetch()}
                />
              ) : localesFavoritos.locales.length === 0 ? (
                <PasifyEmptyState
                  icon={<StoreIcon className="h-7 w-7" />}
                  eyebrow="Sin locales"
                  title={<>Aún no has guardado ningún <span style={serifAccent}>local</span>.</>}
                  subtitle="Pulsa el corazón de un local para tenerlo siempre a mano."
                  action={{ label: "Descubrir locales", onClick: () => setView("home") }}
                />
              ) : (
                <>
                  {(localesFavoritos.isError || !isOnline) && (
                    <AvisoRefresco
                      sinConexion={!isOnline}
                      texto="No hemos podido actualizar tus locales: ves los últimos guardados."
                      reintentando={localesFavoritos.isFetching}
                      onRetry={() => void localesFavoritos.refetch()}
                    />
                  )}
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Locales · {localesFavoritos.locales.length}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {localesFavoritos.locales.map((p) => (
                      <PartnerCard
                        key={p.id}
                        partner={p}
                        onClick={() => navigate(`/p/${p.id}`)}
                        favorito
                        onToggleFavorito={() => alternarLocalFavorito(p)}
                      />
                    ))}
                  </div>
                </>
              )
            ) : favoritos.loading ? (
              <PasifyEmptyState
                icon={<Heart className="h-7 w-7" />}
                eyebrow="Cargando"
                title="Cargando tus favoritos…"
                spin
                compact
              />
            ) : !favoritos.hasData && (favoritos.isError || favoritos.offline) ? (
              <ErrorDeCarga
                sinConexion={favoritos.offline || !isOnline}
                que="tus favoritos"
                reintentando={favoritos.isFetching}
                onRetry={() => void favoritos.refetch()}
              />
            ) : favEvents.length === 0 ? (
              <PasifyEmptyState
                icon={<Heart className="h-7 w-7" />}
                eyebrow="Sin favoritos"
                title={<>Aún no has guardado ningún <span style={serifAccent}>evento</span>.</>}
                subtitle="Cuando guardes un evento con el corazón, aparecerá aquí."
                action={{ label: "Descubrir locales", onClick: () => setView("home") }}
              />
            ) : (
              <>
                {(favoritos.isError || !isOnline) && (
                  <AvisoRefresco
                    sinConexion={!isOnline}
                    texto="No hemos podido actualizar tus favoritos: ves los últimos guardados."
                    reintentando={favoritos.isFetching}
                    onRetry={() => void favoritos.refetch()}
                  />
                )}

                {/* Tabs Lista / Calendario */}
                <div className="mb-4 inline-flex rounded-full border border-border bg-card p-1">
                  <button
                    type="button"
                    onClick={() => setFavTab("list")}
                    aria-pressed={favTab === "list"}
                    className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition ${
                      favTab === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                    Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => setFavTab("calendar")}
                    aria-pressed={favTab === "calendar"}
                    className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition ${
                      favTab === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Calendario
                  </button>
                </div>

                {favTab === "list" && (
                  <>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Próximos · {favProximos.length}
                    </h2>
                    {favProximos.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
                        No tienes favoritos próximos.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {favProximos.map((e) => (
                          <FavoritePosterCard
                            key={e.id}
                            event={e}
                            onOpen={() => abrirFavorito(e)}
                            onUnfav={() => void toggleFav(e)}
                          />
                        ))}
                      </div>
                    )}

                    {favPasados.length > 0 && (
                      <section className="mt-8">
                        <button
                          type="button"
                          onClick={() => setVerFavPasados((v) => !v)}
                          aria-expanded={verFavPasados}
                          className="flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                        >
                          <span>Pasados · {favPasados.length}</span>
                          <ChevronDown className={`h-4 w-4 transition ${verFavPasados ? "rotate-180" : ""}`} />
                        </button>
                        {verFavPasados && (
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {favPasados.map((e) => (
                              <FavoritePosterCard
                                key={e.id}
                                event={e}
                                past
                                onOpen={() => abrirFavorito(e)}
                                onUnfav={() => void toggleFav(e)}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </>
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
                              past={isEventOver(e)}
                              onOpen={() => abrirFavorito(e)}
                              onUnfav={() => void toggleFav(e)}
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

        {vistaActiva === "wallet" && (
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

            {ticketsLoading ? (
              <PasifyEmptyState
                icon={<Ticket className="h-7 w-7" />}
                eyebrow="Cargando"
                title="Sincronizando tu wallet…"
                subtitle="Estamos recuperando tus tickets más recientes."
                spin
              />
            ) : ticketsFallo && tickets.length === 0 ? (
              // Uno u otro: sin entradas que enseñar, el error (con Reintentar)
              // y no además "Aún no tienes entradas".
              <ErrorDeCarga
                sinConexion={ticketsSinRed || !isOnline}
                que="tus entradas"
                reintentando={ticketsQuery.isFetching}
                onRetry={() => void loadTickets()}
              />
            ) : tickets.length === 0 ? (
              <PasifyEmptyState
                icon={<Ticket className="h-7 w-7" />}
                eyebrow="Wallet vacío"
                title={<>Aún no tienes <span style={serifAccent}>entradas</span>.</>}
                subtitle="Cuando compres una entrada aparecerá aquí con su QR, cuenta atrás y opción de añadirla al calendario."
                action={{ label: "Descubrir locales", onClick: () => setView("home") }}
              />
            ) : (
              <>
                {/* Entradas guardadas y un refresco que ha fallado (o sin red):
                    se siguen enseñando, con la hora real de la última
                    actualización. */}
                {avisoEntradas && (
                  <div
                    role="status"
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
                      {ticketsEnPausa || !isOnline ? <WifiOff className="h-4 w-4" /> : <Ticket className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">
                        {ticketsEnPausa || !isOnline ? "Sin conexión" : "No hemos podido actualizar tus entradas"}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                        <ActualizadoHace momento={ticketsQuery.dataUpdatedAt} />
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadTickets()}
                      disabled={ticketsQuery.isFetching}
                      className="min-h-[44px] shrink-0 rounded-full border border-border bg-card px-4 text-xs font-medium hover:border-primary/40 disabled:opacity-60"
                    >
                      Reintentar
                    </button>
                  </div>
                )}

                {entradasActivas.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
                    No tienes entradas activas.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {entradasActivas.map((t) => (
                      <TicketCard
                        key={t.id}
                        ticket={t}
                        uid={userId}
                        onOpenQR={() => setOpenTicketId(t.id)}
                        refundStatus={refundStatusForTicket(t.id)}
                        onRequestRefund={refundRequestRefund}
                      />
                    ))}
                  </div>
                )}

                {/* Reembolsadas: plegadas, sin QR, para que no desaparezcan sin rastro. */}
                {entradasReembolsadas.length > 0 && (
                  <section className="mt-8">
                    <button
                      type="button"
                      onClick={() => setVerReembolsadas((v) => !v)}
                      aria-expanded={verReembolsadas}
                      className="flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                    >
                      <span>Reembolsadas · {entradasReembolsadas.length}</span>
                      <ChevronDown className={`h-4 w-4 transition ${verReembolsadas ? "rotate-180" : ""}`} />
                    </button>
                    {verReembolsadas && (
                      <ul className="mt-3 space-y-2">
                        {entradasReembolsadas.map((t) => (
                          <EntradaReembolsada key={t.id} ticket={t} />
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}

            <TicketQRModal
              open={!!openTicket}
              onClose={() => setOpenTicketId(null)}
              ticket={openTicket}
              event={openTicket?.event ?? null}
            />
          </div>
          </Sentry.ErrorBoundary>
        )}
      </main>

      {/* Bottom tab bar mobile — primitiva compartida (MobileBottomNav). */}
      <MobileBottomNav<View>
        items={tabBarItems}
        activeId={vistaActiva}
        onSelect={setView}
        drawerSlot={
          <ClientDrawer
            navTree={navTree}
            view={vistaActiva}
            onSelect={setView}
            onLogout={handleLogout}
            onOpenSettings={abrirAjustes}
            onOpenHelp={() => setHelpOpen(true)}
            city={userCity}
            variant="tab"
          />
        }
      />
      </div>

      {/* Sheets globales — abiertos desde el drawer y desde el perfil */}
      <CitySelector
        open={selectorCiudadAbierto}
        onOpenChange={setSelectorCiudadAbierto}
        selectedCity={ciudad}
        onCityChange={(c) => void cambiarCiudad(c)}
      />
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        role="client"
        email={null}
        displayName={nombrePerfil || (userCity ? `Cliente · ${userCity}` : "Cliente Pasify")}
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
// Estados de carga: error sin datos y aviso de datos guardados
// ============================================================================

/** Sin nada que enseñar: error (o sin conexión) con Reintentar, nunca un "vacío". */
const ErrorDeCarga = ({
  sinConexion,
  que,
  reintentando,
  onRetry,
}: {
  sinConexion: boolean;
  /** "los locales", "tus favoritos"… */
  que: string;
  reintentando: boolean;
  onRetry: () => void;
}) => (
  <PasifyEmptyState
    icon={sinConexion ? <WifiOff className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
    eyebrow={sinConexion ? "Sin conexión" : "Error"}
    title={`No hemos podido cargar ${que}`}
    subtitle={
      sinConexion
        ? "Conéctate a internet y vuelve a intentarlo."
        : "Ha fallado la conexión con Pasify. Vuelve a intentarlo en unos segundos."
    }
    action={{ label: reintentando ? "Reintentando…" : "Reintentar", onClick: onRetry }}
    compact
  />
);

/** Hay datos guardados pero el último refresco falló: se enseñan con este aviso. */
const AvisoRefresco = ({
  sinConexion,
  texto,
  reintentando,
  onRetry,
}: {
  sinConexion: boolean;
  texto: string;
  reintentando: boolean;
  onRetry: () => void;
}) => (
  <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2 text-sm">
    {sinConexion ? (
      <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" />
    ) : (
      <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
    )}
    <span className="min-w-0 flex-1 text-muted-foreground">
      {sinConexion ? "Sin conexión: ves lo último guardado." : texto}
    </span>
    <button
      type="button"
      onClick={onRetry}
      disabled={reintentando}
      className="min-h-[44px] shrink-0 rounded-full border border-border px-3 text-xs font-medium transition hover:border-primary/40 disabled:opacity-60"
    >
      Reintentar
    </button>
  </div>
);

/** "Actualizado hace 5 minutos" (dato real de la caché), al día cada minuto. */
const ActualizadoHace = ({ momento }: { momento: number }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!momento) return <>Ves las últimas entradas guardadas en este dispositivo.</>;
  return <>Actualizado {formatDistanceToNow(momento, { locale: es, addSuffix: true })}.</>;
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
  restaurante: "Restaurante",
  teatro: "Teatro",
  otro: "Otro",
};

// Card per evento favorito — stile poster identico a PartnerCard. La tarjeta
// entera abre la página del evento (/e/:id); el corazón es un botón hermano
// (no anidado: un botón dentro de otro no es válido ni accesible).
const FavoritePosterCard = ({
  event,
  onOpen,
  onUnfav,
  past = false,
}: {
  event: FavEvent;
  onOpen: () => void;
  onUnfav: () => void;
  /** Ya terminado: sin precio y con la etiqueta "Pasado". */
  past?: boolean;
}) => {
  // Día y mes en la hora del evento (Europe/Madrid), no la del móvil.
  const dayMonth = eventDayMonth(event.date_start);
  const time = formatEventTime(event.date_start);
  const initial = (event.title?.[0] ?? "?").toUpperCase();
  // "Desde X €" (precio mínimo de sus tipos) o "Gratis"; un evento pasado ya no se vende.
  const priceLabel = past ? null : eventPriceLabel(event.price_cents);
  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 ${
        past ? "opacity-75" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ver ${event.title}`}
        className="block w-full text-left"
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
          {event.image_url ? (
            <img
              src={event.image_url}
              alt=""
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
          {dayMonth && (
            <div
              className="absolute left-3 top-3 flex flex-col items-center rounded-md px-2 py-1 text-center"
              style={{ background: past ? "rgba(90,84,74,0.95)" : "rgba(232,84,42,0.95)", color: "#fff" }}
            >
              <span className="text-[10px] font-bold uppercase leading-none tracking-wider">{dayMonth.month}</span>
              <span className="mt-0.5 text-base font-bold leading-none">{dayMonth.day}</span>
            </div>
          )}

          {/* Title + venue bottom */}
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="truncate text-sm font-bold leading-tight text-white drop-shadow-md md:text-base">
              {event.title}
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <div className="truncate text-[11px] text-white/85 drop-shadow">
                {time && `${time} · `}
                {event.partnerName ?? event.city}
                {event.partnerName && event.city && ` · ${event.city}`}
              </div>
              {past ? (
                <div
                  className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: "rgba(90,84,74,0.95)", color: "#fff" }}
                >
                  Pasado
                </div>
              ) : (
                priceLabel && (
                  <div
                    className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: "rgba(232,84,42,0.95)", color: "#fff" }}
                  >
                    {priceLabel}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Heart top-right: hermano de la tarjeta, no dentro del botón */}
      <button
        type="button"
        onClick={onUnfav}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition hover:scale-110"
        style={{ background: "rgba(10,10,10,0.45)" }}
        aria-label={`Quitar ${event.title} de favoritos`}
      >
        <Heart className="h-4 w-4" fill="#E8542A" stroke="#E8542A" />
      </button>
    </article>
  );
};

/** Pestaña «Eventos» / «Locales» de Favoritos (44 px de alto como mínimo). */
const PestanaFavoritos = ({
  activa,
  onClick,
  icono,
  texto,
  cuenta,
}: {
  activa: boolean;
  onClick: () => void;
  icono: React.ReactNode;
  texto: string;
  /** null mientras no se sabe. */
  cuenta: number | null;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={activa}
    className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition ${
      activa
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
    }`}
  >
    {icono}
    {cuenta === null ? texto : `${texto} · ${cuenta}`}
  </button>
);

// Tarjeta de local. La tarjeta entera abre la ficha (/p/:id); el corazón es un
// botón hermano (no anidado: un botón dentro de otro no es válido ni
// accesible). Los favoritos salen de UNA consulta de la pantalla
// (useFavoritePartners): antes cada tarjeta lanzaba la suya y guardaba el id
// en partner_favorites.org_id, que fallaba siempre con 23503 (B2-03).
const PartnerCard = ({
  partner,
  onClick,
  favorito,
  onToggleFavorito,
}: {
  partner: Partner;
  onClick: () => void;
  favorito: boolean;
  onToggleFavorito: () => void;
}) => {
  const name = partner.business_name ?? "Local";
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const cover = partner.cover_image_url;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10">
      <button type="button" onClick={onClick} aria-label={`Ver ${name}`} className="block w-full text-left">
        {/* Cover */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
          {cover ? (
            <img
              src={cover}
              alt=""
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

          {/* Category badge top-left (arriba a la derecha va el corazón) */}
          {partner.business_category && (
            <div
              className="absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
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

      {/* Corazón top-right: hermano de la tarjeta, no dentro del botón */}
      <button
        type="button"
        onClick={onToggleFavorito}
        aria-pressed={favorito}
        aria-label={favorito ? `Quitar ${name} de favoritos` : `Guardar ${name} en favoritos`}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition hover:scale-110"
        style={{ background: "rgba(10,10,10,0.45)" }}
      >
        <Heart
          className="h-4 w-4"
          fill={favorito ? "#E8542A" : "transparent"}
          stroke={favorito ? "#E8542A" : "#FFFFFF"}
        />
      </button>
    </article>
  );
};

// ============================================================================
// TicketCard — card editorial del wallet con cuenta atrás en vivo + ICS
// ============================================================================

const ticketCardMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/**
 * Cuenta atrás de una entrada. "Pasado" con la misma regla que el servidor
 * (isEventOver: hora de fin o, sin ella, 12 h después de empezar); antes una
 * noche de 23:00 a 06:00 salía "Caducada" a las 03:00.
 */
const useCountdown = (event: { date_start: string; date_end?: string | null } | null) => {
  const [now, setNow] = useState<number>(() => Date.now());
  const start = event?.date_start ?? null;
  useEffect(() => {
    if (!start) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [start]);
  if (!event || !start) return { label: "—", state: "none" as const, now };
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return { label: "—", state: "none" as const, now };
  if (isEventOver(event, now)) return { label: "Finalizado", state: "past" as const, now };
  const diff = t - now;
  if (diff <= 0) return { label: "Está ocurriendo", state: "live" as const, now };
  const min = Math.floor(diff / 60_000);
  const days = Math.floor(min / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  const minutes = min % 60;
  if (days >= 2) return { label: `En ${days}d ${hours}h`, state: "future" as const, now };
  if (days === 1) return { label: `Mañana · ${hours}h ${minutes}m`, state: "soon" as const, now };
  if (hours >= 1) return { label: `En ${hours}h ${minutes}m`, state: "soon" as const, now };
  return { label: `En ${minutes} min`, state: "imminent" as const, now };
};

const TicketCard = ({
  ticket,
  uid,
  onOpenQR,
  refundStatus,
  onRequestRefund,
}: {
  ticket: WalletTicketRow;
  /** Usuario de la cartera (el comprador puede pedir que se le reenvíe el email). */
  uid: string;
  onOpenQR: () => void;
  /** Solicitud de reembolso de esta entrada (si hay). */
  refundStatus: RefundRequest | null;
  onRequestRefund: (ticketId: string, reason: string) => Promise<unknown>;
}) => {
  const event = ticket.event;
  // Día, mes y hora en la hora del evento (Europe/Madrid), no la del móvil.
  const dayMonth = event ? eventDayMonth(event.date_start) : null;
  const time = event ? formatEventTime(event.date_start) : "";
  const countdown = useCountdown(event);
  const { toast } = useToast();
  // Evento cancelado por el local: sin QR ni código, el importe se devuelve
  // solo (una entrada ya usada sigue siendo "usada").
  const cancelled = ticket.status !== "used" && event?.status === "cancelled";
  const [savingIcs, setSavingIcs] = useState(false);
  // Enviada a otra persona y aún sin aceptar: sigue siendo del usuario.
  const transferenciaPendiente =
    ticket.status === "paid" &&
    !cancelled &&
    countdown.state !== "past" &&
    !!ticket.transferencia_pendiente &&
    Date.parse(ticket.transferencia_pendiente.caduca) > countdown.now;

  const statusLabel =
    ticket.status === "used"
      ? "Usado"
      : cancelled
      ? "Cancelado"
      : ticket.status === "refunded"
      ? "Reembolsado"
      : countdown.state === "past"
      ? "Caducado"
      : transferenciaPendiente
      ? "Transferencia pendiente"
      : "Válido";
  const statusColor =
    ticket.status === "used"
      ? "rgba(10,10,10,0.7)"
      : cancelled
      ? "rgba(90,84,74,0.95)"
      : ticket.status === "refunded"
      ? "rgba(232,176,76,0.95)"
      : countdown.state === "past"
      ? "rgba(140,140,140,0.95)"
      : "rgba(232,84,42,0.95)";

  // .ics: descarga en la web; en la app, hoja de compartir del sistema
  // (el `<a download>` de antes no hacía nada en iOS ni en Android).
  const handleIcs = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!event || savingIcs) return;
    setSavingIcs(true);
    try {
      await downloadIcs(`pasify-${ticket.id.slice(0, 8)}`, {
        uid: ticket.id,
        title: event.title ?? "Evento Pasify",
        description: event.partner_name
          ? `Pasify · ${event.partner_name}`
          : "Tu entrada en Pasify",
        location: event.venue_name ?? event.partner_name ?? undefined,
        start: event.date_start,
        end: event.date_end ?? undefined,
        url: publicEventUrl(ticket.event_id),
      });
    } catch (err) {
      console.warn("[cartera] no se pudo preparar el .ics", err);
      toast({
        title: "No se ha podido añadir al calendario",
        description: "Vuelve a intentarlo en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setSavingIcs(false);
    }
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
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${cancelled ? "grayscale" : ""}`}
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

        {cancelled ? (
          // Sin QR, sin código y sin cuenta atrás: esta entrada ya no vale.
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border px-3 py-3"
            style={{ background: "rgba(184,56,26,0.10)", borderColor: "rgba(184,56,26,0.45)" }}
          >
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Evento cancelado · te devolvemos el importe</div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                El local ha cancelado el evento. No hace falta que hagas nada: el reembolso va a tu método de pago.
              </p>
            </div>
          </div>
        ) : (
          <>
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
                className="group/btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
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
                  onClick={(e) => void handleIcs(e)}
                  disabled={!event || savingIcs}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ ...ticketCardMono, letterSpacing: "0.08em" }}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  CALENDARIO
                </button>
                <button
                  type="button"
                  onClick={handleMaps}
                  disabled={!event?.venue_name && !event?.partner_name}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-medium text-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ ...ticketCardMono, letterSpacing: "0.08em" }}
                >
                  <MapPin className="h-3.5 w-3.5" />
                  CÓMO LLEGAR
                </button>
              </div>
            </div>
          </>
        )}

        {/* Enviar a un amigo, reenviar el email, devolución según la política
            del tipo y el estado de la solicitud (AccionesEntrada). */}
        <AccionesEntrada
          ticket={ticket}
          uid={uid}
          refund={refundStatus}
          onRequestRefund={onRequestRefund}
          past={countdown.state === "past"}
          cancelled={cancelled}
          ahora={countdown.now}
        />
      </div>
    </article>
  );
};

/** Fila de la sección plegada "Reembolsadas": sin QR ni acciones. */
const EntradaReembolsada = ({ ticket }: { ticket: WalletTicketRow }) => {
  const event = ticket.event;
  const cuando = event ? formatEventDateTime(event.date_start) : "";
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <RotateCcw className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{event?.title ?? "Evento"}</div>
        <div className="truncate text-[12px] text-muted-foreground">
          {[cuando, ticket.tier_name].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className="text-[10px] font-bold uppercase text-orange-400"
          style={{ ...ticketCardMono, letterSpacing: "0.16em" }}
        >
          Reembolsada
        </div>
        {ticket.amount_paid_cents > 0 && (
          <div className="text-[12px] text-muted-foreground" style={ticketCardMono}>
            {formatPriceCents(ticket.amount_paid_cents)}
          </div>
        )}
      </div>
    </li>
  );
};

export default ClientDashboard;
