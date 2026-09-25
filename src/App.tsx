import { Toaster as Sonner } from "@/components/ui/sonner";
import { toast as sonnerToast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Session } from "@supabase/supabase-js";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { usePendingCheckoutResume } from "@/hooks/usePendingCheckoutResume";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { queryClient } from "@/lib/cache/queryClient";
import { useCacheLifecycle } from "@/lib/cache/lifecycle";
import { useCurrentUserId, useSesionSinVerificar } from "@/lib/cache/session";
import { useDoorLocked } from "@/lib/doorLock";
import { sanitizeNextPath, tomarOAuthEnCurso } from "@/lib/redirect-url";
import { canjearReferidoPendiente } from "@/components/auth/referidos";

// Critical pages - keep static imports
import Index from "./pages/Index";
import Login from "./pages/Login";

// Lazy loaded pages
const NotFound = lazy(() => import("./pages/NotFound"));
const RegisterClient = lazy(() => import("./pages/RegisterClient"));
const RegisterPartner = lazy(() => import("./pages/RegisterPartner"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword"));
const ClientDashboard = lazy(() => import("./pages/ClientDashboard"));
const PartnerDashboard = lazy(() => import("./pages/PartnerDashboard"));
const PublicEvent = lazy(() => import("./pages/PublicEvent"));
const DoorMode = lazy(() => import("./pages/DoorMode"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const PartnerSubscribe = lazy(() => import("./pages/PartnerSubscribe"));
const PartnerManage = lazy(() => import("./pages/PartnerManage"));
const PartnerSuccess = lazy(() => import("./pages/PartnerSuccess"));
const TicketSuccess = lazy(() => import("./pages/TicketSuccess"));
const TicketReturn = lazy(() => import("./pages/TicketReturn"));
const PublicTicket = lazy(() => import("./pages/PublicTicket"));
const PartnerCancel = lazy(() => import("./pages/PartnerCancel"));
const PartnerChoosePlan = lazy(() => import("./pages/PartnerChoosePlan"));
const PartnerOnboarding = lazy(() => import("./pages/PartnerOnboarding"));
// Paginas publicas exigidas por App Store Connect y Google Play:
// URL de soporte y politica de privacidad. Accesibles sin sesion.
const Soporte = lazy(() => import("./pages/Soporte"));
const Privacidad = lazy(() => import("./pages/Privacidad"));
const Calendar = lazy(() => import("./pages/Calendar"));
const PublicPartnerPage = lazy(() => import("./pages/PublicPartnerPage"));

// Static imports for non-page components
import ProtectedRoute from "./components/auth/ProtectedRoute";
import PartnerGate from "./components/auth/PartnerGate";
import DataPrefetcher from "./components/shared/DataPrefetcher";
import PanelSwitcher from "./components/shared/PanelSwitcher";
import LoaderOne from "@/components/ui/loader-one";

// Usa il sistema di auth centralizzato
import { useAuth, resolveInitialDashboard, signOutLocal } from "@/hooks/useAuth";
import AuthErrorScreen, { CuentaSinAcceso } from "@/components/auth/AuthErrorScreen";

// Caché de datos: src/lib/cache (memoria + dispositivo por usuario). La de
// antes (PersistQueryClientProvider) guardaba en una única entrada los datos
// de cualquier usuario y no los borraba al cerrar sesión.

// Loading state for Suspense fallback — full-screen Pasify dark splash that
// matches the inline boot splash in index.html so the chain is seamless and
// no gray flash / blue dots appear between splash and page.
const PageLoader = () => <LoaderOne />;

// Wrapper per la pagina Login. Resuelve el dashboard inicial según el rol
// efectivo del usuario (post-Fase 1 hardening) en lugar de empujar a todos
// a /client-dashboard. Si todavía no se han cargado los roles (o la cuenta no
// tiene ninguno), muestra Login — nunca redirige a un panel que el usuario no
// tiene. Con `?next=` (el CTA de compra) manda `next`: antes, al llegar la
// sesión, se pisaba con el panel y el comprador perdía el evento.
const LoginRoute = ({ session }: { session: Session | null }) => {
  const [searchParams] = useSearchParams();
  const { userRoles, roleLoading } = useAuth();

  if (session && !roleLoading && userRoles.length > 0) {
    const next = sanitizeNextPath(searchParams.get("next"));
    const destino = next && !next.startsWith("/login") ? next : resolveInitialDashboard(userRoles);
    if (destino !== "/login") return <Navigate to={destino} replace />;
  }

  return <Login />;
};

// Wrapper para la ruta `/` (root). Igual que LoginRoute pero el fallback no
// autenticado es Index (landing pública) en web, o /login en nativa.
const RootRoute = ({ session }: { session: Session | null }) => {
  const { userRoles, rolesLoaded, roleError, reloadRoles } = useAuth();
  // Vuelta de "Entrar con Google" en la web: la raíz, con el destino (`next`)
  // apuntado antes de salir. Se toma una vez, en cuanto hay sesión.
  const destinoOAuthRef = useRef<string | null | undefined>(undefined);
  if (session && destinoOAuthRef.current === undefined) {
    destinoOAuthRef.current = tomarOAuthEnCurso()?.next ?? null;
  }

  if (session) {
    if (destinoOAuthRef.current) return <Navigate to={destinoOAuthRef.current} replace />;
    // Sin red no se pueden saber los roles: mejor "Reintentar" que una
    // pantalla en blanco.
    if (roleError && userRoles.length === 0) {
      return (
        <AuthErrorScreen
          title="No hemos podido cargar tu cuenta"
          description="Revisa tu conexión y vuelve a intentarlo."
          detail={roleError}
          onRetry={reloadRoles}
          onSignOut={signOutLocal}
        />
      );
    }
    if (!rolesLoaded) return <PageLoader />;
    // Roles cargados y ninguno (p. ej. un local al que el admin ha retirado
    // el acceso): antes, pantalla negra sin salida.
    if (userRoles.length === 0) return <CuentaSinAcceso onSignOut={signOutLocal} />;
    const target = resolveInitialDashboard(userRoles);
    return <Navigate to={target} replace />;
  }
  if (Capacitor.isNativePlatform()) {
    return <Navigate to="/login" replace />;
  }
  return <Index />;
};

// Alta (cliente y local): quien ya tiene sesión al abrirla no tiene nada que
// registrar y va a `next` o a su panel. Solo se mira al entrar: la sesión que
// abre la propia alta a mitad del formulario no puede sacarle de ella (el
// alta de local aún tiene que crear su organización).
const SoloSinSesion = ({ session, children }: { session: Session | null; children: React.ReactNode }) => {
  const [searchParams] = useSearchParams();
  const [habiaSesion] = useState(() => session !== null);
  if (habiaSesion) return <Navigate to={sanitizeNextPath(searchParams.get("next")) ?? "/"} replace />;
  return <>{children}</>;
};

// Modo puerta activo en este dispositivo (src/lib/doorLock.ts): ninguna otra
// pantalla, tampoco las que no pasan por ProtectedRoute (/login, que con la
// sesión viva mandaba al panel, o /update-password). Se sale con el PIN o
// cerrando sesión. El bloqueo se escucha en vivo: si se activa en otra
// pestaña, esta también pasa a /door.
const DoorLockGuard = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const locked = useDoorLocked(useCurrentUserId());
  if (locked && location.pathname !== "/door") return <Navigate to="/door" replace />;
  return <>{children}</>;
};

// `/partner/:id` era la ficha de local heredada (PartnerDetails), rota desde
// el snapshot; la vigente es `/p/:id`. La ruta se conserva solo para que los
// enlaces guardados y las notificaciones antiguas lleguen a la ficha buena.
const LegacyPartnerRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/p/${encodeURIComponent(id ?? "")}`} replace />;
};

/**
 * Ruta de la app para un enlace que abre la app nativa (appUrlOpen): la web
 * (`https://…/e/<id>`, también con la ruta tras el `#`) o el esquema propio
 * (`es.pasify.app://e/<id>`, donde el primer tramo llega como host).
 *
 *   /e/<id>       → /e/<id>        (página del evento)
 *   /p/<id>       → /p/<id>        (ficha del local)
 *   /entrada/<id> → /entrada/<id>  (entrada pública; solo viaja su `?k=`)
 *   cualquier otra → /
 *
 * Nunca lleva tokens de sesión: antes cualquier URL con access_token y
 * refresh_token abría esa sesión en la app (login CSRF).
 */
function rutaDeEnlace(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "/";
  }
  let ruta: string;
  let query: string;
  if (u.hash.startsWith("#/")) {
    const [p, q = ""] = u.hash.slice(1).split("?");
    ruta = p;
    query = q;
  } else {
    const esWeb = u.protocol === "http:" || u.protocol === "https:";
    ruta = esWeb ? u.pathname : `/${u.host}${u.pathname}`;
    query = u.search.replace(/^\?/, "");
  }
  ruta = ruta.replace(/^\/+/, "/").replace(/\/+$/, "");
  const m = ruta.match(/^\/(e|p|entrada)\/([^/]+)$/);
  if (!m) return "/";
  const [, tipo, idCodificado] = m;
  let id: string;
  try {
    id = decodeURIComponent(idCodificado);
  } catch {
    return "/";
  }
  const k = tipo === "entrada" ? new URLSearchParams(query).get("k") : null;
  return `/${tipo}/${encodeURIComponent(id)}${k ? `?k=${encodeURIComponent(k)}` : ""}`;
}

/** Capas de Radix abiertas (hojas, diálogos, menús): el botón atrás las cierra. */
const CAPA_ABIERTA =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]';

/**
 * Botón atrás de Android. Con cualquier listener registrado Capacitor ya no
 * hace nada por su cuenta, así que aquí va todo: cerrar la hoja o el diálogo
 * abierto (Escape, como el teclado), volver atrás si hay historial dentro de
 * la app y, si no, minimizar. En /door manda el de DoorMode (no deja salir).
 */
function alPulsarAtras() {
  if (window.location.hash.startsWith("#/door")) return;
  if (document.querySelector(CAPA_ABIERTA)) {
    const destino = document.activeElement ?? document.body;
    destino.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }),
    );
    return;
  }
  // HashRouter guarda en history.state el índice de la entrada (0 = la primera de la app).
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  if (typeof idx === "number" && idx > 0) window.history.back();
  else void CapacitorApp.minimizeApp();
}

