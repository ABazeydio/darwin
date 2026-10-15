"use server";

import { createClient } from "@/lib/supabase/server";
import { isSignupPasswordValid, PASSWORD_REQUIREMENTS } from "@/lib/password-validation";

export async function requestPasswordRecovery(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${site}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: "We couldn’t send the reset email. Please try again shortly." };
  return { success: true };
}

export async function resetPassword(password: string) {
  if (!isSignupPasswordValid(password)) return { error: PASSWORD_REQUIREMENTS };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  await supabase.auth.signOut();
  return { success: true };
}
