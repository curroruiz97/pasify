import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendEmail } from "../_shared/gmail.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface EventConfirmationRequest {
  user_email: string;
  user_name: string;
  event_title: string;
  event_date: string;
  partner_name: string;
  discount_percentage?: number | null;
  qr_code?: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const {
      user_email,
      user_name,
      event_title,
      event_date,
      partner_name,
      discount_percentage,
      qr_code,
    }: EventConfirmationRequest = await req.json();

    console.log('📨 Sending event confirmation email to:', user_email, 'for event:', event_title);

    const formattedDate = new Date(event_date).toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const discountSection = discount_percentage && discount_percentage > 0
      ? `
        <div style="background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%); border-radius: 12px; padding: 20px; margin-top: 20px; text-align: center; border: 1px solid #93C5FD;">
          <p style="margin: 0 0 4px 0; color: #1E40AF; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Descuento incluido</p>
          <p style="margin: 0; color: #2563EB; font-size: 32px; font-weight: 700;">${discount_percentage}% OFF</p>
        </div>
      `
      : '';

    await sendEmail({
      to: [user_email],
      subject: `Iscrizione confermata: ${event_title}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #F0F7FF;">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.1);">
              <tr>
                <td style="background: white; padding: 40px 30px; text-align: center;">
                  <img src="https://lwtmddtwuiheluccykvs.supabase.co/storage/v1/object/public/avatars/logo.png" alt="StudentsLife" style="width: 80px; height: 80px; border-radius: 20px; margin-bottom: 20px;">
                  <h1 style="color: #2563EB; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">¡Inscripción confirmada!</h1>
                  <p style="color: #64748B; margin: 8px 0 0 0; font-size: 16px;">Tu plaza está reservada</p>
                </td>
              </tr>

              <tr>
                <td style="padding: 40px 30px;">
                  <div style="background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%); border-radius: 16px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #3B82F6;">
                    <h2 style="margin: 0 0 8px 0; color: #1E40AF; font-size: 18px; font-weight: 600;">¡Hola ${user_name}!</h2>
                    <p style="margin: 0; color: #2563EB; font-size: 14px;">Te has inscrito correctamente al evento</p>
                  </div>

                  <div style="margin-bottom: 24px;">
                    <h3 style="color: #1E293B; font-size: 16px; margin: 0 0 16px 0;">Detalles del evento:</h3>

                    <div style="background: #F8FAFC; border-radius: 12px; padding: 20px; border: 1px solid #E2E8F0;">
                      <div style="margin-bottom: 16px;">
                        <p style="margin: 0 0 4px 0; color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Evento</p>
                        <p style="margin: 0; color: #1E293B; font-size: 18px; font-weight: 600;">${event_title}</p>
                      </div>

                      <div style="margin-bottom: 16px;">
                        <p style="margin: 0 0 4px 0; color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Fecha</p>
                        <p style="margin: 0; color: #1E293B; font-size: 15px;">${formattedDate}</p>
                      </div>

                      <div>
                        <p style="margin: 0 0 4px 0; color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Organizado por</p>
                        <p style="margin: 0; color: #1E293B; font-size: 15px;">${partner_name}</p>
                      </div>
                    </div>

                    ${discountSection}
                  </div>

                  ${qr_code ? `
                  <div style="margin-top: 32px; text-align: center;">
                    <p style="margin: 0 0 12px 0; color: #1E293B; font-size: 16px; font-weight: 600;">Tu código QR</p>
                    <div style="display: inline-block; background: white; padding: 16px; border-radius: 16px; border: 2px solid #E2E8F0;">
                      <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr_code)}" alt="QR Code" style="width: 200px; height: 200px;" />
                    </div>
                    <p style="margin: 12px 0 0 0; color: #64748B; font-size: 14px; font-family: monospace; letter-spacing: 1px;">${qr_code}</p>
                    <p style="margin: 8px 0 0 0; color: #94A3B8; font-size: 12px;">Muestra este código en la entrada del evento</p>
                  </div>
                  ` : `
                  <div style="margin-top: 32px; text-align: center;">
                    <a href="https://studentslife.es" style="display: inline-block; background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);">
                      Ver mi ticket en StudentsLife
                    </a>
                  </div>
                  `}
                </td>
              </tr>

              <tr>
                <td style="background: #F8FAFC; padding: 24px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
                  <p style="margin: 0; color: #64748B; font-size: 13px;">
                    Este es un mensaje automático de <strong style="color: #3B82F6;">StudentsLife</strong>
                  </p>
                  <p style="margin: 8px 0 0 0; color: #94A3B8; font-size: 12px;">
                    © ${new Date().getFullYear()} StudentsLife. Todos los derechos reservados.
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
      message: 'Confirmation email sent successfully',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Error in send-event-confirmation:', error);
    const err = error as any;

    return new Response(JSON.stringify({
      error: err?.message || String(err),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
