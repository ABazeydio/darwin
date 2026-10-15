import { Webhook } from "standardwebhooks";

export type AuthEmailConfig = {
  secret: string;
  siteUrl: string;
  from: string;
  signupTemplate: string;
  recoveryTemplate: string;
};

/** Only signed Supabase events can supply recipients and authentication tokens. */
export function authEmailMessage(body: string, headers: Record<string, string>, config: AuthEmailConfig) {
  const payload = new Webhook(config.secret.replace(/^v1,/, "")).verify(body, headers) as {
    user?: { email?: string };
    email_data?: { email_action_type?: string; token_hash?: string; redirect_to?: string };
  };
  const type = payload.email_data?.email_action_type;
  if (type !== "signup" && type !== "recovery") throw new Error("Unsupported authentication email type");
  if (!payload.user?.email || !payload.email_data?.token_hash) throw new Error("Invalid authentication email payload");
  const template = type === "signup" ? config.signupTemplate : config.recoveryTemplate;
  if (!template) throw new Error("Authentication email template is not configured");
  const url = new URL("/auth/confirm", config.siteUrl);
  url.searchParams.set("token_hash", payload.email_data.token_hash);
  url.searchParams.set("type", type);
  // Recovery always goes to the password form. Signup retains an internal next path.
  let next = "/browse";
  if (type === "signup" && payload.email_data.redirect_to) {
    const redirect = new URL(payload.email_data.redirect_to);
    const requested = redirect.searchParams.get("next");
    if (redirect.origin === url.origin && requested?.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\")) next = requested;
  }
  url.searchParams.set("next", type === "recovery" ? "/reset-password" : next);
  return {
    from: config.from,
    to: payload.user.email,
    subject: type === "signup" ? "Verify your email to join Darwin" : "Reset your Darwin password",
    template: { id: template, variables: { ACTION_URL: url.toString() } },
  };
}
