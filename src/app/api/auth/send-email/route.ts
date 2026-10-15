import { Resend } from "resend";
import { WebhookVerificationError } from "standardwebhooks";
import { authEmailMessage } from "@/lib/auth-email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secret || !apiKey || !siteUrl) {
    return Response.json({ error: { http_code: 500, message: "Authentication email delivery is not configured." } }, { status: 500 });
  }
  try {
    const message = authEmailMessage(await request.text(), Object.fromEntries(request.headers), {
      secret, siteUrl,
      from: process.env.RESEND_AUTH_FROM ?? "Darwin <noreply@vesperworks.ca>",
      signupTemplate: process.env.RESEND_SIGNUP_TEMPLATE_ID ?? "",
      recoveryTemplate: process.env.RESEND_RECOVERY_TEMPLATE_ID ?? "",
    });
    const { error } = await new Resend(apiKey).emails.send(message, {
      idempotencyKey: `auth-email/${request.headers.get("webhook-id")}`,
    });
    if (error) {
      // Never log email bodies, recipients, or confirmation tokens.
      console.error("[auth email] Resend delivery failed", error.name);
      return Response.json({ error: { http_code: 502, message: "Email delivery failed. Please try again." } }, { status: 502 });
    }
    return Response.json({});
  } catch (error) {
    const status = error instanceof WebhookVerificationError ? 401 : 500;
    return Response.json({ error: { http_code: status, message: status === 401 ? "Invalid webhook signature." : "Authentication email could not be sent." } }, { status });
  }
}
