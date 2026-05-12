import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendEmail } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Anti-spam email headers
const getEmailHeaders = (userEmail: string) => ({
  "List-Unsubscribe": `<mailto:unsubscribe@studentslife.es?subject=Unsubscribe%20${encodeURIComponent(userEmail)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  "X-Entity-Ref-ID": crypto.randomUUID(),
  "Precedence": "bulk",
});

// Quota giornaliera
const MAX_EMAILS_PER_DAY = 20;

// Subject variati per ogni invio
const SUBJECT_POOL = [
  "Nuevas ofertas disponibles en StudentsLife",
  "Descubre las promociones de hoy",
  "Ofertas exclusivas para ti",
  "No te pierdas estos descuentos",
  "Novedades y ofertas en StudentsLife",
  "Ahorra hoy con StudentsLife",
  "Eventos y descuentos que te esperan",
  "Mira lo que hay de nuevo en StudentsLife",
];

function pickRandomSubject(): string {
  return SUBJECT_POOL[Math.floor(Math.random() * SUBJECT_POOL.length)];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    console.log("Starting marketing email job...");

    let testEmail: string | null = null;
    try {
      const body = await req.json();
      testEmail = body.test_email || null;
    } catch {
      // No body
    }

    if (testEmail) {
      console.log(`TEST MODE: Sending only to ${testEmail}`);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch sconti attivi dalla tabella discounts
    const { data: allDiscounts, error: discountsError } = await supabase
      .from("discounts")
      .select(`id, title, description, image_url, discount_percentage, partner_id, created_at`)
      .eq("is_active", true)
      .gt("end_date", new Date().toISOString());

    if (discountsError) {
      console.error("Error fetching discounts:", discountsError);
      throw discountsError;
    }

    const allItems: any[] = allDiscounts || [];

    // Shuffle random e prendere 4-6 elementi misti
    const shuffled = allItems.sort(() => Math.random() - 0.5);
    const itemCount = Math.min(shuffled.length, 4 + Math.floor(Math.random() * 3)); // 4-6
    const selectedItems = shuffled.slice(0, itemCount);

    console.log(`Found ${allItems.length} total items, selected ${selectedItems.length} for email`);

    if (selectedItems.length === 0) {
      console.log("No active discounts to promote");
      return new Response(
        JSON.stringify({ message: "No active discounts to promote" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const partnerIds = [...new Set(selectedItems.map(e => e.partner_id))];
    const { data: partners } = await supabase
      .from("profiles")
      .select("id, business_name, profile_image_url")
      .in("id", partnerIds);

    const partnerMap = new Map(partners?.map(p => [p.id, p]) || []);

    const eventCardsHtml = selectedItems.map(item => {
      const partner = partnerMap.get(item.partner_id);
      const imageUrl = item.image_url || partner?.profile_image_url || '';
      const discountBadge = item.discount_percentage && item.discount_percentage > 0
        ? `<span style="background: linear-gradient(135deg, #ec4899, #8b5cf6); color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">${item.discount_percentage}% OFF</span>`
        : '';

      return `
        <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); margin-bottom: 20px;">
          ${imageUrl ? `<img src="${imageUrl}" alt="${item.title}" style="width: 100%; height: 180px; object-fit: cover;" />` : ''}
          <div style="padding: 20px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              ${partner?.profile_image_url ? `<img src="${partner.profile_image_url}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;" />` : ''}
              <span style="font-weight: 600; color: #374151;">${partner?.business_name || 'Partner'}</span>
              ${discountBadge}
            </div>
            <h3 style="margin: 0 0 10px 0; color: #111827; font-size: 18px;">${item.title}</h3>
            <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.5;">${item.description || ''}</p>
          </div>
        </div>
      `;
    }).join('');

    const itemsTitles = selectedItems.map(e => `- ${e.title}${e.discount_percentage ? ` (${e.discount_percentage}% OFF)` : ''}`).join('\n');

    if (testEmail) {
      try {
        const subject = pickRandomSubject();
        await sendEmail({
          to: [testEmail],
          replyTo: "info@studentslife.es",
          subject,
          headers: getEmailHeaders(testEmail),
          text: buildEmailText("Usuario Test", itemsTitles),
          html: buildEmailHtml("Usuario Test", eventCardsHtml),
        });

        console.log(`Test email sent to ${testEmail} with subject: "${subject}"`);
        return new Response(
          JSON.stringify({ success: true, message: `Test email sent to ${testEmail}`, subject }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e: any) {
        console.error(`Exception sending test email:`, e);
        return new Response(
          JSON.stringify({ success: false, error: e.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Inizio giornata (UTC) per tracking giornaliero
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    console.log("Looking for inactive users since:", sixDaysAgo.toISOString());
    console.log("Checking emails sent since:", startOfDay.toISOString());

    // Verificare email inviate OGGI
    const { data: emailsSentToday } = await supabase
      .from("marketing_email_log")
      .select("user_id")
      .gte("sent_at", startOfDay.toISOString());

    const alreadySentUserIds = new Set((emailsSentToday || []).map(e => e.user_id));
    const emailsSentCount = alreadySentUserIds.size;

    console.log(`Emails already sent today: ${emailsSentCount}`);

    // Calcolare quota rimanente per oggi
    const remainingQuota = MAX_EMAILS_PER_DAY - emailsSentCount;

    if (remainingQuota <= 0) {
      console.log("Daily email quota reached");
      return new Response(
        JSON.stringify({ message: "Daily email quota reached", sent_today: emailsSentCount }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, first_name, business_name");

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      throw profilesError;
    }

    console.log(`Found ${profiles?.length || 0} total profiles`);

    const inactiveUsers: any[] = [];

    for (const profile of profiles || []) {
      // Saltare utenti che hanno già ricevuto email oggi
      if (alreadySentUserIds.has(profile.id)) {
        continue;
      }

      const { data: lastAccess } = await supabase
        .from("access_logs")
        .select("accessed_at")
        .eq("user_id", profile.id)
        .order("accessed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastAccessDate = lastAccess?.accessed_at
        ? new Date(lastAccess.accessed_at)
        : new Date(0);

      if (lastAccessDate < sixDaysAgo) {
        inactiveUsers.push(profile);
      }
    }

    console.log(`Found ${inactiveUsers.length} inactive users (excluding already contacted today)`);

    if (inactiveUsers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No inactive users to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Shuffle e limitare alla quota giornaliera
    const shuffledUsers = inactiveUsers.sort(() => Math.random() - 0.5);
    const usersToContact = shuffledUsers.slice(0, remainingQuota);

    console.log(`Will send emails to ${usersToContact.length} random users (daily quota remaining: ${remainingQuota})`);

    let sentCount = 0;
    let errorCount = 0;

    for (const user of usersToContact) {
      const userName = user.first_name || user.business_name || 'Usuario';

      try {
        const subject = pickRandomSubject();
        await sendEmail({
          to: [user.email],
          replyTo: "info@studentslife.es",
          subject,
          headers: getEmailHeaders(user.email),
          text: buildEmailText(userName, itemsTitles),
          html: buildEmailHtml(userName, eventCardsHtml),
        });

        console.log(`Email sent to ${user.email} with subject: "${subject}"`);
        sentCount++;

        // Registrare invio nel log
        await supabase
          .from("marketing_email_log")
          .insert({ user_id: user.id, sent_at: new Date().toISOString() });
      } catch (e) {
        console.error(`Exception sending to ${user.email}:`, e);
        errorCount++;
      }

      await delay(600);
    }

    console.log(`Marketing emails completed: ${sentCount} sent, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        errors: errorCount,
        inactiveUsers: inactiveUsers.length
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-marketing-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildEmailText(userName: string, itemsTitles: string): string {
  return `
Hola ${userName},

Hace tiempo que no te vemos por StudentsLife. Tenemos nuevas ofertas increíbles esperándote.

Ofertas y eventos destacados:
${itemsTitles}

Visita https://studentslife.es para ver todas las ofertas.

---
StudentsLife - Tu app de descuentos universitarios
Calle Universidad 1, Valladolid, España

Este email fue enviado porque tienes una cuenta en StudentsLife.
Para dejar de recibir estos emails, responde con "Cancelar suscripción" en el asunto.
  `.trim();
}

function buildEmailHtml(userName: string, eventCardsHtml: string): string {
  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="x-apple-disable-message-reformatting">
      <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
      <title>Ofertas en StudentsLife</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header with Logo -->
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://lwtmddtwuiheluccykvs.supabase.co/storage/v1/object/public/avatars/logo.png" alt="StudentsLife" style="width: 120px; height: auto; margin-bottom: 15px;" />
          <h1 style="color: #ec4899; font-size: 28px; margin: 0;">StudentsLife</h1>
          <p style="color: #6b7280; margin-top: 10px; font-size: 14px;">Tu app de descuentos universitarios</p>
        </div>

        <!-- Main Content -->
        <div style="background: linear-gradient(135deg, #fdf2f8, #faf5ff); border-radius: 24px; padding: 30px; margin-bottom: 30px;">
          <h2 style="color: #111827; margin: 0 0 15px 0; font-size: 22px;">Hola ${userName},</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0;">
            Hace tiempo que no te vemos por aquí. Tenemos nuevas ofertas increíbles esperándote.
            Mira lo que nuestros socios tienen preparado para ti:
          </p>
        </div>

        <!-- Events & Discounts -->
        <div style="margin-bottom: 30px;">
          <h3 style="color: #111827; font-size: 18px; margin-bottom: 20px;">Ofertas y eventos destacados</h3>
          ${eventCardsHtml}
        </div>

        <!-- CTA Button -->
        <div style="text-align: center; margin-bottom: 30px;">
          <a href="https://studentslife.es" style="display: inline-block; background: linear-gradient(135deg, #ec4899, #8b5cf6); color: white; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: 600; font-size: 16px;">
            Ver todas las ofertas
          </a>
        </div>

        <!-- Footer with physical address (anti-spam requirement) -->
        <div style="text-align: center; color: #9ca3af; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
          <p style="margin: 0 0 10px 0;"><strong>StudentsLife</strong></p>
          <p style="margin: 0 0 10px 0;">Calle Universidad 1, 47002 Valladolid, España</p>
          <p style="margin: 0 0 10px 0;">Recibiste este email porque tienes una cuenta en StudentsLife.</p>
          <p style="margin: 0;">
            <a href="mailto:unsubscribe@studentslife.es?subject=Cancelar%20suscripcion" style="color: #6b7280; text-decoration: underline;">Cancelar suscripción</a>
            &nbsp;|&nbsp;
            <a href="https://studentslife.es" style="color: #6b7280; text-decoration: underline;">Visitar web</a>
          </p>
          <p style="margin: 10px 0 0 0;">© ${new Date().getFullYear()} StudentsLife. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
