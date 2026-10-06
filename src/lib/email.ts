import "server-only";
import nodemailer from "nodemailer";
import { COMPANY } from "@/lib/pdf";

// Email goes out through the company's own mail service, set only by environment variables. Nothing here is ever
// shown in the browser, stored in the database or committed to GitHub:
//   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD, EMAIL_FROM, EMAIL_FROM_NAME, EMAIL_SECURE (true for port 465)

export function emailStatus() {
  const missing = ["EMAIL_HOST", "EMAIL_USER", "EMAIL_PASSWORD", "EMAIL_FROM"].filter((k) => !process.env[k]);
  return {
    configured: missing.length === 0,
    missing,
    host: process.env.EMAIL_HOST ?? null,
    port: Number(process.env.EMAIL_PORT ?? 587),
    from: process.env.EMAIL_FROM ?? null,
    fromName: process.env.EMAIL_FROM_NAME ?? COMPANY,
    user: process.env.EMAIL_USER ? process.env.EMAIL_USER.replace(/^(.{2}).*(@.*)?$/, (_m, a: string, b?: string) => `${a}…${b ?? ""}`) : null, // masked
  };
}

export type Mail = { to: string; subject: string; text: string; html: string };

/** Sends one email. Returns false (and says why on the server log) when mail is not set up or fails; it never throws. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const status = emailStatus();
  if (!status.configured) {
    console.warn(`[email] not configured (missing ${status.missing.join(", ")}); "${mail.subject}" to ${mail.to} was not sent`);
    return false;
  }
  try {
    const port = status.port;
    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST, port, secure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === "true" : port === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }, connectionTimeout: 10_000, socketTimeout: 15_000,
    });
    await transport.sendMail({ from: { name: status.fromName, address: process.env.EMAIL_FROM! }, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return true;
  } catch (e) {
    console.error("[email] sending failed:", (e as Error).message);
    return false;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const support = () => process.env.SUPPORT_EMAIL ?? process.env.EMAIL_FROM ?? "your administrator";

function wrap(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#16202c">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #d9dfe7;border-radius:8px;overflow:hidden">
<div style="background:#16202c;color:#fff;padding:18px 24px;font-weight:700;font-size:16px">${esc(COMPANY)}</div>
<div style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${bodyHtml}
<p style="color:#5a6677;font-size:12px;margin-top:24px">Need help? Contact ${esc(support())}.</p></div></div></body></html>`;
}

export function resetEmail(name: string | null, link: string, minutes: number): Mail & { to: "" } {
  const hello = name ? `Hello ${name},` : "Hello,";
  return {
    to: "", subject: "Password Reset Request",
    text: `${hello}\n\nYou requested a password reset for your ${COMPANY} account. Open this link to choose a new password (it works once and expires in ${minutes} minutes):\n\n${link}\n\nIf you did not request this, you can safely ignore this email. Your password has not changed. Never share this link.\n\nNeed help? Contact ${support()}.`,
    html: wrap("Password Reset Request", `<p>${esc(hello)}</p>
<p>You requested a password reset for your account. Click the button to choose a new password. The link works once and expires in <b>${minutes} minutes</b>.</p>
<p style="margin:22px 0"><a href="${esc(link)}" style="background:#1c5db0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700;display:inline-block">Reset password</a></p>
<p style="font-size:12px;color:#5a6677">Or copy this address into your browser:<br>${esc(link)}</p>
<p style="background:#fff7e6;border:1px solid #f0d9a6;border-radius:6px;padding:10px 12px;font-size:13px"><b>Security warning:</b> if you did not request this, you can safely ignore this email. Your password has not changed. We will never ask for your password by email. Never share this link.</p>`),
  };
}

export function passwordChangedEmail(name: string | null): Mail & { to: "" } {
  const hello = name ? `Hello ${name},` : "Hello,";
  return {
    to: "", subject: "Your password was changed",
    text: `${hello}\n\nThe password for your ${COMPANY} account was just changed. If this was you, no action is needed.\n\nIf it was not you, contact ${support()} immediately.`,
    html: wrap("Your password was changed", `<p>${esc(hello)}</p><p>The password for your account was just changed. If this was you, no action is needed.</p>
<p style="background:#fdecea;border:1px solid #f1b8b3;border-radius:6px;padding:10px 12px;font-size:13px"><b>If it was not you</b>, contact ${esc(support())} immediately so your account can be secured.</p>`),
  };
}
