import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Verification can complete after signup, before its profile insert runs. */
export async function ensureAccountProfile(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (error || data) return { error };
  const metadata = user.user_metadata;
  const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : null;
  const firstName = text(metadata.first_name, 50) || "Student";
  const lastName = text(metadata.last_name, 50);
  // Ignore a concurrent insert rather than overwriting a profile or paid tier.
  return supabase.from("profiles").upsert({
    id: user.id, username: user.email?.split("@")[0] || `user_${user.id.slice(0, 8)}`,
    first_name: firstName, last_name: lastName, full_name: [firstName, lastName].filter(Boolean).join(" "),
    school: text(metadata.school, 100), level_of_study: text(metadata.level_of_study, 100), program: text(metadata.program, 150),
    interests: Array.isArray(metadata.interests) ? metadata.interests.filter((value): value is string => typeof value === "string").slice(0, 30) : null,
  }, { onConflict: "id", ignoreDuplicates: true });
}
