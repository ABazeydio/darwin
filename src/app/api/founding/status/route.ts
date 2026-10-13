import { createClient } from "@/lib/supabase/server";
import { fulfillMembership } from "@/lib/membership-fulfillment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to view your purchase" }, { status: 401 });
  let sessionId: unknown;
  try { sessionId = (await request.json()).sessionId; } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (typeof sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || sessionId.length > 255) return Response.json({ error: "Invalid session" }, { status: 400 });
  try {
    const result = await fulfillMembership(sessionId, user.id);
    if (result.status === 'invalid') return Response.json({ error: "This purchase could not be verified for your account" }, { status: 403 });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: "pending" }, { status: 503 });
  }
}
