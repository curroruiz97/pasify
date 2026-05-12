import { ReactNode } from "react";
import Wordmark from "@/components/Wordmark";

interface AuthShellProps {
  headline: ReactNode;
  subline?: ReactNode;
  imageUrl?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Layout split-screen per pagine di autenticazione (Pasify).
 * Sinistra: hero arancione/nero con logo; Destra: form su sfondo chiaro.
 */
export const AuthShell = ({ headline, subline, imageUrl, children, footer }: AuthShellProps) => {
  const bg = imageUrl || "/partner-hero.jpg";

  return (
    <div className="min-h-screen md:flex" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* LEFT — hero */}
      <div className="relative flex min-h-[38vh] flex-col justify-between overflow-hidden p-6 md:min-h-screen md:w-[52%] md:p-12">
        <img
          src={bg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
          loading="eager"
        />
        {/* Overlay terracota Pasify + nero */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(232,84,42,0.88) 0%, rgba(184,56,26,0.92) 45%, rgba(10,10,10,0.97) 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 md:hidden"
          style={{ background: "linear-gradient(to bottom, transparent, #f8fafc)" }}
        />
        <div className="pointer-events-none absolute -top-20 -left-20 h-60 w-60 rounded-full bg-white/10 blur-[70px] md:h-80 md:w-80 md:blur-[80px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-orange-300/25 blur-[80px] md:h-96 md:w-96 md:blur-[100px]" />

        {/* Logo Pasify (PNG ufficiale) */}
        <div className="relative z-10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <button
            onClick={() => (window.location.href = "/")}
            className="inline-flex items-center"
            aria-label="Pasify"
          >
            <Wordmark className="h-10 md:h-12" />
          </button>
        </div>

        {/* Headline */}
        <div className="relative z-10 mt-6 max-w-md md:mt-0 md:my-auto md:py-8">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-white md:text-5xl lg:text-[56px]">
            {headline}
          </h1>
          {subline && (
            <p className="mt-3 text-sm leading-relaxed text-white/85 md:mt-6 md:max-w-[28rem] md:text-lg md:leading-[1.55]">
              {subline}
            </p>
          )}
        </div>

        {/* Bottom trust — desktop */}
        <div className="relative z-10 hidden items-center gap-3 text-xs text-white/70 md:flex">
          <span>
            <strong className="text-white">Tickets, eventos y locales</strong> · España
          </span>
        </div>
      </div>

      {/* RIGHT — form (force light theme tokens so dark global theme doesn't make text white-on-white) */}
      <div
        className="flex flex-1 flex-col bg-slate-50 md:bg-white"
        style={
          {
            "--background": "0 0% 100%",
            "--foreground": "210 15% 20%",
            "--card": "0 0% 100%",
            "--card-foreground": "210 15% 20%",
            "--popover": "0 0% 100%",
            "--popover-foreground": "210 15% 20%",
            "--muted": "210 20% 96%",
            "--muted-foreground": "210 10% 45%",
            "--border": "210 20% 90%",
            "--input": "210 20% 90%",
            "--ring": "13 80% 54%",
            color: "hsl(210 15% 20%)",
          } as React.CSSProperties
        }
      >
        <div className="flex flex-1 items-center justify-center px-5 py-8 md:p-12">
          <div className="w-full max-w-md">{children}</div>
        </div>

        {footer && <div className="px-6 pb-8 md:px-12">{footer}</div>}
      </div>
    </div>
  );
};

export default AuthShell;
