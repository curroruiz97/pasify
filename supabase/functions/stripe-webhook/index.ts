// Webhook Stripe per Studentslife: aggiorna partner_subscriptions in DB,
// invia email di benvenuto / fattura / pagamento fallito al Partner.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/gmail.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "stud3nts1ife.info@gmail.com";

const ISSUER = {
  name: "Jose Pingo",
  nif: "Z1527925V",
  address: "C. Canovas del Castillo, 47002 Valladolid, España",
  regime: "Autónomo",
  brand: "StudentsLife",
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature verification failed:", (err as Error).message);
    return new Response(`Webhook error: ${(err as Error).message}`, { status: 400 });
  }

  console.log("📨 Stripe event:", event.type);

  // Log evento ricevuto. UPSERT su event_id (UNIQUE) per idempotenza:
  // se Stripe ritenta lo stesso evento, incrementiamo attempt_count.
  await supabaseAdmin.from("stripe_webhook_events").upsert(
    {
      event_id: event.id,
      event_type: event.type,
      status: "received",
      livemode: event.livemode,
      payload: event as unknown as Record<string, unknown>,
      received_at: new Date().toISOString(),
    },
    { onConflict: "event_id", ignoreDuplicates: false },
  );

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscription(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await markCancelled(event.data.object as Stripe.Subscription);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "checkout.session.completed":
        // Subscription created handler già gestisce il salvataggio
        console.log("checkout.session.completed:", (event.data.object as Stripe.Checkout.Session).id);
        break;

      default:
        console.log("Unhandled event:", event.type);
    }

    // Log success
    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ status: "succeeded", processed_at: new Date().toISOString() })
      .eq("event_id", event.id);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMessage = (err as Error).message;
    console.error("Webhook handler error:", err);

    // Log failure — utile per dashboard admin e alert
    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        status: "failed",
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
      })
      .eq("event_id", event.id);

    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
  }
});

async function upsertSubscription(sub: Stripe.Subscription) {
  const partnerId = sub.metadata?.partner_id;
  if (!partnerId) {
    console.warn("Subscription without partner_id metadata:", sub.id);
    return;
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  // Normalize to monthly cents. Stripe returns unit_amount in the price's
  // own interval; collapse "year" into a /12 monthly figure so the admin's
  // MRR stat is comparable across plans.
  const unitAmount = item?.price?.unit_amount ?? null;
  const interval = item?.price?.recurring?.interval ?? "month";
  let monthlyAmountCents: number | null = null;
  if (unitAmount != null) {
    if (interval === "year") monthlyAmountCents = Math.round(unitAmount / 12);
    else if (interval === "week") monthlyAmountCents = Math.round((unitAmount * 52) / 12);
    else if (interval === "day") monthlyAmountCents = Math.round((unitAmount * 365) / 12);
    else monthlyAmountCents = unitAmount; // month
  }

  const payload = {
    partner_id: partnerId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: item?.price.id,
    status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    monthly_amount_cents: monthlyAmountCents,
    updated_at: new Date().toISOString(),
  };

  // Pattern robusto: UPDATE prima, INSERT solo se nessuna riga matcha.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("partner_subscriptions")
    .update(payload)
    .eq("partner_id", partnerId)
    .select("id");

  if (updateError) {
    console.error("update error:", updateError);
    return;
  }

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabaseAdmin
      .from("partner_subscriptions")
      .insert(payload);
    if (insertError) {
      console.error("insert error:", insertError);
      return;
    }
    console.log(`✅ Subscription ${sub.id} INSERTED for partner ${partnerId}`);
  } else {
    console.log(`✅ Subscription ${sub.id} UPDATED for partner ${partnerId}`);
  }
}

