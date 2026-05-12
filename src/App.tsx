import { Toaster as Sonner } from "@/components/ui/sonner";
import { toast as sonnerToast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useTranslation } from "react-i18next";
import logo from "./assets/logo.webp";

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
const PartnerDetails = lazy(() => import("./pages/PartnerDetails"));
const PartnerDashboard = lazy(() => import("./pages/PartnerDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminSetup = lazy(() => import("./pages/AdminSetup"));
const PartnerSubscribe = lazy(() => import("./pages/PartnerSubscribe"));
const PartnerManage = lazy(() => import("./pages/PartnerManage"));
const PartnerSuccess = lazy(() => import("./pages/PartnerSuccess"));
const PartnerCancel = lazy(() => import("./pages/PartnerCancel"));
const PartnerChoosePlan = lazy(() => import("./pages/PartnerChoosePlan"));
const PartnerOnboarding = lazy(() => import("./pages/PartnerOnboarding"));
const AuthBridge = lazy(() => import("./pages/AuthBridge"));
const Calendar = lazy(() => import("./pages/Calendar"));
const PublicPartnerPage = lazy(() => import("./pages/PublicPartnerPage"));

// Static imports for non-page components
import ProtectedRoute from "./components/auth/ProtectedRoute";
import PartnerGate from "./components/auth/PartnerGate";
import DataPrefetcher from "./components/shared/DataPrefetcher";
import PanelSwitcher from "./components/shared/PanelSwitcher";
import LoaderOne from "@/components/ui/loader-one";

// Usa il sistema di auth centralizzato
import { useAuth } from "@/hooks/useAuth";
import { useFCMToken } from "@/hooks/useFCMToken";
import { useMultiAccount } from "@/hooks/useMultiAccount";

// React Query persister: usa la libreria ufficiale TanStack +
// IndexedDB (idb-keyval) come storage asincrono. Sostituisce il
// vecchio setupCachePersistence custom (fragile + race condition).
//
// `dehydrateOptions` esclude le query "live" (eventi/sconti)
// che devono essere sempre rifetchate per non mostrare item scaduti.
const idbStorage = {
  getItem: (key: string) => get<string>(key).then((v) => v ?? null),
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
};

const persister = createAsyncStoragePersister({
  storage: idbStorage,
  key: "react-query-cache-v3",
  throttleTime: 5_000, // throttle scritture su IDB (max ogni 5s)
});

const SKIP_PERSIST_KEYS = new Set(["all-events", "events", "calendar-events", "all-discounts"]);
const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000, // 24h: dati più vecchi vengono droppati
  buster: import.meta.env.MODE === "production" ? "prod-v1" : "dev-v1",
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { data: unknown } }) => {
      const key = query.queryKey[0] as string;
      if (SKIP_PERSIST_KEYS.has(key)) return false;
      // Non persistere array vuoti: meglio rifetchare che mostrare empty stale
      if (Array.isArray(query.state.data) && query.state.data.length === 0) return false;
      return query.state.data !== undefined;
    },
  },
};


// Wrapper per la pagina Login che permette l'accesso quando si aggiunge un account
const LoginRoute = ({ session }: { session: any }) => {
  const location = useLocation();
  const isAddingAccount = (location.state as any)?.addingAccount === true;

  // Se sta aggiungendo un account, mostra sempre il Login
  if (isAddingAccount) {
    return <Login />;
  }

  // Altrimenti, se c'è sessione redirect alla dashboard
  if (session) {
    return <Navigate to="/client-dashboard" replace />;
  }

  return <Login />;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 60s default: bilancia freschezza e numero di refetch.
      // Override per query specifiche dove serve (es. chat realtime).
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      // Su mobile native non c'è "window focus" → su web mantenere il refetch
      // ha senso, ma il default true causa spreco. Lo lasciamo on solo
      // su web e disabilitato su native.
      refetchOnWindowFocus: !Capacitor.isNativePlatform(),
    },
  },
});

// Persistenza ora gestita da PersistQueryClientProvider (vedi return).

// Loading state for Suspense fallback — full-screen Pasify dark splash that
// matches the inline boot splash in index.html so the chain is seamless and
// no gray flash / blue dots appear between splash and page.
const PageLoader = () => <LoaderOne />;

