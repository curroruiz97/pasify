import { Link } from "react-router-dom";

const CONTACTO = "comunicacion@avenuemedia.io";

/**
 * Política de privacidad pública. Obligatoria para App Store Connect y para
 * Google Play, y exigida por el RGPD. Sin sesión: el revisor la abre sin entrar.
 *
 * El contenido refleja lo que la app hace de verdad (Supabase en la UE, Stripe
 * para pagos, Sentry para errores, cámara para QR, micrófono para notas de voz).
 * Si cambia la arquitectura, hay que actualizar esta página.
 */
const Privacidad = () => (
  <div className="min-h-screen bg-[#0F0F0F] px-6 py-14 text-[#F4EEE2]">
    <div className="mx-auto w-full max-w-2xl">
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#E8542A]">Pasify</p>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight">Política de privacidad</h1>
      <p className="mb-10 text-[13px] text-white/40">Última actualización: 25 de agosto de 2026</p>

      <div className="space-y-8 text-[15px] leading-relaxed text-white/70">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Quién trata tus datos</h2>
          <p>
            El responsable es <strong className="text-white">Avenue Digital Group SL</strong>,
            con domicilio en Plaza Mayor 23, Piso 1 A, 47001 Valladolid (España).
            Para cualquier cuestión sobre privacidad puedes escribir a{" "}
            <a href={`mailto:${CONTACTO}`} className="text-[#FF7A4D] underline">{CONTACTO}</a>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Qué datos recogemos</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-white">Cuenta:</strong> nombre, correo electrónico y, si lo facilitas, teléfono.</li>
            <li><strong className="text-white">Compras:</strong> entradas adquiridas, importe y evento asociado.</li>
            <li><strong className="text-white">Contenido:</strong> imágenes de locales y eventos, y los mensajes que envías al chat de soporte.</li>
            <li><strong className="text-white">Uso:</strong> información básica sobre cómo utilizas la app, para mantenerla en funcionamiento.</li>
            <li><strong className="text-white">Errores:</strong> informes técnicos de fallos, sin asociar a tu identidad.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Para qué los usamos</h2>
          <p>
            Para darte acceso a tu cuenta, gestionar la compra y validación de tus
            entradas, atenderte cuando escribes a soporte, cumplir nuestras
            obligaciones legales y detectar y corregir errores de la aplicación.
            <strong className="text-white"> No usamos tus datos con fines publicitarios
            ni los vendemos a terceros.</strong>
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Permisos del dispositivo</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-white">Cámara:</strong> únicamente para escanear los códigos QR de las entradas en la puerta del local.</li>
            <li><strong className="text-white">Micrófono:</strong> únicamente si decides enviar una nota de voz en el chat de soporte.</li>
            <li><strong className="text-white">Fotos:</strong> para adjuntar imágenes de tu local o de tus eventos, y para guardar entradas en tu carrete.</li>
          </ul>
          <p className="mt-2">
            Todos son opcionales: la app te los pide en el momento de usarlos y puedes
            denegarlos o revocarlos desde los ajustes del dispositivo.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Con quién los compartimos</h2>
          <p>Solo con los proveedores necesarios para que el servicio funcione:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong className="text-white">Supabase</strong> — alojamiento de la base de datos y autenticación, en la Unión Europea.</li>
            <li><strong className="text-white">Stripe</strong> — procesamiento de los pagos. Nosotros no almacenamos los datos de tu tarjeta.</li>
            <li><strong className="text-white">Sentry</strong> — registro de errores técnicos de la aplicación.</li>
            <li><strong className="text-white">Google</strong> y <strong className="text-white">Apple</strong> — solo si eliges iniciar sesión con sus cuentas.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Cuánto tiempo los conservamos</h2>
          <p>
            Mientras tu cuenta esté activa. Los registros de compra se conservan el
            tiempo que exige la normativa fiscal y mercantil aplicable.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Tus derechos</h2>
          <p>
            Puedes acceder a tus datos, rectificarlos, eliminarlos, oponerte a su
            tratamiento, limitarlo o solicitar su portabilidad escribiendo a{" "}
            <a href={`mailto:${CONTACTO}`} className="text-[#FF7A4D] underline">{CONTACTO}</a>.
            También puedes reclamar ante la Agencia Española de Protección de Datos
            (aepd.es).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Eliminar tu cuenta</h2>
          <p>
            Escríbenos a{" "}
            <a href={`mailto:${CONTACTO}?subject=Eliminar%20mi%20cuenta%20de%20Pasify`} className="text-[#FF7A4D] underline">{CONTACTO}</a>{" "}
            indicando el correo de tu cuenta y la eliminaremos, salvo los datos que
            debamos conservar por obligación legal.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Menores</h2>
          <p>
            Pasify no está dirigida a menores de 16 años. El acceso a los locales y
            eventos está sujeto además a las condiciones de edad que fije cada local.
          </p>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap gap-3 text-sm">
        <Link to="/soporte" className="inline-flex items-center rounded-full border border-white/12 px-4 py-2 text-white/70 transition hover:text-white">
          Soporte
        </Link>
        <Link to="/" className="inline-flex items-center rounded-full border border-white/12 px-4 py-2 text-white/70 transition hover:text-white">
          Volver a la app
        </Link>
      </div>
    </div>
  </div>
);

export default Privacidad;