async function markCancelled(sub: Stripe.Subscription) {
  await supabaseAdmin
    .from("partner_subscriptions")
    .update({ status: "canceled", cancel_at_period_end: false })
    .eq("stripe_subscription_id", sub.id);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customer = await stripe.customers.retrieve(invoice.customer as string);
  if ((customer as Stripe.Customer).deleted) return;
  const cust = customer as Stripe.Customer;

  const totalCents = invoice.amount_paid ?? invoice.total ?? 0;
  // In API 2024-06-20 `invoice.tax` può essere 0/null; calcoliamo l'IVA
  // dalla differenza total − total_excluding_tax (robusto anche per reverse charge).
  const subtotalCents = (invoice as any).total_excluding_tax ?? invoice.subtotal ?? 0;
  const taxCents = Math.max(0, totalCents - subtotalCents);
  const total = (totalCents / 100).toFixed(2);
  const subtotal = (subtotalCents / 100).toFixed(2);
  const tax = (taxCents / 100).toFixed(2);
  const country = invoice.customer_address?.country || "";
  const customerTaxIds = invoice.customer_tax_ids || [];
  const hasEuVat = customerTaxIds.some((t) => t.type === "eu_vat");

  let taxClause = "";
  if (country === "ES") {
    taxClause = "IVA 21% aplicado según normativa vigente en España.";
  } else if (hasEuVat && country !== "ES") {
    taxClause = "Operación intracomunitaria — Inversión del sujeto pasivo (art. 84.Uno.2º LIVA).";
  } else if (country && !["ES","AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","SE"].includes(country)) {
    taxClause = "Operación no sujeta a IVA por aplicación del art. 69.Uno.2º LIVA (servicio prestado a cliente fuera de la UE).";
  } else {
    taxClause = "IVA aplicado según normativa vigente.";
  }

  const html = invoiceEmailHtml({
    name: cust.name || cust.email?.split("@")[0] || "Partner",
    invoiceNumber: invoice.number || "",
    date: new Date(invoice.created * 1000).toLocaleDateString("es-ES"),
    description: invoice.lines?.data[0]?.description || "Suscripción Partner StudentsLife",
    subtotal, tax, total, taxClause,
    pdfUrl: invoice.invoice_pdf || "",
    hostedUrl: invoice.hosted_invoice_url || "",
  });

  await sendEmail({
    to: cust.email!,
    subject: `Tu factura StudentsLife #${invoice.number}`,
    html,
  });

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `[COPIA] Nueva factura pagada #${invoice.number}`,
    html,
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customer = await stripe.customers.retrieve(invoice.customer as string);
  if ((customer as Stripe.Customer).deleted) return;
  const cust = customer as Stripe.Customer;

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `⚠️ Pago fallido StudentsLife — ${cust.email}`,
    html: `
      <h2>Pago Fallido</h2>
      <p><strong>Cliente:</strong> ${cust.name || cust.email}</p>
      <p><strong>Email:</strong> ${cust.email}</p>
      <p><strong>Factura:</strong> #${invoice.number}</p>
      <p><strong>Importe:</strong> €${(invoice.amount_due / 100).toFixed(2)}</p>
      <p><a href="https://dashboard.stripe.com/invoices/${invoice.id}">Ver en Stripe</a></p>
    `,
  });
}

function invoiceEmailHtml(d: {
  name: string;
  invoiceNumber: string;
  date: string;
  description: string;
  subtotal: string;
  tax: string;
  total: string;
  taxClause: string;
  pdfUrl: string;
  hostedUrl: string;
}) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f5f7fb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.08);">
    <tr><td style="background:linear-gradient(135deg,#4F9CF9 0%,#3B82F6 100%);padding:40px 30px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;">StudentsLife</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Factura Pagada</p>
    </td></tr>
    <tr><td style="padding:40px 30px;">
      <p style="font-size:15px;color:#333;">Hola <strong>${d.name}</strong>,</p>
      <p style="font-size:15px;color:#555;line-height:1.6;">¡Gracias por tu pago! Aquí los detalles de tu factura:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f8f9ff;border-radius:12px;">
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;color:#666;">Número factura</td><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;text-align:right;font-weight:600;color:#333;">#${d.invoiceNumber}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;color:#666;">Fecha</td><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;text-align:right;font-weight:600;color:#333;">${d.date}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;color:#666;">Descripción</td><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;text-align:right;font-weight:600;color:#333;">${d.description}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;color:#666;">Subtotal</td><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;text-align:right;font-weight:600;color:#333;">€${d.subtotal}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;color:#666;">IVA</td><td style="padding:14px 18px;border-bottom:1px solid #e8ebf5;text-align:right;font-weight:600;color:#333;">€${d.tax}</td></tr>
        <tr><td style="padding:14px 18px;color:#333;font-weight:700;">Total pagado</td><td style="padding:14px 18px;text-align:right;font-weight:700;color:#3B82F6;font-size:18px;">€${d.total}</td></tr>
      </table>
      <div style="background:#fff7ed;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;font-size:13px;color:#92400e;margin:16px 0;">${d.taxClause}</div>
      <div style="text-align:center;margin:24px 0;">
        ${d.pdfUrl ? `<a href="${d.pdfUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:6px;">Descargar PDF</a>` : ""}
        ${d.hostedUrl ? `<a href="${d.hostedUrl}" style="display:inline-block;background:#374151;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:6px;">Ver online</a>` : ""}
      </div>
      <div style="background:#f9fafb;padding:14px 18px;border-radius:8px;font-size:12px;color:#555;line-height:1.6;margin-top:24px;">
        <strong>${ISSUER.name}</strong><br>
        NIF: ${ISSUER.nif}<br>
        ${ISSUER.address}<br>
        Régimen: ${ISSUER.regime}
      </div>
    </td></tr>
  </table>
</body></html>`;
}