/** Enlaces que abren la app y botón atrás (solo nativo). Vive dentro del router. */
const IntegracionNativa = () => {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Solo se quitan estos: App.removeAllListeners() se llevaba también los
    // de DoorMode, la vuelta de Stripe y el estado de la red.
    const handles: Promise<PluginListenerHandle>[] = [
      CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        navigateRef.current(rutaDeEnlace(url));
      }),
      CapacitorApp.addListener("backButton", alPulsarAtras),
    ];
    return () => {
      handles.forEach((h) => void h.then((handle) => handle.remove()).catch(() => undefined));
    };
  }, []);

  return null;
};

// Invitación de "Trae un amigo" (RegisterClient guarda el `?ref=`): se canjea
// en cuanto hay sesión verificada de una cuenta recién creada.
const ReferidoPendiente = () => {
  const userId = useCurrentUserId();
  const sinVerificar = useSesionSinVerificar();
  useEffect(() => {
    if (userId && !sinVerificar) void canjearReferidoPendiente();
  }, [userId, sinVerificar]);
  return null;
};

// Page-transition wrapper: applica un fade+slide morbido a ogni cambio
// di route. Usa motion.div con `key={location.pathname}` così React
// rimonta il subtree ad ogni navigazione → l'animation initial parte.
// Niente AnimatePresence/exit per evitare flicker col HashRouter.
const PageTransitions = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  // Las secciones del panel de local y las vistas del de cliente viven en la
  // URL (/partner-dashboard/:section, /client-dashboard/:view): cambiar de
  // sección no puede remontar el panel entero (perdería estado y volvería a
  // cargarlo todo).
  const transitionKey = location.pathname.startsWith("/partner-dashboard")
    ? "/partner-dashboard"
    : location.pathname.startsWith("/client-dashboard")
      ? "/client-dashboard"
      : location.pathname;
  return (
    <motion.div
      key={transitionKey}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
};

