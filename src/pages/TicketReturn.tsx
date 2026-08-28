import { CheckCircle2 } from "lucide-react";

/**
 * Pasify · destino de retorno de Stripe Checkout para la APP NATIVA.
 *
 * Por que existe una pagina aparte de /ticket/success:
 *
 * En la app nativa el checkout se abre en Safari, fuera de la WebView, asi
 * que quien aterriza aqui es un navegador SIN sesion de Supabase. La pagina
 * /ticket/success necesita sesion: consulta `ticket_orders`, y sus politicas
 * RLS solo dejan leer al comprador autenticado. Un usuario anonimo veria el
 * estado de "no hemos podido encontrar tu pedido" justo despues de pagar,
 * que es peor que no enseñar nada.
 *
 * Esta pagina no consulta nada. El pago ya esta confirmado por el webhook de
 * Stripe en el servidor, de forma independiente de este redirect: la entrada
 * existe aunque el usuario cierre Safari aqui mismo. Lo unico que hace falta
 * es decirle que vuelva a la app.
 */
const TicketReturn = () => (
  <div className="flex min-h-screen items-center justify-center bg-[#0F0F0F] px-6 text-[#F4EEE2]">
    <div className="w-full max-w-md text-center">
      <div
        className="mx-auto grid h-16 w-16 place-items-center rounded-2xl"
        style={{
          background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          boxShadow: "0 10px 30px -10px rgba(232,84,42,0.6)",
        }}
      >
        <CheckCircle2 className="h-9 w-9 text-white" />
      </div>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Pago completado</h1>

      <p className="mt-3 text-[15px] leading-relaxed text-white/60">
        Tu entrada ya está emitida. Vuelve a la aplicación de Pasify y ábrela en
        la pestaña <strong className="text-white">Tickets</strong>: ahí tienes el
        código QR que te validarán en la puerta.
      </p>

      <p className="mt-8 text-[13px] leading-relaxed text-white/35">
        Puedes cerrar esta ventana. También te hemos enviado la entrada por
        correo electrónico.
      </p>
    </div>
  </div>
);

export default TicketReturn;
