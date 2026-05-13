import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Check, ChevronDown, Shield, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wordmark } from "@/components/Wordmark";
import { useAuth } from "@/hooks/useAuth";

/**
 * MobileTopBar — header sticky compartido para los 3 dashboards (Cliente/
 * Local/Admin) en móvil. Reemplaza los headers inline duplicados en
 * `PartnerDashboard.tsx`, `ClientDashboard.tsx` y `AdminDashboard.tsx`.
 *
 * Layout normal:        [Back?] [Pasify] [role pill]            [flex-1] {endSlot}
 * Layout super-admin:   [Back?] [Pasify] [role pill ▾ dropdown] [flex-1] {endSlot}
 *
 * En modo super-admin (`useAuth().canSwitchPanels === true`) la pill se
 * convierte en un trigger de DropdownMenu que permite saltar entre los 3
 * dashboards (admin / partner / client) desde la propia cabecera, sin
 * depender del `PanelSwitcher` flotante. El switcher flotante se oculta en
 * mobile cuando este dropdown está activo — sólo aparece en desktop.
 *
 * El componente sólo se renderiza < md; en desktop el sidebar lateral
 * sigue siendo la nav principal.
 */

type Role = "client" | "partner" | "admin";

const ROLE_META: Record<Role, { label: string; Icon: typeof Shield; path: string }> = {
  admin: { label: "Admin", Icon: Shield, path: "/admin" },
  partner: { label: "Local", Icon: Building2, path: "/partner-dashboard" },
  client: { label: "Cliente", Icon: UserIcon, path: "/client-dashboard" },
};

export interface MobileTopBarProps {
  /** Muestra una flecha de back a la izquierda. */
  showBack?: boolean;
  /** Handler invocado al pulsar back. Requerido si `showBack` es true. */
  onBack?: () => void;
  /** Rol activo del dashboard — controla la pill ("Cliente" / "Local" / "Admin"). */
  role: Role;
  /** Slot a la derecha (ProfileSheet, Drawer trigger, etc.). */
  endSlot: ReactNode;
  /** Tamaño del wordmark en px. */
  brandSize?: number;
}

export const MobileTopBar = ({
  showBack = false,
  onBack,
  role,
  endSlot,
  brandSize = 32,
}: MobileTopBarProps) => {
  const { canSwitchPanels, userRoles, setActiveRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const meta = ROLE_META[role];

  // El rol "canónico" para el highlight del check viene de la URL — coherente
  // con la lógica de PanelSwitcher (evita lags entre setActiveRole y el render).
  const pathToRole: Record<string, Role> = {
    "/admin": "admin",
    "/partner-dashboard": "partner",
    "/client-dashboard": "client",
  };
  let routeRole: Role = role;
  for (const [prefix, r] of Object.entries(pathToRole)) {
    if (location.pathname.startsWith(prefix) || location.hash.startsWith("#" + prefix)) {
      routeRole = r;
      break;
    }
  }

  const handleSelectRole = (target: string) => {
    const path = setActiveRole(target);
    // Pequeño delay igual que PanelSwitcher para que el state se propague antes
    // de navegar (evita parpadeo del label).
    setTimeout(() => navigate(path, { replace: false }), 50);
  };

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-3 pr-2 md:hidden"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      {showBack && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onBack}
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}

      <Wordmark height={brandSize} />

      {canSwitchPanels ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-transparent px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              aria-label={`Cambiar de panel · actualmente ${meta.label}`}
            >
              {meta.label}
              <ChevronDown
                className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
                strokeWidth={2.5}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="min-w-[200px]">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Cambiar de panel
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {userRoles.map((r) => {
              const m = ROLE_META[r as Role];
              if (!m) return null;
              const isActive = (r as Role) === routeRole;
              return (
                <DropdownMenuItem
                  key={r}
                  onSelect={() => handleSelectRole(r)}
                  className={`gap-2 ${isActive ? "bg-primary/10 text-primary" : ""}`}
                >
                  <m.Icon className="h-4 w-4" strokeWidth={2.5} />
                  <span className="flex-1">{m.label}</span>
                  {isActive && <Check className="h-4 w-4" strokeWidth={3} />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Badge variant="outline" className="border-primary/40 text-primary">
          {meta.label}
        </Badge>
      )}

      <span className="flex-1 min-w-0" />

      {endSlot}
    </header>
  );
};

export default MobileTopBar;
