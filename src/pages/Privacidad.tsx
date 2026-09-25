import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

/** La única política de privacidad: la misma URL que enlazan Google Play, App Store y la web. */
const POLITICA_URL = "/privacidad.html";

/**
 * Política de privacidad dentro de la app (/#/privacidad). Obligatoria para
 * App Store Connect y Google Play, y exigida por el RGPD. Sin sesión: el
 * revisor la abre sin entrar.
 *
 * El texto NO vive aquí: se muestra public/privacidad.html, la política
 * canónica. Antes había dos textos (este y el HTML) que decían cosas
 * distintas; cualquier cambio se hace solo en el HTML.
 */
const Privacidad = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const anterior = document.title;
    document.title = "Política de privacidad · Pasify";
    return () => {
      document.title = anterior;
    };
  }, []);

  const volver = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0F0F0F] text-[#F4EEE2]">
      <div
        className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 pb-3"
        style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
      >
        <button
          type="button"
          onClick={volver}
          className="inline-flex items-center rounded-full border border-white/12 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          ← Volver
        </button>
        <Link
          to="/soporte"
          className="inline-flex items-center rounded-full border border-white/12 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          Soporte
        </Link>
      </div>
      <iframe src={POLITICA_URL} title="Política de privacidad de Pasify" className="w-full flex-1 border-0 bg-[#0F0F0F]" />
    </div>
  );
};

export default Privacidad;