// Aviso sin conexión. Solo informa: nunca bloquea toques
// (pointer-events-none) y en modo puerta no sale: tapaba la cabecera, y con
// ella «Salir», justo sin red; el escáner ya avisa de que así no se valida.
// También sale con la sesión "sin verificar" (arranque sin red con el token
// caducado): se está viendo lo guardado en el dispositivo.
const OfflineBanner = () => {
  const { isOnline, wasOffline } = useNetworkStatus();
  const sinVerificar = useSesionSinVerificar();
  const location = useLocation();
  const sinVerificarAntes = useRef(sinVerificar);

  useEffect(() => {
    if (wasOffline && isOnline) {
      sonnerToast.success("Vuelves a tener conexión. Actualizando…");
      // Solo le query attualmente *attive* vengono invalidate.
      // Le query inattive (pagine non aperte) restano in cache e si
      // aggiorneranno alla prossima visita. Evita una raffica di refetch
      // su decine di query non visibili al riconnetto.
      queryClient.invalidateQueries({ refetchType: "active" });
    }
  }, [wasOffline, isOnline]);

  // La sesión se ha podido renovar: lo que se ve sale ya del servidor.
  useEffect(() => {
    if (sinVerificarAntes.current && !sinVerificar) {
      queryClient.invalidateQueries({ refetchType: "active" });
    }
    sinVerificarAntes.current = sinVerificar;
  }, [sinVerificar]);

  if ((isOnline && !sinVerificar) || location.pathname === "/door") return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium shadow-lg"
    >
      {isOnline
        ? "Sin conexión con Pasify: estás viendo lo guardado en este dispositivo."
        : "Sin conexión: puede que lo que ves no esté al día."}
    </div>
  );
};