// Deep link handler per push notifications — vive dentro HashRouter
// per poter usare useNavigate(). Mappa data.type → route.
//
// MULTI-ACCOUNT: il device riceve notifiche per TUTTI gli account
// loggati su quel device (i token FCM sono salvati per ciascuno).
// Quando arriva una notifica con `data.targetUserId` che non matcha
// la sessione corrente:
//   - se l'account è salvato in MultiAccount → switch automatico
//   - altrimenti → redirect al login con hint email
// Se la notifica non ha `targetUserId` (legacy backend), naviga
// senza switch — comportamento back-compat.
const NotificationDeepLinkHandler = () => {
  const navigate = useNavigate();
  const { savedAccounts, switchToAccount } = useMultiAccount();

  useEffect(() => {
    const resolveRoute = (data: Record<string, unknown>): string => {
      const type = data.type as string | undefined;
      // Soporte (chat tri-direccional): aterriza directo en el client/partner
      // dashboard donde el SupportChat drawer se abre automáticamente leyendo
      // el query string `?support=<conversation_id>`.
      if (data.conversationId || type === "support_reply") {
        const cid = (data.conversationId as string) || (data.id as string) || "";
        return cid ? `/client-dashboard?support=${cid}` : "/client-dashboard";
      }
      if (type === "event" || type === "ticket_paid" || type === "discount") return "/client-dashboard";
      if (type === "refund_decided" && data.refundId) return `/client-dashboard?refund=${data.refundId}`;
      if (type === "partner" && data.partnerId) return `/partner/${data.partnerId}`;
      if (type === "participant" || type === "participation" || type === "payout_arrived") return "/partner-dashboard";
      if (type === "ai_recommendation" || type === "compliance_alert") return "/partner-dashboard";
      return "/client-dashboard";
    };

    const handler = async (e: Event) => {
      const data = ((e as CustomEvent).detail || {}) as Record<string, unknown>;
      const route = resolveRoute(data);
      const targetUserId = (data.targetUserId || data.userId) as string | undefined;
      const targetEmail = data.targetEmail as string | undefined;

      // Sessione corrente
      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id;

      // Caso 1: notifica senza target user → naviga e basta (legacy)
      if (!targetUserId) {
        navigate(route);
        return;
      }

      // Caso 2: target == current user → naviga normalmente
      if (currentUserId === targetUserId) {
        navigate(route);
        return;
      }

      // Caso 3: target ≠ current user → tenta switch automatico se saved
      const savedTarget = savedAccounts.find((a) => a.id === targetUserId);
      if (savedTarget?.refreshToken) {
        // Salviamo la route in sessionStorage così dopo il reload
        // post-switch atterriamo sul deep link giusto.
        try {
          sessionStorage.setItem("post_switch_route", route);
        } catch { /* noop */ }
        const ok = await switchToAccount(savedTarget);
        if (ok) return; // switchToAccount triggera reload
      }

      // Caso 4: target non salvato o switch fallito → login con hint
      navigate("/login", { state: { suggestedEmail: targetEmail || savedTarget?.email, deepLinkAfter: route } });
    };

    // Dopo un reload da account-switch, naviga alla route memorizzata
    try {
      const stored = sessionStorage.getItem("post_switch_route");
      if (stored) {
        sessionStorage.removeItem("post_switch_route");
        navigate(stored);
      }
    } catch { /* noop */ }

    window.addEventListener("notification-tap", handler);
    return () => window.removeEventListener("notification-tap", handler);
  }, [navigate, savedAccounts, switchToAccount]);

  return null;
};

// Page-transition wrapper: applica un fade+slide morbido a ogni cambio
// di route. Usa motion.div con `key={location.pathname}` così React
// rimonta il subtree ad ogni navigazione → l'animation initial parte.
// Niente AnimatePresence/exit per evitare flicker col HashRouter.
const PageTransitions = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
};

// Offline banner component
const OfflineBanner = () => {
  const { isOnline, wasOffline } = useNetworkStatus();
  const { t } = useTranslation();

  useEffect(() => {
    if (wasOffline && isOnline) {
      sonnerToast.success(t("network.backOnline", "Connected! Updating data..."));
      // Solo le query attualmente *attive* vengono invalidate.
      // Le query inattive (pagine non aperte) restano in cache e si
      // aggiorneranno alla prossima visita. Evita una raffica di refetch
      // su decine di query non visibili al riconnetto.
      queryClient.invalidateQueries({ refetchType: "active" });
    }
  }, [wasOffline, isOnline, t]);

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium shadow-lg">
      {t("network.offline", "Offline mode - data may not be up to date")}
    </div>
  );
};

