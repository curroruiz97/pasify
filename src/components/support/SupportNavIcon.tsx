import { MessageCircle } from "lucide-react";

/**
 * Icono de «Soporte» en los menús (lateral, cajón y barra inferior) con los
 * mensajes de Pasify sin leer (useSupportUnread). Sin mensajes, el icono solo.
 */
export function SupportNavIcon({ count = 0 }: { count?: number }) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      <MessageCircle className="h-5 w-5" />
      {n > 0 && (
        <>
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
            style={{ background: "#E8542A" }}
          >
            {n > 9 ? "9+" : n}
          </span>
          <span className="sr-only">{n === 1 ? ", 1 mensaje sin leer" : `, ${n} mensajes sin leer`}</span>
        </>
      )}
    </span>
  );
}

export default SupportNavIcon;
