import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { completeEnrollment } from "@/features/auth/enrollment";
import { pendingSignupForUser } from "@/features/auth/pending-signup-cookie";

export const dynamic = "force-dynamic";
function go(path: string) {
  const response = NextResponse.redirect(new URL(path, getPublicEnv().NEXT_PUBLIC_SITE_URL));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const recovery = params.get("purpose") === "recovery" || ["recovery", "invite"].includes(params.get("type") ?? "");
  const invalid = () => go(recovery ? "/redefinir-senha?error=invalid_link" : "/confirmar-email?error=invalid_link");
  if (params.has("error") || params.has("error_code")) return invalid();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const flowId = params.get("sb_flow_id");
  if (flowId && !/^[a-zA-Z0-9-]{1,128}$/.test(flowId)) return invalid();
  if ((!code && !tokenHash) || (code && tokenHash) || (code?.length ?? 0) > 2048 || (tokenHash?.length ?? 0) > 2048) return invalid();
  const supabase = await createSupabaseServerClient();
  let userId: string;
  let isRecovery = false;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (error || !data.user || !data.session) return invalid();
    userId = data.user.id;
    // This SDK returns redirectType at runtime but omits it from the
    // public response type. Fail closed if the field is absent.
    isRecovery = "redirectType" in data && data.redirectType === "recovery";
    if (recovery && !isRecovery) return invalid();
  } else {
    if (type !== "signup" && type !== "email" && type !== "recovery" && type !== "invite") return invalid();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type });
    if (error || !data.user || !data.session) return invalid();
    userId = data.user.id;
    isRecovery = type === "recovery" || type === "invite";
  }
  if (isRecovery) return go("/redefinir-senha");
  const pending = await pendingSignupForUser(userId);
  if (pending) {
    // The verified session and immutable browser state are both required.
    const result = await completeEnrollment(pending);
    return go(result.status === "complete" ? result.destination : "/cadastro?notice=enrollment_retry");
  }
  // Missing/expired browser state never becomes trusted user_metadata.
  // A verified account can finish via the authenticated enrollment form.
  return go("/cadastro?confirmed=1");
}