const App = () => {
  const { session, loading } = useAuth();
  // Restaura la caché guardada del usuario antes de pintar (ver lifecycle.ts).
  const cacheLista = useCacheLifecycle();

  // Confirma la compra al volver de Stripe Checkout en la app nativa. Sin
  // esto, si el webhook de Stripe no llega, la entrada pagada nunca aparece.
  usePendingCheckoutResume();

  // Lo splash è in index.html (visibile prima ancora che React parta) e
  // viene rimosso da MutationObserver appena #root ha il primo DOM child.
  // Mentre useAuth carica la session, ritorniamo null così #root resta vuoto
  // e lo splash resta visibile → no flash di login prima del redirect alla
  // dashboard. Sin red, como mucho ~2 s (lib/cache/session.ts).
  // Igual mientras se restaura la caché guardada (IndexedDB, ~decenas de ms,
  // máximo 1,5 s): así la primera pantalla ya sale con sus datos.
  if (loading || !cacheLista) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner />
        {/* Prefetch dati in background */}
        <DataPrefetcher userId={session?.user?.id} />
        <ReferidoPendiente />
        <HashRouter>
          <OfflineBanner />
          <IntegracionNativa />
          {/* Floating multi-role switcher (visible when user tiene 2+ roles
              y está en una ruta de dashboard). */}
          <PanelSwitcher />
          <Suspense fallback={<PageLoader />}>
            <PageTransitions>
            <DoorLockGuard>
            <Routes>
              {/* Loggato → dashboard appropriata según rol efectivo
                  (resolveInitialDashboard). Non loggato (web) → landing Pasify.
                  Su app nativa → login. */}
              <Route path="/" element={<RootRoute session={session} />} />

              {/* Rotte pubbliche */}
              <Route
                path="/register-client"
                element={
                  <SoloSinSesion session={session}>
                    <RegisterClient />
                  </SoloSinSesion>
                }
              />
              <Route
                path="/register-partner"
                element={
                  <SoloSinSesion session={session}>
                    <RegisterPartner />
                  </SoloSinSesion>
                }
              />
              <Route
                path="/login"
                element={<LoginRoute session={session} />}
              />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/password-recovery" element={<UpdatePassword />} />
              <Route path="/home" element={<Index />} />

              {/* Calendar — pubblico, accessibile anche senza account.
                  Niente piu' route /calendar/:city/:id: il flusso e' tutto
                  inline sulla card (Participar). Le richieste vecchie
                  cadono sul catch-all SPA e finiscono su /calendar. */}
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/p/:id" element={<PublicPartnerPage />} />
              {/* Página pública y compartible de un evento (enlace del local). */}
              <Route path="/e/:eventId" element={<PublicEvent />} />
              <Route path="/partner/:id" element={<LegacyPartnerRedirect />} />

              {/* Rotte protette */}
              <Route
                path="/client-dashboard/:view?"
                element={
                  <ProtectedRoute requireRole="client">
                    <ClientDashboard />
                  </ProtectedRoute>
                }
              />
              {/* Modo puerta: sin PartnerGate, la puerta no se cierra por el plan. */}
              <Route
                path="/door"
                element={
                  <ProtectedRoute requireRole="partner">
                    <DoorMode />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/partner-dashboard/:section?"
                element={
                  <ProtectedRoute requireRole="partner">
                    <PartnerGate>
                      <PartnerDashboard />
                    </PartnerGate>
                  </ProtectedRoute>
                }
              />
              {/* Legacy Pasify routes (social/chats/profile/badges) removed
                  in favor of Pasify support flow (support_conversations table)
                  and clean event-only client surface. */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Partner subscription (Stripe) */}
              <Route
                path="/partner/choose-plan"
                element={
                  <ProtectedRoute requireRole="partner">
                    <PartnerChoosePlan />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/partner/onboarding"
                element={
                  <ProtectedRoute requireRole="partner">
                    <PartnerOnboarding />
                  </ProtectedRoute>
                }
              />
              <Route path="/partner/subscribe" element={<PartnerSubscribe />} />
              <Route path="/partner/manage" element={<PartnerManage />} />
              <Route path="/partner/success" element={<PartnerSuccess />} />
              <Route path="/partner/cancel" element={<PartnerCancel />} />

              {/* Ticket purchase success — destino de Stripe Checkout para
                  compra de entradas (no suscripciones de partner). Stripe
                  redirige con ?order_id=...&session_id=... y la página hace
                  poll/realtime contra ticket_orders hasta confirmar el pago
                  vía webhook. */}
              <Route path="/ticket/success" element={<TicketSuccess />} />

              {/* Retorno de Stripe para la app nativa. Publica a proposito:
                  quien llega es Safari sin sesion. Ver TicketReturn.tsx. */}
              <Route path="/ticket/gracias" element={<TicketReturn />} />

              {/* Entrada pública (enlace "Ver entrada" del email). Sin sesión:
                  la llave es el token `?k=`. Ver PublicTicket.tsx. */}
              <Route path="/entrada/:ticketId" element={<PublicTicket />} />

              <Route path="/soporte" element={<Soporte />} />
              <Route path="/privacidad" element={<Privacidad />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </DoorLockGuard>
            </PageTransitions>
          </Suspense>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
