import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendEmail } from "../_shared/gmail.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ApprovalEmailRequest {
  user_email: string;
  user_name: string;
  user_type: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { user_email, user_name, user_type }: ApprovalEmailRequest = await req.json();

    console.log('📨 Richiesta invio email approvazione:', { user_email, user_name, user_type });

    await sendEmail({
      to: [user_email],
      subject: user_type === 'partner'
        ? '🎉 ¡Tu cuenta de Partner ha sido aprobada!'
        : '🎉 ¡Tu cuenta de Pasify ha sido aprobada!',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
              <tr>
                <td style="background: linear-gradient(135deg, #4F9CF9 0%, #3B82F6 100%); padding: 40px 30px; text-align: center;">
                  <img src="https://lwtmddtwuiheluccykvs.supabase.co/storage/v1/object/public/avatars/logo.png" alt="Pasify" style="width: 80px; height: 80px; border-radius: 20px; margin-bottom: 20px; box-shadow: 0 8px 16px rgba(0,0,0,0.1);">
                  <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">¡Felicidades, ${user_name}!</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 16px;">Tu cuenta ha sido aprobada</p>
                </td>
              </tr>

              <tr>
                <td style="padding: 40px 30px;">
                  <div style="background: linear-gradient(135deg, #E0F2FE 0%, #DBEAFE 100%); border-radius: 16px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #3B82F6;">
                    <h2 style="margin: 0 0 8px 0; color: #1E40AF; font-size: 18px; font-weight: 600;">🎉 ¡Bienvenido a Pasify!</h2>
                    <p style="margin: 0; color: #1E3A8A; font-size: 14px; opacity: 0.8;">Ya puedes acceder a todas las funcionalidades de la plataforma</p>
                  </div>

                  ${user_type === 'partner' ? `
                    <div style="margin-bottom: 24px;">
                      <h3 style="color: #1E293B; font-size: 16px; margin: 0 0 12px 0;">Como Partner, ahora puedes:</h3>
                      <ul style="color: #334155; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                        <li>Crear y gestionar eventos especiales</li>
                        <li>Ofrecer descuentos exclusivos a estudiantes</li>
                        <li>Gestionar tu galería de fotos</li>
                        <li>Escanear códigos QR de estudiantes</li>
                        <li>Ver estadísticas de tu negocio</li>
                      </ul>
                    </div>
                  ` : `
                    <div style="margin-bottom: 24px;">
                      <h3 style="color: #1E293B; font-size: 16px; margin: 0 0 12px 0;">Como estudiante, ahora puedes:</h3>
                      <ul style="color: #334155; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                        <li>Acceder a descuentos exclusivos</li>
                        <li>Participar en eventos especiales</li>
                        <li>Generar códigos QR para obtener beneficios</li>
                        <li>Conectar con comercios locales</li>
                        <li>Compartir experiencias en la red social</li>
                      </ul>
                    </div>
                  `}
                </td>
              </tr>

              <tr>
                <td style="background: #F8FAFC; padding: 24px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
                  <p style="margin: 0; color: #64748B; font-size: 13px;">
                    Este es un mensaje automático de <strong style="color: #3B82F6;">Pasify</strong>
                  </p>
                  <p style="margin: 8px 0 0 0; color: #94A3B8; font-size: 12px;">
                    © ${new Date().getFullYear()} Pasify. Todos los derechos reservados.
                  </p>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Email inviata con successo via Gmail SMTP',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Errore completo in send-approval-email function:', error);
    const err = error as any;

    return new Response(JSON.stringify({
      error: err?.message || String(err),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
