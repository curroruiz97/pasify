import type { ReactNode } from "react";

/**
 * MobileBottomNav — barra de navegación inferior compartida para los 3
 * dashboards en móvil. Reemplaza los `<nav className="fixed bottom-0 ...">`
 * inline duplicados en `PartnerDashboard.tsx`, `ClientDashboard.tsx` y
 * `AdminDashboard.tsx`.
 *
 * Render: hasta 4 tabs primarios + un `drawerSlot` como 5ª celda. Cada celda
 * es `flex-1 min-w-0` para repartir el ancho disponible sin overflow en
 * viewports estrechos (360 px). Labels usan `truncate` para evitar saltos.
 *
 * Padding-bottom usa `env(safe-area-inset-bottom)` para respetar el área
 * segura de iOS (notch / barra inferior).
 *
 * Sólo se renderiza < md.
 */

export interface MobileBottomNavItem<TId extends string = string> {
  id: TId;
  label: string;
  icon: ReactNode;
  /** Contador opcional renderizado como badge terracota sobre el icono. */
  badge?: number;
}

export interface MobileBottomNavProps<TId extends string = string> {
  items: ReadonlyArray<MobileBottomNavItem<TId>>;
  activeId: TId;
  onSelect: (id: TId) => void;
  /** El "Más" drawer trigger se renderiza como 5ª celda (flex-1). */
  drawerSlot: ReactNode;
}

export function MobileBottomNav<TId extends string = string>({
  items,
  activeId,
  onSelect,
  drawerSlot,
}: MobileBottomNavProps<TId>) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 flex items-stretch border-t border-border bg-card md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        const hasBadge = (item.badge ?? 0) > 0;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`relative flex flex-1 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[10px] font-medium leading-tight transition ${
              active ? "text-primary" : "text-muted-foreground"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <span className="relative">
              {item.icon}
              {hasBadge && (
                <span
                  className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-primary-foreground"
                  style={{ background: "#E8542A" }}
                  aria-label={`${item.badge} sin leer`}
                >
                  {item.badge}
                </span>
              )}
            </span>
            <span className="block w-full truncate text-center">{item.label}</span>
            {active && (
              <span
                className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full"
                style={{ background: "#E8542A" }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}

      {drawerSlot}
    </nav>
  );
}

export default MobileBottomNav;
