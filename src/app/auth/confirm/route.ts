import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureAccountProfile } from "@/lib/ensure-account-profile";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (tokenHash && (type === "signup" || type === "recovery")) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error && data.user) {
      const { error: profileError } = await ensureAccountProfile(supabase, data.user);
      if (!profileError) {
        const requested = url.searchParams.get("next");
        const next = type === "recovery" ? "/reset-password"
          : requested?.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") ? requested : "/browse";
        return NextResponse.redirect(new URL(next, url.origin));
      }
    }
  }
  return NextResponse.redirect(new URL("/login?error=Authentication%20link%20expired%20or%20invalid.%20Please%20try%20again.", url.origin));
}