const App = () => {
  const { session, loading } = useAuth();
  // FCM token registration (no-op on web)
  useFCMToken();

  // Listen for foreground push notifications and show toast
  // Skip city notifications (event/discount) - native push is enough
  useEffect(() => {
    const handleForegroundPush = (e: Event) => {
      const { title, body, data } = (e as CustomEvent).detail;
      const notifType = data?.type;
      if (notifType === 'event' || notifType === 'discount') return;
      if (title || body) {
        sonnerToast(title, { description: body });
      }
    };
    window.addEventListener('foreground-push', handleForegroundPush);
    return () => window.removeEventListener('foreground-push', handleForegroundPush);
  }, []);

  // Gestione deep links: Supabase Auth, App Links e share URLs.
  useEffect(() => {
    CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      console.log('Deep link received:', url);
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        return;
      }

      // 1) Supabase Auth callback (token nell'hash, non nel path)
      const hashParams = new URLSearchParams(urlObj.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) console.error('Error setting session from deep link:', error);
        else console.log('Session set successfully from deep link');
        return;
      }

      // 2) App Links shareable URLs (Android verified or iOS Universal):
      //    https://pasify.es/e/<id>            → /calendar?event=<id>
      //    https://pasify.es/calendar?event=   → stesso
      //    https://pasify.es/p/<id>            → /p/<id>
      //    https://pasify.es/client-dashboard?wallet=<id> → wallet
      //    https://pasify.es/t/<qr_token>      → ticket detail
      //    https://pasify.es/refund/<id>       → refund flow
      // Tutti vengono ridiretti al corrispondente HashRouter target.
      const path = urlObj.pathname;
      const search = urlObj.search;
      const targetForRouter = (() => {
        const eventMatch = path.match(/^\/e\/([\w-]+)\/?$/);
        if (eventMatch) return `/calendar?event=${encodeURIComponent(eventMatch[1])}`;
        if (path.startsWith('/calendar')) return `/calendar${search}`;
        if (path.startsWith('/p/')) return `${path}${search}`;
        if (path.startsWith('/client-dashboard')) return `/client-dashboard${search}`;
        return null;
      })();

      if (targetForRouter) {
        // HashRouter usa hash come path. Sostituiamo solo l'hash della
        // URL corrente, cosi' React Router intercetta come navigation.
        window.location.hash = targetForRouter.startsWith('/')
          ? targetForRouter
          : `/${targetForRouter}`;
      }
    });

    return () => {
      CapacitorApp.removeAllListeners();
    };
  }, []);

  // Lo splash è in index.html (visibile prima ancora che React parta) e
  // viene rimosso da MutationObserver appena #root ha il primo DOM child.
  // Mentre useAuth carica la session (< 50ms da localStorage), ritorniamo
  // null così #root resta vuoto e lo splash resta visibile → no flash di
  // login prima del redirect alla dashboard, transizione perfetta.
  if (loading) return null;


  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <TooltipProvider>
        <Sonner />
        <OfflineBanner />
        {/* Prefetch dati in background */}
        <DataPrefetcher userId={session?.user?.id} />
        <HashRouter>
          <NotificationDeepLinkHandler />
          {/* Floating multi-role switcher (visible when user tiene 2+ roles
              y está en una ruta de dashboard). */}
          <PanelSwitcher />
          <Suspense fallback={<PageLoader />}>
            <PageTransitions>
            <Routes>
              {/* Loggato → dashboard appropriata. Non loggato (web) → landing Pasify.
                  Su app nativa → login. */}
              <Route
                path="/"
                element={
                  session ? (
                    <Navigate to="/client-dashboard" replace />
                  ) : Capacitor.isNativePlatform() ? (
                    <Navigate to="/login" replace />
                  ) : (
                    <Index />
                  )
                }
              />

              {/* Rotte pubbliche */}
              <Route path="/register-client" element={<RegisterClient />} />
              <Route path="/register-partner" element={<RegisterPartner />} />
              <Route
                path="/login"
                element={<LoginRoute session={session} />}
              />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/password-recovery" element={<UpdatePassword />} />
              <Route path="/home" element={<Index />} />
              <Route path="/auth/bridge" element={<AuthBridge />} />

              {/* Calendar — pubblico, accessibile anche senza account.
                  Niente piu' route /calendar/:city/:id: il flusso e' tutto
                  inline sulla card (Participar). Le richieste vecchie
                  cadono sul catch-all SPA e finiscono su /calendar. */}
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/p/:id" element={<PublicPartnerPage />} />

              {/* Rotte protette */}
              <Route
                path="/client-dashboard"
                element={
                  <ProtectedRoute requireRole="client">
                    <ClientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/partner/:id"
                element={
                  <ProtectedRoute>
                    <PartnerDetails />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/partner-dashboard"
                element={
                  <ProtectedRoute requireRole="partner">
                    <PartnerGate>
                      <PartnerDashboard />
                    </PartnerGate>
                  </ProtectedRoute>
                }
              />
              {/* Legacy Students Life routes (social/chats/profile/badges) removed
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
              <Route path="/admin-setup" element={<AdminSetup />} />

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

              <Route path="*" element={<NotFound />} />
            </Routes>
            </PageTransitions>
          </Suspense>
        </HashRouter>
      </TooltipProvider>
    </PersistQueryClientProvider>
  );
};

export default App;
