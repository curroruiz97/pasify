import nodemailer from "npm:nodemailer@6";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: Deno.env.get("GMAIL_USER"),
    pass: Deno.env.get("GMAIL_APP_PASSWORD"),
  },
});

const FROM_ADDRESS = `StudentsLife <${Deno.env.get("GMAIL_USER") || "stud3nts1ife.info@gmail.com"}>`;

export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}) {
  const { to, subject, html, text, replyTo, headers } = options;

  console.log(`📧 Sending email to: ${Array.isArray(to) ? to.join(", ") : to}`);

  const info = await transporter.sendMail({
    from: FROM_ADDRESS,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
    text,
    replyTo,
    headers,
  });

  console.log(`✅ Email sent successfully. MessageId: ${info.messageId}`);
  return info;
}
