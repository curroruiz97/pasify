// Pasify · notify-admin-message
// Email al admin cuando llega un mensaje nuevo. Solo servidor→servidor: ningún
// cliente la llama. Abierta, cualquiera podía mandar emails HTML arbitrarios.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendEmail, esc } from "../_shared/resend.ts";
import { requireServiceRole, HttpError } from "../_shared/internal-auth.ts";

// Antes iba a un Gmail heredado de Students Life: los mensajes salían de Pasify.
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "admin@pasify.es";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface NotifyAdminRequest {
  sender_name: string;
  sender_type: string;
  message_preview: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    requireServiceRole(req);
    const payload: NotifyAdminRequest = await req.json();
    // Todo lo que llega en el body se escapa antes de ir al HTML.
    const sender_name = esc(payload.sender_name);
    const sender_type = esc(payload.sender_type);
    const message_preview = esc(payload.message_preview);

    await sendEmail({
      to: [ADMIN_EMAIL],
      subject: `💬 Nuevo mensaje de ${payload.sender_type ?? ''}`,
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
                  <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Pasify</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 16px;">Notificación de nuevo mensaje</p>
                </td>
              </tr>

              <tr>
                <td style="padding: 40px 30px;">
                  <div style="background: linear-gradient(135deg, #E0F2FE 0%, #DBEAFE 100%); border-radius: 16px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #3B82F6;">
                    <h2 style="margin: 0 0 8px 0; color: #1E40AF; font-size: 18px; font-weight: 600;">💬 Nuevo mensaje recibido</h2>
                    <p style="margin: 0; color: #1E3A8A; font-size: 14px; opacity: 0.8;">Has recibido un nuevo mensaje en la plataforma</p>
                  </div>

                  <div style="margin-bottom: 24px;">
                    <p style="margin: 0 0 12px 0; color: #64748B; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Remitente</p>
                    <p style="margin: 0 0 4px 0; color: #1E293B; font-size: 18px; font-weight: 600;">${sender_name}</p>
                    <p style="margin: 0; color: #64748B; font-size: 14px;">${sender_type}</p>
                  </div>

                  <div style="background: #F8FAFC; border-radius: 12px; padding: 20px; border: 1px solid #E2E8F0;">
                    <p style="margin: 0 0 8px 0; color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Vista previa del mensaje</p>
                    <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.6;">${message_preview}</p>
                  </div>

                  <div style="margin-top: 32px; text-align: center;">
                    <a href="https://pasify.es/#/admin" style="display: inline-block; background: linear-gradient(135deg, #4F9CF9 0%, #3B82F6 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); transition: transform 0.2s;">
                      Ver en el panel de administración
                    </a>
                  </div>
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
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('notify-admin-message failed:', error);

    return new Response(JSON.stringify({
      error: error instanceof HttpError ? error.code : 'internal_error',
    }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
