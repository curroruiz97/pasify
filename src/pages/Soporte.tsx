import { Link } from "react-router-dom";
import { Mail, MessageSquare, Trash2, ShieldCheck } from "lucide-react";

const CONTACTO = "comunicacion@avenuemedia.io";

/**
 * Página pública de soporte. Necesaria para la ficha de App Store Connect:
 * Apple abre la "URL de soporte" y comprueba que haya una vía real de contacto.
 * No requiere sesión a propósito — el revisor la visita sin estar logueado.
 */
const Soporte = () => (
  <div className="min-h-screen bg-[#0F0F0F] px-6 py-14 text-[#F4EEE2]">
    <div className="mx-auto w-full max-w-2xl">
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#E8542A]">Pasify</p>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight">Soporte</h1>
      <p className="mb-10 text-[15px] leading-relaxed text-white/60">
        ¿Algún problema con tus entradas, tu cuenta o tu local? Escríbenos y te
        respondemos en horario laboral, de lunes a viernes.
      </p>

      <a
        href={`mailto:${CONTACTO}`}
        className="mb-10 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#E8542A]/50"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#E8542A]/15 text-[#FF7A4D]">
          <Mail className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] uppercase tracking-[0.14em] text-white/40">
            Correo de soporte
          </span>
          <span className="block truncate text-lg font-medium">{CONTACTO}</span>
        </span>
      </a>

      <h2 className="mb-4 text-lg font-semibold">Preguntas frecuentes</h2>
      <div className="space-y-4 text-[15px] leading-relaxed text-white/70">
        <p>
          <strong className="text-white">No encuentro mi entrada.</strong> Entra en la
          app con la misma cuenta con la que compraste y abre la pestaña Tickets. Si
          sigue sin aparecer, escríbenos indicando el evento y el correo de la compra.
        </p>
        <p>
          <strong className="text-white">El QR no se valida en la puerta.</strong>{" "}
          Sube el brillo de la pantalla y muestra el código completo. Si el personal
          del local no consigue leerlo, que lo valide manualmente desde su panel.
        </p>
        <p>
          <strong className="text-white">Quiero una devolución.</strong> Las
          devoluciones dependen de la política de cada local. Escríbenos con el número
          de tu entrada y lo gestionamos con el organizador.
        </p>
        <p>
          <strong className="text-white">Tengo un local y quiero vender entradas.</strong>{" "}
          Escríbenos y te explicamos cómo darte de alta como partner.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-3 text-sm">
        <Link
          to="/privacidad"
          className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-white/70 transition hover:text-white"
        >
          <ShieldCheck className="h-4 w-4" /> Política de privacidad
        </Link>
        <a
          href={`mailto:${CONTACTO}?subject=Eliminar%20mi%20cuenta%20de%20Pasify`}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-white/70 transition hover:text-white"
        >
          <Trash2 className="h-4 w-4" /> Eliminar mi cuenta
        </a>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-white/70 transition hover:text-white"
        >
          <MessageSquare className="h-4 w-4" /> Volver a la app
        </Link>
      </div>

      <p className="mt-12 text-[13px] leading-relaxed text-white/35">
        Pasify es un servicio de Avenue Digital Group SL · Plaza Mayor 23, Piso 1 A,
        47001 Valladolid, España
      </p>
    </div>
  </div>
);

export default Soporte;
