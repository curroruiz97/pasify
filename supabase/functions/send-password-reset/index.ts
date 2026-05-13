import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendEmail } from "../_shared/gmail.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PasswordResetRequest {
  email: string;
  redirect_to: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { email, redirect_to }: PasswordResetRequest = await req.json();

    console.log('📨 Richiesta invio email reset password:', { email, redirect_to });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const cleanRedirectUrl = 'https://www.pasify.es/password-recovery';

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: cleanRedirectUrl
      }
    });

    if (linkError) {
      console.error('❌ Errore generazione link:', linkError);
      throw linkError;
    }

    const resetLink = linkData.properties?.action_link;

    if (!resetLink) {
      throw new Error('Impossibile generare il link di reset');
    }

    console.log('🔗 Link generato con successo');

    await sendEmail({
      to: [email],
      subject: '🔐 Restablece tu contraseña - Pasify',
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
                  <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Restablecer Contraseña</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 16px;">Has solicitado cambiar tu contraseña</p>
                </td>
              </tr>

              <tr>
                <td style="padding: 40px 30px;">
                  <div style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 16px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #F59E0B;">
                    <h2 style="margin: 0 0 8px 0; color: #92400E; font-size: 18px; font-weight: 600;">🔐 Solicitud de cambio de contraseña</h2>
                    <p style="margin: 0; color: #78350F; font-size: 14px; opacity: 0.8;">Haz clic en el botón de abajo para crear una nueva contraseña</p>
                  </div>

                  <div style="margin-bottom: 24px;">
                    <p style="color: #334155; font-size: 14px; line-height: 1.8; margin: 0;">
                      Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de Pasify. Si no has sido tú quien ha solicitado este cambio, puedes ignorar este email de forma segura.
                    </p>
                  </div>

                  <div style="margin-top: 32px; text-align: center;">
                    <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #4F9CF9 0%, #3B82F6 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);">
                      Restablecer mi contraseña
                    </a>
                  </div>

                  <div style="margin-top: 24px; background: #F8FAFC; border-radius: 12px; padding: 16px; border: 1px solid #E2E8F0;">
                    <p style="margin: 0; color: #64748B; font-size: 12px; line-height: 1.6;">
                      <strong>⚠️ Nota de seguridad:</strong> Este enlace expirará en 1 hora. Si no has solicitado este cambio, tu cuenta sigue siendo segura y puedes ignorar este mensaje.
                    </p>
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
      message: 'Email inviata con successo via Gmail SMTP',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Errore completo in send-password-reset function:', error);
    const err = error as any;

    return new Response(JSON.stringify({
      error: err?.message || String(err),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
