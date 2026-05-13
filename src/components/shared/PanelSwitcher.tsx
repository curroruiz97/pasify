import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Shield, Building2, User, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * PanelSwitcher · floating overlay top-right.
 *
 * Visible SOLO cuando el usuario autenticado tiene 2+ roles (`userRoles.length >= 2`).
 * Permite saltar entre /admin, /partner-dashboard y /client-dashboard cambiando
 * el `activeRole` persistido en localStorage (vía `useAuth.setActiveRole`).
 *
 * Estilo Pasify: cápsula cream con grain implícito, mono uppercase labels,
 * accent terracota en el role activo, sombra cálida en hover.
 */

const ROLE_META: Record<string, { label: string; Icon: typeof Shield; path: string; accent: string }> = {
  admin:   { label: "Admin",   Icon: Shield,     path: "/admin",              accent: "#E8542A" },
  partner: { label: "Partner", Icon: Building2,  path: "/partner-dashboard",  accent: "#B8381A" },
  client:  { label: "Client",  Icon: User,       path: "/client-dashboard",   accent: "#FF7A4D" },
};

const FONT_MONO: React.CSSProperties = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
};

export const PanelSwitcher = () => {
  const { userRoles, userRole, setActiveRole, isAuthenticated, canSwitchPanels } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.closest?.("[data-pasify-switcher]")) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Ocultar en rutas no-dashboard. Derivamos el role activo DEL PATHNAME en
  // vez de del state `userRole` para evitar lags de sincronización (cuando
  // ProtectedRoute hace auto-switch via setActiveRole, el state de useAuth
  // tarda un render en propagarse; mientras tanto el label parpadeaba al
  // role anterior). El pathname es la fuente canónica del role activo.
  const pathToRole: Record<string, "admin" | "partner" | "client"> = {
    "/admin": "admin",
    "/partner-dashboard": "partner",
    "/client-dashboard": "client",
  };
  let routeRole: "admin" | "partner" | "client" | null = null;
  for (const [prefix, role] of Object.entries(pathToRole)) {
    if (location.pathname.startsWith(prefix) || location.hash.startsWith("#" + prefix)) {
      routeRole = role;
      break;
    }
  }

  if (!isAuthenticated) return null;
  if (!userRole) return null;
  // Fase 1 hardening: el switcher es exclusivo del super-admin/dev mode.
  // `canSwitchPanels` exige email allowlist + rol admin + env flag
  // VITE_ENABLE_SUPER_ADMIN_SWITCHER=true. Cualquier otro usuario nunca lo ve,
  // ni siquiera si manipula localStorage o tiene roles acumulados antiguos.
  if (!canSwitchPanels) return null;
  if (!routeRole) return null; // No dashboard route

  // Visual: usa routeRole (canonical de la URL). Estado: userRole sirve
  // como fallback para el check del dropdown.
  const displayRole = routeRole;
  const active = ROLE_META[displayRole];
  if (!active) return null;

  const handleSelect = (role: string) => {
    const path = setActiveRole(role);
    setOpen(false);
    // Pequeño delay para que el state se propague antes de navegar
    setTimeout(() => navigate(path, { replace: false }), 50);
  };

  return (
    <div
      data-pasify-switcher
      // hidden en mobile: el MobileTopBar ya incluye un dropdown inline que
      // permite cambiar de panel desde la cabecera. Mantenemos la cápsula
      // flotante sólo en desktop (md+) donde no compite con el header.
      className="fixed z-[9998] hidden md:flex flex-col items-end"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 14px)",
        right: 16,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-2 rounded-full border px-3.5 py-2 transition-all"
        style={{
          borderColor: "rgba(38,33,28,0.16)",
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.95) 0%, rgba(247,243,236,0.92) 100%)",
          backdropFilter: "blur(12px)",
          boxShadow:
            "0 8px 24px -10px rgba(232,84,42,.28), 0 2px 6px -2px rgba(0,0,0,.08)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow =
            "0 12px 30px -10px rgba(232,84,42,.42), 0 4px 10px -2px rgba(0,0,0,.12)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow =
            "0 8px 24px -10px rgba(232,84,42,.28), 0 2px 6px -2px rgba(0,0,0,.08)";
          e.currentTarget.style.transform = "";
        }}
      >
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-white"
          style={{
            background: `linear-gradient(180deg, ${active.accent} 0%, #B8381A 100%)`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.45), 0 2px 6px -1px rgba(232,84,42,.5)",
          }}
        >
          <active.Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <span
          style={{
            ...FONT_MONO,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 600,
            color: "#1A1612",
          }}
        >
          Panel · {active.label}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform"
          style={{
            color: "#8A8275",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {open && (
        <div
          className="mt-2 min-w-[220px] overflow-hidden rounded-2xl border"
          style={{
            borderColor: "rgba(38,33,28,0.12)",
            background:
              "linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(247,243,236,0.96) 100%)",
            backdropFilter: "blur(14px)",
            boxShadow:
              "0 22px 50px -18px rgba(232,84,42,.32), 0 4px 12px -4px rgba(0,0,0,.12)",
          }}
        >
          {/* Header */}
          <div
            className="border-b px-4 py-2.5"
            style={{ borderColor: "rgba(38,33,28,0.10)" }}
          >
            <div
              style={{
                ...FONT_MONO,
                fontSize: 9.5,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#8A8275",
              }}
            >
              Cambiar de panel
            </div>
          </div>

          {/* Items */}
          <div className="py-1.5">
            {userRoles.map((role) => {
              const meta = ROLE_META[role];
              if (!meta) return null;
              // isActive: usa routeRole (canonical de la URL) para mantener consistencia
              // visual con el label de la cápsula.
              const isActive = role === displayRole;
              return (
                <button
                  key={role}
                  onClick={() => handleSelect(role)}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 transition-colors"
                  style={{
                    background: isActive ? "rgba(232,84,42,0.08)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "rgba(232,84,42,0.05)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg"
                    style={{
                      background: isActive
                        ? `linear-gradient(180deg, ${meta.accent}, #B8381A)`
                        : "rgba(232,84,42,0.10)",
                      color: isActive ? "#fff" : "#B8381A",
                      boxShadow: isActive
                        ? "inset 0 1px 0 rgba(255,255,255,.45), 0 2px 6px -1px rgba(232,84,42,.5)"
                        : "none",
                    }}
                  >
                    <meta.Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <div className="flex flex-1 flex-col items-start">
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: isActive ? 600 : 500,
                        letterSpacing: "-0.01em",
                        color: "#1A1612",
                      }}
                    >
                      {meta.label}
                    </span>
                    <span
                      style={{
                        ...FONT_MONO,
                        fontSize: 9.5,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "#8A8275",
                      }}
                    >
                      {meta.path.replace("/", "")}
                    </span>
                  </div>
                  {isActive && (
                    <Check
                      className="h-4 w-4"
                      style={{ color: "#B8381A" }}
                      strokeWidth={3}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div
            className="border-t px-4 py-2"
            style={{ borderColor: "rgba(38,33,28,0.08)" }}
          >
            <span
              style={{
                ...FONT_MONO,
                fontSize: 9,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8A8275",
              }}
            >
              Super Admin · Dev mode
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default PanelSwitcher;
